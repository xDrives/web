// ============================================================
// File Manager Module - MEGA Storage with Multi-User Support
// Each user gets their own folder in shared MEGA account
// Auto-connects using credentials stored in Firebase (mega/mail, mega/pass)
//
// METADATA STORAGE: Firebase Realtime Database
//   Path: userData/{encodedPhone}/fileLibraryData/
//     ├── folders/{folderId}   → user-created folders
//     └── meta/{sanitizedFile} → { folderId, description, lastModified }
//
// MEGA only stores the actual file bytes. All folder assignments and
// descriptions live in Firebase so they persist across reconnects.
// ============================================================

class FileLibraryModule {
    constructor() {
        this.storageLimitBytes = 1024 * 1024 * 1024; // 1 GB
        this.storage = null;
        this.files = [];              // Rebuilt from MEGA on every load
        this.folders = [];            // Synced from Firebase
        this.selectedFiles = null;
        this.itemToDelete = null;

        this.MEGA_BASE_FOLDER = 'xDrive_Files';
        this.MEGA_USER_FOLDER = null;
        this.megaBaseFolder = null;
        this.megaFolder = null;

        this.currentUserId = null;
        this.currentUserName = null;

        // Currently selected folder: 'home' or a custom folder id
        this.currentFolderId = 'home';
        this.editingFolderId = null;

        this.collapsedGroups = new Set();

        this.uploadLimits = {
            maxFilesPerUpload: 10,
            maxFileSizeMB: 50,
            maxTotalFiles: 500
        };

        this._objectUrls = [];

        // Firebase refs & listeners
        this.db = null;
        this._firebaseListeners = {};

        this.fileCategories = {
            image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/tiff'],
            video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'],
            audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/flac'],
            document: ['application/pdf', 'application/msword',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                       'application/vnd.ms-excel',
                       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                       'application/vnd.ms-powerpoint',
                       'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
            text: ['text/plain', 'text/html', 'text/css', 'text/javascript', 'application/json', 'text/markdown'],
            archive: ['application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/gzip']
        };

        this.fileIcons = {
            image: 'image',
            video: 'play-circle',
            audio: 'music',
            document: 'file-alt',
            text: 'file-code',
            archive: 'file-archive',
            unknown: 'file'
        };

        this.fileColors = {
            image: '#3b82f6',
            video: '#ef4444',
            audio: '#8b5cf6',
            document: '#f59e0b',
            text: '#10b981',
            archive: '#ec4899',
            unknown: '#6b7280'
        };

        this._sorted = [];

        this.init();
    }

    // ========== AUTH HELPERS ==========
    getCurrentUserId() {
        if (window.authDataManager && window.authDataManager.isLoggedIn && window.authDataManager.isLoggedIn()) {
            return window.authDataManager.getEncodedPhone();
        }
        try {
            const userStr = localStorage.getItem('currentUser');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user && user.phone) return this.encodePhone(user.phone);
            }
        } catch (e) {}
        return null;
    }

    getCurrentUserName() {
        if (window.authDataManager && window.authDataManager.getUser) {
            const user = window.authDataManager.getUser();
            if (user && user.name) return user.name;
        }
        try {
            const userStr = localStorage.getItem('currentUser');
            if (userStr) {
                const user = JSON.parse(userStr);
                return user?.name || 'User';
            }
        } catch (e) {}
        return 'User';
    }

    encodePhone(phone) {
        if (!phone) return null;
        return phone.replace(/[^\d+]/g, '').replace(/\./g, ',').replace(/@/g, '-at-');
    }

    isAuthenticated() {
        return !!this.getCurrentUserId();
    }

    getSessionKey() {
        const userId = this.getCurrentUserId();
        return userId ? `mega_auth_session_${userId}` : null;
    }

    getUserFolderName() {
        return this.getCurrentUserId();
    }

    // ========== FIREBASE HELPERS ==========

    getFirebaseDatabase() {
        if (window.authDataManager && typeof window.authDataManager.getDatabase === 'function') {
            const db = window.authDataManager.getDatabase();
            if (db) return db;
        }
        try {
            if (window.firebase && firebase.database) {
                return firebase.database();
            }
        } catch (e) {}
        return null;
    }

    getMetaRootPath() {
        const uid = this.getCurrentUserId();
        if (!uid) return null;
        return `userData/${uid}/fileLibraryData`;
    }

    /**
     * Firebase disallows: . # $ [ ] /
     */
    sanitizeFileName(name) {
        return String(name || '')
            .replace(/\./g, ',')
            .replace(/#/g, '-h-')
            .replace(/\$/g, '-s-')
            .replace(/\[/g, '-lb-')
            .replace(/\]/g, '-rb-')
            .replace(/\//g, '-sl-');
    }

    desanitizeFileName(key) {
        return String(key || '')
            .replace(/-h-/g, '#')
            .replace(/-s-/g, '$')
            .replace(/-lb-/g, '[')
            .replace(/-rb-/g, ']')
            .replace(/-sl-/g, '/')
            .replace(/,/g, '.');
    }

    // ---------- File metadata ----------
    async loadAllFileMeta() {
        const path = this.getMetaRootPath();
        if (!path) return new Map();
        const db = this.getFirebaseDatabase();
        if (!db) return new Map();

        try {
            const snap = await db.ref(`${path}/meta`).once('value');
            const map = new Map();
            if (snap.exists()) {
                const data = snap.val();
                Object.keys(data).forEach(key => {
                    const fullName = this.desanitizeFileName(key);
                    map.set(fullName, data[key]);
                });
            }
            return map;
        } catch (e) {
            console.error('[FileLibrary] loadAllFileMeta failed:', e);
            return new Map();
        }
    }

    async saveFileMeta(fullName, meta) {
        const path = this.getMetaRootPath();
        if (!path || !fullName) return;
        const db = this.getFirebaseDatabase();
        if (!db) return;

        const key = this.sanitizeFileName(fullName);
        const record = {
            folderId: meta.folderId || null,
            description: meta.description || '',
            lastModified: Date.now()
        };
        try {
            await db.ref(`${path}/meta/${key}`).set(record);
        } catch (e) {
            console.error('[FileLibrary] saveFileMeta failed:', e);
        }
    }

    async deleteFileMeta(fullName) {
        const path = this.getMetaRootPath();
        if (!path || !fullName) return;
        const db = this.getFirebaseDatabase();
        if (!db) return;

        const key = this.sanitizeFileName(fullName);
        try {
            await db.ref(`${path}/meta/${key}`).remove();
        } catch (e) {
            console.error('[FileLibrary] deleteFileMeta failed:', e);
        }
    }

    // ---------- Folders ----------
    async loadFoldersFromFirebase() {
        const path = this.getMetaRootPath();
        if (!path) {
            this.folders = this.getDefaultFolders();
            return;
        }
        const db = this.getFirebaseDatabase();
        if (!db) {
            this.folders = this.getDefaultFolders();
            return;
        }

        try {
            const snap = await db.ref(`${path}/folders`).once('value');
            const userFolders = snap.exists() ? Object.values(snap.val()) : [];
            this.folders = [...this.getDefaultFolders(), ...userFolders];
        } catch (e) {
            console.error('[FileLibrary] loadFoldersFromFirebase failed:', e);
            this.folders = this.getDefaultFolders();
        }
    }

    async saveFolderToFirebase(folder) {
        const path = this.getMetaRootPath();
        if (!path || !folder || folder.isSystemFolder) return;
        const db = this.getFirebaseDatabase();
        if (!db) return;

        const record = {
            id: folder.id,
            name: folder.name,
            description: folder.description || '',
            icon: folder.icon || 'fas fa-folder',
            color: folder.color || '#3b82f6',
            isSystemFolder: false,
            lastModified: Date.now()
        };

        const idx = this.folders.findIndex(f => f.id === folder.id);
        if (idx !== -1) this.folders[idx] = record;
        else this.folders.push(record);

        try {
            await db.ref(`${path}/folders/${folder.id}`).set(record);
        } catch (e) {
            console.error('[FileLibrary] saveFolderToFirebase failed:', e);
        }
    }

    async deleteFolderFromFirebase(folderId) {
        const path = this.getMetaRootPath();
        if (!path || !folderId) return;
        const db = this.getFirebaseDatabase();
        if (!db) return;

        this.folders = this.folders.filter(f => f.id !== folderId || f.isSystemFolder);

        try {
            await db.ref(`${path}/folders/${folderId}`).remove();
        } catch (e) {
            console.error('[FileLibrary] deleteFolderFromFirebase failed:', e);
        }
    }

    // ---------- Real-time listeners ----------
    setupFirebaseListeners() {
        const path = this.getMetaRootPath();
        if (!path) return;
        const db = this.getFirebaseDatabase();
        if (!db) return;

        this.teardownFirebaseListeners();

        const metaRef = db.ref(`${path}/meta`);
        const added = metaRef.on('child_added', snap => {
            const fullName = this.desanitizeFileName(snap.key);
            const meta = snap.val() || {};
            const file = this.files.find(f => f.fullName === fullName);
            if (file) {
                file.folderId = meta.folderId || null;
                file.description = meta.description || '';
                this.renderFolders();
                this.renderFiles();
            }
        });
        const changed = metaRef.on('child_changed', snap => {
            const fullName = this.desanitizeFileName(snap.key);
            const meta = snap.val() || {};
            const file = this.files.find(f => f.fullName === fullName);
            if (file) {
                file.folderId = meta.folderId || null;
                file.description = meta.description || '';
                this.renderFolders();
                this.renderFiles();
            }
        });
        const removed = metaRef.on('child_removed', snap => {
            const fullName = this.desanitizeFileName(snap.key);
            const file = this.files.find(f => f.fullName === fullName);
            if (file) {
                file.folderId = null;
                file.description = '';
                this.renderFolders();
                this.renderFiles();
            }
        });

        this._firebaseListeners.meta = { ref: metaRef, added, changed, removed };

        const foldersRef = db.ref(`${path}/folders`);
        const fAdded = foldersRef.on('child_added', snap => {
            const data = snap.val();
            if (!data || data.isSystemFolder) return;
            if (!this.folders.find(f => f.id === data.id)) {
                this.folders.push(data);
                this.renderFolders();
            }
        });
        const fChanged = foldersRef.on('child_changed', snap => {
            const data = snap.val();
            if (!data) return;
            const idx = this.folders.findIndex(f => f.id === data.id);
            if (idx !== -1) this.folders[idx] = data;
            else this.folders.push(data);
            this.renderFolders();
        });
        const fRemoved = foldersRef.on('child_removed', snap => {
            const id = snap.key;
            this.files.forEach(f => { if (f.folderId === id) f.folderId = null; });
            this.folders = this.folders.filter(f => f.id !== id || f.isSystemFolder);
            if (this.currentFolderId === id) {
                this.currentFolderId = 'home';
                const titleEl = document.getElementById('currentFolderTitle');
                if (titleEl) titleEl.textContent = 'Home';
                const manageBtn = document.getElementById('manageFolderBtn');
                if (manageBtn) manageBtn.style.display = 'none';
            }
            this.renderFolders();
            this.renderFiles();
        });

        this._firebaseListeners.folders = { ref: foldersRef, added: fAdded, changed: fChanged, removed: fRemoved };
    }

    teardownFirebaseListeners() {
        Object.keys(this._firebaseListeners).forEach(k => {
            const l = this._firebaseListeners[k];
            if (!l || !l.ref) return;
            try {
                if (l.added) l.ref.off('child_added', l.added);
                if (l.changed) l.ref.off('child_changed', l.changed);
                if (l.removed) l.ref.off('child_removed', l.removed);
            } catch (e) {}
        });
        this._firebaseListeners = {};
    }


        // ========== INIT ==========
    async init() {
        console.log('[FileLibrary] Initializing...');

        window.addEventListener('authSuccess', () => {
            console.log('[FileLibrary] Auth success detected, refreshing...');
            this.handleAuthChange();
        });

        window.addEventListener('authLogout', () => {
            console.log('[FileLibrary] Logout detected, cleaning up...');
            this.handleLogout();
        });

        if (this.isAuthenticated()) {
            const container = document.getElementById('home-file-library-container');
            if (container) {
                this.render('home-file-library-container');
            }
        }

        console.log('[FileLibrary] Ready');
    }

    async handleAuthChange() {
        const newUserId = this.getCurrentUserId();
        if (newUserId && newUserId !== this.currentUserId) {
            await this.disconnectMega();
            this.currentUserId = newUserId;
            this.files = [];
            await this.loadFoldersFromFirebase();
            this.setupFirebaseListeners();

            const container = document.getElementById('home-file-library-container');
            if (container) {
                this.render('home-file-library-container');
            }
        }
    }

    async handleLogout() {
        this.teardownFirebaseListeners();
        await this.disconnectMega();
        this.currentUserId = null;
        this.currentUserName = null;
        this.files = [];
        this.folders = this.getDefaultFolders();
        this.currentFolderId = 'home';
    }

    // ========== FOLDERS (FLAT) ==========
    getDefaultFolders() {
        return [
            {
                id: 'home',
                name: 'Home',
                icon: 'fas fa-home',
                color: '#3b82f6',
                isSystemFolder: true,
                description: 'Files not assigned to any folder'
            }
        ];
    }

    generateFolderId() {
        return 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    }

    getFolderById(id) {
        return this.folders.find(f => f.id === id);
    }

    getFolderFileCount(folderId) {
        if (folderId === 'home') return this.files.filter(f => !f.folderId).length;
        return this.files.filter(f => f.folderId === folderId).length;
    }

    getFilteredFiles() {
        if (this.currentFolderId === 'home') return this.files.filter(f => !f.folderId);
        return this.files.filter(f => f.folderId === this.currentFolderId);
    }

    getUploadTargetFolderId() {
        if (this.currentFolderId === 'home') return null;
        const folder = this.getFolderById(this.currentFolderId);
        if (folder && !folder.isSystemFolder) return folder.id;
        return null;
    }

    // ========== MEGA CREDENTIALS FROM FIREBASE ==========
    async getMegaCredentialsFromFirebase() {
        try {
            const authManager = window.authDataManager;
            if (!authManager || !authManager.getDatabase) return null;
            const db = authManager.getDatabase();
            if (!db) return null;
            const snapshot = await db.ref('mega').once('value');
            if (!snapshot.exists()) return null;
            const data = snapshot.val();
            if (!data.mail || !data.pass) return null;
            return { email: data.mail, password: data.pass };
        } catch (error) {
            console.error('[FileLibrary] Error fetching MEGA credentials from Firebase:', error);
            return null;
        }
    }

    // ========== MEGA CONNECTION ==========
    async connectToMega(email, password) {
        if (!this.isAuthenticated()) throw new Error('You must be logged in to connect MEGA storage');
        if (!window.mega || !window.mega.Storage) throw new Error('MEGA SDK not loaded. Check the <script type="module"> import for megajs.');

        const userId = this.getCurrentUserId();
        const userFolder = this.getUserFolderName();

        console.log('[FileLibrary] Connecting to MEGA for user:', userId);

        const storage = new window.mega.Storage({ email, password });
        await storage.ready;
        console.log('[FileLibrary] Connected to MEGA:', storage.name);

        this.storage = storage;
        this.currentUserId = userId;
        this.currentUserName = this.getCurrentUserName();
        this.MEGA_USER_FOLDER = userFolder;

        const sessionKey = this.getSessionKey();
        try {
            localStorage.setItem(sessionKey, JSON.stringify({
                email,
                password: btoa(unescape(encodeURIComponent(password))),
                userId: userId,
                savedAt: Date.now()
            }));
        } catch (e) {
            console.warn('[FileLibrary] Failed to save session:', e);
        }

        await this.setupUserFolder();
        return storage;
    }

    async setupUserFolder() {
        if (!this.storage) throw new Error('Not connected to xDrive');

        const root = this.storage.root;
        if (!root.children) await new Promise((r) => root.once('update', r));

        let baseFolder = root.children.find(c => c.directory && c.name === this.MEGA_BASE_FOLDER);
        if (!baseFolder) {
            baseFolder = await root.mkdir(this.MEGA_BASE_FOLDER);
        }
        this.megaBaseFolder = baseFolder;

        if (!baseFolder.children) {
            await new Promise((r) => baseFolder.once('update', r));
        }

        const userFolderName = this.MEGA_USER_FOLDER;
        let userFolder = baseFolder.children.find(c => c.directory && c.name === userFolderName);

        if (!userFolder) {
            userFolder = await baseFolder.mkdir(userFolderName);
        }

        this.megaFolder = userFolder;
    }

    async tryAutoConnect() {
        if (this.storage) return true;
        if (!this.isAuthenticated()) return false;

        const sessionKey = this.getSessionKey();
        if (sessionKey) {
            try {
                const raw = localStorage.getItem(sessionKey);
                if (raw) {
                    const data = JSON.parse(raw);
                    if (data.email && data.password && data.userId === this.getCurrentUserId()) {
                        const password = decodeURIComponent(escape(atob(data.password)));
                        await this.connectToMega(data.email, password);
                        return true;
                    }
                }
            } catch (e) {
                console.warn('[FileLibrary] localStorage auto-connect failed:', e.message);
                localStorage.removeItem(sessionKey);
            }
        }

        const credentials = await this.getMegaCredentialsFromFirebase();
        if (!credentials) return false;

        try {
            await this.connectToMega(credentials.email, credentials.password);
            return true;
        } catch (e) {
            console.error('[FileLibrary] Firebase credential auto-connect failed:', e.message);
            return false;
        }
    }

    async disconnectMega() {
        try {
            if (this.storage && typeof this.storage.close === 'function') this.storage.close();
        } catch (e) {}

        this.revokeAllUrls();
        this.storage = null;
        this.megaFolder = null;
        this.megaBaseFolder = null;
        this.MEGA_USER_FOLDER = null;
        this.files = [];

        const sessionKey = this.getSessionKey();
        if (sessionKey) localStorage.removeItem(sessionKey);
    }

    // ========== LOAD ==========
    async loadFiles() {
        if (!this.storage) return;
        if (!this.megaFolder) await this.setupUserFolder();

        if (!this.megaFolder.children || this.megaFolder.children.length === 0) {
            await new Promise((resolve) => {
                const t = setTimeout(resolve, 2000);
                this.megaFolder.once('update', () => { clearTimeout(t); resolve(); });
            });
        }

        const metaMap = await this.loadAllFileMeta();

        const children = this.megaFolder.children || [];
        const fileNodes = children.filter(c => !c.directory);

        this.files = fileNodes.map(n => {
            const rec = this.nodeToRecord(n);
            const meta = metaMap.get(rec.fullName);
            if (meta) {
                rec.folderId = meta.folderId || null;
                rec.description = meta.description || '';
            }
            return rec;
        });

        console.log('[FileLibrary] Loaded', this.files.length, 'files for user:', this.currentUserId);
    }

    nodeToRecord(node) {
        const name = node.name || 'untitled';
        const ext = this.getExtension(name);
        const mime = this.getMimeFromExtension(ext);
        const category = this.getCategory(mime);
        return {
            id: node.nodeId || node.handle || ('file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)),
            nodeId: node.nodeId,
            megaNode: node,
            userId: this.currentUserId,
            name: name.replace(/\.[^/.]+$/, ''),
            fullName: name,
            extension: ext,
            size: this.formatBytes(node.size || 0),
            fileSizeMB: (node.size || 0) / (1024 * 1024),
            mimeType: mime,
            category: category,
            icon: this.fileIcons[category],
            color: this.fileColors[category],
            date: node.timestamp ? new Date(node.timestamp * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            timestamp: node.timestamp || Math.floor(Date.now() / 1000),
            description: '',
            folderId: null,
            lastModified: Date.now()
        };
    }

    // ========== UPLOAD ==========
    async uploadFile(file, onProgress) {
        if (!this.storage) throw new Error('Not connected to xDrive');
        if (!this.megaFolder) await this.setupUserFolder();

        const buffer = await file.arrayBuffer();

        return new Promise((resolve, reject) => {
            try {
                const upload = this.megaFolder.upload({
                    name: file.name,
                    size: buffer.byteLength
                });

                const timeoutId = setTimeout(() => reject(new Error('Upload timed out')), 5 * 60 * 1000);

                upload.on('complete', (node) => {
                    clearTimeout(timeoutId);
                    resolve(node ? node.nodeId : null);
                });

                upload.on('error', (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                });

                upload.on('progress', (p) => {
                    if (onProgress) onProgress(Math.round(p * 100));
                });

                const chunkSize = 1024 * 1024;
                let offset = 0;
                while (offset < buffer.byteLength) {
                    const end = Math.min(offset + chunkSize, buffer.byteLength);
                    upload.write(new Uint8Array(buffer, offset, end - offset));
                    offset = end;
                }
                upload.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    // ========== DOWNLOAD ==========
    async downloadFile(record) {
        const node = record.megaNode;
        if (!node) throw new Error('File node not available');

        return new Promise((resolve, reject) => {
            const chunks = [];
            const stream = node.download();
            stream.on('data', c => chunks.push(this.normalizeChunk(c)));
            stream.on('end', () => resolve(new Blob(chunks)));
            stream.on('error', reject);
        });
    }

    normalizeChunk(c) {
        if (c instanceof Uint8Array) return c;
        if (c instanceof ArrayBuffer) return new Uint8Array(c);
        if (c instanceof Blob) return c;
        if (c && c.buffer instanceof ArrayBuffer) {
            return new Uint8Array(c.buffer, c.byteOffset || 0, c.byteLength || c.buffer.byteLength);
        }
        return new Uint8Array(c);
    }

    async deleteFile(record) {
        const node = record.megaNode;
        if (!node) throw new Error('File node not available');
        return new Promise((resolve, reject) => {
            node.delete((err) => err ? reject(err) : resolve());
        });
    }

    // ========== HELPERS ==========
    getExtension(name) {
        const i = name.lastIndexOf('.');
        return i === -1 ? '' : name.substring(i + 1).toLowerCase();
    }

    getMimeFromExtension(ext) {
        const map = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tiff: 'image/tiff', tif: 'image/tiff',
            mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
            avi: 'video/x-msvideo', mkv: 'video/x-matroska',
            mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4',
            pdf: 'application/pdf',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xls: 'application/vnd.ms-excel',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ppt: 'application/vnd.ms-powerpoint',
            pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            txt: 'text/plain', html: 'text/html', css: 'text/css',
            js: 'text/javascript', json: 'application/json', md: 'text/markdown',
            zip: 'application/zip', rar: 'application/x-rar-compressed',
            '7z': 'application/x-7z-compressed', gz: 'application/gzip'
        };
        return map[ext] || 'application/octet-stream';
    }

    getCategory(mime) {
        for (const [cat, types] of Object.entries(this.fileCategories)) {
            if (types.includes(mime)) return cat;
        }
        return 'unknown';
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
    }

    escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    revokeAllUrls() {
        this._objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        this._objectUrls = [];
    }

    trackUrl(url) {
        this._objectUrls.push(url);
        return url;
    }

    showNotification(msg, type = 'success') {
        if (window.toastManager && window.toastManager.show) window.toastManager.show(msg, type);
        else console.log(`[${type}] ${msg}`);
    }

    randomFolderColor() {
        const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    // ========== DATE GROUPING ==========
    groupFilesByDate(files) {
        const groups = {};
        const sorted = [...files].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        sorted.forEach(file => {
            const date = file.timestamp
                ? new Date(file.timestamp * 1000)
                : new Date(file.date || Date.now());

            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            let groupKey;
            if (date.toDateString() === today.toDateString()) groupKey = 'Today';
            else if (date.toDateString() === yesterday.toDateString()) groupKey = 'Yesterday';
            else if (this.isThisWeek(date)) groupKey = 'This week';
            else if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()) groupKey = 'This month';
            else groupKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(file);
        });

        return groups;
    }

    isThisWeek(date) {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return date >= weekAgo && date < yesterday;
    }

    // ========== RENDER ==========
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!this.isAuthenticated()) {
            container.innerHTML = `
                <div style="padding: 60px 20px; text-align: center;">
                    <span class="material-icons" style="font-size: 64px; opacity: 0.4;">lock</span>
                    <h2 style="margin: 16px 0 8px;">Authentication Required</h2>
                    <p style="opacity: 0.7;">Please sign in to access your file library.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.getHTML();
        this.attachEventListeners();
        this.bootstrapAuth();
    }

    getHTML() {
        const userId = this.getCurrentUserId();

        return `
            <div class="file-library-container">
                <div class="module-card" id="fileManagerCard">
                    <div class="module-icon" style="color: var(--primary);">
                        <i class="fas fa-folder-open"></i>
                    </div>
                    <div class="module-info">
                        <div class="module-title">File Manager</div>
                        <div class="module-description">Secure file storage with xDrive</div>
                    </div>
                    <div class="module-actions">
                        <div class="file-count-badge" id="fileCountBadge">
                            <i class="fas fa-file"></i> <span>0</span>
                        </div>
                        <span class="section-card-badge" id="megaAuthStatus">Loading...</span>
                    </div>
                </div>

                <div class="section-card" id="uploadSection" style="display:none;">
                    <div class="section-card-header">
                        <div class="section-card-title">
                            <i class="fas fa-list"></i> 
                            <span>Selected Files</span>
                        </div>
                        <button class="btn btn-danger" id="clearAllFilesBtn" title="Clear all">
                            <i class="fas fa-times"></i> Clear
                        </button>
                        <span class="section-card-badge" id="fileSelectionInfo">0 selected</span>
                    </div>
                    <div class="section-card-content">
                        <div style="font-size:0.75rem; opacity:0.7; margin-bottom:10px;">
                            Uploading to: <strong id="uploadTargetLabel" style="color:var(--primary);">Home</strong>
                        </div>

                        <input type="file" id="fileInput" multiple style="display:none;">
                        
                        <!-- Hidden file input for "add more" -->
                        <input type="file" id="fileInputMore" multiple style="display:none;">

                        <div class="file-preview" id="filePreview" style="display:none;">
                            <div class="file-preview-grid" id="filePreviewGrid"></div>
                        </div>

                        <!-- Inline progress -->
                        <div id="uploadProgress" style="display:none; margin-top:10px;">
                            <div class="progress-bar">
                                <div class="progress-fill" id="progressFill"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-top:6px;">
                                <span id="progressText">Uploading...</span>
                                <span id="progressPercent">0%</span>
                            </div>
                        </div>

                        <div class="upload-actions-row">
                            <button class="btn btn-primary" id="startUploadBtn" style="display:none;">
                                <i class="fas fa-upload"></i> Upload to xDrive
                            </button>
                            <button class="btn btn-secondary" id="cancelUploadBtn">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                        </div>
                    </div>
                </div>

                <div class="section-card" id="folderModal" style="display:none;">
                    <div class="section-card-header">
                        <div class="section-card-title">
                            <i class="fas fa-folder-plus" id="folderModalIcon"></i>
                            <span id="folderModalTitle">Create New Folder</span>
                        </div>
                        <span class="section-card-badge" id="folderModalBadge">New</span>
                    </div>
                    <div class="section-card-content">
                        <div class="form-group" style="margin-bottom:10px;">
                            <label class="form-label" for="folderName">Folder Name (max 12 characters, no spaces)</label>
                            <input type="text" id="folderName" class="form-input" placeholder="e.g., Projects" maxlength="12"
                                   oninput="this.value = this.value.replace(/\\s/g, '')">
                        </div>
                        <div class="form-group" style="margin-bottom:10px;">
                            <label class="form-label" for="folderDescription">Description (optional)</label>
                            <input type="text" id="folderDescription" class="form-input" placeholder="Short description" maxlength="60">
                        </div>

                        <div class="folder-delete-confirmation-panel" id="folderDeleteConfirm" style="display:none; margin-top:10px;">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="width:32px;height:32px;background:rgba(239,68,68,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;">
                                    <i class="fas fa-exclamation-triangle" style="color:#ef4444; font-size:18px;"></i>
                                </div>
                                <div>
                                    <div style="font-size:0.85rem; font-weight:500;">Delete this folder?</div>
                                    <div style="font-size:0.7rem; opacity:0.7; margin-top:2px;">
                                        Files inside will move back to Home.
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
                                <button class="btn btn-danger" id="confirmFolderDeleteBtn"><i class="fas fa-trash"></i> Delete Folder</button>
                                <button class="btn btn-secondary" id="cancelFolderDeleteBtn">Cancel</button>
                            </div>
                        </div>

                        <div style="display:flex; gap:8px; margin-top:12px; justify-content:flex-end;">
                            <button class="btn btn-danger" id="deleteFolderBtn" style="display:none;">
                                <i class="fas fa-trash"></i> Delete Folder
                            </button>
                            <div style="flex:1;"></div>
                            <button class="btn btn-primary" id="saveFolderBtn"><i class="fas fa-folder-plus"></i> Create Folder</button>
                            <button class="btn btn-secondary" id="cancelFolderBtn">Cancel</button>
                        </div>
                    </div>
                </div>

                <div class="section-card" id="foldersSection" style="display:none;">
                    <div class="section-card-header">
                        <div class="section-card-title"><i class="fas fa-folder"></i> <span>Folders</span></div>
                        <div class="section-card-actions">
                            <button class="btn btn-icon" id="manageFolderBtn" title="Manage folder" style="display:none;">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-icon" id="newFolderBtn" title="New folder">
                                <i class="fas fa-folder-plus"></i>
                            </button>
                        </div>
                    </div>
                    <div class="section-card-content">
                        <div class="folders-grid" id="foldersGrid"></div>
                    </div>
                    <div class="section-card-footer">
                        <p class="section-description" id="folderSectionDescription">Organize your files into folders</p>
                    </div>
                </div>

                <div class="section-card file-view-section" id="fileViewSection" style="display:none;">
                    <div class="section-card-header">
                        <div class="section-card-title">
                            <i class="fas fa-file" id="fileViewIcon"></i>
                            <span id="fileViewName">File</span>
                        </div>
                        <span class="section-card-badge">
                            <span id="fileViewDate"></span>
                            <span id="fileViewSize" style="margin-left: 8px;"></span>
                        </span>
                        <button class="close-file-view" id="closeFileViewBtn" style="background: transparent; border: none; color: var(--text); cursor: pointer; font-size: 1.2rem;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="section-card-content">
                        <div class="file-view-body">
                            <div class="file-preview-container" id="filePreviewContainer"></div>
                        </div>
                        <div class="file-description-container" style="margin-top: 8px;">
                            <input type="text" class="file-description-input-view" id="fileDescriptionInput"
                                   placeholder="Add a short description (max 100 chars)" maxlength="100" value="">
                            <span class="description-char-count-view" id="descriptionCharCount">0/100</span>
                        </div>
                        <div class="file-view-actions" style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; justify-content:flex-end;">
                            <button class="btn-icon move-to-folder-btn" id="moveToFolderViewBtn" title="Move to folder">
                                <i class="fas fa-folder-tree"></i>
                            </button>
                            <button class="btn-icon share-file-view-btn" id="shareFileViewBtn" title="Share this file">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-icon delete-view-btn" id="deleteViewBtn" title="Delete File">
                                <i class="fas fa-trash"></i>
                            </button>
                            <button class="btn-icon download-file-view-btn" id="downloadFileViewBtn" title="Download File">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="btn-icon zoom-in-btn" id="zoomInImageBtn" title="Zoom In" style="display:none;">
                                <i class="fas fa-search-plus"></i>
                            </button>
                            <button class="btn-icon zoom-out-btn" id="zoomOutImageBtn" title="Zoom Out" style="display:none;">
                                <i class="fas fa-search-minus"></i>
                            </button>
                            <button class="btn-icon zoom-reset-btn" id="zoomResetImageBtn" title="Reset Zoom" style="display:none;">
                                <i class="fas fa-expand"></i>
                            </button>
                        </div>

                        <!-- Move-to-folder panel -->
                        <div class="move-to-folder-panel" id="moveToFolderPanel" style="display:none; margin-top:8px;">
                            <p style="font-size:0.8rem; margin-bottom:8px; font-weight:500;">
                                <i class="fas fa-folder-tree"></i> Move "<span id="moveFileName">file</span>" to:
                            </p>
                            <div class="folder-picker-list" id="folderPickerList"></div>
                            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
                                <button class="btn btn-secondary" id="closeMovePanelBtn">Cancel</button>
                            </div>
                        </div>

                        <div class="file-delete-panel" id="fileDeletePanel" style="display:none; margin-top:8px;">
                            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                                <div style="width:32px; height:32px; background: rgba(239,68,68,0.15); border-radius:8px; display:flex; align-items:center; justify-content:center;">
                                    <i class="fas fa-exclamation-triangle" style="color:var(--danger, #ef4444); font-size:18px;"></i>
                                </div>
                                <div>
                                    <div style="color: var(--f-label); font-size: 0.85rem; font-weight: 500;">
                                        Are you sure you want to delete this file from xDrive?
                                    </div>
                                    <div style="color: var(--text-secondary, #a0a0b0); font-size: 0.7rem; margin-top: 2px;">
                                        This action cannot be undone.
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; justify-content:flex-end; margin-top:4px;">
                                <button type="button" class="btn btn-danger" id="confirmFileDeleteBtn">
                                    <i class="fas fa-trash"></i> Delete
                                </button>
                                <button type="button" class="btn btn-secondary" id="cancelFileDeleteBtn">Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-card" id="filesGridSection" style="display:none;">
                    <div class="section-card-header">
                        <div class="section-card-title">
                            <i class="fas fa-files"></i>
                            <span id="currentFolderTitle">Home</span>
                        </div>
                        <button class="btn btn-primary" id="uploadFilesBtn">
                            <i class="fas fa-file-medical"></i> Add File
                        </button>
                    </div>
                    <div class="section-card-content">
                        <div class="files-grid grid-view" id="filesGrid"></div>
                        <div class="empty-state" id="emptyState" style="display:none; padding:40px; text-align:center; opacity:0.7;">
                            <i class="fas fa-folder-open" style="font-size:48px;"></i>
                            <h3 id="emptyStateTitle">No files yet</h3>
                            <p id="emptyStateMessage">Upload your first file to xDrive</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ========== LISTENERS ==========
    attachEventListeners() {
        const $ = (id) => document.getElementById(id);

        $('uploadFilesBtn').onclick = () => $('fileInput').click();
        $('fileInput').onchange = (e) => this.handleFileSelect(e);
        $('startUploadBtn').onclick = () => this.handleUpload();
        $('cancelUploadBtn').onclick = () => this.resetUpload();
        $('newFolderBtn').onclick = () => this.openFolderModal();
        $('manageFolderBtn').onclick = () => {
            if (this.currentFolderId !== 'home') {
                this.openFolderModal(this.currentFolderId);
            }
        };
        $('saveFolderBtn').onclick = () => this.saveFolderFromModal();
        $('cancelFolderBtn').onclick = () => this.closeFolderModal();
        $('deleteFolderBtn').onclick = () => {
            const panel = $('folderDeleteConfirm');
            if (panel) panel.style.display = 'block';
            $('deleteFolderBtn').style.display = 'none';
        };
        $('cancelFolderDeleteBtn').onclick = () => {
            $('folderDeleteConfirm').style.display = 'none';
            if (this.editingFolderId) $('deleteFolderBtn').style.display = 'inline-flex';
        };
        $('confirmFolderDeleteBtn').onclick = () => this.confirmDeleteFolder();

        $('closeFileViewBtn').onclick = () => this.closeFileView();
        $('deleteViewBtn').onclick = () => {
            $('moveToFolderPanel').style.display = 'none';
            $('fileDeletePanel').style.display = 'block';
        };
        $('cancelFileDeleteBtn').onclick = () => { $('fileDeletePanel').style.display = 'none'; };
        $('confirmFileDeleteBtn').onclick = () => this.confirmDeleteCurrent();
        $('downloadFileViewBtn').onclick = () => this.downloadCurrent();
        $('shareFileViewBtn').onclick = () => this.shareCurrent();

        $('moveToFolderViewBtn').onclick = () => {
            $('fileDeletePanel').style.display = 'none';
            this.openMoveToFolderPanel();
        };
        $('closeMovePanelBtn').onclick = () => {
            $('moveToFolderPanel').style.display = 'none';
        };

         // Preview action buttons
        const clearBtn = $('clearAllFilesBtn');
        if (clearBtn) clearBtn.onclick = () => this.clearAllSelectedFiles();

        // Add-more file input
        const moreInput = $('fileInputMore');
        if (moreInput) moreInput.onchange = (e) => this.handleAddMoreFiles(e);


        const descInput = $('fileDescriptionInput');
        if (descInput) {
            descInput.oninput = (e) => {
                const c = $('descriptionCharCount');
                if (c) c.textContent = `${e.target.value.length}/100`;
                clearTimeout(this._descTimeout);
                this._descTimeout = setTimeout(() => {
                    if (this.currentFileId) this.updateFileDescription(this.currentFileId, e.target.value);
                }, 800);
            };
        }
    }

    // ========== AUTH ==========
    async bootstrapAuth() {
        const statusEl = document.getElementById('megaAuthStatus');
        if (statusEl) statusEl.textContent = 'Loading...';

        try {
            await this.loadFoldersFromFirebase();
            this.setupFirebaseListeners();

            const ok = await this.tryAutoConnect();
            if (ok) {
                this.showConnectedUI();
                await this.loadAndRenderFiles();
            } else {
                this.showNotConnectedUI();
            }
        } catch (e) {
            console.error('[FileLibrary] Auto-connect error:', e);
            if (statusEl) statusEl.textContent = 'Connection failed';
            this.showNotConnectedUI();
        }
    }

    showNotConnectedUI() {
        ['uploadSection', 'filesGridSection', 'fileViewSection', 'foldersSection', 'folderModal']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        const statusEl = document.getElementById('megaAuthStatus');
        if (statusEl) statusEl.textContent = '';
    }

    showConnectedUI() {
        const statusEl = document.getElementById('megaAuthStatus');
        if (statusEl) statusEl.textContent = '';
        const card = document.getElementById('fileManagerCard');
        const foldersSection = document.getElementById('foldersSection');
        const gridSection = document.getElementById('filesGridSection');
        if (card) card.style.display = 'flex';
        if (foldersSection) foldersSection.style.display = 'block';
        if (gridSection) gridSection.style.display = 'block';
    }

    // ========== LOAD / RENDER ==========
    async loadAndRenderFiles() {
        try {
            await this.loadFiles();
            this.renderFolders();
            this.renderFiles();
        } catch (e) {
            console.error(e);
            this.showNotification('Load failed: ' + e.message, 'error');
        }
    }

renderFolders() {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    grid.innerHTML = this.folders.map(folder => {
        const count = this.getFolderFileCount(folder.id);
        const active = this.currentFolderId === folder.id ? 'active' : '';
        const countLabel = `${count} file${count !== 1 ? 's' : ''}`;
        
        // Get folder description or default
        const description = folder.description || (folder.isSystemFolder ? 'Default folder' : 'Custom folder');
        return `
            <div class="folder-card ${active}" data-folder-id="${folder.id}" data-action="filter"
                 style="--folder-color:${folder.color};">
                <div class="folder-thumbnail">
                    <div class="folder-icon-container"
                         style="background:${folder.color}20;border-color:${folder.color};">
                        <i class="${folder.icon}" style="color:${folder.color};"></i>
                    </div>
                </div>
                <div class="folder-info">
                    <div class="folder-name" title="${this.escapeHtml(folder.name)}" style="color:${folder.color}">
                        ${this.escapeHtml(folder.name)}
                    </div>
                    <div class="folder-meta">
                        <span class="folder-count-badge">${countLabel}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.folder-card').forEach(card => {
        card.onclick = () => {
            const folderId = card.dataset.folderId;
            const folder = this.getFolderById(folderId);
            if (folder && folder.isCreateTrigger) {
                this.openFolderModal();
                return;
            }
            this.applyFolderFilter(folderId);
        };
    });

    const desc = document.getElementById('folderSectionDescription');
    if (desc) {
        const current = this.getFolderById(this.currentFolderId);
        desc.textContent = current && current.description
            ? current.description
            : 'Organize your files into folders';
    }

    // Update manage button visibility
    const manageBtn = document.getElementById('manageFolderBtn');
    if (manageBtn) {
        const current = this.getFolderById(this.currentFolderId);
        manageBtn.style.display = current && !current.isSystemFolder ? 'inline-flex' : 'none';
    }
}

    applyFolderFilter(folderId) {
        this.currentFolderId = folderId;
        const titleEl = document.getElementById('currentFolderTitle');
        const folder = this.getFolderById(folderId);
        if (titleEl) titleEl.textContent = folder ? folder.name : 'Home';
        
        // Show/hide manage folder button
        const manageFolderBtn = document.getElementById('manageFolderBtn');
        if (manageFolderBtn) {
            const currentFolder = this.getFolderById(folderId);
            manageFolderBtn.style.display = currentFolder && !currentFolder.isSystemFolder ? 'inline-flex' : 'none';
        }
        
        this.updateUploadTargetLabel();
        this.renderFolders();
        this.renderFiles();
    }

    updateUploadTargetLabel() {
        const label = document.getElementById('uploadTargetLabel');
        if (!label) return;
        const folder = this.getFolderById(this.currentFolderId);
        label.textContent = folder ? folder.name : 'Home';
    }

    // ========== FOLDER MODAL ==========
    openFolderModal(folderId = null) {
        const modal = document.getElementById('folderModal');
        const title = document.getElementById('folderModalTitle');
        const icon = document.getElementById('folderModalIcon');
        const badge = document.getElementById('folderModalBadge');
        const nameInput = document.getElementById('folderName');
        const descInput = document.getElementById('folderDescription');
        const deleteBtn = document.getElementById('deleteFolderBtn');
        const confirmPanel = document.getElementById('folderDeleteConfirm');
        const saveBtn = document.getElementById('saveFolderBtn');

        if (!modal) return;

        modal.style.display = 'block';
        confirmPanel.style.display = 'none';
        this.editingFolderId = folderId;

        const isEditing = folderId !== null;

        if (isEditing) {
            const folder = this.getFolderById(folderId);
            if (!folder || folder.isSystemFolder) return;
            if (title) title.textContent = 'Manage Folder';
            if (icon) icon.className = 'fas fa-edit';
            if (badge) badge.textContent = 'Manage';
            if (nameInput) nameInput.value = folder.name;
            if (descInput) descInput.value = folder.description || '';
            if (deleteBtn) deleteBtn.style.display = 'inline-flex';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> Update Folder';
        } else {
            if (title) title.textContent = 'Create New Folder';
            if (icon) icon.className = 'fas fa-folder-plus';
            if (badge) badge.textContent = 'New';
            if (nameInput) nameInput.value = '';
            if (descInput) descInput.value = '';
            if (deleteBtn) deleteBtn.style.display = 'none';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-folder-plus"></i> Create Folder';
        }

        modal.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    closeFolderModal() {
        const modal = document.getElementById('folderModal');
        if (modal) modal.style.display = 'none';
        const nameInput = document.getElementById('folderName');
        const descInput = document.getElementById('folderDescription');
        if (nameInput) nameInput.value = '';
        if (descInput) descInput.value = '';
        const confirmPanel = document.getElementById('folderDeleteConfirm');
        if (confirmPanel) confirmPanel.style.display = 'none';
        this.editingFolderId = null;
    }

    async saveFolderFromModal() {
        const name = (document.getElementById('folderName')?.value || '').trim();
        const description = (document.getElementById('folderDescription')?.value || '').trim();

        if (!name) {
            this.showNotification('Please enter a folder name', 'error');
            return;
        }
        if (name.includes(' ')) {
            this.showNotification('Folder name must be a single word (no spaces allowed)', 'error');
            return;
        }
        if (name.length > 24) {
            this.showNotification('Folder name must be 24 characters or less', 'error');
            return;
        }

        const isEditing = this.editingFolderId !== null;

        if (isEditing) {
            const folder = this.getFolderById(this.editingFolderId);
            if (!folder || folder.isSystemFolder) return;

            const conflict = this.folders.some(f =>
                f.id !== folder.id && !f.isSystemFolder &&
                f.name.toLowerCase() === name.toLowerCase()
            );
            if (conflict) {
                this.showNotification('A folder with this name already exists', 'error');
                return;
            }

            folder.name = name;
            folder.description = description;
            await this.saveFolderToFirebase(folder);
            this.showNotification(`Folder "${name}" updated`);
        } else {
            const conflict = this.folders.some(f =>
                !f.isSystemFolder && f.name.toLowerCase() === name.toLowerCase()
            );
            if (conflict) {
                this.showNotification('A folder with this name already exists', 'error');
                return;
            }

            const newFolder = {
                id: this.generateFolderId(),
                name,
                description,
                icon: 'fas fa-folder',
                color: this.randomFolderColor(),
                isSystemFolder: false
            };
            await this.saveFolderToFirebase(newFolder);
            this.showNotification(`Folder "${name}" created`);
        }

        this.renderFolders();
        this.closeFolderModal();
    }

    async confirmDeleteFolder() {
        if (!this.editingFolderId) return;
        const folder = this.getFolderById(this.editingFolderId);
        if (!folder || folder.isSystemFolder) return;

        // Move all files in this folder back to Home
        const affected = this.files.filter(f => f.folderId === folder.id);
        for (const file of affected) {
            await this.saveFileMeta(file.fullName, {
                folderId: null,
                description: file.description || ''
            });
            file.folderId = null;
        }

        await this.deleteFolderFromFirebase(folder.id);

        if (this.currentFolderId === folder.id) {
            this.applyFolderFilter('home');
        } else {
            this.renderFolders();
            this.renderFiles();
        }

        this.showNotification(`Folder "${folder.name}" deleted${affected.length ? ` (${affected.length} file${affected.length !== 1 ? 's' : ''} moved to Home)` : ''}`);
        this.closeFolderModal();
    }

    // ========== MOVE TO FOLDER ==========
    openMoveToFolderPanel() {
        if (!this.currentFileId) return;
        const file = this.files.find(f => f.id === this.currentFileId);
        if (!file) return;

        const panel = document.getElementById('moveToFolderPanel');
        const list = document.getElementById('folderPickerList');
        const nameEl = document.getElementById('moveFileName');
        if (!panel || !list) return;

        if (nameEl) nameEl.textContent = file.fullName;

        this.renderFolderPickerInto(list, file.folderId, async (targetFolderId) => {
            await this.moveFileToFolder(file.id, targetFolderId);
            panel.style.display = 'none';
        });

        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Renders the folder picker list into any container.
     * @param {HTMLElement} container
     * @param {string|null} currentFolderId  - highlight this as selected (null = Home)
     * @param {(targetFolderId: string|null) => void} onPick
     */
    renderFolderPickerInto(container, currentFolderId, onPick) {
        if (!container) return;

        const customFolders = this.folders.filter(f => !f.isSystemFolder);
        const isHome = !currentFolderId;

        let html = `
            <div class="folder-picker-item ${isHome ? 'selected' : ''}" data-folder-id="__home__">
                <i class="fas fa-home" style="color:#3b82f6;"></i>
                <span>Home (no folder)</span>
                ${isHome ? '<i class="fas fa-check" style="margin-left:auto;color:#10b981;"></i>' : ''}
            </div>
        `;

        customFolders.forEach(folder => {
            const selected = currentFolderId === folder.id;
            html += `
                <div class="folder-picker-item ${selected ? 'selected' : ''}" data-folder-id="${folder.id}">
                    <i class="${folder.icon}" style="color:${folder.color};"></i>
                    <span>${this.escapeHtml(folder.name)}</span>
                    ${selected ? '<i class="fas fa-check" style="margin-left:auto;color:#10b981;"></i>' : ''}
                </div>
            `;
        });

        if (customFolders.length === 0) {
            html += `<p style="font-size:0.75rem;opacity:0.6;padding:8px 4px;">No custom folders yet.</p>`;
        }

        container.innerHTML = html;

        container.querySelectorAll('.folder-picker-item').forEach(item => {
            item.onclick = () => {
                const rawId = item.dataset.folderId;
                const targetFolderId = rawId === '__home__' ? null : rawId;
                onPick(targetFolderId);
            };
        });
    }

    async moveFileToFolder(fileId, targetFolderId) {
        const file = this.files.find(f => f.id === fileId);
        if (!file) return;

        if ((file.folderId || null) === (targetFolderId || null)) {
            this.showNotification('File is already in that folder', 'info');
            return;
        }

        await this.saveFileMeta(file.fullName, {
            folderId: targetFolderId,
            description: file.description || ''
        });

        file.folderId = targetFolderId;
        file.lastModified = Date.now();

        this.renderFolders();
        this.renderFiles();

        const targetFolder = targetFolderId ? this.getFolderById(targetFolderId) : null;
        if (targetFolder) {
            this.showNotification(`Moved "${file.name}" to "${targetFolder.name}"`);
        } else {
            this.showNotification(`Moved "${file.name}" to Home`);
        }
    }

    async moveFilesToFolder(fileIds, targetFolderId) {
        if (!fileIds || fileIds.length === 0) return;

        let moved = 0;
        for (const id of fileIds) {
            const file = this.files.find(f => f.id === id);
            if (!file) continue;
            if ((file.folderId || null) === (targetFolderId || null)) continue;

            await this.saveFileMeta(file.fullName, {
                folderId: targetFolderId,
                description: file.description || ''
            });

            file.folderId = targetFolderId;
            file.lastModified = Date.now();
            moved++;
        }

        this.renderFolders();
        this.renderFiles();

        const targetFolder = targetFolderId ? this.getFolderById(targetFolderId) : null;
        const targetName = targetFolder ? targetFolder.name : 'Home';
        this.showNotification(`Moved ${moved} file${moved !== 1 ? 's' : ''} to "${targetName}"`);
    }

    // ========== FILE VIEW ==========
    async viewFile(id) {
        const file = this.files.find(f => f.id === id);
        if (!file) { this.showNotification('File not found', 'error'); return; }

        this.currentFileId = id;
        this.revokeAllUrls();

        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('fileDeletePanel').style.display = 'none';
        document.getElementById('moveToFolderPanel').style.display = 'none';

        const section = document.getElementById('fileViewSection');
        section.style.display = 'block';

        document.getElementById('fileViewName').textContent = file.fullName;
        document.getElementById('fileViewDate').textContent = file.date || 'No date';
        document.getElementById('fileViewSize').textContent = file.size || 'Unknown';

        const iconEl = document.getElementById('fileViewIcon');
        iconEl.className = 'fas ' + (file.icon ? 'fa-' + file.icon.replace(/_/g, '-') : 'fa-file');
        iconEl.style.color = file.color || '#6b7280';

        const isImage = file.category === 'image';
        document.getElementById('zoomInImageBtn').style.display = isImage ? 'flex' : 'none';
        document.getElementById('zoomOutImageBtn').style.display = isImage ? 'flex' : 'none';
        document.getElementById('zoomResetImageBtn').style.display = isImage ? 'flex' : 'none';

        const descInput = document.getElementById('fileDescriptionInput');
        descInput.value = file.description || '';
        document.getElementById('descriptionCharCount').textContent = `${(file.description || '').length}/100`;

        section.scrollIntoView({ behavior: 'smooth', block: 'start' });

        const container = document.getElementById('filePreviewContainer');
        container.innerHTML = `<div style="padding:40px;text-align:center;opacity:0.6;">
            <div class="spinner" style="width:32px;height:32px;border:3px solid rgba(59,130,246,0.2);border-top-color:#2878ff;border-radius:50%;animation:spin 0.8s linear infinite;margin:auto;"></div>
            <p style="margin-top:12px;">Loading preview...</p>
        </div>`;

        try {
            const blob = await this.downloadFile(file);
            const url = this.trackUrl(URL.createObjectURL(blob));
            this.renderPreview(container, file, url, blob);
            if (isImage) setTimeout(() => this.setupImageZoom(), 200);
        } catch (e) {
            console.error('[FileLibrary] Preview failed:', e);
            container.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">
                Preview failed: ${this.escapeHtml(e.message || String(e))}
            </div>`;
        }
    }

    renderPreview(container, file, url, blob) {
        const cat = file.category;
        const mime = file.mimeType || '';
        const iconClass = file.icon ? 'fa-' + file.icon.replace(/_/g, '-') : 'fa-file';
        const color = file.color || '#6b7280';

        let html = '';

        if (cat === 'image') {
            html = `
                <div class="file-preview-image" style="display:flex;align-items:center;justify-content:center;min-height:300px;background:transparent;border-radius:10px;overflow:hidden;">
                    <img src="${url}" alt="${this.escapeHtml(file.name)}"
                         class="preview-image-full" id="previewZoomableImage"
                         style="max-width:100%;max-height:70vh;transition:transform 0.15s;transform-origin:center;">
                </div>`;
        } else if (cat === 'video') {
            html = `
                <div class="file-preview-video" style="padding:20px;text-align:center;">
                    <div style="
                        max-width:900px;
                        margin:0 auto;
                        border-radius:12px;
                        overflow:hidden;
                        background:rgba(0,0,0,0.3);
                        border:1px solid rgba(255,255,255,0.08);
                    ">
                        <video src="${url}" controls preload="metadata"
                            playsinline
                            style="
                                display:block;
                                width:100%;
                                max-height:70vh;
                                background:#000;
                                outline:none;
                            "></video>
                    </div>
                    <div style="
                        margin-top:12px;
                        font-size:0.85rem;
                        opacity:0.7;
                        word-break:break-word;
                    ">
                        ${this.escapeHtml(file.fullName)} • ${this.escapeHtml(file.size)}
                    </div>
                </div>`;
        } else if (cat === 'audio') {
            html = `
                <div class="file-preview-audio" style="padding:30px 20px;text-align:center;">
                    <div style="
                        width:100px;height:100px;margin:0 auto 16px;
                        border-radius:50%;
                        background:${color}20;
                        border:2px solid ${color};
                        display:flex;align-items:center;justify-content:center;
                    ">
                        <i class="fas fa-music" style="font-size:44px;color:${color};"></i>
                    </div>
                    <div style="font-weight:500;font-size:1rem;word-break:break-word;margin-bottom:20px;">
                        ${this.escapeHtml(file.fullName)}
                    </div>

                    <audio src="${url}" controls preload="metadata" style="
                        width:100%;
                        max-width:520px;
                        height:40px;
                        border-radius:10px;
                        background:rgba(255,255,255,0.04);
                        outline:none;
                    "></audio>
                </div>`;
        } else if (mime === 'application/pdf') {
            html = `
                <div style="padding:40px;text-align:center;">
                    <i class="fas ${iconClass}" style="font-size:64px;color:${color};"></i>
                    <div style="margin-top:16px;font-weight:500;">${this.escapeHtml(file.fullName)}</div>
                    <div style="margin-top:8px;opacity:0.6;font-size:0.85rem;">${file.size} • ${file.date}</div>
                </div>`;
        } else if (cat === 'text') {
            blob.text().then(txt => {
                const el = container.querySelector('.text-preview');
                if (el) el.textContent = txt;
            });
            html = `
                <div class="file-preview-text" style="text-align:left;">
                    <pre class="text-preview" style="
                        max-height:60vh;
                        overflow:auto;
                        background:transparent;
                        padding:15px;
                        border-radius:8px;
                        font-family:monospace;
                        font-size:13px;
                        white-space:pre-wrap;
                        text-align:left;
                        margin:0;
                    "></pre>
                </div>`;
        } else if (cat === 'document' || cat === 'archive' || cat === 'unknown') {
            html = `
                <div style="padding:40px;text-align:center;">
                    <i class="fas ${iconClass}" style="font-size:64px;color:${color};"></i>
                    <div style="margin-top:16px;font-weight:500;">${this.escapeHtml(file.fullName)}</div>
                    <div style="margin-top:8px;opacity:0.6;font-size:0.85rem;">${file.size} • ${file.date}</div>
                </div>`;
        } else {
            html = `<div style="padding:40px;text-align:center;">Unsupported preview</div>`;
        }

        container.innerHTML = html;
    }

    setupImageZoom() {
        const img = document.getElementById('previewZoomableImage');
        if (!img) return;

        let scale = 1;
        const MIN = 0.5, MAX = 5, STEP = 0.25;

        const apply = () => {
            img.style.transform = `scale(${scale})`;
            img.style.cursor = scale > 1 ? 'zoom-out' : 'zoom-in';
        };

        document.getElementById('zoomInImageBtn').onclick = () => { if (scale < MAX) { scale += STEP; apply(); } };
        document.getElementById('zoomOutImageBtn').onclick = () => { if (scale > MIN) { scale -= STEP; apply(); } };
        document.getElementById('zoomResetImageBtn').onclick = () => { scale = 1; apply(); };

        img.onwheel = (e) => {
            e.preventDefault();
            if (e.deltaY < 0 && scale < MAX) { scale += STEP; apply(); }
            else if (e.deltaY > 0 && scale > MIN) { scale -= STEP; apply(); }
        };
        img.ondblclick = () => { scale = 1; apply(); };
    }

    closeFileView() {
        document.getElementById('fileViewSection').style.display = 'none';
        document.getElementById('fileDeletePanel').style.display = 'none';
        document.getElementById('moveToFolderPanel').style.display = 'none';
        this.revokeAllUrls();
        this.currentFileId = null;
    }

    async confirmDeleteCurrent() {
        if (!this.currentFileId) return;
        const file = this.files.find(f => f.id === this.currentFileId);
        if (!file) return;

        const btn = document.getElementById('confirmFileDeleteBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

        try {
            await this.deleteFile(file);
            await this.deleteFileMeta(file.fullName);
            this.files = this.files.filter(f => f.id !== file.id);

            this.closeFileView();
            this.renderFolders();
            this.renderFiles();
            this.showNotification(`"${file.name}" deleted from xDrive`);
        } catch (e) {
            console.error(e);
            this.showNotification('Delete failed: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
        }
    }

    async downloadCurrent() {
        if (!this.currentFileId) return;
        const file = this.files.find(f => f.id === this.currentFileId);
        if (!file) return;

        this.showNotification('Downloading ' + file.fullName + '...', 'info');
        try {
            const blob = await this.downloadFile(file);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.fullName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            this.showNotification('Download complete');
        } catch (e) {
            console.error(e);
            this.showNotification('Download failed: ' + e.message, 'error');
        }
    }

    shareCurrent() {
        if (!this.currentFileId) return;
        const file = this.files.find(f => f.id === this.currentFileId);
        if (!file) return;

        this.closeFileView();

        if (window.shareModule && typeof window.shareModule.prepareShareWithFile === 'function') {
            window.shareModule.prepareShareWithFile(file);
        }
        if (window.xDrive && window.xDrive.navigateToModule) {
            window.xDrive.navigateToModule('share');
        } else {
            const item = document.querySelector('.navbar-menu .menu-item[data-page="share"]');
            if (item) item.click();
        }
        this.showNotification('Opening share with selected file...', 'info');
    }

    async updateFileDescription(id, description) {
        const file = this.files.find(f => f.id === id);
        if (!file) return;
        file.description = description;
        await this.saveFileMeta(file.fullName, {
            folderId: file.folderId || null,
            description: description
        });
    }

    // ========== FILES GRID ==========
    renderFiles() {
        const grid = document.getElementById('filesGrid');
        const empty = document.getElementById('emptyState');
        const badge = document.getElementById('fileCountBadge');
        if (!grid || !empty || !badge) return;

        badge.querySelector('span').textContent = this.files.length;

        const filtered = this.getFilteredFiles();
        if (filtered.length === 0) {
            // Render "Add File" tile in a proper grid so it sits at the first position
            grid.innerHTML = `
                <div class="date-group-files">
                    <div class="add-more-tile add-file-tile" id="addFileTileEmpty">
                        <div class="preview-thumbnail">
                            <div class="preview-icon-container">
                                <i class="fas fa-plus"></i>
                            </div>
                        </div>
                        <div class="preview-info">
                            <span class="preview-name">Add File...</span>
                            <div class="preview-meta">
                                <span class="preview-size">Upload new file</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            empty.style.display = 'block';
            this._sorted = [];

            const folder = this.getFolderById(this.currentFolderId);
            const titleEl = document.getElementById('emptyStateTitle');
            const msgEl = document.getElementById('emptyStateMessage');

            if (!folder || folder.id === 'home') {
                titleEl.textContent = 'No files yet';
                msgEl.textContent = 'Upload your first file to xDrive';
            } else {
                titleEl.textContent = `"${folder.name}" is empty`;
                msgEl.textContent = 'Upload files while this folder is selected, or move files into it';
            }

            // Attach handler for empty-state add tile
            const emptyAddTile = document.getElementById('addFileTileEmpty');
            if (emptyAddTile) {
                emptyAddTile.onclick = () => {
                    const input = document.getElementById('fileInput');
                    if (input) {
                        input.value = '';
                        input.click();
                    }
                };
            }
            return;
        }

        empty.style.display = 'none';

        const sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        this._sorted = sorted;

                const grouped = this.groupFilesByDate(sorted);

        let html = '';
        Object.keys(grouped).forEach(dateKey => {
            const groupFiles = grouped[dateKey];
            const isCollapsed = this.collapsedGroups.has(dateKey);

            html += `
                <div class="date-group-header" data-date-key="${this.escapeHtml(dateKey)}">
                    <h3 class="date-group-title">
                        <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}"></i>
                        ${this.escapeHtml(dateKey)}
                    </h3>
                    <span class="date-group-count">${groupFiles.length} file${groupFiles.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="date-group-files" ${isCollapsed ? 'style="display:none;"' : ''}>
            `;

            groupFiles.forEach((file, fileIdx) => {
                const idx = sorted.indexOf(file);

                // Insert "Add File" tile as the FIRST item in the first group
                const isFirstGroup = dateKey === Object.keys(grouped)[0];
                if (isFirstGroup && fileIdx === 0) {
                    html += `
                        <div class="add-more-tile add-file-tile" id="addFileTile">
                            <div class="preview-thumbnail">
                                <div class="preview-icon-container">
                                    <i class="fas fa-plus"></i>
                                </div>
                            </div>
                            <div class="preview-info">
                                <span class="preview-name">Add File...</span>
                                <div class="preview-meta">
                                    <span class="preview-size">Upload new file</span>
                                </div>
                            </div>
                        </div>
                    `;
                }

                html += `
                    <div class="file-card" data-index="${idx}">
                        <div class="file-thumbnail">
                            <div class="file-icon-container"
                                 style="background:${file.color}20;border-color:${file.color};width:48px;height:48px;border-radius:10px;display:flex;align-items:center;justify-content:center;">
                                <i class="fas fa-${file.icon || 'file'}"
                                   style="color:${file.color};font-size:22px;"></i>
                            </div>
                            <div class="file-overlay">
                                <span class="file-extension-badge">${this.escapeHtml(file.extension || '')}</span>
                            </div>
                        </div>
                        <div class="file-info">
                            <div class="file-name" title="${this.escapeHtml(file.fullName)}">
                                ${this.escapeHtml(file.name)}<span class="file-ext">.${this.escapeHtml(file.extension)}</span>
                            </div>
                            <div class="file-meta">
                                <span class="file-size">${this.escapeHtml(file.size)}</span>
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
        });

        grid.innerHTML = html;

        grid.querySelectorAll('.file-card').forEach(card => {
            card.onclick = () => {
                const idx = parseInt(card.dataset.index, 10);
                const record = sorted[idx];
                if (record) this.viewFile(record.id);
            };
        });

        grid.querySelectorAll('.date-group-header').forEach(header => {
            header.onclick = () => {
                const key = header.dataset.dateKey;
                if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
                else this.collapsedGroups.add(key);
                this.renderFiles();
            };
        });

        // Attach "Add File" tile handler
        const addFileTile = document.getElementById('addFileTile');
        if (addFileTile) {
            addFileTile.onclick = () => {
                const input = document.getElementById('fileInput');
                if (input) {
                    input.value = '';
                    input.click();
                }
            };
        }
    }

    // ========== UPLOAD FLOW ==========
    handleFileSelect(e) {
        const list = Array.from(e.target.files || []);
        if (list.length === 0) return;

        if (list.length > this.uploadLimits.maxFilesPerUpload) {
            this.showNotification('Max ' + this.uploadLimits.maxFilesPerUpload + ' files at once', 'error');
            return;
        }

        const oversize = list.filter(f => f.size / (1024 * 1024) > this.uploadLimits.maxFileSizeMB);
        if (oversize.length) {
            this.showNotification(
                'Too large (max ' + this.uploadLimits.maxFileSizeMB + 'MB): ' + 
                oversize.map(f => f.name).join(', '), 
                'error'
            );
            return;
        }

        const totalIncoming = list.reduce((s, f) => s + f.size, 0);
        if (!this.hasRoomFor(totalIncoming)) {
            const remaining = this.storageLimitBytes - this.getUserUsageBytes();
            this.showNotification(
                `Storage full. ${this.formatBytes(remaining)} left of 1GB. Delete some files first.`,
                'error'
            );
            return;
        }

        this.selectedFiles = list;
        this.updateUploadTargetLabel();
        document.getElementById('uploadSection').style.display = 'block';
        document.getElementById('startUploadBtn').style.display = 'inline-flex';
        this.showPreview(list);
    }

    showPreview(files) {
        const grid = document.getElementById('filePreviewGrid');
        const wrap = document.getElementById('filePreview');
        if (!grid || !wrap) return;

        wrap.style.display = 'block';

        // Build preview items
        let html = files.map((f, idx) => {
            const ext = this.getExtension(f.name);
            const mime = f.type || this.getMimeFromExtension(ext);
            const category = this.getCategory(mime);
            const icon = this.fileIcons[category] || 'file';
            const color = this.fileColors[category] || '#6b7280';
            const isImage = category === 'image';

            // Use object URL for image previews
            let thumbHtml = '';
            if (isImage) {
                const url = this.trackUrl(URL.createObjectURL(f));
                thumbHtml = `<img src="${url}" alt="${this.escapeHtml(f.name)}">`;
            }

            return `
                <div class="file-preview-item" data-idx="${idx}">
                    <button class="preview-remove" data-idx="${idx}" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                    <div class="preview-thumbnail">
                        ${thumbHtml || `
                            <div class="preview-icon-container"
                                style="background:${color}20;border-color:${color};">
                                <i class="fas fa-${icon}" style="color:${color};"></i>
                            </div>
                        `}
                        <div class="preview-overlay">
                            <span class="preview-extension-badge">${this.escapeHtml(ext || '?')}</span>
                        </div>
                    </div>
                    <div class="preview-info">
                        <span class="preview-name" title="${this.escapeHtml(f.name)}">
                            ${this.escapeHtml(f.name)}
                        </span>
                        <div class="preview-meta">
                            <span class="preview-size">${this.formatBytes(f.size)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Add "more" tile if under limit
        if (files.length < this.uploadLimits.maxFilesPerUpload) {
            const remaining = this.uploadLimits.maxFilesPerUpload - files.length;
            html += `
                <div class="add-more-tile" id="addMoreTile">
                    <div class="preview-thumbnail">
                        <div class="preview-icon-container">
                            <i class="fas fa-plus"></i>
                        </div>
                    </div>
                    <div class="preview-info">
                        <span class="preview-name">Add more...</span>
                        <div class="preview-meta">
                            <span class="preview-size">${remaining} slot${remaining !== 1 ? 's' : ''} left</span>
                        </div>
                    </div>
                </div>
            `;
        }

        grid.innerHTML = html;

        // Update title + count
        const infoEl = document.getElementById('fileSelectionInfo');
        if (infoEl) {
            infoEl.textContent = `${files.length} / ${this.uploadLimits.maxFilesPerUpload}`;
        }

        // Attach remove handlers
        grid.querySelectorAll('.preview-remove').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx, 10);
                this.removeSelectedFile(idx);
            };
        });

        // Attach "add more" handler
        const addMoreTile = document.getElementById('addMoreTile');
        if (addMoreTile) {
            addMoreTile.onclick = () => this.openAddMorePicker();
        }
    }

    removeSelectedFile(idx) {
        if (!this.selectedFiles) return;
        this.selectedFiles.splice(idx, 1);

        // Revoke only the removed image's URL (we rebuild all on re-render anyway)
        this.revokeAllUrls();

        if (this.selectedFiles.length === 0) {
            this.resetUpload();
            return;
        }

        this.showPreview(this.selectedFiles);
    }

    clearAllSelectedFiles() {
        this.revokeAllUrls();
        this.resetUpload();
    }

    openAddMorePicker() {
        const input = document.getElementById('fileInputMore');
        if (!input) return;
        input.value = '';
        input.click();
    }

    handleAddMoreFiles(e) {
        const list = Array.from(e.target.files || []);
        if (list.length === 0) return;

        const currentCount = this.selectedFiles ? this.selectedFiles.length : 0;
        const remaining = this.uploadLimits.maxFilesPerUpload - currentCount;

        if (remaining <= 0) {
            this.showNotification(
                `Maximum ${this.uploadLimits.maxFilesPerUpload} files already selected`, 
                'error'
            );
            return;
        }

        const toAdd = list.slice(0, remaining);
        if (list.length > remaining) {
            this.showNotification(
                `Only added ${remaining} file${remaining !== 1 ? 's' : ''} (limit reached)`, 
                'info'
            );
        }

        // Filter oversized
        const valid = [];
        const oversized = [];
        toAdd.forEach(f => {
            if (f.size / (1024 * 1024) > this.uploadLimits.maxFileSizeMB) {
                oversized.push(f.name);
            } else {
                valid.push(f);
            }
        });

        if (oversized.length) {
            this.showNotification(
                `Too large (max ${this.uploadLimits.maxFileSizeMB}MB): ${oversized.join(', ')}`,
                'error'
            );
        }

        if (valid.length === 0) return;

        this.selectedFiles = [...(this.selectedFiles || []), ...valid];
        this.showPreview(this.selectedFiles);
    }

    async handleUpload() {
        if (!this.selectedFiles || this.selectedFiles.length === 0) return;

        const startBtn = document.getElementById('startUploadBtn');
        const progress = document.getElementById('uploadProgress');
        const fill = document.getElementById('progressFill');
        const text = document.getElementById('progressText');
        const pct = document.getElementById('progressPercent');

        // Snapshot target folder so it stays consistent across the upload loop
        const targetFolderId = this.getUploadTargetFolderId();

        startBtn.style.display = 'none';
        progress.style.display = 'block';

        let success = 0;
        for (let i = 0; i < this.selectedFiles.length; i++) {
            const f = this.selectedFiles[i];
            text.textContent = `Uploading ${f.name} (${i + 1}/${this.selectedFiles.length})`;
            fill.style.width = '0%';
            pct.textContent = '0%';

            if (!this.hasRoomFor(f.size)) {
                text.textContent = `Skipped ${f.name} — 1GB limit reached`;
                continue;
            }

            try {
                const nodeId = await this.uploadFile(f, (p) => {
                    fill.style.width = p + '%';
                    pct.textContent = p + '%';
                });
                success++;

                await this.saveFileMeta(f.name, {
                    folderId: targetFolderId,
                    description: ''
                });

                const mime = f.type || '';
                const category = this.getCategory(mime);
                const record = {
                    id: nodeId || ('pending_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)),
                    nodeId: nodeId || null,
                    userId: this.currentUserId,
                    name: f.name.replace(/\.[^/.]+$/, ''),
                    fullName: f.name,
                    extension: this.getExtension(f.name),
                    size: this.formatBytes(f.size),
                    fileSizeMB: f.size / (1024 * 1024),
                    mimeType: mime,
                    category: category,
                    icon: this.fileIcons[category],
                    color: this.fileColors[category],
                    date: new Date().toISOString().split('T')[0],
                    timestamp: Math.floor(Date.now() / 1000),
                    description: '',
                    folderId: targetFolderId,
                    lastModified: Date.now()
                };
                this.files.push(record);
                // Hydrate the MEGA node reference so preview/download work immediately
                const node = await this.findMegaNodeByName(f.name);
                if (node) {
                    record.megaNode = node;
                    if (!record.nodeId) record.nodeId = node.nodeId;
                }
            } catch (err) {
                console.error('[FileLibrary] Upload error:', err);
                text.textContent = 'Failed: ' + f.name + ' — ' + err.message;
            }
        }

        text.textContent = `Uploaded ${success} of ${this.selectedFiles.length}`;
        fill.style.width = '100%';
        pct.textContent = '100%';
        this.showNotification(`Uploaded ${success} file(s)`);

        setTimeout(async () => {
            this.resetUpload();
        }, 1200);
    }

    async findMegaNodeByName(fullName) {
        if (!this.megaFolder) await this.setupUserFolder();
        
        // Refresh children if stale
        if (!this.megaFolder.children || this.megaFolder.children.length === 0) {
            await new Promise((resolve) => {
                const t = setTimeout(resolve, 2000);
                this.megaFolder.once('update', () => { clearTimeout(t); resolve(); });
            });
        }
        
        const node = (this.megaFolder.children || []).find(
            c => !c.directory && c.name === fullName
        );
        return node || null;
    }
    // Helper since we don't have $ in scope here
    // Replace with document.getElementById directly:
    resetUpload() {
        this.selectedFiles = null;

        const input = document.getElementById('fileInput');
        if (input) input.value = '';

        const moreInput = document.getElementById('fileInputMore');
        if (moreInput) moreInput.value = '';

        const preview = document.getElementById('filePreview');
        if (preview) preview.style.display = 'none';

        const progress = document.getElementById('uploadProgress');
        if (progress) progress.style.display = 'none';

        const startBtn = document.getElementById('startUploadBtn');
        if (startBtn) startBtn.style.display = 'none';

        const section = document.getElementById('uploadSection');
        if (section) section.style.display = 'none';

        this.revokeAllUrls();
    }

    getUserUsageBytes() {
        return this.files.reduce((sum, f) => sum + (f.fileSizeMB || 0) * 1024 * 1024, 0);
    }

    hasRoomFor(bytes) {
        return (this.getUserUsageBytes() + bytes) <= this.storageLimitBytes;
    }
}

// ============================================================
// GLOBAL INIT
// ============================================================
let fileLibraryModule;

function initFileLibraryModule() {
    if (fileLibraryModule) return;
    fileLibraryModule = new FileLibraryModule();
    window.fileLibraryModule = fileLibraryModule;
    console.log('[FileLibrary] Module exposed as window.fileLibraryModule');
}

if (window.mega && window.mega.Storage) {
    initFileLibraryModule();
} else {
    window.addEventListener('megaReady', initFileLibraryModule, { once: true });
    document.addEventListener('DOMContentLoaded', () => {
        if (!fileLibraryModule) setTimeout(initFileLibraryModule, 500);
    });
}