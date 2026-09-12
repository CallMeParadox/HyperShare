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
  const transferredBytes = document.getElementById('transferredBytes');
  const etaTime = document.getElementById('etaTime');
  const networkStatus = document.getElementById('networkStatus');
  const btnAddFiles = document.getElementById('btnAddFiles');
  const btnPickFilesNative = document.getElementById('btnPickFilesNative');
  const fileInput = document.getElementById('fileInput');

  // Load Initial Network Info
  fetch('/api/network')
    .then(r => r.json())
    .then(net => {
      if (net.is_hotspot) {
        networkStatus.textContent = '5GHz Hotspot (Direct P2P)';
      } else {
        networkStatus.textContent = `Direct LAN (${net.primary_ip})`;
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

  // Add Files Action Handler (Opens native file picker or fallback)
  function triggerFilePick() {
    if (window.AndroidBridge && window.AndroidBridge.pickFilesForSharing) {
      window.AndroidBridge.pickFilesForSharing();
    } else if (fileInput) {
      fileInput.click();
    }
  }

  btnAddFiles?.addEventListener('click', triggerFilePick);
  btnPickFilesNative?.addEventListener('click', triggerFilePick);

  // Fetch & Render Files
  async function loadFiles() {
    try {
      const res = await fetch('/api/files');
      allFiles = await res.json();
      renderFiles();
      populateTurboSelect();
    } catch (err) {
      fileListContainer.innerHTML = `<div class="error-state">خطا در دریافت لیست فایل‌ها: ${err.message}</div>`;
    }
  }

  // Make globally accessible so MainActivity.kt can refresh the list on file add
  window.loadFiles = loadFiles;

  function renderFiles() {
    const filtered = currentCategory === 'all' 
      ? allFiles 
      : allFiles.filter(f => f.category === currentCategory);

    if (filtered.length === 0) {
      fileListContainer.innerHTML = `
        <div class="empty-state">
          <p>هیچ فایلی در این دسته وجود ندارد.</p>
          <button class="btn-primary mt-2" onclick="window.AndroidBridge ? window.AndroidBridge.pickFilesForSharing() : document.getElementById('fileInput').click()">
            ➕ افزودن فایل از گوشی
          </button>
        </div>
      `;
      return;
    }

    fileListContainer.innerHTML = filtered.map(file => {
      const icon = getCategoryIcon(file.category);
      const canPreview = file.preview_url ? true : false;

      return `
        <div class="file-card">
          <div class="file-icon">${icon}</div>
          <div class="file-meta">
            <div class="file-title" title="${file.name}">${file.name}</div>
            <div class="file-sub">
              <span>${file.human_size}</span>
              <span>•</span>
              <span>${file.category.toUpperCase()}</span>
            </div>
          </div>
          <div class="file-actions">
            ${canPreview ? `
              <button class="action-icon-btn preview-btn" data-url="${file.preview_url}" data-type="${file.category}" data-title="${file.name}">
                👁️ پیش‌نمایش
              </button>
            ` : ''}
            <a href="${file.downloadURL}" class="action-icon-btn dl-btn" download="${file.name}">
              ⬇️ دریافت
            </a>
            <button class="action-icon-btn delete-btn danger-icon-btn" data-id="${file.id || ''}" data-name="${file.name}" title="حذف از لیست">
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
    if (allFiles.length === 0) {
      turboFileSelect.innerHTML = '<option value="">هیچ فایلی موجود نیست</option>';
      btnStartTurbo.disabled = true;
      return;
    }

    turboFileSelect.innerHTML = allFiles.map(f => 
      `<option value="${f.name}" data-size="${f.size}">${f.name} (${f.human_size})</option>`
    ).join('');
    btnStartTurbo.disabled = false;
  }

  // Download All as ZIP
  document.getElementById('btnDownloadAll')?.addEventListener('click', () => {
    window.location.href = '/api/download-all';
  });

  // Clear All Files
  document.getElementById('btnClearAllFiles')?.addEventListener('click', async () => {
    if (allFiles.length === 0) return;
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
    mediaModal.classList.add('open');
  }

  modalClose?.addEventListener('click', () => mediaModal.classList.remove('open'));
  modalBackdrop?.addEventListener('click', () => mediaModal.classList.remove('open'));

  // ----------------------------------------------------
  // Turbo Multi-Stream Parallel Downloader (8 Streams)
  // ----------------------------------------------------
  btnStartTurbo?.addEventListener('click', async () => {
    const selectedOption = turboFileSelect.selectedOptions[0];
    if (!selectedOption) return;

    const filename = selectedOption.value;
    const totalSize = parseInt(selectedOption.dataset.size, 10);
    const numChunks = 8;
    const chunkSize = Math.ceil(totalSize / numChunks);

    chunkContainer.style.display = 'block';
    chunkGrid.innerHTML = '';
    btnStartTurbo.disabled = true;
    transferFileName.textContent = `توربو: ${filename}`;

    const chunkProgress = new Array(numChunks).fill(0);

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

    speedInterval = setInterval(() => {
      const now = performance.now();
      const timeDiff = (now - lastTime) / 1000;
      const bytesDiff = totalDownloaded - lastDownloaded;
      const mbps = (bytesDiff / (1024 * 1024)) / timeDiff;

      currentSpeed.textContent = mbps.toFixed(1);
      lastDownloaded = totalDownloaded;
      lastTime = now;

      const percent = Math.min(100, Math.round((totalDownloaded / totalSize) * 100));
      transferPercent.textContent = `${percent}%`;
      progressBar.style.width = `${percent}%`;
      transferredBytes.textContent = `${(totalDownloaded / (1024*1024)).toFixed(1)} MB / ${(totalSize / (1024*1024)).toFixed(1)} MB`;

      if (mbps > 0) {
        const remainingBytes = totalSize - totalDownloaded;
        const etaSec = remainingBytes / (mbps * 1024 * 1024);
        etaTime.textContent = `ETA: ${Math.round(etaSec)} ثانیه`;
      }
    }, 400);

    const promises = [];
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize - 1, totalSize - 1);

      promises.push((async () => {
        const res = await fetch(`/api/download/${encodeURIComponent(filename)}`, {
          headers: { 'Range': `bytes=${start}-${end}` }
        });

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

          const p = Math.round((chunkRecv / expected) * 100);
          document.getElementById(`chunkBar-${i}`).style.width = `${p}%`;
          document.getElementById(`chunkText-${i}`).textContent = `${p}%`;
        }

        return new Blob(parts);
      })());
    }

    try {
      const blobs = await Promise.all(promises);
      clearInterval(speedInterval);
      currentSpeed.textContent = '0.0';
      progressBar.style.width = '100%';
      transferPercent.textContent = '100% (تکمیل)';
      etaTime.textContent = 'انجام شد!';

      if (window.AndroidBridge && window.AndroidBridge.vibrate) {
        window.AndroidBridge.vibrate(200);
      }

      const finalBlob = new Blob(blobs);
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      clearInterval(speedInterval);
      alert(`خطا در دانلود توربو: ${err.message}`);
    } finally {
      btnStartTurbo.disabled = false;
    }
  });

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
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/upload?name=${encodeURIComponent(file.name)}&size=${file.size}`);

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

  btnShowQR?.addEventListener('click', () => qrModal.classList.add('open'));
  qrModalClose?.addEventListener('click', () => qrModal.classList.remove('open'));
  qrModalBackdrop?.addEventListener('click', () => qrModal.classList.remove('open'));

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
