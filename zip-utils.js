/**
 * zip-utils.js
 * 外部ライブラリ不要！純粋なJavaScriptで複数画像を単一ZIPファイルにまとめる軽量ZIPアーカイブ生成ユーティリティ
 * (画像ファイルはすでに高圧縮されているため、高速なSTORE方式で瞬時にZIP作成可能)
 */
class SimpleZip {
  constructor() {
    this.files = [];
  }

  /**
   * ファイルを追加
   * @param {string} filename 
   * @param {Uint8Array|Blob} data 
   */
  async addFile(filename, data) {
    let uint8;
    if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      uint8 = new Uint8Array(buffer);
    } else if (data instanceof ArrayBuffer) {
      uint8 = new Uint8Array(data);
    } else {
      uint8 = data;
    }
    this.files.push({
      name: filename,
      data: uint8,
      crc: this.calculateCRC32(uint8)
    });
  }

  /**
   * CRC-32 チェックサム計算
   */
  calculateCRC32(bytes) {
    if (!SimpleZip.crcTable) {
      SimpleZip.crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        SimpleZip.crcTable[i] = c;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ SimpleZip.crcTable[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * ZIP Blobを生成
   * @returns {Blob}
   */
  generateZipBlob() {
    const fileEntries = [];
    let localOffset = 0;
    const parts = [];

    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const textEncoder = new TextEncoder();

    // 1. 各ファイルのローカルヘッダ + ファイルデータ
    for (const file of this.files) {
      const nameBytes = textEncoder.encode(file.name);
      const size = file.data.length;
      const crc = file.crc;

      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);

      view.setUint32(0, 0x04034B50, true); // Local file header signature
      view.setUint16(4, 20, true);         // Version needed to extract (2.0)
      view.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8)
      view.setUint16(8, 0, true);          // Compression method (0 = Store)
      view.setUint16(10, dosTime, true);   // Last mod time
      view.setUint16(12, dosDate, true);   // Last mod date
      view.setUint32(14, crc, true);       // CRC-32
      view.setUint32(18, size, true);      // Compressed size
      view.setUint32(22, size, true);      // Uncompressed size
      view.setUint16(26, nameBytes.length, true); // Filename length
      view.setUint16(28, 0, true);         // Extra field length
      header.set(nameBytes, 30);

      parts.push(header);
      parts.push(file.data);

      fileEntries.push({
        nameBytes,
        size,
        crc,
        offset: localOffset
      });

      localOffset += header.length + size;
    }

    // 2. セントラルディレクトリヘッダ群
    const cdOffset = localOffset;
    let cdSize = 0;

    for (const entry of fileEntries) {
      const cdHeader = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(cdHeader.buffer);

      view.setUint32(0, 0x02014B50, true); // Central directory header signature
      view.setUint16(4, 20, true);         // Version made by
      view.setUint16(6, 20, true);         // Version needed to extract
      view.setUint16(8, 0x0800, true);     // General purpose bit flag (UTF-8)
      view.setUint16(10, 0, true);         // Compression method (Store)
      view.setUint16(12, dosTime, true);   // Last mod time
      view.setUint16(14, dosDate, true);   // Last mod date
      view.setUint32(16, entry.crc, true); // CRC-32
      view.setUint32(20, entry.size, true);// Compressed size
      view.setUint32(24, entry.size, true);// Uncompressed size
      view.setUint16(28, entry.nameBytes.length, true); // Filename length
      view.setUint16(30, 0, true);         // Extra field length
      view.setUint16(32, 0, true);         // Comment length
      view.setUint16(34, 0, true);         // Disk number start
      view.setUint16(36, 0, true);         // Internal file attributes
      view.setUint32(38, 0, true);         // External file attributes
      view.setUint32(42, entry.offset, true); // Relative offset of local header
      cdHeader.set(entry.nameBytes, 46);

      parts.push(cdHeader);
      cdSize += cdHeader.length;
    }

    // 3. エンドオブセントラルディレクトリレコード (EOCD)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054B50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Number of this disk
    eocdView.setUint16(6, 0, true);          // Disk with start of CD
    eocdView.setUint16(8, fileEntries.length, true); // Total entries on this disk
    eocdView.setUint16(10, fileEntries.length, true); // Total entries
    eocdView.setUint32(12, cdSize, true);    // Size of central directory
    eocdView.setUint32(16, cdOffset, true);  // Offset of CD
    eocdView.setUint16(20, 0, true);         // Comment length

    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }
}
