/**
 * worker.js
 * マルチスレッドWeb Worker - CPUマルチコア並列処理 & 二分探索による目標容量最適化
 */

// Worker内で利用可能な場合はgpu-resizerをインポート
try {
  importScripts('gpu-resizer.js');
} catch (e) {
  // 環境によってインポート失敗した場合は2Dコンテキストフォールバック
}

let gpuResizerInstance = null;
try {
  if (typeof GPUImageResizer !== 'undefined') {
    gpuResizerInstance = new GPUImageResizer();
  }
} catch (e) {
  gpuResizerInstance = null;
}

self.onmessage = async function (e) {
  const { id, file, options, workerIndex } = e.data;
  const startTime = performance.now();

  try {
    // 1. 画像デコード (createImageBitmap: ブラウザがGPUを活用して高速並列デコード)
    const bitmap = await createImageBitmap(file);
    const origWidth = bitmap.width;
    const origHeight = bitmap.height;
    const origSize = file.size;

    const {
      targetMaxBytes = 0,         // 0なら容量制限なし
      maxWidth = 0,
      maxHeight = 0,
      mimeType = 'image/jpeg',    // 'image/jpeg', 'image/webp', 'image/png'
      qualityPreset = 0.85,       // 目標サイズ未指定時のデフォルト品質
      maintainAspectRatio = true
    } = options;

    // 2. 寸法の算出
    let baseWidth = origWidth;
    let baseHeight = origHeight;

    if (maxWidth > 0 && maxHeight > 0) {
      if (maintainAspectRatio) {
        const ratio = Math.min(maxWidth / origWidth, maxHeight / origHeight, 1.0);
        baseWidth = Math.round(origWidth * ratio);
        baseHeight = Math.round(origHeight * ratio);
      } else {
        baseWidth = Math.min(maxWidth, origWidth);
        baseHeight = Math.min(maxHeight, origHeight);
      }
    } else if (maxWidth > 0) {
      if (origWidth > maxWidth) {
        const ratio = maxWidth / origWidth;
        baseWidth = maxWidth;
        baseHeight = Math.round(origHeight * ratio);
      }
    } else if (maxHeight > 0) {
      if (origHeight > maxHeight) {
        const ratio = maxHeight / origHeight;
        baseHeight = maxHeight;
        baseWidth = Math.round(origWidth * ratio);
      }
    }

    // 3. リサイズおよびファイルサイズ最適化 (GPU VRAMパイプライン)
    let bestBlob = null;
    let finalWidth = baseWidth;
    let finalHeight = baseHeight;
    let finalQuality = qualityPreset;
    let iterations = 0;

    // PNGはロスレスのため品質パラメータが効かない点に注意（targetMaxBytesがある場合はWebP/JPEG推奨または寸法縮小）
    const effectiveMimeType = (targetMaxBytes > 0 && mimeType === 'image/png') ? 'image/webp' : mimeType;

    // GPU VRAM上に元画像テクスチャを1度だけアップロードして常駐（PCIe帯域とRAMを大幅節約）
    let vramTex = null;
    if (gpuResizerInstance && gpuResizerInstance.gl) {
      try {
        vramTex = gpuResizerInstance.createVRAMTexture(bitmap);
      } catch (e) {
        vramTex = null;
      }
    }

    const renderWorkingCanvas = (w, h) => {
      if (vramTex) {
        const c = gpuResizerInstance.resizeFromVRAM(vramTex, w, h);
        if (c) return c;
      }
      return renderImageToCanvas(bitmap, w, h);
    };

    // 目標データサイズが設定されている場合のバイナリサーチ（二分探索）アルゴリズム
    if (targetMaxBytes > 0) {
      let currentScale = 1.0;
      let targetSatisfied = false;

      // 解像度スケールループ（品質を下げても入らない場合は解像度を少しずつ落とす）
      for (let scaleAttempt = 0; scaleAttempt < 5; scaleAttempt++) {
        const testWidth = Math.max(16, Math.round(baseWidth * currentScale));
        const testHeight = Math.max(16, Math.round(baseHeight * currentScale));

        // GPU VRAMからダイレクト描画
        const canvas = renderWorkingCanvas(testWidth, testHeight);

        // 品質バイナリサーチ
        let lowQ = 0.20;
        let highQ = 0.95;
        let bestUnderTarget = null;
        let bestUnderQ = 0.20;

        // 最大5回のバイナリ探索で目標サイズ以内の最高品質を特定
        for (let b = 0; b < 5; b++) {
          iterations++;
          const midQ = (lowQ + highQ) / 2;
          const blob = await canvasToBlob(canvas, effectiveMimeType, midQ);

          if (blob.size <= targetMaxBytes) {
            bestUnderTarget = blob;
            bestUnderQ = midQ;
            // 許容誤差範囲（目標の90%以上）なら即確定
            if (blob.size >= targetMaxBytes * 0.90) {
              break;
            }
            // さらに高い品質を狙える
            lowQ = midQ;
          } else {
            // 目標を超えているので品質を下げる
            highQ = midQ;
          }
        }

        if (bestUnderTarget) {
          bestBlob = bestUnderTarget;
          finalWidth = testWidth;
          finalHeight = testHeight;
          finalQuality = Math.round(bestUnderQ * 100) / 100;
          targetSatisfied = true;
          break;
        }

        // 最小品質でも目標サイズを超えている場合、解像度を75%に縮小して再試行
        currentScale *= 0.75;
      }

      // 万一どの解像度でも入らなかった場合は最後の最小スケールblobを採用
      if (!bestBlob) {
        const fallbackCanvas = renderWorkingCanvas(Math.max(16, Math.round(baseWidth * 0.4)), Math.max(16, Math.round(baseHeight * 0.4)));
        bestBlob = await canvasToBlob(fallbackCanvas, effectiveMimeType, 0.25);
        finalWidth = fallbackCanvas.width;
        finalHeight = fallbackCanvas.height;
        finalQuality = 0.25;
      }
    } else {
      // 目標サイズ指定なし（通常の解像度・指定品質リサイズ）
      iterations = 1;
      const canvas = renderWorkingCanvas(baseWidth, baseHeight);
      bestBlob = await canvasToBlob(canvas, effectiveMimeType, qualityPreset);
      finalWidth = baseWidth;
      finalHeight = baseHeight;
      finalQuality = qualityPreset;
    }

    // GPU VRAMテクスチャとビットマップの安全解放
    if (vramTex && gpuResizerInstance) {
      gpuResizerInstance.releaseVRAMTexture(vramTex);
    }
    bitmap.close();

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    self.postMessage({
      status: 'success',
      id,
      workerIndex,
      result: {
        blob: bestBlob,
        origName: file.name,
        origSize,
        origWidth,
        origHeight,
        outputSize: bestBlob.size,
        outputWidth: finalWidth,
        outputHeight: finalHeight,
        quality: finalQuality,
        mimeType: effectiveMimeType,
        durationMs,
        iterations,
        reductionPercent: Math.round(((origSize - bestBlob.size) / origSize) * 1000) / 10
      }
    });

  } catch (err) {
    self.postMessage({
      status: 'error',
      id,
      workerIndex,
      error: err.message || String(err)
    });
  }
};

/**
 * GPUまたは高速Canvasを用いて画像をリサイズ描画
 */
function renderImageToCanvas(source, width, height) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));

  if (gpuResizerInstance && gpuResizerInstance.gl) {
    try {
      return gpuResizerInstance.resize(source, width, height);
    } catch (e) {
      // フォールバック
    }
  }

  // 2D OffscreenCanvas フォールバック (ブラウザ内部でGPUハードウェアアクセラレーション利用)
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * OffscreenCanvasをBlobに変換
 */
function canvasToBlob(canvas, mimeType, quality) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  // 万一フォールバックが必要な場合
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}
