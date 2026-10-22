/**
 * gpu-resizer.js
 * WebGL 2.0 / WebGL を活用したGPUハードウェアアクセラレーション画像リサイズモジュール
 */
class GPUImageResizer {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.positionBuffer = null;
    this.texCoordBuffer = null;
    this.gpuInfo = {
      isAvailable: false,
      renderer: 'Unknown',
      vendor: 'Unknown',
      version: 'None',
      webgpuAvailable: typeof navigator !== 'undefined' && !!navigator.gpu
    };
    this.allocatedVRAMBytes = 0;
    this.initGL();
  }

  initGL() {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.canvas = new OffscreenCanvas(256, 256);
      } else if (typeof document !== 'undefined') {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 256;
        this.canvas.height = 256;
      } else {
        return;
      }

      const glOptions = {
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true, // VRAM内の描画ピクセルを保持しダイレクトBlob変換を可能にする
        powerPreference: 'high-performance'
      };

      this.gl = this.canvas.getContext('webgl2', glOptions) ||
                this.canvas.getContext('webgl', glOptions) ||
                this.canvas.getContext('experimental-webgl', glOptions);

      if (!this.gl) {
        console.warn('WebGL is not supported in this environment.');
        return;
      }

      // GPU情報の取得
      const debugInfo = this.gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        this.gpuInfo.renderer = this.gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Generic GPU';
        this.gpuInfo.vendor = this.gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Generic Vendor';
      } else {
        this.gpuInfo.renderer = this.gl.getParameter(this.gl.RENDERER) || 'Generic WebGL';
        this.gpuInfo.vendor = this.gl.getParameter(this.gl.VENDOR) || 'Generic Vendor';
      }
      this.gpuInfo.version = this.gl.getParameter(this.gl.VERSION) || 'WebGL 1.0';
      this.gpuInfo.isAvailable = true;

      this.initShaders();
    } catch (err) {
      console.warn('GPUImageResizer init error:', err);
    }
  }

  initShaders() {
    const gl = this.gl;
    if (!gl) return;

    // 頂点シェーダー（クリッピング空間へのマッピングとテクスチャ座標）
    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // フラグメントシェーダー（ハードウェアバイリニアフィルタリングテクスチャサンプリング）
    const fsSource = `
      precision highp float;
      uniform sampler2D u_image;
      varying vec2 v_texCoord;
      void main() {
        gl_FragColor = texture2D(u_image, v_texCoord);
      }
    `;

    const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program link failed: ' + gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;

    // ジオメトリバッファの設定（画面全体のクアッド）
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0
    ]), gl.STATIC_DRAW);

    // テクスチャ座標バッファ（画像のY軸反転を補正）
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0, 1.0,
      1.0, 1.0,
      0.0, 0.0,
      0.0, 0.0,
      1.0, 1.0,
      1.0, 0.0
    ]), gl.STATIC_DRAW);
  }

  createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('An error occurred compiling shader: ' + gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * 画像をGPU専用ビデオメモリ（VRAM）へテクスチャとしてロード・常駐
   * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} sourceImage
   * @returns {Object|null} VRAMテクスチャディスクリプタ
   */
  createVRAMTexture(sourceImage) {
    if (!this.gl || !this.program) return null;
    const gl = this.gl;
    try {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceImage);

      const w = sourceImage.width || 0;
      const h = sourceImage.height || 0;
      const bytes = w * h * 4;
      this.allocatedVRAMBytes = (this.allocatedVRAMBytes || 0) + bytes;

      return {
        texture,
        width: w,
        height: h,
        bytes
      };
    } catch (err) {
      console.warn('VRAM texture creation failed:', err);
      return null;
    }
  }

  /**
   * GPU VRAM上のテクスチャを即座に解放
   * @param {Object} texHandle
   */
  releaseVRAMTexture(texHandle) {
    if (!this.gl || !texHandle || !texHandle.texture) return;
    try {
      this.gl.deleteTexture(texHandle.texture);
      if (texHandle.bytes) {
        this.allocatedVRAMBytes = Math.max(0, (this.allocatedVRAMBytes || 0) - texHandle.bytes);
      }
      texHandle.texture = null;
    } catch (e) {}
  }

  /**
   * GPU VRAM上のテクスチャから指定解像度に高速ダイレクト描画
   * （メインCPU RAMを経由せずGPU VRAM内で完結）
   * @param {Object} texHandle
   * @param {number} targetWidth
   * @param {number} targetHeight
   * @returns {OffscreenCanvas|HTMLCanvasElement}
   */
  resizeFromVRAM(texHandle, targetWidth, targetHeight) {
    if (!this.gl || !this.program || !texHandle || !texHandle.texture) {
      return null;
    }
    const gl = this.gl;
    targetWidth = Math.max(1, Math.round(targetWidth));
    targetHeight = Math.max(1, Math.round(targetHeight));

    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    gl.viewport(0, 0, targetWidth, targetHeight);

    gl.useProgram(this.program);

    const posAttr = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posAttr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    const texAttr = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.enableVertexAttribArray(texAttr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.vertexAttribPointer(texAttr, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, texHandle.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return this.canvas;
  }

  /**
   * GPUを活用して画像をターゲットサイズにリサイズ
   * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} sourceImage
   * @param {number} targetWidth
   * @param {number} targetHeight
   * @returns {HTMLCanvasElement|OffscreenCanvas} リサイズ済みCanvas
   */
  resize(sourceImage, targetWidth, targetHeight) {
    targetWidth = Math.max(1, Math.round(targetWidth));
    targetHeight = Math.max(1, Math.round(targetHeight));

    // WebGLが利用可能な場合はVRAM経由でハードウェアアクセラレーション描画
    if (this.gl && this.program) {
      try {
        const vramTex = this.createVRAMTexture(sourceImage);
        if (vramTex) {
          const res = this.resizeFromVRAM(vramTex, targetWidth, targetHeight);
          this.releaseVRAMTexture(vramTex);
          if (res) return res;
        }
      } catch (err) {
        console.warn('WebGL rendering failed, falling back to 2D Canvas GPU pipeline:', err);
      }
    }

    // フォールバック: ブラウザネイティブのGPUアクセラレーション付き2D Canvas
    let fallbackCanvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      fallbackCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    } else {
      fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = targetWidth;
      fallbackCanvas.height = targetHeight;
    }
    const ctx = fallbackCanvas.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
    return fallbackCanvas;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GPUImageResizer;
}
