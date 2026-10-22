/**
 * app.js
 * メインアプリケーションロジック:
 * - CPU Worker Pool（マルチスレッド並列処理）管理
 * - GPU検出 & WebGLハードウェアアクセラレーション連携
 * - 目標ファイルサイズ設定（1MB以下等）
 * - File System Access API による出力先フォルダ選択 & 自動保存
 * - ドラッグ＆ドロップ / クリップボード画像受付
 * - リアルタイムモニター & 結果プレビュー
 */

// グローバル状態
const state = {
  // ハードウェア
  cpuCores: navigator.hardwareConcurrency || 4,
  workers: [],
  workerStatus: [], // 'idle' | 'busy'
  gpuResizer: null,
  gpuInfo: null,

  // ジョブキュー & 実行ステータス
  jobQueue: [],
  activeJobs: 0,
  isProcessing: false, // ユーザーがスタートボタンを押して処理中か
  isPaused: false,     // ユーザーが停止ボタンを押して一時停止中か
  processedItems: [], // 処理完了アイテムのリスト
  fileMap: new Map(), // ジョブIDごとの元Fileオブジェクト参照 (プレビュー比較用)
  totalProcessedCount: 0,
  totalSavedBytes: 0,
  totalProcessTimeMs: 0,

  // 設定
  settings: {
    targetMaxBytes: 1000 * 1024, // デフォルト 1MB (1,024,000 bytes)
    targetSizePreset: '1mb',     // '300kb' | '500kb' | '1mb' | '2mb' | '5mb' | 'custom' | 'none'
    maxWidth: 0,
    maxHeight: 0,
    mimeType: 'image/webp',      // 'image/webp' | 'image/jpeg' | 'image/png'
    qualityPreset: 0.85,
    filenameSuffix: '_resized',
    autoSave: false,
    maxMemoryBytes: 1024 * 1024 * 1024, // デフォルト 1GB (1,073,741,824 bytes)
    maxConcurrency: 4,                  // 最大並列スレッド数 (0=全コア)
    ultraMemorySaver: true,             // 超省メモリモード
    gpuVramPipeline: true,              // GPU VRAM オフロード・パイプライン (GPUメモリ優先)
    theme: localStorage.getItem('hyperresize_theme') || 'cyberpunk' // テーマ ('cyberpunk' | 'macos' | 'simple-modern')
  },

  // メモリ状態
  activeMemoryEstimate: 0,
  isThrottled: false,

  // 出力先フォルダ (File System Access API)
  outputDirHandle: null,
  outputDirName: ''
};

// DOM要素参照
const elements = {
  themeButtons: document.querySelectorAll('.theme-pill-btn'),
  appTitle: document.getElementById('app-title'),
  appSubtitle: document.getElementById('app-subtitle'),
  cpuBadge: document.getElementById('cpu-badge'),
  gpuBadge: document.getElementById('gpu-badge'),
  ramBadge: document.getElementById('ram-badge'),
  statusBadge: document.getElementById('status-badge'),
  workerGrid: document.getElementById('worker-grid'),
  statProcessed: document.getElementById('stat-processed'),
  statSaved: document.getElementById('stat-saved'),
  statSpeed: document.getElementById('stat-speed'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  folderInput: document.getElementById('folder-input'),
  btnSelectFiles: document.getElementById('btn-select-files'),
  btnSelectFolderInput: document.getElementById('btn-select-folder-input'),

  // メモリモニター
  memUsedVal: document.getElementById('mem-used-val'),
  memLimitVal: document.getElementById('mem-limit-val'),
  memPercentVal: document.getElementById('mem-percent-val'),
  memFillBar: document.getElementById('mem-fill-bar'),
  memAlert: document.getElementById('mem-alert'),

  // メモリ設定
  memPills: document.querySelectorAll('.mem-pill'),
  customMemContainer: document.getElementById('custom-mem-container'),
  customMemVal: document.getElementById('custom-mem-val'),
  customMemSlider: document.getElementById('custom-mem-slider'),
  customMemBadge: document.getElementById('custom-mem-badge'),
  memTicks: document.querySelectorAll('.mem-tick'),
  concurrencySelect: document.getElementById('concurrency-select'),
  ultraSaverToggle: document.getElementById('ultra-saver-toggle'),
  gpuVramToggle: document.getElementById('gpu-vram-toggle'),
  vramUsedVal: document.getElementById('vram-used-val'),
  vramPoolVal: document.getElementById('vram-pool-val'),
  vramPercentVal: document.getElementById('vram-percent-val'),
  vramFillBar: document.getElementById('vram-fill-bar'),
  
  // 出力先
  btnPickDir: document.getElementById('btn-pick-dir'),
  selectedDirDisplay: document.getElementById('selected-dir-display'),
  autoSaveToggle: document.getElementById('auto-save-toggle'),
  suffixInput: document.getElementById('suffix-input'),

  // 設定
  sizePills: document.querySelectorAll('.size-pill'),
  customSizeContainer: document.getElementById('custom-size-container'),
  customSizeVal: document.getElementById('custom-size-val'),
  customSizeUnit: document.getElementById('custom-size-unit'),
  formatSelect: document.getElementById('format-select'),
  maxWidthInput: document.getElementById('max-width-input'),
  maxHeightInput: document.getElementById('max-height-input'),
  dimPills: document.querySelectorAll('.dim-pill'),

  // アクションバー & 実行制御
  btnStartProcess: document.getElementById('btn-start-process'),
  btnStopProcess: document.getElementById('btn-stop-process'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  progressText: document.getElementById('progress-text'),
  btnSaveToFolder: document.getElementById('btn-save-to-folder'),
  btnDownloadZip: document.getElementById('btn-download-zip'),
  btnClearList: document.getElementById('btn-clear-list'),
  resultsList: document.getElementById('results-list'),

  // 比較モーダル & 拡大ズーム制御
  modalOverlay: document.getElementById('modal-overlay'),
  modalClose: document.getElementById('modal-close'),
  modalTitle: document.getElementById('modal-title'),
  origImg: document.getElementById('orig-img'),
  compImg: document.getElementById('comp-img'),
  compOverlay: document.getElementById('comp-overlay'),
  compSlider: document.getElementById('comp-slider'),
  modalOrigInfo: document.getElementById('modal-orig-info'),
  modalCompInfo: document.getElementById('modal-comp-info'),
  compWrapper: document.getElementById('comparison-wrapper'),
  compStageBase: document.getElementById('comp-stage-base'),
  compStageOverlay: document.getElementById('comp-stage-overlay'),
  compDividerLine: document.getElementById('comp-divider-line'),
  compDividerHandle: document.getElementById('comp-divider-handle'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnZoomFit: document.getElementById('btn-zoom-fit'),
  btnZoom100: document.getElementById('btn-zoom-100'),
  btnZoom200: document.getElementById('btn-zoom-200'),
  compZoomBadge: document.getElementById('comp-zoom-badge'),
  compZoomHint: document.getElementById('comp-zoom-hint')
};

// ==========================================
// 初期化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  setTheme(state.settings.theme);
  initGPU();
  initWorkerPool();
  setupEventListeners();
  updateSettingsFromUI();
  updateStatsUI();
  updateExecButtonsUI();
  startMemoryMonitor();
});

/**
 * テーマ切り替え処理 (サイバーパンク / macOS / シンプルモダン)
 * @param {'cyberpunk' | 'macos' | 'simple-modern'} themeName
 */
function setTheme(themeName) {
  if (themeName === 'modern') themeName = 'macos';
  const validThemes = ['cyberpunk', 'macos', 'simple-modern'];
  if (!validThemes.includes(themeName)) {
    themeName = 'cyberpunk';
  }

  state.settings.theme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  document.body.setAttribute('data-theme', themeName);

  try {
    localStorage.setItem('hyperresize_theme', themeName);
  } catch (e) {
    console.warn('localStorage access failed:', e);
  }

  // テーマ切り替えボタンのactiveクラス更新
  const themeBtns = document.querySelectorAll('.theme-pill-btn');
  themeBtns.forEach(btn => {
    if (btn.dataset.theme === themeName) {
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-checked', 'false');
    }
  });

  // タイトル & サブタイトルの洗練された切り替え
  const appTitle = document.getElementById('app-title');
  const appSubtitle = document.getElementById('app-subtitle');
  if (appTitle && appSubtitle) {
    switch (themeName) {
      case 'macos':
        appTitle.textContent = 'HyperResize Modern';
        appSubtitle.textContent = 'Apple Glassmorphism :: GPU Texture Pipeline & Multi-Core Engine';
        break;
      case 'simple-modern':
        appTitle.textContent = 'HyperResize Studio';
        appSubtitle.textContent = 'High-Performance Batch Compression & Resizing Dashboard';
        break;
      case 'cyberpunk':
      default:
        appTitle.textContent = '// HYPER_RESIZE // [CYBER_EDITION]';
        appSubtitle.textContent = '// GPU_TEXTURE_PIPELINE :: MULTI_THREAD_CORE_ENGINE :: MEMORY_FIREWALL';
        break;
    }
  }
}

/**
 * GPUの検出と初期化
 */
function initGPU() {
  try {
    state.gpuResizer = new GPUImageResizer();
    state.gpuInfo = state.gpuResizer.gpuInfo;

    const gpuName = state.gpuInfo.renderer.split('/')[0] || state.gpuInfo.renderer;
    const cleanName = gpuName.replace(/ANGLE\s*\(/i, '').replace(/\)/g, '').trim();
    
    elements.gpuBadge.innerHTML = `<span class="pulse-dot"></span> 🚀 GPU: [${cleanName.slice(0, 24)}]`;
  } catch (err) {
    console.warn('GPU init error:', err);
    elements.gpuBadge.textContent = '🚀 GPU: [2D_CANVAS_ACCEL]';
  }
}

/**
 * CPUマルチスレッドWorkerプールの生成
 */
function initWorkerPool() {
  const cores = state.cpuCores;
  elements.cpuBadge.innerHTML = `<span class="pulse-dot"></span> 🧠 CPU: [${cores} CORES_ONLINE]`;

  // スレッドモニターUIの初期化
  elements.workerGrid.innerHTML = '';
  state.workers = [];
  state.workerStatus = [];

  let workerSupported = true;
  try {
    const testWorker = new Worker('worker.js');
    testWorker.terminate();
  } catch (err) {
    console.warn('Web Worker directly disabled or blocked (e.g. file:// protocol). Switching to Async Main Pipeline:', err);
    workerSupported = false;
  }

  for (let i = 0; i < cores; i++) {
    const box = document.createElement('div');
    box.className = 'worker-box';
    box.id = `worker-box-${i}`;
    box.innerHTML = `
      <div class="worker-label">CORE ${i + 1}</div>
      <div class="worker-status">IDLE</div>
    `;
    elements.workerGrid.appendChild(box);

    if (workerSupported) {
      try {
        const worker = new Worker('worker.js');
        state.workerStatus.push('idle');

        worker.onmessage = (e) => handleWorkerMessage(i, e.data);
        worker.onerror = (err) => {
          console.error(`Worker ${i} error:`, err);
          setWorkerStatus(i, 'idle');
        };

        state.workers.push(worker);
        continue;
      } catch (err) {
        console.warn(`Worker ${i} creation failed:`, err);
      }
    }

    // フォールバック用擬似Worker
    state.workerStatus.push('idle');
    state.workers.push({
      postMessage: async (msg) => {
        try {
          const res = await processJobLocally(msg);
          handleWorkerMessage(i, res);
        } catch (err) {
          handleWorkerMessage(i, { status: 'error', id: msg.id, error: err.message });
        }
      }
    });
  }
}

/**
 * OffscreenCanvas / HTMLCanvasElement 両対応の安全なBlob変換ヘルパー
 */
function canvasToBlobSafe(canvas, mimeType, quality) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Workerがブロックされた場合のローカル非同期処理フォールバック (GPU/Canvas両対応)
 */
async function processJobLocally(msg) {
  const { id, file, options, workerIndex } = msg;
  const startTime = performance.now();

  const bitmap = await createImageBitmap(file);
  const origWidth = bitmap.width;
  const origHeight = bitmap.height;
  const origSize = file.size;

  const {
    targetMaxBytes = 0,
    maxWidth = 0,
    maxHeight = 0,
    mimeType = 'image/webp',
    qualityPreset = 0.85,
    maintainAspectRatio = true
  } = options;

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
  } else if (maxWidth > 0 && origWidth > maxWidth) {
    const ratio = maxWidth / origWidth;
    baseWidth = maxWidth;
    baseHeight = Math.round(origHeight * ratio);
  } else if (maxHeight > 0 && origHeight > maxHeight) {
    const ratio = maxHeight / origHeight;
    baseHeight = maxHeight;
    baseWidth = Math.round(origWidth * ratio);
  }

  const effectiveMimeType = (targetMaxBytes > 0 && mimeType === 'image/png') ? 'image/webp' : mimeType;
  let bestBlob = null;
  let finalWidth = baseWidth;
  let finalHeight = baseHeight;
  let finalQuality = qualityPreset;

  // GPU VRAM パイプライン (GPUメモリ常駐 & ダイレクト描画)
  let vramTex = null;
  if (state.gpuResizer && state.gpuResizer.gl && state.settings.gpuVramPipeline) {
    try {
      vramTex = state.gpuResizer.createVRAMTexture(bitmap);
    } catch (e) {
      vramTex = null;
    }
  }

  const renderWorkingCanvas = (w, h) => {
    if (vramTex && state.gpuResizer) {
      const c = state.gpuResizer.resizeFromVRAM(vramTex, w, h);
      if (c) return c;
    }
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c;
  };

  if (targetMaxBytes > 0) {
    let currentScale = 1.0;

    for (let scaleAttempt = 0; scaleAttempt < 5; scaleAttempt++) {
      const testWidth = Math.max(16, Math.round(baseWidth * currentScale));
      const testHeight = Math.max(16, Math.round(baseHeight * currentScale));
      const workingCanvas = renderWorkingCanvas(testWidth, testHeight);

      let lowQ = 0.20, highQ = 0.95;
      let bestUnderTarget = null;
      let bestUnderQ = 0.20;

      for (let b = 0; b < 5; b++) {
        const midQ = (lowQ + highQ) / 2;
        const bRes = await canvasToBlobSafe(workingCanvas, effectiveMimeType, midQ);

        if (bRes.size <= targetMaxBytes) {
          bestUnderTarget = bRes;
          bestUnderQ = midQ;
          if (bRes.size >= targetMaxBytes * 0.90) break;
          lowQ = midQ;
        } else {
          highQ = midQ;
        }
      }

      if (bestUnderTarget) {
        bestBlob = bestUnderTarget;
        finalWidth = testWidth;
        finalHeight = testHeight;
        finalQuality = Math.round(bestUnderQ * 100) / 100;
        break;
      }

      currentScale *= 0.75;
    }

    if (!bestBlob) {
      const fallbackCanvas = renderWorkingCanvas(Math.max(16, Math.round(baseWidth * 0.4)), Math.max(16, Math.round(baseHeight * 0.4)));
      bestBlob = await canvasToBlobSafe(fallbackCanvas, effectiveMimeType, 0.25);
      finalWidth = fallbackCanvas.width;
      finalHeight = fallbackCanvas.height;
      finalQuality = 0.25;
    }
  } else {
    const workingCanvas = renderWorkingCanvas(baseWidth, baseHeight);
    bestBlob = await canvasToBlobSafe(workingCanvas, effectiveMimeType, qualityPreset);
    finalWidth = baseWidth;
    finalHeight = baseHeight;
    finalQuality = qualityPreset;
  }

  // GPU VRAMテクスチャとビットマップ解放
  if (vramTex && state.gpuResizer) {
    state.gpuResizer.releaseVRAMTexture(vramTex);
    vramTex = null;
  }
  bitmap.close();
  const durationMs = Math.round(performance.now() - startTime);

  return {
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
      reductionPercent: Math.round(((origSize - bestBlob.size) / origSize) * 1000) / 10
    }
  };
}

/**
 * Workerの状態更新 & UI反映
 */
function setWorkerStatus(index, status) {
  state.workerStatus[index] = status;
  const box = document.getElementById(`worker-box-${index}`);
  if (!box) return;

  if (status === 'busy') {
    box.className = 'worker-box busy';
    box.querySelector('.worker-status').textContent = 'RUNNING';
  } else if (status === 'done') {
    box.className = 'worker-box done';
    box.querySelector('.worker-status').textContent = 'READY';
  } else {
    box.className = 'worker-box';
    box.querySelector('.worker-status').textContent = 'IDLE';
  }
}

// ==========================================
// イベントリスナー設定
// ==========================================
function setupEventListeners() {
  // ==========================================
  // テーマ切り替えボタン
  // ==========================================
  const themeBtns = document.querySelectorAll('.theme-pill-btn');
  themeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const theme = btn.dataset.theme;
      if (theme) setTheme(theme);
    });
  });

  // ==========================================
  // ドラッグ＆ドロップ (ウィンドウ全体キャッチ & 堅牢化)
  // ==========================================
  const dropzone = elements.dropzone;
  let dragCounter = 0;

  // ブラウザのデフォルトファイルオープン動作をウィンドウ全体で完全に抑止
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
    window.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropzone.classList.add('dragover');
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropzone.classList.remove('dragover');
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('dragover');

    const dt = e.dataTransfer;
    if (!dt) return;

    await processDroppedData(dt);
  });

  // ドロップゾーンをクリックしたときもファイル選択ダイアログを開く
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // ボタンのクリック時は二重起動しない
    elements.fileInput.click();
  });

  // ファイル選択ボタン
  elements.btnSelectFiles.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.fileInput.click();
  });
  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      enqueueFiles(Array.from(e.target.files));
      elements.fileInput.value = '';
    }
  });

  // フォルダ選択ボタン（画像入力側）
  elements.btnSelectFolderInput.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.folderInput.click();
  });
  elements.folderInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      enqueueFiles(Array.from(e.target.files));
      elements.folderInput.value = '';
    }
  });

  // クリップボードからの画像貼り付け (Ctrl+V)
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      enqueueFiles(files);
      showToast(`📋 クリップボードから ${files.length} 件の画像を読み込みました`);
    }
  });

  // 出力先フォルダ選択 (File System Access API)
  elements.btnPickDir.addEventListener('click', pickOutputDirectory);

  // 自動保存トグル
  elements.autoSaveToggle.addEventListener('change', (e) => {
    state.settings.autoSave = e.target.checked;
    if (state.settings.autoSave && !state.outputDirHandle) {
      showToast('⚠️ 自動保存には出力先フォルダの選択が必要です', 'warn');
      pickOutputDirectory();
    }
  });

  // 目標サイズプリセットボタン
  elements.sizePills.forEach(pill => {
    pill.addEventListener('click', () => {
      elements.sizePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const val = pill.dataset.size;
      state.settings.targetSizePreset = val;

      if (val === 'custom') {
        elements.customSizeContainer.style.display = 'flex';
      } else {
        elements.customSizeContainer.style.display = 'none';
        if (val === 'none') {
          state.settings.targetMaxBytes = 0;
        } else if (val === '300kb') {
          state.settings.targetMaxBytes = 300 * 1024;
        } else if (val === '500kb') {
          state.settings.targetMaxBytes = 500 * 1024;
        } else if (val === '1mb') {
          state.settings.targetMaxBytes = 1000 * 1024; // 1MB
        } else if (val === '2mb') {
          state.settings.targetMaxBytes = 2000 * 1024;
        } else if (val === '5mb') {
          state.settings.targetMaxBytes = 5000 * 1024;
        }
      }
    });
  });

  // カスタムサイズ入力
  const updateCustomSize = () => {
    const num = parseFloat(elements.customSizeVal.value) || 1;
    const unit = elements.customSizeUnit.value;
    state.settings.targetMaxBytes = Math.round(unit === 'mb' ? num * 1024 * 1024 : num * 1024);
  };
  elements.customSizeVal.addEventListener('input', updateCustomSize);
  elements.customSizeUnit.addEventListener('change', updateCustomSize);

  // 出力フォーマット
  elements.formatSelect.addEventListener('change', (e) => {
    state.settings.mimeType = e.target.value;
  });

  // 解像度プリセット
  elements.dimPills.forEach(pill => {
    pill.addEventListener('click', () => {
      elements.dimPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const w = parseInt(pill.dataset.width) || 0;
      elements.maxWidthInput.value = w > 0 ? w : '';
      elements.maxHeightInput.value = '';
      state.settings.maxWidth = w;
      state.settings.maxHeight = 0;
    });
  });

  elements.maxWidthInput.addEventListener('input', (e) => {
    state.settings.maxWidth = parseInt(e.target.value) || 0;
  });
  elements.maxHeightInput.addEventListener('input', (e) => {
    state.settings.maxHeight = parseInt(e.target.value) || 0;
  });

function formatMemoryMb(mb) {
  if (mb >= 1024) {
    const gb = (mb / 1024).toFixed(1).replace(/\.0$/, '');
    return `${mb.toLocaleString()} MB (${gb} GB)`;
  }
  return `${mb} MB`;
}

function updateCustomMemUI(mb, updateInput = true, updateSlider = true) {
  mb = Math.max(128, Math.min(16384, Math.round(mb)));
  state.settings.maxMemoryBytes = mb * 1024 * 1024;

  if (elements.customMemBadge) {
    elements.customMemBadge.textContent = formatMemoryMb(mb);
  }
  if (updateInput && elements.customMemVal) {
    elements.customMemVal.value = mb;
  }
  if (updateSlider && elements.customMemSlider) {
    elements.customMemSlider.value = Math.min(8192, mb);
  }

  // スライダーの進捗トラック背景色（サイバーシアンの動的グラデーション塗り）
  if (elements.customMemSlider) {
    const min = parseFloat(elements.customMemSlider.min) || 256;
    const max = parseFloat(elements.customMemSlider.max) || 8192;
    const pct = Math.max(0, Math.min(100, ((mb - min) / (max - min)) * 100));
    elements.customMemSlider.style.background = `linear-gradient(to right, var(--cyber-cyan) 0%, var(--cyber-cyan) ${pct}%, rgba(0, 240, 255, 0.15) ${pct}%, rgba(0, 240, 255, 0.15) 100%)`;
  }

  updateMemoryMonitorUI();
}

  // メモリ上限プリセットボタン
  elements.memPills.forEach(pill => {
    pill.addEventListener('click', () => {
      elements.memPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const memVal = pill.dataset.mem;

      if (memVal === 'custom') {
        elements.customMemContainer.style.display = 'flex';
        const num = parseFloat(elements.customMemVal ? elements.customMemVal.value : 1024) || 1024;
        updateCustomMemUI(num, true, true);
      } else {
        elements.customMemContainer.style.display = 'none';
        const mb = parseInt(memVal, 10);
        state.settings.maxMemoryBytes = mb > 0 ? mb * 1024 * 1024 : 0;
        if (mb > 0) {
          updateCustomMemUI(mb, true, true);
        }
      }
      updateMemoryMonitorUI();
    });
  });

  // カスタムメモリスライダー（バー）操作
  if (elements.customMemSlider) {
    elements.customMemSlider.addEventListener('input', (e) => {
      const mb = parseInt(e.target.value, 10) || 1024;
      updateCustomMemUI(mb, true, false);
    });
  }

  // カスタムメモリ数値直接入力
  if (elements.customMemVal) {
    elements.customMemVal.addEventListener('input', () => {
      const mb = parseInt(elements.customMemVal.value, 10) || 1024;
      updateCustomMemUI(mb, false, true);
    });
  }

  // スライダー目盛り（Tick）クリックで素早く設定
  if (elements.memTicks) {
    elements.memTicks.forEach(tick => {
      tick.addEventListener('click', () => {
        const mb = parseInt(tick.dataset.val, 10);
        if (mb > 0) {
          updateCustomMemUI(mb, true, true);
        }
      });
    });
  }

  // 最大並列スレッド数
  elements.concurrencySelect.addEventListener('change', (e) => {
    state.settings.maxConcurrency = parseInt(e.target.value, 10);
    if (state.isProcessing && !state.isPaused) {
      dispatchNextJobs();
    }
  });

  // 超省メモリモードトグル
  elements.ultraSaverToggle.addEventListener('change', (e) => {
    state.settings.ultraMemorySaver = e.target.checked;
  });

  // GPU VRAM オフロードトグル
  if (elements.gpuVramToggle) {
    elements.gpuVramToggle.addEventListener('change', (e) => {
      state.settings.gpuVramPipeline = e.target.checked;
      updateMemoryMonitorUI();
      showToast(e.target.checked ? '🚀 GPU VRAM オフロードパイプラインを有効化しました' : 'ℹ️ 2D Canvas CPUパイプラインに切り替えました');
    });
  }

  // サフィックス
  elements.suffixInput.addEventListener('input', (e) => {
    state.settings.filenameSuffix = e.target.value;
  });

  // 実行制御アクション (スタート & 停止)
  if (elements.btnStartProcess) {
    elements.btnStartProcess.addEventListener('click', startProcessing);
  }
  if (elements.btnStopProcess) {
    elements.btnStopProcess.addEventListener('click', stopProcessing);
  }

  // 一括保存アクション
  elements.btnSaveToFolder.addEventListener('click', saveAllToFolder);
  elements.btnDownloadZip.addEventListener('click', downloadAllAsZip);
  elements.btnClearList.addEventListener('click', clearAllResults);

  // 比較モーダル & 拡大ズーム機能
  elements.modalClose.addEventListener('click', closeModal);
  elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modalOverlay.classList.contains('active')) {
      closeModal();
    }
  });

  // 比較ビューポートのイベント登録
  setupComparisonViewerEvents();
}

function updateSettingsFromUI() {
  state.settings.mimeType = elements.formatSelect.value;
  state.settings.filenameSuffix = elements.suffixInput.value;
  state.settings.maxWidth = parseInt(elements.maxWidthInput.value) || 0;
  state.settings.maxHeight = parseInt(elements.maxHeightInput.value) || 0;
  state.settings.maxConcurrency = parseInt(elements.concurrencySelect.value, 10) || 0;
  state.settings.ultraMemorySaver = elements.ultraSaverToggle.checked;
  if (elements.gpuVramToggle) state.settings.gpuVramPipeline = elements.gpuVramToggle.checked;
  updateCustomMemUI(1024, true, true);
  updateMemoryMonitorUI();
}

// ==========================================
// メモリ使用量監視 & リアルタイムモニター
// ==========================================
function getMemoryUsageBytes() {
  if (typeof window !== 'undefined' && window.performance && window.performance.memory) {
    return window.performance.memory.usedJSHeapSize;
  }
  return state.activeMemoryEstimate;
}

function updateMemoryMonitorUI() {
  const usedBytes = getMemoryUsageBytes();
  const limitBytes = state.settings.maxMemoryBytes;

  // 使用量テキスト
  elements.memUsedVal.textContent = formatBytes(usedBytes);

  // 上限テキスト
  if (limitBytes > 0) {
    elements.memLimitVal.textContent = `${formatBytes(limitBytes)} (上限)`;
    const percent = Math.min(100, Math.round((usedBytes / limitBytes) * 100));
    elements.memPercentVal.textContent = `${percent}%`;
    elements.memFillBar.style.width = `${percent}%`;

    // 警告・危険クラス
    if (percent >= 85) {
      elements.memFillBar.className = 'memory-fill danger';
      elements.memPercentVal.style.color = 'var(--accent-rose)';
      elements.memAlert.style.display = 'block';
    } else if (percent >= 70) {
      elements.memFillBar.className = 'memory-fill';
      elements.memPercentVal.style.color = 'var(--accent-amber)';
      elements.memAlert.style.display = 'none';
    } else {
      elements.memFillBar.className = 'memory-fill';
      elements.memPercentVal.style.color = '#fcd34d';
      elements.memAlert.style.display = 'none';
    }

    elements.ramBadge.innerHTML = `<span class="pulse-dot"></span> 💾 RAM: [${formatBytes(usedBytes)} / ${formatBytes(limitBytes)}]`;
  } else {
    elements.memLimitVal.textContent = '無制限';
    elements.memPercentVal.textContent = '---';
    elements.memFillBar.style.width = '30%';
    elements.memFillBar.className = 'memory-fill';
    elements.memAlert.style.display = 'none';
    elements.ramBadge.innerHTML = `<span class="pulse-dot"></span> 💾 RAM: [${formatBytes(usedBytes)} / UNLIMITED]`;
  }

  // GPU VRAM モニター更新 (VRAMオフロード追跡)
  if (elements.vramUsedVal) {
    let vramBytes = 0;
    if (state.gpuResizer && state.gpuResizer.allocatedVRAMBytes) {
      vramBytes = state.gpuResizer.allocatedVRAMBytes;
    }
    elements.vramUsedVal.textContent = formatBytes(vramBytes);

    if (state.settings.gpuVramPipeline) {
      elements.vramPoolVal.textContent = 'ACTIVE (TEXTURE_POOL)';
      elements.vramPercentVal.textContent = vramBytes > 0 ? `VRAM: ${formatBytes(vramBytes)}` : 'ONLINE';
      elements.vramFillBar.style.width = vramBytes > 0 ? `${Math.min(100, Math.max(15, Math.round((vramBytes / (256 * 1024 * 1024)) * 100)))}%` : '100%';
    } else {
      elements.vramPoolVal.textContent = 'STANDBY (CPU_FALLBACK)';
      elements.vramPercentVal.textContent = 'OFF';
      elements.vramFillBar.style.width = '0%';
    }
  }
}

function startMemoryMonitor() {
  updateMemoryMonitorUI();
  setInterval(() => {
    updateMemoryMonitorUI();
  }, 500);
}

// ==========================================
// 出力先フォルダ選択 (File System Access API)
// ==========================================
async function pickOutputDirectory() {
  if (!('showDirectoryPicker' in window)) {
    showToast('⚠️ お使いのブラウザは直接フォルダ書き込み非対応です。ZIPダウンロードをご利用ください', 'warn');
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'pictures'
    });

    state.outputDirHandle = handle;
    state.outputDirName = handle.name;

    elements.selectedDirDisplay.innerHTML = `
      <span class="folder-path-text">📁 ${handle.name}</span>
    `;
    elements.btnSaveToFolder.disabled = false;
    showToast(`✅ 出力先フォルダを「${handle.name}」に設定しました！`);

  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Directory pick error:', err);
      showToast('フォルダの選択がキャンセルされたか、アクセス権がありません', 'warn');
    }
  }
}

// ==========================================
// ドラッグ＆ドロップ アイテム解析 (確実な同期抽出 & フォルダ再帰)
// ==========================================
async function processDroppedData(dt) {
  const files = [];

  // 1. 同期的に dt.files を抽出 (通常のファイルドロップで最も確実)
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (file) files.push(file);
    }
  }

  // 2. もしフォルダが投入されたか確認 (items と webkitGetAsEntry)
  let hasDirectory = false;
  const entries = [];

  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.webkitGetAsEntry) {
        try {
          const entry = item.webkitGetAsEntry();
          if (entry && entry.isDirectory) {
            hasDirectory = true;
            entries.push(entry);
          }
        } catch (e) {
          console.warn('webkitGetAsEntry error:', e);
        }
      }
    }
  }

  if (hasDirectory) {
    showToast('📁 フォルダ内の画像ファイルをスキャン中...');
    const folderFiles = [];
    for (const entry of entries) {
      const scanned = await traverseFileTree(entry);
      folderFiles.push(...scanned);
    }
    const combined = [...files, ...folderFiles];
    if (combined.length > 0) {
      enqueueFiles(combined);
    } else {
      showToast('⚠️ フォルダ内に画像ファイルが見つかりませんでした', 'warn');
    }
  } else if (files.length > 0) {
    enqueueFiles(files);
  } else {
    showToast('⚠️ 画像ファイルが検出されませんでした', 'warn');
  }
}

async function traverseFileTree(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => resolve([file]), () => resolve([]));
    });
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const allEntries = [];

    const readBatch = () => {
      return new Promise((resolve) => {
        dirReader.readEntries(async (entries) => {
          if (!entries || entries.length === 0) {
            resolve(allEntries);
          } else {
            allEntries.push(...entries);
            resolve(await readBatch());
          }
        }, () => resolve(allEntries));
      });
    };

    const entries = await readBatch();
    const promises = entries.map(e => traverseFileTree(e));
    const nested = await Promise.all(promises);
    return nested.flat();
  }
  return [];
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|bmp|avif|svg|tiff?|ico|heic|heif)$/i.test(file.name || '');
}

// ==========================================
// ジョブキュー & Workerディスパッチャ (メモリ安全並列処理)
// ==========================================
let globalJobId = 0;

// 軽量プレースホルダーSVG (メモリ消費ゼロ & HTML属性エスケープ安全)
const PLACEHOLDER_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 75'%3E%3Crect width='100' height='75' fill='%230a0f1d' stroke='%2300f0ff' stroke-width='1'/%3E%3Ctext x='50' y='46' font-size='24' text-anchor='middle' fill='%2300f0ff'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E";

/**
 * 実行制御ボタン (スタート / 停止) の状態を更新
 */
function updateExecButtonsUI() {
  if (!elements.btnStartProcess || !elements.btnStopProcess) return;

  const pendingCount = state.jobQueue.length;
  const isRunning = state.isProcessing && !state.isPaused;

  if (isRunning) {
    // 処理実行中: スタート無効化、停止ボタン活性化（パルスアニメーション）
    elements.btnStartProcess.disabled = true;
    elements.btnStartProcess.innerHTML = `<span class="btn-icon-glow">⚡</span> 実行中...`;
    elements.btnStopProcess.disabled = false;
    elements.btnStopProcess.classList.add('pulse');
    elements.btnStopProcess.innerHTML = `<span class="btn-icon-glow">⏹</span> 停止`;
  } else if (state.isPaused && pendingCount > 0) {
    // 一時停止中: 再開可能、停止ボタン無効化
    elements.btnStartProcess.disabled = false;
    elements.btnStartProcess.innerHTML = `<span class="btn-icon-glow">▶</span> 再開 (${pendingCount})`;
    elements.btnStopProcess.disabled = true;
    elements.btnStopProcess.classList.remove('pulse');
    elements.btnStopProcess.innerHTML = `<span class="btn-icon-glow">⏹</span> 停止中`;
  } else if (pendingCount > 0) {
    // 待機中（投入済み・未実行）: スタートボタン活性化、停止ボタン無効化
    elements.btnStartProcess.disabled = false;
    elements.btnStartProcess.innerHTML = `<span class="btn-icon-glow">▶</span> スタート (${pendingCount})`;
    elements.btnStopProcess.disabled = true;
    elements.btnStopProcess.classList.remove('pulse');
    elements.btnStopProcess.innerHTML = `<span class="btn-icon-glow">⏹</span> 停止`;
  } else {
    // キューなし（待機中または全件完了）: 両方無効化
    elements.btnStartProcess.disabled = true;
    elements.btnStartProcess.innerHTML = `<span class="btn-icon-glow">▶</span> スタート`;
    elements.btnStopProcess.disabled = true;
    elements.btnStopProcess.classList.remove('pulse');
    elements.btnStopProcess.innerHTML = `<span class="btn-icon-glow">⏹</span> 停止`;
  }
}

/**
 * リサイズ処理を開始（ユーザーのスタートボタン押下）
 */
function startProcessing() {
  if (state.isProcessing && !state.isPaused) return;

  if (state.jobQueue.length === 0) {
    if (state.activeJobs === 0) {
      showToast('ℹ️ 処理対象の画像がありません。画像をドロップまたは選択してください');
    }
    return;
  }

  state.isProcessing = true;
  state.isPaused = false;

  // キューに残っているカードのステータス文言を「キュー待機中...」に更新
  for (const job of state.jobQueue) {
    updateCardStatus(job.id, 'pending', 'キュー待機中...');
  }

  updateExecButtonsUI();
  updateProgressUI();
  showToast(`▶️ リサイズ処理を開始しました (残り ${state.jobQueue.length} 件)`);
  dispatchNextJobs();
}

/**
 * リサイズ処理を停止/一時停止（ユーザーの停止ボタン押下）
 */
function stopProcessing() {
  if (!state.isProcessing || state.isPaused) return;

  state.isProcessing = false;
  state.isPaused = true;

  // キューに残っているジョブのカード文言を「一時停止中」に更新
  for (const job of state.jobQueue) {
    updateCardStatus(job.id, 'paused', '⏸️ 一時停止中 (「再開」で続行)');
  }

  elements.statusBadge.innerHTML = `<span class="pulse-dot" style="background-color:var(--cyber-magenta)"></span> ⏸️ SYS: PAUSED`;
  updateExecButtonsUI();
  updateProgressUI();
  showToast('⏸️ 処理を一時停止しました。「再開」ボタンでいつでも続きから実行できます', 'warn');
}

function enqueueFiles(files) {
  const validFiles = files.filter(isImageFile);
  if (validFiles.length === 0) {
    showToast('⚠️ 画像ファイル（JPEG, PNG, WebP等）を選択してください', 'warn');
    return;
  }

  const currentOptions = { ...state.settings };

  for (const file of validFiles) {
    const id = ++globalJobId;
    state.fileMap.set(id, file); // 比較プレビュー用に元Fileの参照を保持
    const item = {
      id,
      file,
      options: currentOptions,
      status: 'pending',
      thumbUrl: PLACEHOLDER_SVG, // 巨大なObjectURLを作らずメモリを節約
      result: null
    };

    state.activeMemoryEstimate += file.size;
    state.jobQueue.push(item);
    renderPendingCard(item);
  }

  updateProgressUI();
  updateMemoryMonitorUI();
  updateExecButtonsUI();

  // 自動では処理を開始せず、ユーザーの「スタート」ボタン押下を待つ。
  // ただし、すでにバックグラウンドで処理実行中の場合は追加投入分も継続してディスパッチ。
  if (state.isProcessing && !state.isPaused) {
    dispatchNextJobs();
  } else {
    showToast(`📥 ${validFiles.length} 件の画像をキューに追加しました。「スタート」ボタンをクリックして開始してください`);
  }
}

/**
 * アイドル状態のWorkerにキューからタスクを割り振る (メモリ上限チェック & Concurrency制御)
 */
function dispatchNextJobs() {
  // 処理中フラグがOFFまたは一時停止中の場合はタスクをディスパッチしない
  if (!state.isProcessing || state.isPaused) {
    updateExecButtonsUI();
    return;
  }

  if (state.jobQueue.length === 0) {
    if (state.activeJobs === 0 && !state.isThrottled) {
      state.isProcessing = false;
      state.isPaused = false;
      elements.statusBadge.innerHTML = `<span class="pulse-dot"></span> ⚡ SYS: STANDBY`;
      updateExecButtonsUI();
      updateProgressUI();
    }
    return;
  }

  // 1. メモリ使用上限チェック (Backpressure / 自動スロットリング)
  const currentMem = getMemoryUsageBytes();
  const limitMem = state.settings.maxMemoryBytes;

  if (limitMem > 0 && currentMem >= limitMem * 0.85) {
    state.isThrottled = true;
    elements.statusBadge.innerHTML = `<span class="pulse-dot" style="background-color:var(--cyber-magenta)"></span> ⚠️ SYS: THROTTLED (RAM_85%)`;
    elements.memAlert.style.display = 'block';
    setTimeout(dispatchNextJobs, 400);
    return;
  } else {
    state.isThrottled = false;
    elements.memAlert.style.display = 'none';
  }

  // 2. 最大並列スレッド数（Concurrency）チェック
  const maxConc = state.settings.maxConcurrency > 0
    ? Math.min(state.cpuCores, state.settings.maxConcurrency)
    : state.cpuCores;

  if (state.activeJobs >= maxConc) {
    return; // 現在の稼働スレッド数が設定上限に達しているため待機
  }

  elements.statusBadge.innerHTML = `<span class="pulse-dot"></span> ⚡ SYS: ACTIVE (${state.activeJobs} THREADS)`;

  for (let i = 0; i < state.workers.length; i++) {
    if (state.activeJobs >= maxConc) break;

    if (state.workerStatus[i] === 'idle' && state.jobQueue.length > 0) {
      const job = state.jobQueue.shift();
      state.workerStatus[i] = 'busy';
      state.activeJobs++;
      setWorkerStatus(i, 'busy');

      updateCardStatus(job.id, 'processing', `CORE ${i + 1} でリサイズ中...`);

      state.workers[i].postMessage({
        id: job.id,
        file: job.file,
        options: job.options,
        workerIndex: i
      });
    }
  }

  updateExecButtonsUI();
  updateProgressUI();
}

/**
 * Workerからの完了通知処理
 */
async function handleWorkerMessage(workerIndex, data) {
  state.activeJobs = Math.max(0, state.activeJobs - 1);
  setWorkerStatus(workerIndex, 'done');

  const { id, status, result, error } = data;

  if (status === 'success') {
    const origFile = state.fileMap.get(id) || null;
    const outputUrl = URL.createObjectURL(result.blob);
    const item = {
      id,
      file: origFile,
      ...result,
      outputUrl,
      thumbUrl: outputUrl,
      savedToDisk: false
    };

    state.processedItems.push(item);
    state.totalProcessedCount++;
    state.totalSavedBytes += Math.max(0, result.origSize - result.outputSize);
    state.totalProcessTimeMs += result.durationMs;
    state.activeMemoryEstimate += result.outputSize;

    renderSuccessCard(item, workerIndex);

    // 自動保存モードが有効でフォルダ選択済みなら、バックグラウンドで即座に保存
    if (state.settings.autoSave && state.outputDirHandle) {
      await saveSingleToFolder(item);
    }
  } else {
    console.error('Job error:', error);
    updateCardStatus(id, 'error', `エラー: ${error}`);
  }

  // 全ジョブ完了チェック (キューが空かつアクティブタスクが0の場合、即座に処理完了状態へ移行)
  if (state.jobQueue.length === 0 && state.activeJobs === 0) {
    state.isProcessing = false;
    state.isPaused = false;
    elements.statusBadge.innerHTML = `<span class="pulse-dot"></span> ⚡ SYS: STANDBY`;
  }

  updateStatsUI();
  updateProgressUI();
  updateMemoryMonitorUI();
  updateExecButtonsUI();

  // 次のジョブを実行
  setTimeout(() => {
    setWorkerStatus(workerIndex, 'idle');
    if (state.isProcessing && !state.isPaused) {
      dispatchNextJobs();
    } else {
      updateExecButtonsUI();
      if (state.activeJobs === 0 && !state.isProcessing && state.isPaused) {
        elements.statusBadge.innerHTML = `<span class="pulse-dot" style="background-color:var(--cyber-magenta)"></span> ⏸️ SYS: PAUSED`;
      }
    }
  }, 10);
}

// ==========================================
// カードのレンダリング & UI更新
// ==========================================
function renderPendingCard(item) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.id = `card-${item.id}`;

  const initialStatus = (state.isProcessing && !state.isPaused)
    ? 'キュー待機中...'
    : (state.isPaused ? '⏸️ 一時停止中' : 'スタート待機中...');

  card.innerHTML = `
    <img class="card-thumb" src="${item.thumbUrl}" alt="preview">
    <div class="card-info">
      <div class="card-filename" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
      <div class="card-dims" id="status-text-${item.id}">${initialStatus}</div>
    </div>
    <div class="card-sizes">
      <div class="card-orig-size">${formatBytes(item.file.size)}</div>
      <div class="card-new-size">---</div>
    </div>
    <div class="card-badges">
      <span class="badge-tag">待機中</span>
    </div>
    <div class="card-save-info" id="save-info-${item.id}">
      <span style="font-size:0.75rem; color:var(--text-muted);">---</span>
    </div>
    <div class="card-actions">
      <button class="btn-icon" onclick="removeCard(${item.id})" title="キューから削除">❌</button>
    </div>
  `;

  elements.resultsList.prepend(card);
}

function updateCardStatus(id, status, text) {
  const statusEl = document.getElementById(`status-text-${id}`);
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function renderSuccessCard(item, workerIndex) {
  const card = document.getElementById(`card-${item.id}`);
  if (!card) return;

  const targetAchieved = state.settings.targetMaxBytes > 0 && item.outputSize <= state.settings.targetMaxBytes;
  const targetBadge = targetAchieved ? '🎯 目標達成' : '';

  card.innerHTML = `
    <img class="card-thumb" id="thumb-${item.id}" src="${item.outputUrl || item.thumbUrl}" alt="thumbnail" onclick="openComparisonModal(${item.id})">
    <div class="card-info">
      <div class="card-filename" title="${escapeHtml(item.origName)}">${escapeHtml(item.origName)}</div>
      <div class="card-dims">
        ${item.origWidth}×${item.origHeight} → <strong>${item.outputWidth}×${item.outputHeight}</strong> (${item.mimeType.replace('image/', '')})
      </div>
    </div>
    <div class="card-sizes">
      <div class="card-orig-size">${formatBytes(item.origSize)}</div>
      <div class="card-new-size">${formatBytes(item.outputSize)}</div>
      <div class="card-reduction">${item.reductionPercent >= 0 ? '-' + item.reductionPercent + '%' : '+' + Math.abs(item.reductionPercent) + '%'}</div>
    </div>
    <div class="card-badges">
      <span class="badge-tag" style="color:var(--accent-cyan);">⚡ ${item.durationMs}ms (Core ${workerIndex + 1})</span>
      <span class="badge-tag" style="color:var(--accent-emerald); font-weight:600;">${targetBadge}</span>
    </div>
    <div class="card-save-info" id="save-info-${item.id}">
      <span style="font-size:0.75rem; color:var(--text-muted);">${item.savedToDisk ? '💾 保存済' : '未保存'}</span>
    </div>
    <div class="card-actions">
      <button class="btn-icon" onclick="openComparisonModal(${item.id})" title="画質比較プレビュー">👁️</button>
      <button class="btn-icon" onclick="downloadSingle(${item.id})" title="ダウンロード">⬇️</button>
      <button class="btn-icon" onclick="removeCard(${item.id})" title="削除">❌</button>
    </div>
  `;

  // 一括ボタンの活性化
  elements.btnDownloadZip.disabled = false;
  if (state.outputDirHandle) {
    elements.btnSaveToFolder.disabled = false;
  }
}

function updateProgressUI() {
  const total = state.totalProcessedCount + state.jobQueue.length + state.activeJobs;
  if (total === 0) {
    elements.progressBarFill.style.width = '0%';
    elements.progressText.textContent = 'SYS.STANDBY';
    return;
  }

  const percent = total > 0 ? Math.round((state.totalProcessedCount / total) * 100) : 0;
  elements.progressBarFill.style.width = `${percent}%`;

  let statusPrefix = '';
  if (state.isProcessing && !state.isPaused) {
    statusPrefix = '⚡ 実行中: ';
  } else if (state.isPaused && state.jobQueue.length > 0) {
    statusPrefix = '⏸️ 一時停止: ';
  } else if (state.jobQueue.length > 0) {
    statusPrefix = '⏳ 待機中: ';
  } else {
    statusPrefix = '✅ 完了: ';
  }

  elements.progressText.textContent = `${statusPrefix}${state.totalProcessedCount} / ${total} 件 (${percent}%)`;
}

function updateStatsUI() {
  elements.statProcessed.textContent = `${state.totalProcessedCount} 枚`;
  elements.statSaved.textContent = formatBytes(state.totalSavedBytes);

  if (state.totalProcessedCount > 0) {
    const avgMs = Math.round(state.totalProcessTimeMs / state.totalProcessedCount);
    elements.statSpeed.textContent = `${avgMs} ms/枚`;
  } else {
    elements.statSpeed.textContent = '---';
  }
}

// ==========================================
// ファイル保存 & ダウンロード (超省メモリ解放対応)
// ==========================================

/**
 * 単一ファイルを指定フォルダに保存 (File System Access API & メモリ即時解放)
 */
async function saveSingleToFolder(item) {
  if (!state.outputDirHandle) return false;
  if (item.savedToDisk && !item.blob) return true; // すでに保存＆解放済み

  try {
    const ext = getExtensionFromMime(item.mimeType);
    const baseName = item.origName.substring(0, item.origName.lastIndexOf('.')) || item.origName;
    const finalFilename = `${baseName}${state.settings.filenameSuffix}.${ext}`;

    const fileHandle = await state.outputDirHandle.getFileHandle(finalFilename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(item.blob);
    await writable.close();

    item.savedToDisk = true;

    // 超省メモリモード: 保存完了直後にBlobをRAMから解放
    if (state.settings.ultraMemorySaver) {
      if (item.outputSize) {
        state.activeMemoryEstimate = Math.max(0, state.activeMemoryEstimate - item.outputSize);
      }
      item.blob = null; // メモリ解放
      if (item.outputUrl && !item.outputUrl.startsWith('data:')) {
        URL.revokeObjectURL(item.outputUrl);
      }
      item.outputUrl = null;
    }

    const saveInfoEl = document.getElementById(`save-info-${item.id}`);
    if (saveInfoEl) {
      saveInfoEl.innerHTML = `<span style="font-size:0.75rem; color:var(--accent-emerald);">💾 保存済 ${state.settings.ultraMemorySaver ? '(RAM解放済)' : ''}</span>`;
    }
    updateMemoryMonitorUI();
    return true;
  } catch (err) {
    console.error('Save to folder error:', err);
    return false;
  }
}

/**
 * すべての処理済み画像を選択フォルダへ一括保存
 */
async function saveAllToFolder() {
  if (!state.outputDirHandle) {
    await pickOutputDirectory();
    if (!state.outputDirHandle) return;
  }

  let count = 0;
  for (const item of state.processedItems) {
    if (item.blob) {
      const ok = await saveSingleToFolder(item);
      if (ok) count++;
    } else if (item.savedToDisk) {
      count++;
    }
  }

  showToast(`📁 ${count} 件の画像を出力先フォルダ「${state.outputDirName}」に一括保存しました！`);
}

/**
 * 単一画像のブラウザ直接ダウンロード
 */
function downloadSingle(id) {
  const item = state.processedItems.find(x => x.id === id);
  if (!item) return;

  if (!item.blob && item.savedToDisk) {
    showToast(`ℹ️ 「${item.origName}」はすでに出力先フォルダへ保存済みです（メモリ節約のためRAMから解放されています）`);
    return;
  }

  const ext = getExtensionFromMime(item.mimeType);
  const baseName = item.origName.substring(0, item.origName.lastIndexOf('.')) || item.origName;
  const filename = `${baseName}${state.settings.filenameSuffix}.${ext}`;

  const downloadUrl = item.blob ? URL.createObjectURL(item.blob) : item.outputUrl;
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (item.blob && !item.outputUrl) {
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
  }
}

/**
 * 全画像をZIPファイルで一括ダウンロード
 */
async function downloadAllAsZip() {
  const itemsWithBlob = state.processedItems.filter(x => x.blob);
  if (itemsWithBlob.length === 0) {
    if (state.processedItems.length > 0) {
      showToast('ℹ️ 全ての画像はすでに出力先フォルダへ保存完了し、超省メモリのためRAMから解放されています');
    }
    return;
  }

  showToast('📦 ZIPアーカイブを生成中...');

  const zip = new SimpleZip();
  for (const item of itemsWithBlob) {
    const ext = getExtensionFromMime(item.mimeType);
    const baseName = item.origName.substring(0, item.origName.lastIndexOf('.')) || item.origName;
    const filename = `${baseName}${state.settings.filenameSuffix}.${ext}`;
    await zip.addFile(filename, item.blob);
  }

  const zipBlob = zip.generateZipBlob();
  const zipUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = zipUrl;
  a.download = `resized_images_${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(zipUrl), 30000);

  showToast(`🎉 ${itemsWithBlob.length} 件の画像をZIPで一括ダウンロードしました！`);
}

function removeCard(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) card.remove();

  // 未処理キューから該当ジョブを削除
  const queueIdx = state.jobQueue.findIndex(x => x.id === id);
  if (queueIdx !== -1) {
    const [removedJob] = state.jobQueue.splice(queueIdx, 1);
    if (removedJob && removedJob.file) {
      state.activeMemoryEstimate = Math.max(0, state.activeMemoryEstimate - removedJob.file.size);
    }
  }

  const item = state.processedItems.find(x => x.id === id);
  if (item) {
    if (item.outputUrl && !item.outputUrl.startsWith('data:')) {
      URL.revokeObjectURL(item.outputUrl);
    }
    if (item.outputSize) {
      state.activeMemoryEstimate = Math.max(0, state.activeMemoryEstimate - item.outputSize);
    }
    item.blob = null;
    item.file = null;
  }
  state.fileMap.delete(id);
  state.processedItems = state.processedItems.filter(x => x.id !== id);
  if (state.processedItems.length === 0) {
    elements.btnDownloadZip.disabled = true;
    elements.btnSaveToFolder.disabled = true;
  }
  updateExecButtonsUI();
  updateProgressUI();
  updateMemoryMonitorUI();
}

function clearAllResults() {
  state.isProcessing = false;
  state.isPaused = false;
  elements.resultsList.innerHTML = '';
  // 全ObjectURLを明示的に解放
  for (const item of state.processedItems) {
    if (item.outputUrl && !item.outputUrl.startsWith('data:')) {
      URL.revokeObjectURL(item.outputUrl);
    }
    item.blob = null;
    item.file = null;
  }
  state.fileMap.clear();
  state.processedItems = [];
  state.jobQueue = [];
  state.totalProcessedCount = 0;
  state.totalSavedBytes = 0;
  state.totalProcessTimeMs = 0;
  state.activeMemoryEstimate = 0;
  elements.btnDownloadZip.disabled = true;
  elements.btnSaveToFolder.disabled = true;
  updateStatsUI();
  updateProgressUI();
  updateMemoryMonitorUI();
  updateExecButtonsUI();
  showToast('リストとメモリをクリアしました');
}

// ==========================================
// 比較プレビュー モーダル (拡大ズーム & パン & 分割解析)
// ==========================================
state.tempModalUrls = [];

const zoomState = {
  scale: 1,
  fitScale: 1,
  panX: 0,
  panY: 0,
  stageWidth: 1920,
  stageHeight: 1080,
  splitPercent: 50,
  isPanning: false,
  isDraggingDivider: false,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  hasMoved: false,
  pointerDownTime: 0
};

function applyZoomTransform() {
  const transform = `translate(${zoomState.panX}px, ${zoomState.panY}px) scale(${zoomState.scale})`;
  if (elements.compStageBase) elements.compStageBase.style.transform = transform;
  if (elements.compStageOverlay) elements.compStageOverlay.style.transform = transform;

  if (elements.compWrapper) {
    const isZoomed = zoomState.scale > zoomState.fitScale * 1.05;
    elements.compWrapper.classList.toggle('is-zoomed', isZoomed);
  }

  // バッジ更新
  if (elements.compZoomBadge) {
    if (Math.abs(zoomState.scale - zoomState.fitScale) < 0.02) {
      elements.compZoomBadge.textContent = `FIT (${Math.round(zoomState.fitScale * 100)}%)`;
      if (elements.btnZoomFit) elements.btnZoomFit.classList.add('active');
      if (elements.btnZoom100) elements.btnZoom100.classList.remove('active');
      if (elements.btnZoom200) elements.btnZoom200.classList.remove('active');
    } else if (Math.abs(zoomState.scale - 1.0) < 0.02) {
      elements.compZoomBadge.textContent = '1:1 (100%)';
      if (elements.btnZoomFit) elements.btnZoomFit.classList.remove('active');
      if (elements.btnZoom100) elements.btnZoom100.classList.add('active');
      if (elements.btnZoom200) elements.btnZoom200.classList.remove('active');
    } else if (Math.abs(zoomState.scale - 2.0) < 0.05) {
      elements.compZoomBadge.textContent = '200%';
      if (elements.btnZoomFit) elements.btnZoomFit.classList.remove('active');
      if (elements.btnZoom100) elements.btnZoom100.classList.remove('active');
      if (elements.btnZoom200) elements.btnZoom200.classList.add('active');
    } else {
      elements.compZoomBadge.textContent = `${Math.round(zoomState.scale * 100)}%`;
      if (elements.btnZoomFit) elements.btnZoomFit.classList.remove('active');
      if (elements.btnZoom100) elements.btnZoom100.classList.remove('active');
      if (elements.btnZoom200) elements.btnZoom200.classList.remove('active');
    }
  }

  // 操作ヒント文言の更新
  if (elements.compZoomHint) {
    if (zoomState.scale > zoomState.fitScale * 1.05) {
      elements.compZoomHint.textContent = '🖐️ ドラッグで移動 / クリックで拡大 / ホイールでズーム';
    } else {
      elements.compZoomHint.textContent = '🔍 クリックで拡大 / ホイールでズーム';
    }
  }
}

function setSplitPercent(pct) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  zoomState.splitPercent = pct;
  if (elements.compOverlay) elements.compOverlay.style.width = `${pct}%`;
  if (elements.compDividerLine) elements.compDividerLine.style.left = `${pct}%`;
  if (elements.compSlider) elements.compSlider.value = pct;
}

function clampPan() {
  if (!elements.compWrapper) return;
  const wrapperW = elements.compWrapper.clientWidth;
  const wrapperH = elements.compWrapper.clientHeight;
  const curW = zoomState.stageWidth * zoomState.scale;
  const curH = zoomState.stageHeight * zoomState.scale;

  if (curW <= wrapperW) {
    zoomState.panX = (wrapperW - curW) / 2;
  } else {
    const minX = wrapperW - curW - 80;
    const maxX = 80;
    zoomState.panX = Math.max(minX, Math.min(maxX, zoomState.panX));
  }

  if (curH <= wrapperH) {
    zoomState.panY = (wrapperH - curH) / 2;
  } else {
    const minY = wrapperH - curH - 80;
    const maxY = 80;
    zoomState.panY = Math.max(minY, Math.min(maxY, zoomState.panY));
  }
}

function zoomToFit() {
  if (!elements.compWrapper || zoomState.stageWidth <= 0 || zoomState.stageHeight <= 0) return;
  const wrapperW = elements.compWrapper.clientWidth || 800;
  const wrapperH = elements.compWrapper.clientHeight || 500;

  const fitScale = Math.min((wrapperW - 20) / zoomState.stageWidth, (wrapperH - 20) / zoomState.stageHeight);
  zoomState.fitScale = fitScale;
  zoomState.scale = fitScale;
  zoomState.panX = (wrapperW - zoomState.stageWidth * fitScale) / 2;
  zoomState.panY = (wrapperH - zoomState.stageHeight * fitScale) / 2;
  applyZoomTransform();
}

function zoomTo100() {
  if (!elements.compWrapper) return;
  const rect = elements.compWrapper.getBoundingClientRect();
  zoomToPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.0);
}

function zoomToCenter(targetScale) {
  if (!elements.compWrapper) return;
  const rect = elements.compWrapper.getBoundingClientRect();
  zoomToPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, targetScale);
}

function zoomToPoint(clientX, clientY, targetScale) {
  if (!elements.compWrapper) return;
  const rect = elements.compWrapper.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const minScale = Math.max(0.1, zoomState.fitScale * 0.5);
  const maxScale = 12.0; // 最大1200%まで拡大可能
  targetScale = Math.max(minScale, Math.min(maxScale, targetScale));

  const imgX = (mouseX - zoomState.panX) / zoomState.scale;
  const imgY = (mouseY - zoomState.panY) / zoomState.scale;

  zoomState.scale = targetScale;
  zoomState.panX = mouseX - imgX * targetScale;
  zoomState.panY = mouseY - imgY * targetScale;

  clampPan();
  applyZoomTransform();
}

function handleClickToZoom(clientX, clientY) {
  // クリック時のズーム段階: Fit -> 2.5倍 (または100%) -> 5倍 -> Fit
  if (zoomState.scale <= zoomState.fitScale * 1.15) {
    const nextScale = Math.max(1.0, zoomState.fitScale * 2.5);
    zoomToPoint(clientX, clientY, nextScale);
    showToast(`🔍 拡大しました (${Math.round(nextScale * 100)}%) ドラッグで移動できます`);
  } else if (zoomState.scale < 3.0) {
    const nextScale = Math.max(2.5, zoomState.fitScale * 5.0);
    zoomToPoint(clientX, clientY, nextScale);
    showToast(`🔍 ${Math.round(nextScale * 100)}% に拡大しました (再クリックで全体表示)`);
  } else {
    zoomToFit();
    showToast('↔️ 全体表示に戻しました');
  }
}

function setupComparisonViewerEvents() {
  if (!elements.compWrapper) return;

  // 1. ポインター（マウス / タッチ）によるパン操作 & クリック判定
  elements.compWrapper.addEventListener('pointerdown', (e) => {
    // ディバイダー操作判定
    if (e.target.closest('#comp-divider-handle') || e.target.closest('#comp-divider-line')) {
      zoomState.isDraggingDivider = true;
      if (elements.compDividerLine) elements.compDividerLine.classList.add('is-dragging');
      e.preventDefault();
      return;
    }

    zoomState.isPanning = true;
    zoomState.startX = e.clientX;
    zoomState.startY = e.clientY;
    zoomState.startPanX = zoomState.panX;
    zoomState.startPanY = zoomState.panY;
    zoomState.hasMoved = false;
    zoomState.pointerDownTime = performance.now();
    elements.compWrapper.classList.add('is-panning');
  });

  window.addEventListener('pointermove', (e) => {
    if (zoomState.isDraggingDivider) {
      const rect = elements.compWrapper.getBoundingClientRect();
      if (rect.width > 0) {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setSplitPercent(pct);
      }
      return;
    }

    if (zoomState.isPanning) {
      const dx = e.clientX - zoomState.startX;
      const dy = e.clientY - zoomState.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        zoomState.hasMoved = true;
      }
      zoomState.panX = zoomState.startPanX + dx;
      zoomState.panY = zoomState.startPanY + dy;
      clampPan();
      applyZoomTransform();
    }
  });

  const onPointerUp = (e) => {
    if (zoomState.isDraggingDivider) {
      zoomState.isDraggingDivider = false;
      if (elements.compDividerLine) elements.compDividerLine.classList.remove('is-dragging');
    }

    if (zoomState.isPanning) {
      zoomState.isPanning = false;
      elements.compWrapper.classList.remove('is-panning');

      const duration = performance.now() - zoomState.pointerDownTime;
      // 移動量が微小かつ短時間クリックだった場合は「クリックで拡大」を実行
      if (!zoomState.hasMoved && duration < 350) {
        handleClickToZoom(e.clientX, e.clientY);
      }
    }
  };

  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // 2. ダブルクリックで 100% 等倍 と Fit をトグル
  elements.compWrapper.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (Math.abs(zoomState.scale - 1.0) < 0.05) {
      zoomToFit();
      showToast('↔️ 全体表示に戻しました');
    } else {
      zoomToPoint(e.clientX, e.clientY, 1.0);
      showToast('🔍 1:1 等倍ピクセル表示 (100%)');
    }
  });

  // 3. マウスホイールでスムーズズーム (カーソル位置中心)
  elements.compWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    zoomToPoint(e.clientX, e.clientY, zoomState.scale * factor);
  }, { passive: false });

  // 4. スライダー入力連携
  if (elements.compSlider) {
    elements.compSlider.addEventListener('input', (e) => {
      setSplitPercent(e.target.value);
    });
  }

  // 5. ズームツールバー ボタン操作
  if (elements.btnZoomIn) {
    elements.btnZoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomToCenter(zoomState.scale * 1.35);
    });
  }
  if (elements.btnZoomOut) {
    elements.btnZoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomToCenter(zoomState.scale / 1.35);
    });
  }
  if (elements.btnZoomFit) {
    elements.btnZoomFit.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomToFit();
    });
  }
  if (elements.btnZoom100) {
    elements.btnZoom100.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomTo100();
    });
  }
  if (elements.btnZoom200) {
    elements.btnZoom200.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomToCenter(2.0);
    });
  }

  // 6. キーボードショートカット
  window.addEventListener('keydown', (e) => {
    if (!elements.modalOverlay || !elements.modalOverlay.classList.contains('active')) return;

    if (e.key === '+' || e.key === '=') {
      zoomToCenter(zoomState.scale * 1.3);
    } else if (e.key === '-' || e.key === '_') {
      zoomToCenter(zoomState.scale / 1.3);
    } else if (e.key === '0') {
      zoomToFit();
    } else if (e.key === '1') {
      zoomTo100();
    } else if (e.key === 'ArrowLeft') {
      setSplitPercent(zoomState.splitPercent - 5);
    } else if (e.key === 'ArrowRight') {
      setSplitPercent(zoomState.splitPercent + 5);
    }
  });

  // 7. ウィンドウリサイズ時の自動アライメント
  window.addEventListener('resize', () => {
    if (elements.modalOverlay && elements.modalOverlay.classList.contains('active')) {
      if (Math.abs(zoomState.scale - zoomState.fitScale) < 0.05) {
        zoomToFit();
      } else {
        clampPan();
        applyZoomTransform();
      }
    }
  });
}

function openComparisonModal(id) {
  const item = state.processedItems.find(x => x.id === id);
  if (!item) {
    console.warn('Comparison item not found for id:', id);
    return;
  }

  const origFile = item.file || (state.fileMap ? state.fileMap.get(id) : null);

  elements.modalTitle.textContent = `画質比較: ${item.origName || '画像'}`;

  // 元画像の一時URLを生成
  let tempOrigUrl = '';
  if (origFile instanceof Blob || origFile instanceof File) {
    try {
      tempOrigUrl = URL.createObjectURL(origFile);
      state.tempModalUrls.push(tempOrigUrl);
    } catch (e) {
      console.warn('Failed to create orig URL:', e);
    }
  }

  // リサイズ後画像の一時URL
  let tempOutUrl = item.outputUrl || '';
  if (!tempOutUrl && (item.blob instanceof Blob)) {
    try {
      tempOutUrl = URL.createObjectURL(item.blob);
      state.tempModalUrls.push(tempOutUrl);
    } catch (e) {
      console.warn('Failed to create output URL:', e);
    }
  }

  if (!tempOrigUrl && tempOutUrl) tempOrigUrl = tempOutUrl;
  if (!tempOutUrl && tempOrigUrl) tempOutUrl = tempOrigUrl;

  elements.origImg.src = tempOutUrl;  // ベース: リサイズ後
  elements.compImg.src = tempOrigUrl;  // オーバーレイ: 元画像

  elements.modalOrigInfo.innerHTML = `
    <strong>元画像 (ORIGINAL):</strong> ${item.origWidth || '---'}×${item.origHeight || '---'} | ${formatBytes(item.origSize || 0)}
  `;
  elements.modalCompInfo.innerHTML = `
    <strong>リサイズ後 (OPTIMIZED):</strong> ${item.outputWidth || '---'}×${item.outputHeight || '---'} | ${formatBytes(item.outputSize || 0)} (${item.reductionPercent !== undefined ? (item.reductionPercent >= 0 ? '-' + item.reductionPercent + '%' : '+' + Math.abs(item.reductionPercent) + '%') : ''})
  `;

  // ステージ寸法を決定してフィット表示
  const setupDimensions = () => {
    const origW = item.origWidth || elements.compImg.naturalWidth || elements.origImg.naturalWidth || 1920;
    const origH = item.origHeight || elements.compImg.naturalHeight || elements.origImg.naturalHeight || 1080;

    zoomState.stageWidth = origW;
    zoomState.stageHeight = origH;

    if (elements.compStageBase) {
      elements.compStageBase.style.width = `${origW}px`;
      elements.compStageBase.style.height = `${origH}px`;
    }
    if (elements.compStageOverlay) {
      elements.compStageOverlay.style.width = `${origW}px`;
      elements.compStageOverlay.style.height = `${origH}px`;
    }

    setSplitPercent(50);
    zoomToFit();
  };

  let loadedCount = 0;
  const onImageLoad = () => {
    loadedCount++;
    if (loadedCount >= 2 || (elements.origImg.complete && elements.compImg.complete)) {
      setupDimensions();
    }
  };

  elements.origImg.onload = onImageLoad;
  elements.compImg.onload = onImageLoad;

  elements.modalOverlay.classList.add('active');
  setTimeout(setupDimensions, 60);
}

function closeModal() {
  elements.modalOverlay.classList.remove('active');
  elements.origImg.src = '';
  elements.compImg.src = '';
  if (elements.compStageBase) elements.compStageBase.style.transform = '';
  if (elements.compStageOverlay) elements.compStageOverlay.style.transform = '';

  if (state.tempModalUrls && state.tempModalUrls.length > 0) {
    state.tempModalUrls.forEach(url => {
      const isPersistentOutputUrl = state.processedItems.some(item => item.outputUrl === url);
      if (!isPersistentOutputUrl) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    });
    state.tempModalUrls = [];
  }
}

// ==========================================
// ユーティリティ
// ==========================================
function formatBytes(bytes, decimals = 1) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getExtensionFromMime(mime) {
  switch (mime) {
    case 'image/webp': return 'webp';
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    default: return 'jpg';
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'warn') {
    toast.style.borderColor = 'var(--accent-amber)';
  }
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================
// グローバルスコープ登録 (HTML onclick属性からの確実な呼び出しを担保)
// ==========================================
window.openComparisonModal = openComparisonModal;
window.closeModal = closeModal;
window.downloadSingle = downloadSingle;
window.removeCard = removeCard;
window.startProcessing = startProcessing;
window.stopProcessing = stopProcessing;
window.enqueueFiles = enqueueFiles;
window.state = state;
window.elements = elements;
window.zoomToFit = zoomToFit;
window.zoomTo100 = zoomTo100;
window.zoomToPoint = zoomToPoint;
window.zoomState = zoomState;
window.setSplitPercent = setSplitPercent;
window.setTheme = setTheme;
