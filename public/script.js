// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBwfABtxvrQtMhBNUi20VrGyE0gmH-gMXY",
    authDomain: "myreferral002.firebaseapp.com",
    projectId: "myreferral002",
    storageBucket: "myreferral002.firebasestorage.app",
    messagingSenderId: "806318145773",
    appId: "1:806318145773:web:ba5b9443cc2b82c0318ce4",
    measurementId: "G-5HMV181NV7"
};

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const analytics = firebase.analytics();

// --- MANAGER 1: CRYPTO (AES-GCM) ---
const CryptoManager = {
    async generateKey() {
        return window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true, ["encrypt", "decrypt"]
        );
    },

    async exportKey(key) {
        const exported = await window.crypto.subtle.exportKey("jwk", key);
        return JSON.stringify(exported);
    },

    async importKey(jwkJson) {
        const jwk = JSON.parse(jwkJson);
        return window.crypto.subtle.importKey(
            "jwk", jwk,
            { name: "AES-GCM" },
            true, ["encrypt", "decrypt"]
        );
    },

    async encrypt(blob, key) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const arrayBuffer = await blob.arrayBuffer();
        const encryptedBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            arrayBuffer
        );
        return {
            encryptedBlob: new Blob([encryptedBuffer]),
            iv: Array.from(iv)
        };
    },

    async decrypt(encryptedBuffer, key, ivArray) {
        const iv = new Uint8Array(ivArray);
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedBuffer
        );
        return new Blob([decryptedBuffer]);
    },

    async hashPin(pin) {
        const encoder = new TextEncoder();
        const data = encoder.encode(pin);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
};

// --- MANAGER 2: STORAGE (IndexedDB) ---
const StorageManager = {
    dbName: "SecureShareDB",
    storeName: "files",

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = (e) => reject(e);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = () => resolve(request.result);
        });
    },

    async saveFile(id, blob) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            store.put(blob, id);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    },

    async getFile(id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e);
        });
    }
};

// --- MANAGER 3: PEER TO PEER (PeerJS) ---
const P2PManager = {
    peer: null,
    peerId: null,

    async init() {
        return new Promise((resolve, reject) => {
            this.peer = new Peer(null, {
                debug: 3, // LEVEL 3: Logs every handshake step (Critical for debugging)
                config: {
                    iceTransportPolicy: 'all',
                    iceCandidatePoolSize: 10,
                    iceServers: [
                        // High-Redundancy STUN Array (The Fix)
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' },
                        { urls: 'stun:stun.services.mozilla.com' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            });

            // --- 100% ERROR IDENTIFICATION LISTENERS ---

            // 1. Catch Fatal Errors (Browser/Network Limits)
            this.peer.on('error', (err) => {
                console.error('🔴 CRITICAL P2P ERROR:', err.type);
                console.error('Error Details:', err.message);

                if (err.type === 'peer-unavailable') {
                    alert("Error: The other device is offline or the ID is incorrect.");
                } else if (err.type === 'network') {
                    alert("Error: Lost connection to the signaling server (Firewall blocked WebSocket).");
                } else if (err.type === 'browser-incompatible') {
                    alert("Error: This browser doesn't support WebRTC (Restricted by Office IT).");
                } else {
                    alert("P2P Failure: " + err.type);
                }
            });

            this.peer.on('open', (id) => {
                this.peerId = id;
                console.log('My Peer ID:', id);
                resolve(id);
            });

            // 2. Monitor Connection Lifecycle
            this.peer.on('connection', (conn) => {
                conn.on('error', (err) => {
                    console.error('🔴 CONNECTION ERROR:', err);
                });

                conn.on('close', () => {
                    console.warn('⚠️ Connection Closed.');
                });
                this.handleIncomingConnection(conn);
            });
        });
    },

    handleIncomingConnection(conn) {
        conn.on('data', async (data) => {
            if (data.type === 'REQUEST_FILE') {
                const encryptedBlob = await StorageManager.getFile(data.fileId);
                if (encryptedBlob) {
                    const buffer = await encryptedBlob.arrayBuffer();
                    conn.send({
                        type: 'FILE_DATA',
                        fileId: data.fileId,
                        buffer: buffer
                    });
                } else {
                    conn.send({ type: 'ERROR', message: 'File not found in host storage' });
                }
            }
        });
    },

    async downloadFromPeer(hostPeerId, fileId, onProgress) {
        return new Promise((resolve, reject) => {
            const conn = this.peer.connect(hostPeerId);

            conn.on('open', () => {
                if (onProgress) onProgress("Connected... Requesting data...");
                conn.send({ type: 'REQUEST_FILE', fileId: fileId });
            });

            conn.on('data', (data) => {
                if (data.type === 'FILE_DATA') {
                    resolve(data.buffer);
                    conn.close();
                } else if (data.type === 'ERROR') {
                    reject(new Error(data.message));
                }
            });

            conn.on('error', (err) => reject(err));
            setTimeout(() => reject(new Error("Timeout (Uploader offline)")), 15000);
        });
    }
};

// --- MANAGER 4: LINK HISTORY & AUTO-CLEANUP ---
const LinkHistoryManager = {
    key: "secure_share_history_v1",
    links: [],

    init() {
        try {
            const raw = localStorage.getItem(this.key);
            this.links = raw ? JSON.parse(raw) : [];
            this.cleanup();
            this.checkLimits(); // New Check
            this.render();
        } catch (e) {
            console.error("History Init Error", e);
        }
    },

    save(data) {
        // data: { id, url, name, expiryMs, isCreator, limit }
        this.links.push({
            ...data,
            savedAt: Date.now()
        });
        this.persist();
        this.render();
    },

    persist() {
        localStorage.setItem(this.key, JSON.stringify(this.links));
    },

    async checkLimits() {
        if (!navigator.onLine) return;

        const active = [];
        let changed = false;

        for (const link of this.links) {
            // Only check if it's a creator link and has a limit
            if (link.isCreator && link.limit && link.limit < 999) {
                try {
                    const doc = await db.collection('fileMetadata').doc(link.id).get();
                    if (!doc.exists) {
                        console.log(`[Limit] File ${link.id} gone from DB. Removing...`);
                        changed = true;
                        continue; // Skip adding to active
                    }

                    const meta = doc.data();
                    const count = meta.downloadCount || 0;
                    link.currentCount = count; // Update local view

                    if (count >= link.limit) {
                        console.log(`[Limit] Reached ${count}/${link.limit}. Deleting...`);
                        await db.collection('fileMetadata').doc(link.id).delete();
                        changed = true;
                        continue; // Skip adding to active
                    }
                } catch (e) {
                    console.warn("Limit check failed", e);
                }
            }
            active.push(link);
        }

        if (changed) {
            this.links = active;
            this.persist();
            this.render();
        } else {
            // Re-render anyway to update counts
            this.render();
        }
    },

    async cleanup() {
        const now = Date.now();
        const active = [];
        let changed = false;

        for (const link of this.links) {
            const expiryTime = link.savedAt + link.expiryMs;
            if (now > expiryTime) {
                changed = true;
                console.log(`[Cleanup] Link expired: ${link.name}`);

                // 100% DELETE from Database if Creator
                if (link.isCreator) {
                    try {
                        await db.collection('fileMetadata').doc(link.id).delete();
                        console.log(`[Cleanup] Deleted ${link.id} from Firestore`);
                    } catch (e) {
                        console.warn("[Cleanup] Firestore delete failed (maybe already gone)", e);
                    }
                }
            } else {
                active.push(link);
            }
        }

        if (changed) {
            this.links = active;
            this.persist();
            this.render();
        }
    },

    render() {
        const area = document.getElementById('savedLinksArea');
        const list = document.getElementById('savedLinksList');
        if (!area || !list) return;

        if (this.links.length === 0) {
            area.style.display = 'none';
            return;
        }

        area.style.display = 'block';
        list.innerHTML = "";

        this.links.forEach(link => {
            const timeLeft = Math.max(0, (link.savedAt + link.expiryMs) - Date.now());
            const hoursLeft = (timeLeft / (1000 * 60 * 60)).toFixed(1);

            // Limit Display
            let limitHtml = "";
            if (link.limit && link.limit < 999) {
                const count = link.currentCount || 0;
                limitHtml = `<span style="font-size:0.75rem; color:#fbbf24; margin-left:0.5rem;">(DLL: ${count}/${link.limit})</span>`;
            }

            const div = document.createElement('div');
            div.className = "file-item";
            div.style.cursor = "pointer";
            div.onclick = (e) => {
                // Prevent triggering if clicking the button directly (optional, but good UX)
                if (e.target.tagName !== 'BUTTON') this.autoLoad(link);
            };

            div.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight:bold; color:white;">
                        ${link.name} ${limitHtml}
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-dim);">Expires in ${hoursLeft}h</div>
                </div>
                <button class="glass-btn-small" onclick="LinkHistoryManager.autoLoadFromId('${link.id}')">Load</button>
            `;
            list.appendChild(div);
        });
    },

    autoLoadFromId(id) {
        const link = this.links.find(l => l.id === id);
        if (link) this.autoLoad(link);
    },

    autoLoad(link) {
        window.app.showTab('download');
        document.getElementById('downloadId').value = link.url;
        document.getElementById('downloadPin').focus();
        // Visual Feedback
        const input = document.getElementById('downloadId');
        input.style.border = "2px solid var(--primary-color)";
        setTimeout(() => input.style.border = "1px solid rgba(255,255,255,0.1)", 1000);
    }
};

// --- MAIN APP ---
const App = {
    filesToUpload: [], // { file, path, id, name }
    totalSize: 0,

    init() {
        this.bindEvents();
        P2PManager.init().then(newPeerId => {
            this.recoverSession(newPeerId);
        });
        this.loadTextMessages();
        LinkHistoryManager.init(); // Init History
    },

    bindEvents() {
        window.app = this;

        const dropZone = document.getElementById('dropZone');

        // Drag & Drop (Folders support)
        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
        dropZone.ondragleave = () => dropZone.classList.remove('dragover');
        dropZone.ondrop = (e) => this.handleDrop(e);

        // File Inputs
        document.getElementById('fileInput').onchange = (e) => this.addFiles(e.target.files);
        document.getElementById('folderInput').onchange = (e) => this.addFiles(e.target.files);

        document.getElementById('startUploadBtn').onclick = () => this.startUpload();
        document.getElementById('startDownloadBtn').onclick = () => this.startDownload();
        document.getElementById('shareForm').onsubmit = (e) => this.handleTextShare(e);
        document.getElementById('copyLinkBtn').onclick = () => this.copyToClipboard();
    },

    // Session Recovery
    async recoverSession(newPeerId) {
        console.log("Recovering Session...");
        try {
            const dbRef = await StorageManager.init();
            const tx = dbRef.transaction(StorageManager.storeName, 'readonly');
            const store = tx.objectStore(StorageManager.storeName);
            const request = store.getAllKeys();

            request.onsuccess = async () => {
                const fileIds = request.result;
                if (!fileIds || fileIds.length === 0) return;

                const batch = db.batch();
                fileIds.forEach(fid => {
                    const ref = db.collection('fileMetadata').doc(fid);
                    batch.update(ref, { hostPeerId: newPeerId });
                });
                await batch.commit();
                console.log("Session Recovered! Links are active.");
            };
        } catch (e) {
            console.warn("Session recovery issue", e);
        }
    },

    // MULTI-FILE & FOLDER LOGIC
    async handleDrop(e) {
        e.preventDefault();
        document.getElementById('dropZone').classList.remove('dragover');

        const items = e.dataTransfer.items;
        if (!items) return;

        const promises = [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry();
            if (entry) {
                promises.push(this.scanEntry(entry));
            }
        }
        await Promise.all(promises);
        this.renderFileList();
    },

    async scanEntry(entry, path = "") {
        if (entry.isFile) {
            return new Promise((resolve) => {
                entry.file(file => {
                    this.addSingleFile(file, path + file.name);
                    resolve();
                });
            });
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            return new Promise((resolve) => {
                dirReader.readEntries(async (entries) => {
                    for (let i = 0; i < entries.length; i++) {
                        await this.scanEntry(entries[i], path + entry.name + "/");
                    }
                    resolve();
                });
            });
        }
    },

    addFiles(fileList) {
        for (let i = 0; i < fileList.length; i++) {
            const path = fileList[i].webkitRelativePath || fileList[i].name;
            this.addSingleFile(fileList[i], path);
        }
        this.renderFileList();
    },

    addSingleFile(file, path) {
        // Zero-byte files allowed, just check total limit
        if (this.totalSize + file.size > 50 * 1024 * 1024) {
            alert(`⚠️ Skipping ${file.name}: Total size would exceed 50MB.`);
            return;
        }

        this.filesToUpload.push({
            file: file,
            path: path,
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            name: file.name
        });
        this.updateTotalSize();
    },

    updateTotalSize() {
        this.totalSize = this.filesToUpload.reduce((acc, item) => acc + item.file.size, 0);
    },

    removeFile(id) {
        this.filesToUpload = this.filesToUpload.filter(f => f.id !== id);
        this.updateTotalSize();
        this.renderFileList();
    },

    renameFile(id, newName) {
        const item = this.filesToUpload.find(f => f.id === id);
        if (item) item.name = newName;
    },

    clearFileSelection() {
        this.filesToUpload = [];
        this.totalSize = 0;
        this.renderFileList();
        document.getElementById('uploadProgressArea').classList.add('hidden');
        document.getElementById('shareResultArea').classList.add('hidden');
        document.getElementById('fileInput').value = '';
        document.getElementById('folderInput').value = '';
    },

    renderFileList() {
        const listBody = document.getElementById('fileListBody');
        const container = document.getElementById('fileListContainer');
        const zone = document.getElementById('dropZone');
        const countSpan = document.getElementById('fileCount');
        const sizeSpan = document.getElementById('totalSize');

        if (this.filesToUpload.length === 0) {
            container.classList.add('hidden');
            zone.classList.remove('hidden');
            return;
        }

        container.classList.remove('hidden');
        zone.classList.add('hidden');

        listBody.innerHTML = '';
        this.filesToUpload.forEach(item => {
            const di = document.createElement('div');
            di.className = 'file-item';
            di.innerHTML = `
                <div class="file-item-left">
                    <span class="file-icon">📄</span>
                    <input type="text" class="file-name-input" 
                           value="${item.name}" 
                           onchange="window.app.renameFile('${item.id}', this.value)"
                           title="Click to Rename">
                </div>
                <div class="file-item-right">
                    <span>${(item.file.size / 1024).toFixed(1)} KB</span>
                    <button class="remove-item-btn" onclick="window.app.removeFile('${item.id}')">✕</button>
                </div>
            `;
            listBody.appendChild(di);
        });

        countSpan.textContent = this.filesToUpload.length;
        sizeSpan.textContent = (this.totalSize / 1024 / 1024).toFixed(2) + " MB";
    },

    showTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        document.getElementById(`tabBtn-${tabName}`).classList.add('active');
    },

    async startUpload() {
        if (this.filesToUpload.length === 0) return alert("Select files first!");

        const pin = document.getElementById('uploadPin').value;
        if (!pin || pin.length < 4) return alert("Pin must be 4-8 digits");

        const expiryHours = parseInt(document.getElementById('uploadExpiry').value);
        const downloadLimit = parseInt(document.getElementById('downloadLimit').value);
        const uiProgress = document.getElementById('uploadProgressBar');
        const uiText = document.getElementById('uploadStatusText');

        document.getElementById('uploadProgressArea').classList.remove('hidden');
        document.getElementById('startUploadBtn').disabled = true;

        try {
            uiText.textContent = "Processing...";
            uiProgress.style.width = "10%";

            let finalBlob;
            let finalName;

            // BUNDLING LOGIC (JSZip)
            if (this.filesToUpload.length === 1 && !this.filesToUpload[0].path.includes("/")) {
                // Uploading 1 file at root level -> Plain file
                finalBlob = this.filesToUpload[0].file;
                finalName = this.filesToUpload[0].name;
            } else {
                // Multi-files or Folders -> ZIP
                uiText.textContent = "Zipping...";
                const zip = new JSZip();

                this.filesToUpload.forEach(item => {
                    let entryPath = item.path;
                    // If user renamed it, update the filename part of the path
                    if (item.name !== item.file.name) {
                        const parts = entryPath.split('/');
                        parts[parts.length - 1] = item.name;
                        entryPath = parts.join('/');
                    }
                    zip.file(entryPath, item.file);
                });

                finalBlob = await zip.generateAsync({ type: "blob" });
                finalName = "SecureBundle.zip";

                // Try to name the zip after the root folder if exists
                if (this.filesToUpload.length > 0 && this.filesToUpload[0].path.includes("/")) {
                    const firstRoot = this.filesToUpload[0].path.split('/')[0];
                    if (firstRoot) finalName = firstRoot + ".zip";
                }
            }

            uiText.textContent = "Encrypting...";
            uiProgress.style.width = "40%";

            const key = await CryptoManager.generateKey();
            const { encryptedBlob, iv } = await CryptoManager.encrypt(finalBlob, key);

            uiText.textContent = "Saving to Local Storage...";
            uiProgress.style.width = "60%";

            const fileDocRef = db.collection('fileMetadata').doc();
            const fileId = fileDocRef.id;

            await StorageManager.saveFile(fileId, encryptedBlob);

            uiText.textContent = "Syncing Metadata...";
            uiProgress.style.width = "80%";

            const pinHash = await CryptoManager.hashPin(pin);
            const expiryDate = new Date();
            expiryDate.setHours(expiryDate.getHours() + expiryHours);

            await fileDocRef.set({
                fileName: finalName,
                fileSize: finalBlob.size,
                fileType: finalBlob.type || "application/zip",
                pinHash: pinHash,
                iv: iv,
                expiry: expiryDate,
                downloadLimit: downloadLimit,
                downloadCount: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                hostPeerId: P2PManager.peerId
            });

            const keyString = await CryptoManager.exportKey(key);
            const shareUrl = `${window.location.origin}/?id=${fileId}#key=${encodeURIComponent(keyString)}`;

            // AUTO-SAVE LINK
            LinkHistoryManager.save({
                id: fileId,
                url: shareUrl,
                name: finalName,
                expiryMs: expiryHours * 60 * 60 * 1000,
                isCreator: true,
                limit: downloadLimit
            });

            // Update UI Message
            const resultHeader = document.querySelector('#shareResultArea h3');
            if (resultHeader) resultHeader.textContent = "✅ File Ready! (Saved to History)";

            const warningText = document.querySelector('#shareResultArea .warning-text');
            if (warningText) warningText.textContent = "Checkout 'Download File' tab for history & management.";

            this.showShareResult(shareUrl);
            uiProgress.style.width = "100%";
            uiText.textContent = "Done!";

        } catch (e) {
            console.error(e);
            alert("Upload Failed: " + e.message);
            document.getElementById('startUploadBtn').disabled = false;
        }
    },

    showShareResult(url) {
        document.getElementById('shareResultArea').classList.remove('hidden');
        document.getElementById('shareLinkInput').value = url;
        document.getElementById('qrcode').innerHTML = "";
        new QRCode(document.getElementById('qrcode'), {
            text: url, width: 128, height: 128
        });
    },

    async copyToClipboard() {
        const input = document.getElementById("shareLinkInput");
        try {
            await navigator.clipboard.writeText(input.value);
            alert("✅ Link Copied!");
        } catch (err) {
            input.select();
            document.execCommand("copy");
            alert("✅ Link Copied!");
        }
    },

    // --- DOWNLOAD ---
    async startDownload() {
        const inputStr = document.getElementById('downloadId').value.trim();
        const pin = document.getElementById('downloadPin').value;
        if (!inputStr || !pin) return alert("Link and PIN required");

        let fileId, keyString;
        try {
            if (inputStr.includes('?id=')) {
                const url = new URL(inputStr);
                fileId = url.searchParams.get('id');
                keyString = decodeURIComponent(url.hash.replace('#key=', ''));
            } else {
                throw new Error("Invalid Link Format");
            }
        } catch (e) {
            return alert("Invalid Link. Please paste the full share link.");
        }

        const uiArea = document.getElementById('downloadProgressArea');
        const uiBar = document.getElementById('downloadProgressBar');
        const uiText = document.getElementById('downloadStatusText');

        // Reset UI
        uiArea.classList.remove('hidden');
        uiBar.style.width = "10%";
        uiBar.className = "progress-bar-fill"; // Reset color
        uiText.innerHTML = ""; // Clear previous diagnostics/text

        try {
            uiText.textContent = "Checking Metadata...";
            const doc = await db.collection('fileMetadata').doc(fileId).get();
            if (!doc.exists) throw new Error("File not found (or expired).");
            const meta = doc.data();

            const enteredHash = await CryptoManager.hashPin(pin);
            if (meta.pinHash !== enteredHash) throw new Error("Incorrect PIN");
            if (meta.expiry.toDate() < new Date()) throw new Error("File Expired");

            uiText.textContent = "Connecting to Peer (P2P)...";
            uiBar.style.width = "40%";

            let encryptedBuffer;
            const localFile = await StorageManager.getFile(fileId);
            if (localFile) {
                console.log("Found local file!");
                encryptedBuffer = await localFile.arrayBuffer();
            } else {
                encryptedBuffer = await P2PManager.downloadFromPeer(meta.hostPeerId, fileId, (status) => {
                    uiText.textContent = status;
                });
            }

            uiText.textContent = "Decrypting...";
            uiBar.style.width = "80%";

            const key = await CryptoManager.importKey(keyString);
            const decryptedBlob = await CryptoManager.decrypt(encryptedBuffer, key, meta.iv);

            const a = document.createElement('a');
            a.href = URL.createObjectURL(decryptedBlob);
            a.download = meta.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            db.collection('fileMetadata').doc(fileId).update({
                downloadCount: firebase.firestore.FieldValue.increment(1)
            });

            uiBar.style.width = "100%";
            uiText.textContent = "Download Complete!";

            alert("File Downloaded Successfully!");

        } catch (e) {
            console.error(e);
            uiBar.style.width = "100%";
            uiBar.style.backgroundColor = "var(--error-color)";
            uiText.textContent = "Error: " + e.message;

            // LAUNCH TROUBLESHOOTING OPERATOR
            this.showTroubleshooter(e.message);
        }
    },

    showTroubleshooter(errMsg) {
        const area = document.getElementById('downloadProgressArea');

        // Remove existing button if any
        const existingBtn = document.getElementById('diagnoseBtn');
        if (existingBtn) existingBtn.remove();

        const btn = document.createElement('button');
        btn.id = 'diagnoseBtn';
        btn.className = "cta-button";
        btn.style.marginTop = "1rem";
        btn.style.background = "#fbbf24";
        btn.style.color = "black";
        btn.innerHTML = "🔧 Diagnose Network Issue";
        btn.onclick = () => this.runDiagnostics(errMsg);

        area.appendChild(btn);
    },

    runDiagnostics(errMsg) {
        let diagnosis = "Diagnosis Result:\n\n";

        // 1. Check Internet
        if (!navigator.onLine) {
            diagnosis += "❌ No Internet Connection.\n";
        } else {
            diagnosis += "✅ Internet is Online.\n";
        }

        // 2. Check PeerJS
        if (P2PManager.peer.disconnected) {
            diagnosis += "❌ Disconnected from Signaling Server (Firewall block).\n";
        } else {
            diagnosis += "✅ Connected to Signaling Server.\n";
        }

        // 3. Analyze Error Message
        if (errMsg.includes("Timeout")) {
            diagnosis += "⚠️ Timeout: The 'Sender' is unreachable. Likely an Office Firewall blocking UDP.\n";
            diagnosis += "👉 FIX: The Sender should Reload (Ctrl+Shift+R) and check if they are online.";
        } else if (errMsg.includes("Incorrect PIN")) {
            diagnosis += "❌ Wrong Password. Please try again.";
        } else {
            diagnosis += "⚠️ Unknown Error: " + errMsg;
        }

        alert(diagnosis);
    },

    // --- TEXT SHARE ---
    async handleTextShare(e) {
        e.preventDefault();

        const name = document.getElementById('nameInput').value.trim();
        const location = document.getElementById('locInput').value.trim();
        const message = document.getElementById('msgInput').value.trim();
        const secret = document.getElementById('secretInput').value.trim();
        const password = document.getElementById('passwordInput').value.trim();

        if (!name || !location || !message) return alert("Fill required fields");
        if (secret && !password) return alert("Password required for secret data");

        try {
            const payload = {
                name, location, message,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (secret) {
                payload.isLocked = true;
                payload.secretData = secret;
                payload.unlockPassword = password;
            }

            await db.collection('messages').add(payload);
            document.getElementById('shareForm').reset();
            alert("✅ Message Posted!");

        } catch (err) {
            alert("Error: " + err.message);
        }
    },

    loadTextMessages() {
        const board = document.getElementById('messageBoard');
        if (!board) return;

        db.collection('messages').orderBy('timestamp', 'desc').limit(20)
            .onSnapshot(snap => {
                board.innerHTML = "";
                snap.forEach(doc => {
                    const d = doc.data();
                    const div = document.createElement('div');
                    div.className = "message-card";

                    let secretHtml = "";
                    if (d.isLocked) {
                        secretHtml = `
                        <div class="privacy-section-small" id="lock-${doc.id}">
                            <button onclick="app.unlockText('${doc.id}', '${d.unlockPassword}')" class="cta-button" style="padding:0.5rem; font-size:0.8rem; margin-top:0;">🔒 View Hidden</button>
                            <div id="content-${doc.id}" style="display:none; color:#34d399; margin-top:0.5rem; font-family:monospace; white-space:pre-wrap;">${d.secretData}</div>
                        </div>
                    `;
                    }

                    div.innerHTML = `
                   <div style="display:flex; justify-content:space-between; color:var(--primary-color); font-weight:bold; margin-bottom:0.5rem;">
                        <span>@${d.name || 'Anon'}</span>
                        <span style="font-size:0.8rem; color:var(--text-dim);">📍 ${d.location}</span>
                   </div>
                   <div id="msg-${doc.id}" class="msg-content markdown-body">
                        ${DOMPurify.sanitize(marked.parse(d.message))}
                   </div>
                   <div id="raw-${doc.id}" style="display:none;">${d.message}</div>
                   
                   ${secretHtml}
                   
                   <div class="msg-actions">
                        <div class="msg-tools">
                            <button onclick="app.copyRichText('msg-${doc.id}', 'raw-${doc.id}')" class="action-btn copy-msg-btn">
                                📋 Copy Rich Text
                            </button>
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-dim);">
                            ${d.timestamp ? new Date(d.timestamp.toDate()).toLocaleString() : ''}
                        </div>
                   </div>
                `;
                    board.appendChild(div);
                });
            });
    },

    async copyRichText(htmlId, rawId) {
        try {
            const htmlElement = document.getElementById(htmlId);
            const rawElement = document.getElementById(rawId);
            if (!htmlElement || !rawElement) return;

            const plainText = rawElement.innerText || htmlElement.innerText;
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <body>
                    ${htmlElement.innerHTML}
                </body>
                </html>
            `;

            const blobHtml = new Blob([htmlContent], { type: "text/html" });
            const blobText = new Blob([plainText], { type: "text/plain" });

            const data = [new ClipboardItem({
                ["text/html"]: blobHtml,
                ["text/plain"]: blobText,
            })];

            await navigator.clipboard.write(data);
            alert("✅ Copied! Ready for Word/Docs with formatting.");

        } catch (err) {
            console.error("Rich Copy Failed:", err);
            this.copyMessage(htmlId);
        }
    },

    async copyMessage(elementId) {
        const textElement = document.getElementById(elementId);
        if (!textElement) return;
        const text = textElement.innerText;
        try {
            await navigator.clipboard.writeText(text);
            alert("✅ Text Copied (Plain Mode)");
        } catch (err) {
            alert("❌ Copy Failed");
        }
    },

    unlockText(id, pass) {
        const input = prompt("Enter Password:");
        if (input === pass) {
            document.querySelector(`#lock-${id} button`).style.display = 'none';
            document.getElementById(`content-${id}`).style.display = 'block';
        } else {
            alert("Wrong Password");
        }
    }
};

// Start App
document.addEventListener('DOMContentLoaded', () => {
    App.init();

    // Auto-Open Download Tab if Link Shared
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('id')) {
        window.app.showTab('download');
        // Auto-fill the link box with full URL for clarity (optional, but good)
        document.getElementById('downloadId').value = window.location.href;
    }
});
