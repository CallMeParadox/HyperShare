// HyperShare Web Client Engine
document.addEventListener('DOMContentLoaded', () => {
  let allFiles = [];
  let currentCategory = 'all';
  let speedInterval = null;

  // DOM Elements
  const fileListContainer = document.getElementById('fileListContainer');
  const turboFileSelect = document.getElementById('turboFileSelect');
  const btnStartTurbo = document.getElementById('btnStartTurbo');
  const chunkContainer = document.getElementById('chunkContainer');
  const chunkGrid = document.getElementById('chunkGrid');
  const currentSpeed = document.getElementById('currentSpeed');
  const transferFileName = document.getElementById('transferFileName');
  const transferPercent = document.getElementById('transferPercent');
  const progressBar = document.getElementById('progressBar');
  const progressBarBg = document.getElementById('progressBarBg');
  const transferStats = document.getElementById('transferStats');
  const transferredBytes = document.getElementById('transferredBytes');
  const etaTime = document.getElementById('etaTime');
  const networkStatus = document.getElementById('networkStatus');
  const btnAddFiles = document.getElementById('btnAddFiles');
  const mainFileInput = document.getElementById('mainFileInput');
  const btnOpenSharedFolder = document.getElementById('btnOpenSharedFolder');
  const btnOpenReceivedFolder = document.getElementById('btnOpenReceivedFolder');
  const senderBannerUrl = document.getElementById('senderBannerUrl');
  const btnCopySenderUrl = document.getElementById('btnCopySenderUrl');
  const btnBannerShowQR = document.getElementById('btnBannerShowQR');

  // Show PC specific buttons if not inside Android app
  if (!window.AndroidBridge) {
    if (btnOpenSharedFolder) btnOpenSharedFolder.style.display = 'inline-flex';
    if (btnOpenReceivedFolder) btnOpenReceivedFolder.style.display = 'inline-flex';
  }

  btnOpenSharedFolder?.addEventListener('click', () => {
    fetch('/api/open-folder?type=shared');
  });

  btnOpenReceivedFolder?.addEventListener('click', () => {
    fetch('/api/open-folder?type=received');
  });

  btnBannerShowQR?.addEventListener('click', () => {
    if (typeof openQRModal === 'function') openQRModal();
    else {
      const qm = document.getElementById('qrModal');
      if (qm) { qm.style.display = 'flex'; qm.classList.add('open'); }
    }
  });

  btnCopySenderUrl?.addEventListener('click', () => {
    const url = senderBannerUrl?.textContent || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        alert('✅ آدرس وای‌فای فرستنده کپی شد:\n' + url);
      });
    } else {
      prompt('آدرس فرستنده را کپی کنید:', url);
    }
  });

  // ----------------------------------------------------
  // Global Real-Time Transfer Monitor (/api/stats)
  // Synchronizes live transfer speed, progress and ETA
  // across both Sender (Mobile) and Receiver (PC) screens!
  // ----------------------------------------------------
  let monitorInterval = null;
  let lastTransferActive = false;
  window.isManualSpeedActive = false;

  function startActiveTransferMonitor() {
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(async () => {
      if (window.isManualSpeedActive) return;

      try {
        let stats = null;

        // 1. Query local server stats
        try {
          const localRes = await fetch('/api/stats', { cache: 'no-store' });
          if (localRes.ok) {
            const ls = await localRes.json();
            if (ls && ls.is_active) {
              stats = ls;
            }
          }
        } catch (e) {}

        // 2. If receiver connected to remote sender and local is idle, query remote stats
        if (!stats && currentSenderHost) {
          try {
            const remoteRes = await fetch(`${currentSenderHost}/api/stats`, { cache: 'no-store' });
            if (remoteRes.ok) {
              const rs = await remoteRes.json();
              if (rs && rs.is_active) {
                // If remote sender is "sending", from our perspective we are "receiving"
                stats = {
                  ...rs,
                  direction: rs.direction === 'sending' ? 'receiving' : 'sending'
                };
              }
            }
          } catch (e) {}
        }

        if (stats && stats.is_active) {
          lastTransferActive = true;
          const speed = stats.speed_mbps || 0;
          const percent = stats.percent || 0;
          const filename = stats.filename || 'فایل ناشناس';
          const total = stats.total_bytes || 0;
          const transferred = stats.transferred_bytes || 0;

          if (currentSpeed) currentSpeed.textContent = speed.toFixed(1);
          if (transferPercent) transferPercent.textContent = `${percent}%`;
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressBarBg) progressBarBg.style.display = 'block';
          if (transferStats) transferStats.style.display = 'flex';

          if (transferFileName) {
            if (stats.direction === 'sending') {
              transferFileName.innerHTML = `📤 <strong>در حال ارسال به دستگاه مقابل:</strong> ${escapeHtml(filename)}`;
            } else {
              transferFileName.innerHTML = `📥 <strong>در حال دریافت:</strong> ${escapeHtml(filename)}`;
            }
          }

          if (transferredBytes) {
            if (total > 0) {
              transferredBytes.textContent = `${formatBytes(transferred)} / ${formatBytes(total)}`;
            } else {
              transferredBytes.textContent = formatBytes(transferred);
            }
          }

          if (etaTime) {
            if (total > 0 && speed > 0) {
              const remaining = Math.max(0, total - transferred);
              const eta = remaining / (speed * 1024 * 1024);
              etaTime.textContent = eta > 0 ? `ETA: ${Math.round(eta)} ثانیه` : 'تکمیل';
            } else {
              etaTime.textContent = '';
            }
          }
        } else if (lastTransferActive) {
          lastTransferActive = false;
          if (currentSpeed) currentSpeed.textContent = '0.0';
          if (transferPercent) transferPercent.textContent = '۱۰۰% (تکمیل شد)';
          if (progressBar) progressBar.style.width = '100%';
          if (etaTime) etaTime.textContent = 'انجام شد!';
          setTimeout(() => {
            if (!lastTransferActive && !window.isManualSpeedActive) {
              if (transferFileName) transferFileName.textContent = '⚡ آماده به کار (شبکه آماده انتقال فوق‌سریع)';
              if (transferPercent) transferPercent.textContent = '';
              if (progressBarBg) progressBarBg.style.display = 'none';
              if (transferStats) transferStats.style.display = 'none';
            }
          }, 2500);
        }
      } catch (err) {}
    }, 400);
  }

  // Start background transfer monitor immediately
  startActiveTransferMonitor();

  async function uploadFileDirectly(file, target = 'shared') {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?target=${target}&name=${encodeURIComponent(file.name)}&size=${file.size}`);
      xhr.onload = () => resolve();
      xhr.onerror = () => resolve();
      xhr.send(file);
    });
  }

  btnAddFiles?.addEventListener('click', async () => {
    if (window.AndroidBridge && window.AndroidBridge.pickFilesForSharing) {
      window.AndroidBridge.pickFilesForSharing();
    } else if (window.AndroidBridge && window.AndroidBridge.pickFiles) {
      window.AndroidBridge.pickFiles();
    } else {
      // Windows PC native file picker or browser fallback
      try {
        btnAddFiles.disabled = true;
        const origText = btnAddFiles.innerHTML;
        btnAddFiles.innerHTML = '⏳ در حال باز کردن انتخاب‌گر فایل...';
        const res = await fetch('/api/pick-pc-files', { method: 'POST' });
        const data = await res.json();
        if (data && data.count > 0) {
          loadFiles();
        } else {
          mainFileInput?.click();
        }
      } catch (err) {
        mainFileInput?.click();
      } finally {
        btnAddFiles.disabled = false;
        btnAddFiles.innerHTML = '➕ افزودن فایل برای اشتراک و ارسال';
      }
    }
  });

  mainFileInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    btnAddFiles.disabled = true;
    btnAddFiles.innerHTML = '⏳ در حال افزودن فایل‌ها...';
    for (const file of files) {
      await uploadFileDirectly(file, 'shared');
    }
    mainFileInput.value = '';
    btnAddFiles.disabled = false;
    btnAddFiles.innerHTML = '➕ افزودن فایل برای اشتراک و ارسال';
    loadFiles();
  });

  // ----------------------------------------------------
  // Role Selector & Receiver Module (فرستنده / گیرنده)
  // ----------------------------------------------------
  const btnRoleSender = document.getElementById('btnRoleSender');
  const btnRoleReceiver = document.getElementById('btnRoleReceiver');
  const senderContainer = document.getElementById('senderContainer');
  const receiverContainer = document.getElementById('receiverContainer');
  const roleModal = document.getElementById('roleModal');
  const choiceSender = document.getElementById('choiceSender');
  const choiceReceiver = document.getElementById('choiceReceiver');

  // Receiver DOM elements
  const inputSenderHost = document.getElementById('inputSenderHost');
  const btnConnectSender = document.getElementById('btnConnectSender');
  const btnAutoScanSender = document.getElementById('btnAutoScanSender');
  const btnOpenScanner = document.getElementById('btnOpenScanner');
  const receiverConnActions = document.getElementById('receiverConnActions');
  const receiverConnectedBar = document.getElementById('receiverConnectedBar');
  const connectedSenderHost = document.getElementById('connectedSenderHost');
  const btnDisconnectSender = document.getElementById('btnDisconnectSender');
  const btnReceiverDownloadAll = document.getElementById('btnReceiverDownloadAll');
  const receiverFileList = document.getElementById('receiverFileList');
  const receiverFilesCount = document.getElementById('receiverFilesCount');
  const receiverStatusTitle = document.getElementById('receiverStatusTitle');
  const receiverStatusSubtitle = document.getElementById('receiverStatusSubtitle');
  const receiverPulseDot = document.getElementById('receiverPulseDot');

  // Camera Scanner Elements
  const cameraScanModal = document.getElementById('cameraScanModal');
  const cameraModalClose = document.getElementById('cameraModalClose');
  const btnCancelCamera = document.getElementById('btnCancelCamera');
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraScanStatus = document.getElementById('cameraScanStatus');
  let cameraStream = null;
  let cameraScanInterval = null;

  let activeRole = 'sender';
  let currentSenderHost = '';
  let receiverPollTimer = null;
  let lastReceiverFilesHash = '';

  function setRole(role) {
    activeRole = role;
    if (role === 'sender') {
      btnRoleSender?.classList.add('active');
      btnRoleReceiver?.classList.remove('active');
      if (senderContainer) senderContainer.style.display = 'block';
      if (receiverContainer) receiverContainer.style.display = 'none';
      stopReceiverSync();
      loadFiles();
    } else {
      btnRoleReceiver?.classList.add('active');
      btnRoleSender?.classList.remove('active');
      if (senderContainer) senderContainer.style.display = 'none';
      if (receiverContainer) receiverContainer.style.display = 'block';
      if (!currentSenderHost) {
        autoDiscoverSender();
      }
    }
  }

  btnRoleSender?.addEventListener('click', () => setRole('sender'));
  btnRoleReceiver?.addEventListener('click', () => setRole('receiver'));

  choiceSender?.addEventListener('click', () => {
    if (roleModal) roleModal.style.display = 'none';
    setRole('sender');
  });

  choiceReceiver?.addEventListener('click', () => {
    if (roleModal) roleModal.style.display = 'none';
    setRole('receiver');
  });

  // Check if role modal should be shown on startup
  const hasVisited = sessionStorage.getItem('hypershare_visited');
  if (!hasVisited && roleModal) {
    roleModal.style.display = 'flex';
    sessionStorage.setItem('hypershare_visited', 'true');
  }

  // Auto-discover sender
  async function autoDiscoverSender() {
    if (receiverStatusTitle) receiverStatusTitle.textContent = 'در حال جستجوی فرستنده در شبکه...';
    if (receiverPulseDot) receiverPulseDot.style.background = '#ffbb00';

    // 1. Try PC backend /api/find-sender
    try {
      const res = await fetch('/api/find-sender');
      const data = await res.json();
      if (data.found && data.sender_url) {
        connectToSender(data.sender_url);
        return;
      }
    } catch (e) {}

    // 2. Client-side candidate probe
    const candidates = [
      'http://192.168.43.1:8080',  // Android default hotspot
      'http://192.168.137.1:8080', // Windows default hotspot
      'http://192.168.1.1:8080',
      'http://192.168.0.1:8080',
      'http://172.20.10.1:8080'
    ];

    for (const cand of candidates) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600);
        const r = await fetch(`${cand}/api/network`, { signal: controller.signal, mode: 'cors' });
        clearTimeout(timeoutId);
        if (r.ok) {
          connectToSender(cand);
          return;
        }
      } catch (err) {}
    }

    if (receiverStatusTitle) receiverStatusTitle.textContent = 'دستگاه فرستنده را انتخاب کنید';
    if (receiverStatusSubtitle) receiverStatusSubtitle.textContent = 'آدرس وای‌فای نمایش داده شده روی گوشی/دستگاه فرستنده را وارد کنید یا اسکن بارکد را بزنید:';
    if (receiverPulseDot) receiverPulseDot.style.background = '#00f0ff';
    if (inputSenderHost && !inputSenderHost.value) {
      inputSenderHost.value = 'http://192.168.43.1:8080';
    }
  }

  btnAutoScanSender?.addEventListener('click', () => {
    autoDiscoverSender();
  });

  btnConnectSender?.addEventListener('click', () => {
    const raw = inputSenderHost?.value.trim();
    if (!raw) return alert('لطفاً آدرس فرستنده را وارد کنید.');
    let url = raw;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }
    connectToSender(url);
  });

  btnDisconnectSender?.addEventListener('click', () => {
    // 1. Abort any active Turbo transfers
    if (activeTurboAbortControllers && activeTurboAbortControllers.length > 0) {
      activeTurboAbortControllers.forEach(c => {
        try { c.abort(); } catch(e) {}
      });
      activeTurboAbortControllers = [];
    }
    if (speedInterval) {
      clearInterval(speedInterval);
      speedInterval = null;
    }

    // 2. Notify remote sender to terminate its transfer tracking and reset speed immediately
    if (currentSenderHost) {
      fetch(`${currentSenderHost}/api/disconnect`, { method: 'POST', mode: 'cors' }).catch(() => {});
    }
    // Also notify local server
    fetch('/api/disconnect', { method: 'POST' }).catch(() => {});

    stopReceiverSync();
    currentSenderHost = '';
    lastReceiverFilesHash = '';
    window.isManualSpeedActive = false;

    if (chunkContainer) chunkContainer.style.display = 'none';
    if (currentSpeed) currentSpeed.textContent = '0.0';
    if (transferFileName) transferFileName.textContent = '⚡ آماده به کار (شبکه آماده انتقال فوق‌سریع)';
    if (transferPercent) transferPercent.textContent = '';
    if (progressBarBg) progressBarBg.style.display = 'none';
    if (transferStats) transferStats.style.display = 'none';

    if (receiverConnectedBar) receiverConnectedBar.style.display = 'none';
    if (receiverConnActions) receiverConnActions.style.display = 'block';
    if (receiverStatusTitle) receiverStatusTitle.textContent = 'اتصال قطع شد';
    if (receiverStatusSubtitle) receiverStatusSubtitle.textContent = 'می‌توانید به دستگاه فرستنده دیگری متصل شوید.';
    if (receiverPulseDot) receiverPulseDot.style.background = '#8a99ad';
    if (receiverFileList) {
      receiverFileList.innerHTML = '<div class="empty-state"><p>هنوز به دستگاه فرستنده متصل نشده‌اید.</p></div>';
    }
    if (receiverFilesCount) receiverFilesCount.textContent = '۰ فایل';
  });

  function connectToSender(hostUrl) {
    currentSenderHost = hostUrl.replace(/\/+$/, '');
    if (receiverConnActions) receiverConnActions.style.display = 'none';
    if (receiverConnectedBar) receiverConnectedBar.style.display = 'flex';
    if (connectedSenderHost) connectedSenderHost.textContent = currentSenderHost;
    if (receiverStatusTitle) receiverStatusTitle.textContent = '🟢 متصل به دستگاه فرستنده';
    if (receiverStatusSubtitle) receiverStatusSubtitle.textContent = 'فایل‌های ارسالی فرستنده به صورت بلادرنگ همگام‌سازی می‌شوند:';
    if (receiverPulseDot) receiverPulseDot.style.background = 'var(--accent-green)';

    startReceiverSync();
  }

  function startReceiverSync() {
    stopReceiverSync();
    pollReceiverFiles();
    receiverPollTimer = setInterval(pollReceiverFiles, 1500); // 1.5s real-time poll
  }

  function stopReceiverSync() {
    if (receiverPollTimer) {
      clearInterval(receiverPollTimer);
      receiverPollTimer = null;
    }
  }

  let latestReceiverFiles = [];

  async function pollReceiverFiles() {
    if (!currentSenderHost) return;
    try {
      const res = await fetch(`${currentSenderHost}/api/files`, { cache: 'no-store' });
      const files = await res.json();
      const safeFiles = Array.isArray(files) ? files : [];

      latestReceiverFiles = safeFiles;
      populateTurboSelect();

      const currentHash = safeFiles.map(f => `${f.name}:${f.size}`).join('|');
      if (currentHash !== lastReceiverFilesHash) {
        lastReceiverFilesHash = currentHash;
        renderReceiverFilesList(safeFiles);
      }
    } catch (err) {
      console.warn('Poll sender files failed:', err);
    }
  }

  function renderReceiverFilesList(files) {
    if (!receiverFileList) return;
    if (receiverFilesCount) receiverFilesCount.textContent = `${files.length} فایل`;

    if (files.length === 0) {
      receiverFileList.innerHTML = `
        <div class="empty-state">
          <p>دستگاه فرستنده هنوز فایلی برای ارسال انتخاب نکرده است.</p>
          <span style="font-size: 12px; color: var(--text-muted); display: block; margin-top: 6px;">به محض اینکه فرستنده فایلی اضافه یا حذف کند، این صفحه خودکار و بلادرنگ به‌روز می‌شود.</span>
        </div>
      `;
      return;
    }

    receiverFileList.innerHTML = files.map(file => {
      const icon = getCategoryIcon(file.category);
      const downloadUrl = `${currentSenderHost}/api/download/${encodeURIComponent(file.name)}`;
      const canPreview = file.preview_url ? true : false;
      const previewUrl = canPreview ? `${currentSenderHost}/api/preview/${encodeURIComponent(file.name)}` : '';

      return `
        <div class="file-card">
          <div class="file-icon">${icon}</div>
          <div class="file-meta">
            <div class="file-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="file-sub">
              <span>${file.human_size}</span>
              <span class="file-badge">${file.category}</span>
            </div>
          </div>
          <div class="file-actions" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${canPreview ? `
              <button class="btn-secondary btn-sm preview-btn" data-url="${previewUrl}" data-type="${file.category}" data-title="${escapeHtml(file.name)}" title="پیش‌نمایش">
                👁️
              </button>
            ` : ''}
            <button class="btn-turbo-card dl-turbo-btn" data-name="${escapeHtml(file.name)}" data-size="${file.size}" title="دانلود فوق‌سریع موازی">
              🚀 توربو (۸ استریم)
            </button>
            <a href="${downloadUrl}" download="${escapeHtml(file.name)}" class="btn-secondary btn-sm dl-trigger-btn" data-name="${escapeHtml(file.name)}" style="text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="دریافت عادی">
              ⬇️ عادی
            </a>
          </div>
        </div>
      `;
    }).join('');

    // Wire preview buttons
    receiverFileList.querySelectorAll('.preview-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const { url, type, title } = e.currentTarget.dataset;
        openPreview(url, type, title);
      });
    });

    // Wire Turbo 8-stream parallel download directly from cards
    receiverFileList.querySelectorAll('.dl-turbo-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const name = e.currentTarget.dataset.name;
        const size = parseInt(e.currentTarget.dataset.size, 10) || 0;
        runTurboPipeline(name, size);
      });
    });

    // Wire immediate feedback on standard download click
    receiverFileList.querySelectorAll('.dl-trigger-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const name = e.currentTarget.dataset.name;
        if (transferFileName) {
          transferFileName.innerHTML = `📥 <strong>در حال دریافت عادی:</strong> ${escapeHtml(name)}...`;
        }
        if (progressBarBg) progressBarBg.style.display = 'block';
        if (progressBar) progressBar.style.width = '3%';
      });
    });
  }

  btnReceiverDownloadAll?.addEventListener('click', () => {
    if (!currentSenderHost) return;
    if (transferFileName) {
      transferFileName.innerHTML = `📥 <strong>در حال آغاز دریافت همه فایل‌ها (ZIP)...</strong>`;
    }
    if (progressBarBg) progressBarBg.style.display = 'block';
    if (progressBar) progressBar.style.width = '3%';
    window.location.href = `${currentSenderHost}/api/download-all`;
  });

  // ----------------------------------------------------
  // Camera Scanner Implementation
  // ----------------------------------------------------
  btnOpenScanner?.addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('دوربین در این دستگاه پشتیبانی نمی‌شود. لطفاً آدرس فرستنده را به صورت دستی وارد کنید.');
      return;
    }

    if (cameraScanModal) cameraScanModal.style.display = 'flex';
    if (cameraScanStatus) cameraScanStatus.textContent = 'در حال باز کردن دوربین...';

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (cameraVideo) {
        cameraVideo.srcObject = cameraStream;
        cameraVideo.play();
      }
      if (cameraScanStatus) cameraScanStatus.textContent = 'بارکد را روبروی کادر مربع بگیرید...';

      startBarcodeDetection();
    } catch (err) {
      if (cameraScanStatus) cameraScanStatus.textContent = 'خطا در دسترسی به دوربین: ' + err.message;
    }
  });

  function closeCameraModal() {
    if (cameraScanInterval) {
      clearInterval(cameraScanInterval);
      cameraScanInterval = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    if (cameraScanModal) {
      cameraScanModal.style.display = 'none';
      cameraScanModal.classList.remove('open');
    }
  }

  const cameraModalBackdrop = document.getElementById('cameraModalBackdrop');
  cameraModalClose?.addEventListener('click', closeCameraModal);
  cameraModalBackdrop?.addEventListener('click', closeCameraModal);
  btnCancelCamera?.addEventListener('click', closeCameraModal);

  function startBarcodeDetection() {
    if ('BarcodeDetector' in window) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      cameraScanInterval = setInterval(async () => {
        if (!cameraVideo || cameraVideo.readyState < 2) return;
        try {
          const barcodes = await detector.detect(cameraVideo);
          if (barcodes.length > 0) {
            const rawVal = barcodes[0].rawValue;
            if (rawVal && (rawVal.includes('http') || rawVal.includes(':8080') || rawVal.includes('192.168'))) {
              if (window.AndroidBridge && window.AndroidBridge.vibrate) {
                window.AndroidBridge.vibrate(100);
              }
              closeCameraModal();
              connectToSender(rawVal);
            }
          }
        } catch (e) {}
      }, 300);
    } else {
      if (cameraScanStatus) {
        cameraScanStatus.textContent = 'مرورگر از اسکن خودکار بارکد پشتیبانی نمی‌کند. لطفاً آدرس را دستی وارد کنید.';
      }
    }
  }

  // Load Initial Network Info
  fetch('/api/network')
    .then(r => r.json())
    .then(net => {
      if (net.is_hotspot) {
        networkStatus.textContent = '5GHz Hotspot (Direct P2P)';
      } else {
        networkStatus.textContent = `Direct LAN (${net.primary_ip})`;
      }
      if (senderBannerUrl && (net.receiver_url || net.primary_ip)) {
        senderBannerUrl.textContent = net.receiver_url || `http://${net.primary_ip}:8080`;
      }
    })
    .catch(() => {});

  // Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = `tab-${btn.dataset.tab}`;
      const target = document.getElementById(tabId);
      if (target) target.classList.add('active');

      if (btn.dataset.tab === 'clipboard') {
        loadClipboard();
      }
    });
  });

  // Category Filter Chips
  const categoryChips = document.querySelectorAll('.category-chips .chip');
  categoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      categoryChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCategory = chip.dataset.cat;
      renderFiles();
    });
  });

  // Fetch & Render Files
  async function loadFiles() {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      allFiles = Array.isArray(data) ? data : [];
      renderFiles();
      populateTurboSelect();
    } catch (err) {
      fileListContainer.innerHTML = `<div class="error-state">خطا در دریافت لیست فایل‌ها: ${err.message}</div>`;
    }
  }

  // Make globally accessible so MainActivity.kt can refresh the list on file add
  window.loadFiles = loadFiles;

  function renderFiles() {
    if (!Array.isArray(allFiles)) allFiles = [];
    const filtered = (currentCategory === 'all' 
      ? allFiles 
      : allFiles.filter(f => f && f.category === currentCategory)) || [];

    if (filtered.length === 0) {
      fileListContainer.innerHTML = `
        <div class="empty-state">
          <p>هیچ فایلی در این دسته وجود ندارد.</p>
          <button class="btn-primary mt-2" onclick="document.getElementById('btnAddFiles') ? document.getElementById('btnAddFiles').click() : null">
            ➕ افزودن فایل برای اشتراک
          </button>
        </div>
      `;
      return;
    }

    fileListContainer.innerHTML = filtered.map(file => {
      const icon = getCategoryIcon(file.category);
      const canPreview = file.preview_url ? true : false;
      const downloadUrl = file.download_url || file.downloadURL || (`/api/download/${encodeURIComponent(file.name)}`);

      return `
        <div class="file-card">
          <div class="file-icon">${icon}</div>
          <div class="file-meta">
            <div class="file-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="file-sub">
              <span>${file.human_size}</span>
              <span>•</span>
              <span>${file.category.toUpperCase()}</span>
            </div>
          </div>
          <div class="file-actions" style="display: flex; gap: 8px; align-items: center;">
            <span class="file-ready-tag" style="font-size: 11px; color: var(--paradox-teal); background: rgba(0, 240, 255, 0.08); border: 1px solid rgba(0, 240, 255, 0.25); border-radius: 6px; padding: 3px 8px; white-space: nowrap;">
              ✓ آماده ارسال
            </span>
            ${canPreview ? `
              <button class="action-icon-btn preview-btn" data-url="${file.preview_url}" data-type="${file.category}" data-title="${escapeHtml(file.name)}" title="پیش‌نمایش">
                👁️ پیش‌نمایش
              </button>
            ` : ''}
            <button class="action-icon-btn delete-btn danger-icon-btn" data-id="${file.id || ''}" data-name="${escapeHtml(file.name)}" title="حذف از لیست ارسالی‌ها">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach preview listeners
    document.querySelectorAll('.preview-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const { url, type, title } = e.currentTarget.dataset;
        openPreview(url, type, title);
      });
    });

    // Attach delete listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const { id, name } = e.currentTarget.dataset;
        if (confirm(`آیا مطمئنید فایل "${name}" از لیست ارسالی‌ها حذف شود؟`)) {
          await fetch('/api/files/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name })
          });
          loadFiles();
        }
      });
    });
  }

  function getCategoryIcon(cat) {
    switch (cat) {
      case 'video': return '🎬';
      case 'image': return '🖼️';
      case 'audio': return '🎵';
      case 'app': return '📱';
      case 'document': return '📄';
      case 'archive': return '📦';
      default: return '📁';
    }
  }

  // Populate Turbo Select Box
  function populateTurboSelect() {
    if (!turboFileSelect) return;
    const fileSource = (activeRole === 'receiver' && latestReceiverFiles.length > 0) ? latestReceiverFiles : allFiles;
    if (!Array.isArray(fileSource) || fileSource.length === 0) {
      turboFileSelect.innerHTML = '<option value="">هیچ فایلی موجود نیست</option>';
      btnStartTurbo.disabled = true;
      return;
    }

    turboFileSelect.innerHTML = fileSource.map(f => 
      `<option value="${f.name}" data-size="${f.size}">${f.name} (${f.human_size})</option>`
    ).join('');
    btnStartTurbo.disabled = false;
  }

  // Download All as ZIP
  document.getElementById('btnDownloadAll')?.addEventListener('click', () => {
    if (transferFileName) {
      transferFileName.innerHTML = `📥 <strong>در حال ایجاد و دریافت همه فایل‌ها (ZIP)...</strong>`;
    }
    if (progressBarBg) progressBarBg.style.display = 'block';
    if (progressBar) progressBar.style.width = '3%';
    window.location.href = '/api/download-all';
  });

  // Clear All Files
  document.getElementById('btnClearAllFiles')?.addEventListener('click', async () => {
    if (!Array.isArray(allFiles) || allFiles.length === 0) return;
    if (confirm('آیا می‌خواهید تمام فایل‌ها را از لیست ارسالی‌ها پاک کنید؟')) {
      await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
      loadFiles();
    }
  });

  // Media Preview Modal
  const mediaModal = document.getElementById('mediaModal');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const modalBackdrop = document.getElementById('modalBackdrop');

  function openPreview(url, type, title) {
    let content = '';
    if (type === 'video') {
      content = `<video src="${url}" controls autoplay style="max-width:100%; border-radius:12px;"></video>`;
    } else if (type === 'audio') {
      content = `<div style="padding:20px;"><audio src="${url}" controls autoplay style="width:100%;"></audio></div>`;
    } else if (type === 'image') {
      content = `<img src="${url}" alt="${title}" style="max-width:100%; max-height:75vh; border-radius:12px;">`;
    }
    modalBody.innerHTML = `<h4>${title}</h4><div style="margin-top:14px;">${content}</div>`;
    if (mediaModal) {
      mediaModal.style.display = 'flex';
      mediaModal.classList.add('open');
    }
  }

  function closeMediaModal() {
    if (mediaModal) {
      mediaModal.style.display = 'none';
      mediaModal.classList.remove('open');
      modalBody.innerHTML = '';
    }
  }

  modalClose?.addEventListener('click', closeMediaModal);
  modalBackdrop?.addEventListener('click', closeMediaModal);

  // ----------------------------------------------------
  // Turbo Multi-Stream Parallel Downloader (8 Streams)
  // ----------------------------------------------------
  let activeTurboAbortControllers = [];

  async function runTurboPipeline(filename, totalSize) {
    if (!filename) return;
    totalSize = parseInt(totalSize, 10) || 0;

    // Abort any ongoing turbo transfer
    if (activeTurboAbortControllers.length > 0) {
      activeTurboAbortControllers.forEach(c => { try { c.abort(); } catch(e) {} });
      activeTurboAbortControllers = [];
    }

    window.isManualSpeedActive = true;
    if (btnStartTurbo) btnStartTurbo.disabled = true;

    const baseHost = (activeRole === 'receiver' && currentSenderHost) ? currentSenderHost : '';

    // If size not known, probe via HEAD
    if (totalSize <= 0) {
      try {
        const headRes = await fetch(`${baseHost}/api/download/${encodeURIComponent(filename)}`, { method: 'HEAD' });
        const cl = headRes.headers.get('content-length');
        if (cl) totalSize = parseInt(cl, 10);
      } catch (e) {}
    }

    // Determine streams count (8 streams for files >= 4MB, 4 streams for smaller)
    const numChunks = (totalSize > 0 && totalSize < 4 * 1024 * 1024) ? 4 : 8;
    const chunkSize = totalSize > 0 ? Math.ceil(totalSize / numChunks) : 0;

    if (chunkContainer) chunkContainer.style.display = 'block';
    if (chunkGrid) chunkGrid.innerHTML = '';
    if (transferFileName) transferFileName.innerHTML = `🚀 <strong>توربو (${numChunks} کاناله):</strong> ${escapeHtml(filename)}`;
    if (progressBarBg) progressBarBg.style.display = 'block';
    if (transferStats) transferStats.style.display = 'flex';

    // Build visual chunk progress bars
    for (let i = 0; i < numChunks; i++) {
      const item = document.createElement('div');
      item.className = 'chunk-item';
      item.innerHTML = `
        <div class="chunk-title">
          <span>کانال ${i + 1}</span>
          <span id="chunkText-${i}">0%</span>
        </div>
        <div class="chunk-bar-bg">
          <div class="chunk-bar-fill" id="chunkBar-${i}"></div>
        </div>
      `;
      chunkGrid.appendChild(item);
    }

    const startTime = performance.now();
    let totalDownloaded = 0;
    let lastDownloaded = 0;
    let lastTime = startTime;

    if (speedInterval) clearInterval(speedInterval);
    speedInterval = setInterval(() => {
      const now = performance.now();
      const timeDiff = (now - lastTime) / 1000;
      const bytesDiff = totalDownloaded - lastDownloaded;
      const mbps = timeDiff > 0 ? (bytesDiff / (1024 * 1024)) / timeDiff : 0;

      if (currentSpeed) currentSpeed.textContent = mbps.toFixed(1);
      lastDownloaded = totalDownloaded;
      lastTime = now;

      if (totalSize > 0) {
        const percent = Math.min(100, Math.round((totalDownloaded / totalSize) * 100));
        if (transferPercent) transferPercent.textContent = `${percent}%`;
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (transferredBytes) transferredBytes.textContent = `${(totalDownloaded / (1024*1024)).toFixed(1)} MB / ${(totalSize / (1024*1024)).toFixed(1)} MB`;

        if (mbps > 0) {
          const remainingBytes = Math.max(0, totalSize - totalDownloaded);
          const etaSec = remainingBytes / (mbps * 1024 * 1024);
          if (etaTime) etaTime.textContent = `ETA: ${Math.round(etaSec)} ثانیه`;
        }
      } else {
        if (transferredBytes) transferredBytes.textContent = `${(totalDownloaded / (1024*1024)).toFixed(1)} MB`;
      }
    }, 350);

    const promises = [];
    activeTurboAbortControllers = [];

    // Fallback single stream if totalSize is unknown or 1 chunk
    if (totalSize <= 0 || numChunks <= 1) {
      const downloadUrl = `${baseHost}/api/download/${encodeURIComponent(filename)}`;
      window.location.href = downloadUrl;
      clearInterval(speedInterval);
      window.isManualSpeedActive = false;
      if (btnStartTurbo) btnStartTurbo.disabled = false;
      return;
    }

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize - 1, totalSize - 1);
      const controller = new AbortController();
      activeTurboAbortControllers.push(controller);

      promises.push((async () => {
        const res = await fetch(`${baseHost}/api/download/${encodeURIComponent(filename)}`, {
          headers: { 'Range': `bytes=${start}-${end}` },
          signal: controller.signal
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const parts = [];
        let chunkRecv = 0;
        const expected = (end - start) + 1;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          chunkRecv += value.length;
          totalDownloaded += value.length;

          const p = Math.min(100, Math.round((chunkRecv / expected) * 100));
          const barEl = document.getElementById(`chunkBar-${i}`);
          const txtEl = document.getElementById(`chunkText-${i}`);
          if (barEl) barEl.style.width = `${p}%`;
          if (txtEl) txtEl.textContent = `${p}%`;
        }

        return new Blob(parts);
      })());
    }

    try {
      const blobs = await Promise.all(promises);
      clearInterval(speedInterval);
      speedInterval = null;
      if (currentSpeed) currentSpeed.textContent = '0.0';
      if (progressBar) progressBar.style.width = '100%';
      if (transferPercent) transferPercent.textContent = '۱۰۰% (تکمیل شد)';
      if (etaTime) etaTime.textContent = 'انجام شد!';

      if (window.AndroidBridge && window.AndroidBridge.vibrate) {
        window.AndroidBridge.vibrate(200);
      }

      const finalBlob = new Blob(blobs, { type: 'application/octet-stream' });
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      setTimeout(() => {
        if (!window.isManualSpeedActive && chunkContainer) {
          chunkContainer.style.display = 'none';
        }
      }, 3500);
    } catch (err) {
      clearInterval(speedInterval);
      speedInterval = null;
      if (err.name === 'AbortError') {
        console.log('Turbo download cancelled by user');
        return;
      }
      console.error('Turbo error, falling back to standard download:', err);
      alert(`هشدار توربو: ${err.message}\nدر حال دریافت فایل با روش استاندارد...`);
      window.location.href = `${baseHost}/api/download/${encodeURIComponent(filename)}`;
    } finally {
      window.isManualSpeedActive = false;
      if (btnStartTurbo) btnStartTurbo.disabled = false;
      activeTurboAbortControllers = [];
    }
  }

  btnStartTurbo?.addEventListener('click', async () => {
    const selectedOption = turboFileSelect.selectedOptions[0];
    if (!selectedOption || !selectedOption.value) {
      alert('لطفاً ابتدا یک فایل را از لیست انتخاب کنید.');
      return;
    }
    const filename = selectedOption.value;
    const totalSize = parseInt(selectedOption.dataset.size, 10) || 0;
    runTurboPipeline(filename, totalSize);
  });

  // ----------------------------------------------------
  // 5GHz Speed Booster Banner & Hotspot Guide Bindings
  // ----------------------------------------------------
  const btnToggleBoosterGuide = document.getElementById('btnToggleBoosterGuide');
  const boosterContent = document.getElementById('boosterContent');
  const btnOpenHotspotSettings = document.getElementById('btnOpenHotspotSettings');
  const btnStartNative5G = document.getElementById('btnStartNative5G');

  btnToggleBoosterGuide?.addEventListener('click', () => {
    if (!boosterContent) return;
    const isHidden = boosterContent.style.display === 'none';
    boosterContent.style.display = isHidden ? 'block' : 'none';
    btnToggleBoosterGuide.textContent = isHidden ? 'بستن راهنما ▴' : 'مشاهده راهنما ▾';
  });

  if (window.AndroidBridge) {
    if (btnOpenHotspotSettings) {
      btnOpenHotspotSettings.style.display = 'inline-flex';
      btnOpenHotspotSettings.addEventListener('click', () => {
        if (window.AndroidBridge.openHotspotSettings) {
          window.AndroidBridge.openHotspotSettings();
        }
      });
    }

    if (btnStartNative5G) {
      btnStartNative5G.style.display = 'inline-flex';
      btnStartNative5G.addEventListener('click', () => {
        if (window.AndroidBridge.startNative5GHzHotspot) {
          window.AndroidBridge.startNative5GHzHotspot();
        }
      });
    }

    // Check actual Wi-Fi frequency
    try {
      if (window.AndroidBridge.getWifiFrequency) {
        const freq = window.AndroidBridge.getWifiFrequency();
        if (freq >= 4900) {
          if (networkStatus) networkStatus.textContent = '5GHz P2P (نهایت سرعت)';
        } else if (freq >= 2400 && freq <= 2500) {
          if (networkStatus) {
            networkStatus.textContent = '2.4GHz (محدود به ۵MB/s)';
            networkStatus.style.color = 'var(--paradox-yellow)';
          }
          // Automatically expand speed guide to alert user about 2.4GHz bottleneck!
          if (boosterContent) {
            boosterContent.style.display = 'block';
            if (btnToggleBoosterGuide) btnToggleBoosterGuide.textContent = 'بستن راهنما ▴';
          }
        }
      }
    } catch (e) {}
  }

  // ----------------------------------------------------
  // 5GHz Speed Test Benchmark
  // ----------------------------------------------------
  const btnRunSpeedTest = document.getElementById('btnRunSpeedTest');
  const benchResults = document.getElementById('benchResults');
  const benchPeakSpeed = document.getElementById('benchPeakSpeed');
  const benchAvgSpeed = document.getElementById('benchAvgSpeed');
  const benchDuration = document.getElementById('benchDuration');
  const dialMeter = document.getElementById('dialMeter');

  btnRunSpeedTest?.addEventListener('click', async () => {
    window.isManualSpeedActive = true;
    btnRunSpeedTest.disabled = true;
    benchResults.style.display = 'none';

    const selectedSizeMB = parseInt(document.querySelector('input[name="benchSize"]:checked').value, 10);
    const totalBytes = selectedSizeMB * 1024 * 1024;

    let received = 0;
    let peakMBps = 0;
    let lastBytes = 0;
    let lastTime = performance.now();
    const startTime = lastTime;

    const meterInterval = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const db = received - lastBytes;
      const speed = (db / (1024 * 1024)) / dt;

      if (speed > peakMBps) peakMBps = speed;

      benchPeakSpeed.textContent = speed.toFixed(1);
      currentSpeed.textContent = speed.toFixed(1);

      const ratio = Math.min(1, speed / 150);
      dialMeter.style.strokeDashoffset = 251 - (251 * ratio);

      lastBytes = received;
      lastTime = now;
    }, 200);

    try {
      const response = await fetch(`/api/speedtest?size_mb=${selectedSizeMB}`);
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
      }

      const totalTimeSec = (performance.now() - startTime) / 1000;
      const avgMBps = (totalBytes / (1024 * 1024)) / totalTimeSec;

      clearInterval(meterInterval);
      benchPeakSpeed.textContent = peakMBps.toFixed(1);
      benchAvgSpeed.textContent = `${avgMBps.toFixed(1)} MB/s`;
      benchDuration.textContent = `${totalTimeSec.toFixed(2)} ثانیه`;
      benchResults.style.display = 'block';

      if (window.AndroidBridge && window.AndroidBridge.vibrate) {
        window.AndroidBridge.vibrate(100);
      }
    } catch (err) {
      clearInterval(meterInterval);
      alert(`خطای بنچمارک: ${err.message}`);
    } finally {
      window.isManualSpeedActive = false;
      btnRunSpeedTest.disabled = false;
      currentSpeed.textContent = '0.0';
    }
  });

  // ----------------------------------------------------
  // Clipboard / Text Beam
  // ----------------------------------------------------
  const clipInput = document.getElementById('clipInput');
  const btnSendClip = document.getElementById('btnSendClip');
  const clipList = document.getElementById('clipList');

  async function loadClipboard() {
    try {
      const res = await fetch('/api/clipboard');
      const items = await res.json();
      if (!items || items.length === 0) {
        clipList.innerHTML = '<div class="empty-state">هنوز متنی اشتراک گذاشته نشده است.</div>';
        return;
      }

      clipList.innerHTML = items.reverse().map(item => `
        <div class="clip-card">
          <div class="clip-text">${escapeHtml(item.content)}</div>
          <button class="action-icon-btn copy-btn" data-text="${escapeHtml(item.content)}">کپی</button>
        </div>
      `).join('');

      document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          navigator.clipboard.writeText(e.currentTarget.dataset.text);
          btn.textContent = 'کپی شد! ✓';
          setTimeout(() => btn.textContent = 'کپی', 2000);
        });
      });
    } catch (err) {}
  }

  btnSendClip?.addEventListener('click', async () => {
    const text = clipInput.value.trim();
    if (!text) return;

    await fetch('/api/clipboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, sender: 'Mobile' })
    });

    clipInput.value = '';
    loadClipboard();
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ----------------------------------------------------
  // Bidirectional File Upload (Stream Direct with Live Progress)
  // ----------------------------------------------------
  const dropzone = document.getElementById('dropzone');
  const uploadQueue = document.getElementById('uploadQueue');
  const btnUploadSubmit = document.getElementById('btnUploadSubmit');
  const fileUploadInput = document.getElementById('fileUploadInput');
  const btnPickUploadFiles = document.getElementById('btnPickUploadFiles');
  const btnPickPCFiles = document.getElementById('btnPickPCFiles');
  const btnClearUploadQueue = document.getElementById('btnClearUploadQueue');
  const uploadQueueHeader = document.getElementById('uploadQueueHeader');
  const queueCountText = document.getElementById('queueCountText');
  const uploadProgressBox = document.getElementById('uploadProgressBox');
  const uploadProgressBar = document.getElementById('uploadProgressBar');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const uploadPercentText = document.getElementById('uploadPercentText');

  let selectedUploadFiles = [];

  btnPickUploadFiles?.addEventListener('click', () => {
    fileUploadInput?.click();
  });

  // Check if PC file picker is supported by server (when running on Windows)
  fetch('/api/network')
    .then(r => r.json())
    .then(net => {
      if (!window.AndroidBridge && btnPickPCFiles) {
        btnPickPCFiles.style.display = 'inline-flex';
      }
    })
    .catch(() => {});

  btnPickPCFiles?.addEventListener('click', async () => {
    try {
      btnPickPCFiles.disabled = true;
      const res = await fetch('/api/pick-pc-files', { method: 'POST' });
      const data = await res.json();
      if (data.count > 0) {
        alert(`✅ ${data.count} فایل از کامپیوتر به لیست اشتراک اضافه شد!`);
        loadFiles();
      }
    } catch (err) {
      alert('انتخاب فایل کامپیوتر: ' + err.message);
    } finally {
      btnPickPCFiles.disabled = false;
    }
  });

  fileUploadInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(nf => {
      if (!selectedUploadFiles.some(f => f.name === nf.name && f.size === nf.size)) {
        selectedUploadFiles.push(nf);
      }
    });
    fileUploadInput.value = '';
    renderUploadQueue();
  });

  dropzone?.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#00f0ff'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = 'rgba(0, 240, 255, 0.3)'; });
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'rgba(0, 240, 255, 0.3)';
    const files = Array.from(e.dataTransfer.files);
    files.forEach(nf => {
      if (!selectedUploadFiles.some(f => f.name === nf.name && f.size === nf.size)) {
        selectedUploadFiles.push(nf);
      }
    });
    renderUploadQueue();
  });

  function renderUploadQueue() {
    if (selectedUploadFiles.length === 0) {
      uploadQueue.innerHTML = '';
      if (uploadQueueHeader) uploadQueueHeader.style.display = 'none';
      btnUploadSubmit.style.display = 'none';
      return;
    }

    if (uploadQueueHeader) uploadQueueHeader.style.display = 'flex';
    if (queueCountText) queueCountText.textContent = `${selectedUploadFiles.length} فایل آماده ارسال:`;
    btnUploadSubmit.style.display = 'block';

    uploadQueue.innerHTML = selectedUploadFiles.map((f, idx) => `
      <div class="file-card">
        <div class="file-icon">📄</div>
        <div class="file-meta">
          <div class="file-title" title="${f.name}">${f.name}</div>
          <div class="file-sub">${formatBytes(f.size)}</div>
        </div>
        <button type="button" class="action-icon-btn remove-queue-btn" data-index="${idx}" title="لغو این فایل">
          ❌
        </button>
      </div>
    `).join('');

    document.querySelectorAll('.remove-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        selectedUploadFiles.splice(idx, 1);
        renderUploadQueue();
      });
    });
  }

  btnClearUploadQueue?.addEventListener('click', () => {
    selectedUploadFiles = [];
    renderUploadQueue();
  });

  btnUploadSubmit?.addEventListener('click', async () => {
    if (selectedUploadFiles.length === 0) return;

    btnUploadSubmit.disabled = true;
    if (uploadProgressBox) uploadProgressBox.style.display = 'block';

    let successCount = 0;
    const totalFiles = selectedUploadFiles.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = selectedUploadFiles[i];
      if (uploadStatusText) {
        uploadStatusText.textContent = `در حال ارسال (${i + 1}/${totalFiles}): ${file.name}`;
      }

      try {
        await new Promise((resolve, reject) => {
          const targetHost = (activeRole === 'receiver' && currentSenderHost) ? currentSenderHost : '';
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${targetHost}/api/upload?name=${encodeURIComponent(file.name)}&size=${file.size}`);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const percent = Math.round((e.loaded / e.total) * 100);
              if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;
              if (uploadPercentText) {
                uploadPercentText.textContent = `${percent}% (${(e.loaded/(1024*1024)).toFixed(1)} / ${(e.total/(1024*1024)).toFixed(1)} MB)`;
              }
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              successCount++;
              resolve();
            } else {
              reject(new Error(`کد خطا: ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('خطای شبکه در حین ارسال'));
          xhr.send(file);
        });
      } catch (err) {
        alert(`خطا در ارسال فایل ${file.name}: ${err.message}`);
      }
    }

    if (uploadProgressBox) uploadProgressBox.style.display = 'none';
    btnUploadSubmit.disabled = false;
    alert(`✅ ${successCount} فایل با موفقیت به دستگاه مقابل ارسال و ذخیره شد!`);
    selectedUploadFiles = [];
    renderUploadQueue();
    loadFiles();
  });

  // Global Drag & Drop: Drop files anywhere to share or send
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (activeRole === 'receiver') {
        droppedFiles.forEach(nf => {
          if (!selectedUploadFiles.some(f => f.name === nf.name && f.size === nf.size)) {
            selectedUploadFiles.push(nf);
          }
        });
        renderUploadQueue();
        const tabUpload = document.querySelector('.tab-btn[data-tab="upload"]');
        if (tabUpload) tabUpload.click();
      } else {
        btnAddFiles.disabled = true;
        btnAddFiles.innerHTML = '⏳ در حال افزودن فایل‌ها...';
        for (const file of droppedFiles) {
          await uploadFileDirectly(file, 'shared');
        }
        btnAddFiles.disabled = false;
        btnAddFiles.innerHTML = '➕ افزودن فایل برای اشتراک و ارسال';
        loadFiles();
      }
    }
  });

  // ----------------------------------------------------
  // QR Code Modal
  // ----------------------------------------------------
  const qrModal = document.getElementById('qrModal');
  const btnShowQR = document.getElementById('btnShowQR');
  const qrModalClose = document.getElementById('qrModalClose');
  const qrModalBackdrop = document.getElementById('qrModalBackdrop');
  const qrImage = document.getElementById('qrImage');
  const qrTabUrl = document.getElementById('qrTabUrl');
  const qrTabWifi = document.getElementById('qrTabWifi');

  const openQRModal = () => {
    if (qrModal) {
      qrModal.style.display = 'flex';
      qrModal.classList.add('open');
    }
  };
  const closeQRModal = () => {
    if (qrModal) {
      qrModal.style.display = 'none';
      qrModal.classList.remove('open');
    }
  };

  btnShowQR?.addEventListener('click', openQRModal);
  qrModalClose?.addEventListener('click', closeQRModal);
  qrModalBackdrop?.addEventListener('click', closeQRModal);

  qrTabUrl?.addEventListener('click', () => {
    qrTabUrl.classList.add('active');
    qrTabWifi.classList.remove('active');
    qrImage.src = '/api/qr/url?' + Date.now();
  });

  qrTabWifi?.addEventListener('click', () => {
    qrTabWifi.classList.add('active');
    qrTabUrl.classList.remove('active');
    qrImage.src = '/api/qr/wifi?' + Date.now();
  });

  // Initial Boot
  loadFiles();
});
