const socket = createRealtimeSocket();
const MAX_FILE_BYTES = 1024 * 1024;

function createRealtimeSocket() {
    const listeners = new Map();
    const outbox = [];
    let ws = null;
    let retries = 0;
    let reconnectTimer = null;
    let hasOpened = false;

    const api = {
        id: null,
        emit(type, data) {
            const payload = JSON.stringify({ type, data });
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            } else {
                outbox.push(payload);
            }
        },
        on(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        }
    };

    function connect() {
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${scheme}//${window.location.host}/ws`);

        ws.addEventListener('open', () => {
            retries = 0;
            while (outbox.length) ws.send(outbox.shift());
            if (hasOpened) {
                api.emit('join-room', {
                    roomId: currentRoomId,
                    deviceName,
                    role: currentRole || 'standby'
                });
            }
            hasOpened = true;
        });

        ws.addEventListener('message', (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (message.type === 'welcome') {
                api.id = message.data.id;
                return;
            }
            const callbacks = listeners.get(message.type);
            if (callbacks) callbacks.forEach((callback) => callback(message.data));
        });

        ws.addEventListener('close', () => {
            const delay = Math.min(1000 * 2 ** retries, 15000);
            retries += 1;
            reconnectTimer = window.setTimeout(connect, delay);
        });

        ws.addEventListener('error', () => ws.close());
    }

    connect();
    return api;
}

lucide.createIcons();

let currentRoomId = generateSessionId();
let deviceName = `Device-${Math.floor(100 + Math.random() * 900)}`;
let currentRole = null;
let html5QrCode = null;
let selectedFiles = [];
let pendingInboxItems = []; // Menampung file/link yang masuk saat user belum milih peran
let notificationsEnabled = true;
const previewStore = new Map();
let previewCounter = 0;

const urlParams = new URLSearchParams(window.location.search);
const joinedRoomFromUrl = urlParams.get('room');
if (joinedRoomFromUrl) {
    currentRoomId = joinedRoomFromUrl;
}

// 1. PERMISSION
document.getElementById('btn-grant-permissions').addEventListener('click', async () => {
    const customName = document.getElementById('device-name-input').value.trim();
    if (customName) deviceName = customName;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        updatePermBadge('perm-camera-status', 'Aktif', true);
    } catch (err) {
        updatePermBadge('perm-camera-status', 'Off', false);
    }

    updatePermBadge('perm-storage-status', 'Siap', true);

    setTimeout(() => {
        document.getElementById('permission-modal').classList.remove('active');
        initSession();
    }, 450);
});

function updatePermBadge(elementId, text, isGranted) {
    const badge = document.querySelector(`#${elementId} .badge`);
    badge.textContent = text;
    badge.className = `badge ${isGranted ? 'granted' : 'pending'}`;
}

// 2. SESI & QR
function generateSessionId() {
    return 'AERO-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function initSession() {
    document.getElementById('display-room-id').textContent = currentRoomId;
    document.getElementById('session-badge').textContent = currentRoomId;

    socket.emit('join-room', {
        roomId: currentRoomId,
        deviceName: deviceName,
        role: 'standby'
    });

    renderQRCode(currentRoomId);

    if (joinedRoomFromUrl) {
        goToRoleSelection(currentRoomId);
    }
}

function renderQRCode(roomId) {
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    const sessionUrl = `${window.location.origin}?room=${roomId}`;

    new QRCode(qrContainer, {
        text: sessionUrl,
        width: 180,
        height: 180,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
}

document.getElementById('btn-refresh-qr').addEventListener('click', () => {
    currentRoomId = generateSessionId();
    pendingInboxItems = [];
    window.history.replaceState({}, document.title, window.location.pathname);
    initSession();
    switchView('view-connect');
    showToast('Sesi baru dibuat.');
});

document.getElementById('btn-copy-id').addEventListener('click', () => {
    copyText(currentRoomId, `ID ${currentRoomId} disalin.`);
});

document.getElementById('btn-copy-link').addEventListener('click', () => {
    copyText(`${window.location.origin}?room=${currentRoomId}`, 'Link disalin.');
});

function joinSessionByManualId() {
    const inputEl = document.getElementById('manual-room-input');
    const rawId = inputEl.value.trim().toUpperCase();

    if (!rawId) {
        showToast('Isi ID Sesi dulu.');
        inputEl.focus();
        return;
    }

    stopScanner();
    currentRoomId = rawId;
    pendingInboxItems = [];
    document.getElementById('display-room-id').textContent = currentRoomId;
    document.getElementById('session-badge').textContent = currentRoomId;

    socket.emit('join-room', {
        roomId: currentRoomId,
        deviceName: deviceName,
        role: 'standby'
    });

    inputEl.value = '';
    goToRoleSelection(currentRoomId);
}

document.getElementById('btn-join-by-id').addEventListener('click', joinSessionByManualId);
document.getElementById('manual-room-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinSessionByManualId();
});

// 3. SCAN QR
document.getElementById('btn-start-scan').addEventListener('click', () => {
    html5QrCode = new Html5Qrcode('qr-reader');
    document.getElementById('btn-start-scan').classList.add('hidden');
    document.getElementById('btn-stop-scan').classList.remove('hidden');

    html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 190, height: 190 } },
        (decodedText) => {
            let scannedRoomId = decodedText;
            if (decodedText.includes('?room=')) {
                scannedRoomId = new URL(decodedText).searchParams.get('room');
            }
            if (scannedRoomId) {
                stopScanner();
                currentRoomId = scannedRoomId;
                pendingInboxItems = [];
                socket.emit('join-room', {
                    roomId: currentRoomId,
                    deviceName: deviceName,
                    role: 'standby'
                });
                goToRoleSelection(currentRoomId);
            }
        }
    ).catch(err => {
        showToast('Kamera gagal: ' + err);
        stopScanner();
    });
});

document.getElementById('btn-stop-scan').addEventListener('click', stopScanner);

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
    }
    document.getElementById('btn-start-scan').classList.remove('hidden');
    document.getElementById('btn-stop-scan').classList.add('hidden');
}

// 4. PERAN
function goToRoleSelection(roomId) {
    document.getElementById('connected-room-label').textContent = roomId;
    document.getElementById('session-badge').textContent = roomId;
    switchView('view-role');
}

document.getElementById('choose-sender').addEventListener('click', () => setRole('sender'));
document.getElementById('choose-receiver').addEventListener('click', () => setRole('receiver'));
document.getElementById('btn-switch-role').addEventListener('click', () => switchView('view-role'));

function setRole(role) {
    currentRole = role;
    socket.emit('update-role', { roomId: currentRoomId, role });

    document.getElementById('current-role-badge').textContent = role === 'sender' ? 'Pengirim' : 'Penerima';
    document.getElementById('panel-sender').classList.toggle('hidden', role !== 'sender');
    document.getElementById('panel-receiver').classList.toggle('hidden', role !== 'receiver');

    switchView('view-workspace');

    // Jika memilih Penerima, tampilkan item yang sempat masuk saat masih memilih peran
    if (role === 'receiver' && pendingInboxItems.length > 0) {
        const itemsToFlush = [...pendingInboxItems];
        pendingInboxItems = [];
        itemsToFlush.forEach(entry => {
            if (entry.type === 'file') {
                renderIncomingFile(entry.data);
            } else if (entry.type === 'text') {
                renderIncomingText(entry.data);
            }
        });
    }
}

// 5. MULTI-USER
socket.on('room-users-updated', (users) => {
    document.getElementById('user-count').textContent = users.length;
    const listContainer = document.getElementById('connected-users-list');
    const targetSelect = document.getElementById('target-receiver-select');

    listContainer.innerHTML = '';
    targetSelect.innerHTML = '<option value="all">Semua Penerima</option>';

    users.forEach(user => {
        const chip = document.createElement('div');
        chip.className = 'user-chip';
        const roleLabel = user.role === 'sender' ? 'Pengirim' : (user.role === 'receiver' ? 'Penerima' : 'Standby');
        chip.innerHTML = `<span>${escapeHtml(user.name)}${user.id === socket.id ? ' (Anda)' : ''}</span> <span class="role-tag">${roleLabel}</span>`;
        listContainer.appendChild(chip);

        if (user.id !== socket.id) {
            const opt = document.createElement('option');
            opt.value = user.id;
            opt.textContent = `${user.name} (${roleLabel})`;
            targetSelect.appendChild(opt);
        }
    });

    if (users.length > 1 && document.getElementById('view-connect').classList.contains('active')) {
        goToRoleSelection(currentRoomId);
    }
});

// 6. SATU TOMBOL KIRIM + TAMBAH BANYAK LINK + PREVIEW ANTREAN
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

document.getElementById('btn-browse-files').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

document.getElementById('btn-add-link').addEventListener('click', () => {
    const container = document.getElementById('text-inputs-container');
    const row = document.createElement('div');
    row.className = 'text-input-row';
    row.innerHTML = `
        <input type="text" class="multi-text-input" placeholder="Tempel link atau tulis teks...">
        <button type="button" class="btn-mini danger nowrap" onclick="removeTextRow(this)">Hapus</button>
    `;
    container.appendChild(row);
});

window.removeTextRow = (btn) => {
    const rows = document.querySelectorAll('#text-inputs-container .text-input-row');
    if (rows.length > 1) {
        btn.parentElement.remove();
    } else {
        rows[0].querySelector('input').value = '';
    }
};

function resetTextInputs() {
    const container = document.getElementById('text-inputs-container');
    container.innerHTML = `
        <div class="text-input-row">
            <input type="text" class="multi-text-input" placeholder="Tempel link atau tulis teks...">
        </div>
    `;
}

function handleFiles(files) {
    const allFiles = Array.from(files);
    const accepted = allFiles.filter(file => file.size <= MAX_FILE_BYTES);
    const skipped = allFiles.length - accepted.length;

    if (skipped > 0) {
        showToast(`${skipped} file dilewati (maksimal 1 MB per file).`);
    }

    const newEntries = accepted.map(file => ({
        file,
        previewUrl: URL.createObjectURL(file)
    }));
    selectedFiles = [...selectedFiles, ...newEntries];
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const list = document.getElementById('selected-files-list');
    if (selectedFiles.length === 0) {
        list.innerHTML = '<p class="empty-state">Belum ada file.</p>';
        return;
    }

    list.innerHTML = selectedFiles.map((entry, idx) => {
        const { file, previewUrl } = entry;
        const thumbHtml = buildFileThumbnailHtml(file.type, file.name, previewUrl);
        return `
            <div class="file-item">
                <div class="file-left">
                    ${thumbHtml}
                    <div class="file-meta">
                        <strong>${escapeHtml(file.name)}</strong>
                        <span>${formatBytes(file.size)}</span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn-mini danger nowrap" onclick="removeSelectedFile(${idx})">Hapus</button>
                </div>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

window.removeSelectedFile = (index) => {
    if (selectedFiles[index] && selectedFiles[index].previewUrl) {
        URL.revokeObjectURL(selectedFiles[index].previewUrl);
    }
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
};

document.getElementById('btn-send-all').addEventListener('click', () => {
    const targetId = document.getElementById('target-receiver-select').value;
    const textValues = Array.from(document.querySelectorAll('.multi-text-input'))
        .map(el => el.value.trim())
        .filter(Boolean);

    if (selectedFiles.length === 0 && textValues.length === 0) {
        showToast('Pilih file atau isi link/teks dulu.');
        return;
    }

    let sentCount = 0;

    if (selectedFiles.length > 0) {
        selectedFiles.forEach(({ file, previewUrl }) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result || '');
                const fileData = dataUrl.slice(dataUrl.indexOf(',') + 1);
                socket.emit('send-file', {
                    roomId: currentRoomId,
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                    fileData,
                    senderName: deviceName,
                    targetId: targetId
                });
                if (previewUrl) URL.revokeObjectURL(previewUrl);
            };
            reader.readAsDataURL(file);
        });
        sentCount += selectedFiles.length;
        selectedFiles = [];
        renderSelectedFiles();
    }

    if (textValues.length > 0) {
        textValues.forEach(val => {
            socket.emit('send-text', {
                roomId: currentRoomId,
                text: val,
                senderName: deviceName,
                targetId: targetId
            });
        });
        sentCount += textValues.length;
        resetTextInputs();
    }

    showToast(`Terkirim (${sentCount} item).`);
});

// 7. PENERIMA (TERIMA FILE & LINK — AMAN MESKI BARU PILIH PERAN)
socket.on('receive-file', (payload) => {
    showToast(`File: ${payload.fileName}`);
    if (currentRole === 'receiver') {
        renderIncomingFile(payload);
    } else {
        pendingInboxItems.push({ type: 'file', data: payload });
    }
});

socket.on('receive-text', (payload) => {
    const isUrl = isValidUrl(payload.text);
    showToast(isUrl ? 'Link masuk.' : 'Teks masuk.');
    if (currentRole === 'receiver') {
        renderIncomingText(payload);
    } else {
        pendingInboxItems.push({ type: 'text', data: payload });
    }
});

socket.on('app-error', (message) => showToast(message));

function renderIncomingFile({ fileName, fileType, fileSize, fileData, senderName, timestamp }) {
    const inbox = document.getElementById('received-files-list');
    clearEmptyState(inbox);

    const blob = new Blob([decodeBase64ToBytes(fileData)], { type: fileType || 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    const thumbHtml = buildFileThumbnailHtml(fileType, fileName, blobUrl);
    const previewId = `pv-${++previewCounter}`;
    previewStore.set(previewId, { fileName, fileType, blobUrl });

    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
        <div class="file-left">
            ${thumbHtml}
            <div class="file-meta">
                <strong>${escapeHtml(fileName)}</strong>
                <span>${escapeHtml(senderName)} • ${formatBytes(fileSize)} • ${timestamp}</span>
            </div>
        </div>
        <div class="item-actions">
            <button type="button" class="action-btn item-btn-ghost nowrap" onclick="openFilePreview('${previewId}')">Lihat</button>
            <a href="${blobUrl}" download="${escapeHtml(fileName)}" class="action-btn item-btn-primary nowrap">Unduh</a>
        </div>
    `;
    inbox.prepend(item);
    lucide.createIcons();
}

function renderIncomingText({ text, senderName, timestamp }) {
    const isUrl = isValidUrl(text);
    const inbox = document.getElementById('received-files-list');
    clearEmptyState(inbox);

    const item = document.createElement('div');
    item.className = 'file-item';

    const encodedText = encodeURIComponent(text);
    const thumbIcon = isUrl ? 'link-2' : 'message-square';
    const actionsHtml = isUrl
        ? `
            <button type="button" class="action-btn item-btn-ghost nowrap" onclick="copyEncodedText('${encodedText}')">Salin</button>
            <a href="${escapeAttr(text)}" target="_blank" rel="noopener noreferrer" class="action-btn item-btn-primary nowrap">Buka</a>
          `
        : `<button type="button" class="action-btn item-btn-ghost nowrap" onclick="copyEncodedText('${encodedText}')">Salin</button>`;

    item.innerHTML = `
        <div class="file-left">
            <div class="thumb-box"><i data-lucide="${thumbIcon}"></i></div>
            <div class="file-meta">
                <strong>${escapeHtml(text)}</strong>
                <span>${isUrl ? 'Link' : 'Teks'} • ${escapeHtml(senderName)} • ${timestamp}</span>
            </div>
        </div>
        <div class="item-actions">${actionsHtml}</div>
    `;
    inbox.prepend(item);
    lucide.createIcons();
}

window.openFilePreview = (previewId) => {
    const entry = previewStore.get(previewId);
    if (!entry) return;

    const { fileName, fileType, blobUrl } = entry;
    const content = document.getElementById('preview-content');
    const download = document.getElementById('preview-download');
    const lowerMime = (fileType || '').toLowerCase();
    const lowerName = (fileName || '').toLowerCase();

    document.getElementById('preview-title').textContent = fileName;
    download.href = blobUrl;
    download.download = fileName;

    if (lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName)) {
        content.innerHTML = `<img src="${blobUrl}" alt="${escapeAttr(fileName)}">`;
    } else if (lowerMime.startsWith('video/') || /\.(mp4|webm|ogg|mov|mkv)$/i.test(lowerName)) {
        content.innerHTML = `<video src="${blobUrl}" controls></video>`;
    } else if (lowerMime === 'application/pdf' || /\.pdf$/i.test(lowerName)) {
        content.innerHTML = `<iframe src="${blobUrl}" title="${escapeAttr(fileName)}"></iframe>`;
    } else {
        content.innerHTML = '<p class="empty-state">Pratinjau tidak tersedia. Silakan unduh.</p>';
    }

    lucide.createIcons();
    document.getElementById('preview-modal').classList.add('active');
};

function decodeBase64ToBytes(fileData) {
    try {
        const binary = atob(String(fileData || ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        showToast('File rusak saat diterima.');
        return new Uint8Array();
    }
}

function buildFileThumbnailHtml(mimeType, fileName, url) {
    const lowerMime = (mimeType || '').toLowerCase();
    const lowerName = (fileName || '').toLowerCase();

    const isImage = lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName);
    const isVideo = lowerMime.startsWith('video/') || /\.(mp4|webm|ogg|mov|mkv)$/i.test(lowerName);

    if (isImage && url) {
        return `<div class="thumb-box"><img src="${url}" alt="${escapeAttr(fileName)}" loading="lazy"></div>`;
    }
    if (isVideo && url) {
        return `<div class="thumb-box"><video src="${url}" muted preload="metadata"></video></div>`;
    }
    return `<div class="thumb-box"><i data-lucide="file-text"></i></div>`;
}

window.copyEncodedText = (encoded) => {
    copyText(decodeURIComponent(encoded), 'Disalin.');
};

document.getElementById('btn-clear-inbox').addEventListener('click', () => {
    pendingInboxItems = [];
    document.getElementById('received-files-list').innerHTML = `
        <div class="empty-state">
            <p>Kosong.</p>
        </div>`;
});

// 8. PENGATURAN & HELPER
document.getElementById('btn-open-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('active');
});

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.target).classList.remove('active');
    });
});

document.querySelectorAll('.theme-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        document.documentElement.setAttribute('data-theme', chip.dataset.setTheme);
    });
});

document.getElementById('blur-slider').addEventListener('input', (e) => {
    const val = e.target.value + 'px';
    document.getElementById('blur-val').textContent = val;
    document.documentElement.style.setProperty('--glass-blur', val);
});

document.getElementById('toggle-grid').addEventListener('change', (e) => {
    document.querySelector('.grid-overlay').classList.toggle('hidden-grid', !e.target.checked);
});

document.getElementById('toggle-notif').addEventListener('change', (e) => {
    notificationsEnabled = e.target.checked;
});

function clearEmptyState(container) {
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();
}

function isValidUrl(str) {
    try {
        const parsed = new URL(str);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function copyText(text, msg) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showToast(msg));
    } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
        showToast(msg);
    }
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function showToast(message) {
    if (!notificationsEnabled) return;
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
}