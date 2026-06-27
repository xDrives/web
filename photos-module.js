// Photos Module - Firebase Primary Storage with IndexedDB Cache
class PhotosModule {
    constructor() {
        this.storageKey = 'photos-module-data';
        this.dbName = 'PhotosDatabase';
        this.dbVersion = 2; // Increment version for schema change
        this.db = null;
        this.selectedFiles = null;
        this.currentFilter = 'home';
        this.photos = []; // Local cache of photos
        this.albums = []; // Local cache of albums
        this.blurEnabled = true;
        this.editingAlbumId = null;
        this.itemToDelete = null;
        this.currentPhotoId = null;
        
        // Firebase sync tracking
        this.syncInProgress = false;
        this.lastSyncTime = null;
        this.isInitialized = false;
        this.pendingOperations = new Map(); // Track pending operations
        
        // Listeners for real-time updates
        this.firebaseListeners = {};
        
        this.selectedPhotos = new Set();
        this.batchMode = false;
        
        // Compression settings (for uploads only, not for storage)
        this.compressionConfig = {
            maxSizeMB: 1,
            targetSizeKB: 475,
            maxWidth: 1600,
            quality: 0.8,
            minQuality: 0.5
        };
        
        // Upload limits
        this.uploadLimits = {
            maxFilesPerUpload: 5,
            maxFileSizeMB: 20,
            maxTotalPhotos: 100
        };
        
        this.init();
    }
 
    // ========== INITIALIZATION & SETUP ==========
    async init() {
        console.log('Photos Module initializing with Firebase primary storage');
        await this.initIndexedDB();
        await this.loadFromIndexedDB();
        await this.initFirebaseSync();
        this.isInitialized = true;
    }

    // Initialize IndexedDB for local cache
    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB initialized successfully');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object stores with updated schema
                if (!db.objectStoreNames.contains('photos')) {
                    const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
                    photoStore.createIndex('date', 'date', { unique: false });
                    photoStore.createIndex('isFavorite', 'isFavorite', { unique: false });
                    photoStore.createIndex('lastModified', 'lastModified', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('albums')) {
                    const albumStore = db.createObjectStore('albums', { keyPath: 'id' });
                    albumStore.createIndex('isSystemAlbum', 'isSystemAlbum', { unique: false });
                    albumStore.createIndex('lastModified', 'lastModified', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('syncMetadata')) {
                    db.createObjectStore('syncMetadata', { keyPath: 'key' });
                }
                
                console.log('IndexedDB schema created');
            };
        });
    }

    // Initialize Firebase sync with real-time listeners
    async initFirebaseSync() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Firebase sync not available - user not authenticated');
            return;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser.phone);
            if (!encodedPhone) return;

            console.log('Setting up Firebase real-time listeners...');

            // Listen for photos changes
            const photosRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/photos`);
            this.setupFirebaseListener('photos', photosRef);

            // Listen for albums changes
            const albumsRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/albums`);
            this.setupFirebaseListener('albums', albumsRef);

            // Load initial data from Firebase
            await this.loadFromFirebase();

        } catch (error) {
            console.error('Error initializing Firebase sync:', error);
        }
    }

    // Setup Firebase real-time listener for a specific path
    setupFirebaseListener(type, ref) {
        // Remove existing listener
        if (this.firebaseListeners[type]) {
            if (this.firebaseListeners[type].added) ref.off('child_added', this.firebaseListeners[type].added);
            if (this.firebaseListeners[type].changed) ref.off('child_changed', this.firebaseListeners[type].changed);
            if (this.firebaseListeners[type].removed) ref.off('child_removed', this.firebaseListeners[type].removed);
        }

        const listeners = {
            added: (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this.handleFirebaseAdd(type, data);
                }
            },
            changed: (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this.handleFirebaseUpdate(type, data);
                }
            },
            removed: (snapshot) => {
                const id = snapshot.key;
                this.handleFirebaseDelete(type, id);
            }
        };

        ref.on('child_added', listeners.added);
        ref.on('child_changed', listeners.changed);
        ref.on('child_removed', listeners.removed);

        this.firebaseListeners[type] = listeners;
    }

    // Load from IndexedDB cache
    async loadFromIndexedDB() {
        try {
            // Load photos from cache (keep as empty array if none)
            const cachedPhotos = await this.getAllFromIndexedDB('photos');
            this.photos = cachedPhotos || [];
            
            // Load albums from cache
            const cachedAlbums = await this.getAllFromIndexedDB('albums');
            const systemAlbums = this.getDefaultAlbums(); // Keep system albums
            
            // Merge albums
            const albumMap = new Map();
            systemAlbums.forEach(album => {
                albumMap.set(album.id, { ...album, isSystemAlbum: true });
            });
            
            cachedAlbums.forEach(album => {
                if (!album.isSystemAlbum) {
                    albumMap.set(album.id, album);
                }
            });
            
            this.albums = Array.from(albumMap.values());
            
            // Update counts for system albums
            this.updateSystemAlbumCounts();
            
            console.log('Data loaded from IndexedDB cache');
            
        } catch (error) {
            console.error('Error loading from IndexedDB:', error);
            this.photos = [];
            this.albums = this.getDefaultAlbums();
        }
    }

    // Load from Firebase (initial load)
    async loadFromFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Cannot load from Firebase - user not authenticated');
            return;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser.phone);
            if (!encodedPhone) return;

            console.log('Loading data from Firebase...');

            // Load photos
            const photosRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/photos`);
            const photosSnapshot = await photosRef.once('value');
            const photosData = photosSnapshot.val();

            if (photosData) {
                const firebasePhotos = Object.values(photosData);
                this.photos = firebasePhotos;
                await this.saveAllToIndexedDB('photos', firebasePhotos);
            } else {
                this.photos = [];
            }

            // Load albums
            const albumsRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/albums`);
            const albumsSnapshot = await albumsRef.once('value');
            const albumsData = albumsSnapshot.val();

            const systemAlbums = this.getDefaultAlbums();
            const albumMap = new Map();
            
            systemAlbums.forEach(album => {
                albumMap.set(album.id, album);
            });

            if (albumsData) {
                const firebaseAlbums = Object.values(albumsData);
                firebaseAlbums.forEach(album => {
                    if (!album.isSystemAlbum) {
                        albumMap.set(album.id, album);
                    }
                });
            }

            this.albums = Array.from(albumMap.values());
            await this.saveAllToIndexedDB('albums', this.albums.filter(a => !a.isSystemAlbum));

            this.updateSystemAlbumCounts();
            this.renderPhotosGrid();
            this.renderAlbumsGrid();
        } catch (error) {
            console.error('Error loading from Firebase:', error);
        }
    }

    // ========== DATABASE OPERATIONS ==========
    // Save single item to IndexedDB
    async saveToIndexedDB(storeName, item) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Save multiple items to IndexedDB
    async saveAllToIndexedDB(storeName, items) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            items.forEach(item => {
                store.put(item);
            });
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);
        });
    }

    // Delete item from IndexedDB
    async deleteFromIndexedDB(storeName, id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Get item from IndexedDB
    async getFromIndexedDB(storeName, id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Get all items from IndexedDB
    async getAllFromIndexedDB(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // ========== FIREBASE SYNC ==========
    // Handle Firebase add event
    async handleFirebaseAdd(type, data) {
        if (this.pendingOperations.has(`${type}:${data.id}`)) {
            // This is our own operation, ignore
            this.pendingOperations.delete(`${type}:${data.id}`);
            return;
        }

        console.log(`Firebase ${type} added:`, data.id);

        if (type === 'photos') {
            // Check if photo already exists in cache
            const existingIndex = this.photos.findIndex(p => p.id === data.id);
            if (existingIndex === -1) {
                this.photos.push(data);
                await this.saveToIndexedDB('photos', data);
            }
        } else if (type === 'albums' && !data.isSystemAlbum) {
            const existingIndex = this.albums.findIndex(a => a.id === data.id);
            if (existingIndex === -1) {
                this.albums.push(data);
                await this.saveToIndexedDB('albums', data);
            }
        }

        this.updateSystemAlbumCounts();
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
    }

    // Handle Firebase update event
    async handleFirebaseUpdate(type, data) {
        if (this.pendingOperations.has(`${type}:${data.id}`)) {
            // This is our own operation, ignore
            this.pendingOperations.delete(`${type}:${data.id}`);
            return;
        }

        console.log(`Firebase ${type} updated:`, data.id);

        if (type === 'photos') {
            const index = this.photos.findIndex(p => p.id === data.id);
            if (index !== -1) {
                this.photos[index] = data;
                await this.saveToIndexedDB('photos', data);
            }
        } else if (type === 'albums') {
            const index = this.albums.findIndex(a => a.id === data.id);
            if (index !== -1) {
                this.albums[index] = data;
                await this.saveToIndexedDB('albums', data);
            }
        }

        this.updateSystemAlbumCounts();
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
    }

    // Handle Firebase delete event
    async handleFirebaseDelete(type, id) {
        if (this.pendingOperations.has(`${type}:${id}`)) {
            // This is our own operation, ignore
            this.pendingOperations.delete(`${type}:${id}`);
            return;
        }

        console.log(`Firebase ${type} deleted:`, id);

        if (type === 'photos') {
            this.photos = this.photos.filter(p => p.id !== id);
            await this.deleteFromIndexedDB('photos', id);
        } else if (type === 'albums') {
            this.albums = this.albums.filter(a => a.id !== id);
            await this.deleteFromIndexedDB('albums', id);
        }

        this.updateSystemAlbumCounts();
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
    }

    // Save photo to Firebase (primary operation)
    async savePhotoToFirebase(photo) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            this.showNotification('Please sign in to upload photos', 'error');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser.phone);
            if (!encodedPhone) return false;

            // Mark as pending operation
            this.pendingOperations.set(`photo:${photo.id}`, true);

            // Save to Firebase
            const photoRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/photos/${photo.id}`);
            await photoRef.set(photo);

            // Update local cache
            const existingIndex = this.photos.findIndex(p => p.id === photo.id);
            if (existingIndex !== -1) {
                this.photos[existingIndex] = photo;
            } else {
                this.photos.push(photo);
            }
            
            await this.saveToIndexedDB('photos', photo);
            
            console.log('Photo saved to Firebase:', photo.id);
            return true;

        } catch (error) {
            console.error('Error saving photo to Firebase:', error);
            this.showNotification('Error saving photo to cloud', 'error');
            return false;
        }
    }

    // Delete photo from Firebase
    async deletePhotoFromFirebase(photoId) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser.phone);
            if (!encodedPhone) return false;

            // Mark as pending operation
            this.pendingOperations.set(`photo:${photoId}`, true);

            // Delete from Firebase
            const photoRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/photos/${photoId}`);
            await photoRef.remove();

            // Delete from local cache
            this.photos = this.photos.filter(p => p.id !== photoId);
            await this.deleteFromIndexedDB('photos', photoId);

            console.log('Photo deleted from Firebase:', photoId);
            return true;

        } catch (error) {
            console.error('Error deleting photo from Firebase:', error);
            this.showNotification('Error deleting photo from cloud', 'error');
            return false;
        }
    }

    // Save album to Firebase
    async saveAlbumToFirebase(album) {
        if (!window.authModule || !window.authModule.isLoggedIn() || album.isSystemAlbum) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser.phone);
            if (!encodedPhone) return false;

            // Mark as pending operation
            this.pendingOperations.set(`album:${album.id}`, true);

            // Save to Firebase
            const albumRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/albums/${album.id}`);
            await albumRef.set(album);

            // Update local cache
            const existingIndex = this.albums.findIndex(a => a.id === album.id);
            if (existingIndex !== -1) {
                this.albums[existingIndex] = album;
            } else {
                this.albums.push(album);
            }
            
            await this.saveToIndexedDB('albums', album);

            console.log('Album saved to Firebase:', album.id);
            return true;

        } catch (error) {
            console.error('Error saving album to Firebase:', error);
            this.showNotification('Error saving album to cloud', 'error');
            return false;
        }
    }

    // Delete album from Firebase
    async deleteAlbumFromFirebase(albumId) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        const album = this.albums.find(a => a.id === albumId);
        if (album && album.isSystemAlbum) {
            this.showNotification('Cannot delete system albums', 'error');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser.phone);
            if (!encodedPhone) return false;

            // Mark as pending operation
            this.pendingOperations.set(`album:${albumId}`, true);

            // Delete from Firebase
            const albumRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/albums/${albumId}`);
            await albumRef.remove();

            // Delete from local cache
            this.albums = this.albums.filter(a => a.id !== albumId);
            await this.deleteFromIndexedDB('albums', albumId);

            console.log('Album deleted from Firebase:', albumId);
            return true;

        } catch (error) {
            console.error('Error deleting album from Firebase:', error);
            this.showNotification('Error deleting album from cloud', 'error');
            return false;
        }
    }


    // ========== FILE UPLOAD & PROCESSING ==========

    // Upload multiple photos
    async handleFileUpload() {
        if (!this.selectedFiles || this.selectedFiles.length === 0) {
            this.showNotification('Please select files to upload', 'warning');
            return;
        }

        if (!window.authModule || !window.authModule.isLoggedIn()) {
            this.showNotification('Please sign in to upload photos', 'error');
            this.closeUploadSection();
            return;
        }

        const uploadProgress = document.getElementById('uploadProgress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const progressPercent = document.getElementById('progressPercent');
        const startUploadBtn = document.getElementById('startUploadBtn');

        if (uploadProgress && progressFill) {
            uploadProgress.style.display = 'block';
            if (startUploadBtn) startUploadBtn.style.display = 'none';
            
            progressFill.style.width = '0%';
            progressPercent.textContent = '0%';
            progressText.textContent = 'Preparing files...';
            
            await this.completeUpload(this.selectedFiles);
        }
    }

    async completeUpload(files) {
        // Double-check total limit
        if (this.photos.length + files.length > this.uploadLimits.maxTotalPhotos) {
            const remaining = this.uploadLimits.maxTotalPhotos - this.photos.length;
            this.showNotification(
                `Upload failed. You can only upload ${remaining} more photos.`,
                'error'
            );
            this.closeUploadSection();
            return;
        }
        
        let processedCount = 0;
        let successCount = 0;
        const totalFiles = files.length;
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const progressPercent = document.getElementById('progressPercent');
        
        const updateOverallProgress = () => {
            const overallProgress = Math.round((processedCount / totalFiles) * 100);
            if (progressFill && progressPercent) {
                progressFill.style.width = `${overallProgress}%`;
                progressPercent.textContent = `${overallProgress}%`;
            }
        };
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            try {
                if (progressText) {
                    progressText.textContent = `Processing ${file.name} (${i + 1}/${totalFiles})...`;
                }
                
                const base64Data = await this.readFileAsBase64(file);
                const processedPhoto = await this.processPhotoForUpload(file, base64Data, progressText);
                
                const saved = await this.savePhotoToFirebase(processedPhoto);
                if (saved) {
                    successCount++;
                }
                
                processedCount++;
                updateOverallProgress();
                
            } catch (error) {
                console.error('Error processing file:', error);
                processedCount++;
                updateOverallProgress();
            }
        }
        
        if (progressText) {
            if (successCount === totalFiles) {
                progressText.textContent = 'Upload complete!';
            } else {
                progressText.textContent = `Uploaded ${successCount} of ${totalFiles} files`;
            }
        }
        
        this.updateSystemAlbumCounts();
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
        this.updatePhotoCountBadge();
        this.checkAndShowLimitWarning();
        
        if (successCount > 0) {
            this.showNotification(`Successfully uploaded ${successCount} photo(s)`);
        }
        
        setTimeout(() => {
            this.closeUploadSection();
        }, 1500);
    }

    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(file);
        });
    }

    async processPhotoForUpload(file, base64Data, progressText = null) {
        const photoId = this.generatePhotoId();
        const originalSize = this.getBase64Size(base64Data);
        let finalBase64 = base64Data;
        let compressed = false;

        // Compress if too large
        if (originalSize > this.compressionConfig.maxSizeMB * 1024 * 1024) {
            try {
                if (progressText) {
                    progressText.textContent = `Compressing ${file.name}...`;
                }
                finalBase64 = await this.compressToTargetSize(base64Data);
                compressed = true;
            } catch (error) {
                console.log('Compression failed:', error);
            }
        }

        return {
            id: photoId,
            name: file.name.replace(/\.[^/.]+$/, ""),
            url: finalBase64,
            size: this.formatFileSize(this.getBase64Size(finalBase64)),
            date: new Date().toISOString().split('T')[0],
            isFavorite: false,
            tags: ['uploaded'],
            uploadDate: new Date().toISOString(),
            originalSize: this.formatFileSize(file.size),
            compressed: compressed,
            description: '',
            lastModified: Date.now()
        };
    }

    // Compress image to target size
    async compressToTargetSize(base64Image, progressCallback = null, maxAttempts = 5) {
        return new Promise(async (resolve) => {
            if (!base64Image || !base64Image.startsWith('data:image')) {
                resolve(base64Image);
                return;
            }

            const targetSizeBytes = this.compressionConfig.targetSizeKB * 1024;
            const originalSize = this.getBase64Size(base64Image);
            
            if (originalSize <= targetSizeBytes) {
                if (progressCallback) progressCallback(100);
                resolve(base64Image);
                return;
            }

            let currentQuality = this.compressionConfig.quality;
            let compressedImage = base64Image;
            let attempts = 0;

            while (attempts < maxAttempts) {
                attempts++;
                
                if (progressCallback) {
                    progressCallback(Math.round((attempts / maxAttempts) * 80));
                }
                
                const currentSize = this.getBase64Size(compressedImage);
                const sizeRatio = targetSizeBytes / currentSize;
                
                currentQuality = Math.max(
                    this.compressionConfig.minQuality,
                    currentQuality * Math.pow(sizeRatio, 0.7)
                );

                compressedImage = await this.compressBase64Image(
                    base64Image, 
                    this.compressionConfig.maxWidth, 
                    currentQuality
                );

                const newSize = this.getBase64Size(compressedImage);
                
                if (Math.abs(newSize - targetSizeBytes) / targetSizeBytes < 0.1) {
                    if (progressCallback) progressCallback(100);
                    resolve(compressedImage);
                    return;
                }
                
                if (newSize > targetSizeBytes && currentQuality <= this.compressionConfig.minQuality + 0.05) {
                    if (progressCallback) progressCallback(100);
                    resolve(compressedImage);
                    return;
                }
            }

            if (progressCallback) progressCallback(100);
            resolve(compressedImage);
        });
    }

    // Compress base64 image
    async compressBase64Image(base64Image, maxWidth = 1600, quality = 0.8) {
        return new Promise((resolve) => {
            if (!base64Image || !base64Image.startsWith('data:image')) {
                resolve(base64Image);
                return;
            }

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                width = Math.round(width);
                height = Math.round(height);

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                let mimeType = 'image/jpeg';
                try {
                    if (canvas.toDataURL('image/webp').length > canvas.toDataURL('image/jpeg').length * 0.8) {
                        mimeType = 'image/webp';
                    }
                } catch (e) {}
                
                const compressedBase64 = canvas.toDataURL(mimeType, quality);
                resolve(compressedBase64);
            };
            
            img.onerror = () => {
                resolve(base64Image);
            };
            
            img.src = base64Image;
        });
    }

    // Helper method to calculate base64 size
    getBase64Size(base64String) {
        if (!base64String) return 0;
        const stringLength = base64String.length - (base64String.startsWith('data:image') ? 
            base64String.indexOf(',') + 1 : 0);
        return (stringLength * 3) / 4;
    }

    // Format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    generatePhotoId() {
        return 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    generateAlbumId() {
        return 'album_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }


    // ========== PHOTO OPERATIONS ==========

    // Toggle favorite
    async toggleFavorite(id) {
        const photo = this.photos.find(p => p.id === id);
        if (!photo) return;

        photo.isFavorite = !photo.isFavorite;
        photo.lastModified = Date.now();

        // Save to Firebase
        await this.savePhotoToFirebase(photo);

        // Update favorites album
        const favoritesAlbum = this.albums.find(a => a.name === 'Favorites');
        if (favoritesAlbum) {
            if (photo.isFavorite) {
                if (!favoritesAlbum.photos.includes(id)) {
                    favoritesAlbum.photos.push(id);
                }
            } else {
                favoritesAlbum.photos = favoritesAlbum.photos.filter(photoId => photoId !== id);
            }
        }

        this.renderPhotosGrid();
        this.renderAlbumsGrid();
    }

    // Update photo description
    async updatePhotoDescription(id, description) {
        const photo = this.photos.find(p => p.id === id);
        if (!photo) return;

        photo.description = description;
        photo.lastModified = Date.now();

        await this.savePhotoToFirebase(photo);
    }

// Replace the viewPhoto method with this updated version
// Updated viewPhoto method - shows inline like album management
viewPhoto(id) {
    const photo = this.photos.find(p => p.id === id);
    if (!photo) return;

    // Add description field if not exists
    if (!photo.description) {
        photo.description = '';
    }

    // Check if we're currently viewing a custom album
    const isInCustomAlbumView = this.currentFilter !== 'home' && 
                                this.currentFilter !== 'favorites' && 
                                this.currentFilter !== 'recent';
    
    // Check if the photo is in the current album
    let isInCurrentAlbum = false;
    if (isInCustomAlbumView) {
        const currentAlbum = this.albums.find(a => a.id.toString() === this.currentFilter.toString());
        isInCurrentAlbum = currentAlbum && currentAlbum.photos && currentAlbum.photos.includes(photo.id);
    }

    // Get custom albums for the inline selector
    const customAlbums = this.albums.filter(a => !a.isSystemAlbum);
    const albumsListHTML = customAlbums.map(album => {
        const isPhotoInAlbum = album.photos && album.photos.includes(photo.id);
        return `
            <div class="album-item ${isPhotoInAlbum ? 'already-in-album' : ''}" data-album-id="${album.id}" data-album-name="${album.name}" data-album-color="${album.color}" data-album-icon="${album.icon}" data-is-in-album="${isPhotoInAlbum}">
                <div class="album-icon" style="background: ${album.color}20; border-color: ${album.color}">
                    <i class="${album.icon}" style="color: ${album.color}"></i>
                </div>
                <div class="album-info">
                    <div class="album-name">${this.escapeHtml(album.name)}</div>
                    <div class="album-count">${album.photos ? album.photos.length : 0} photos</div>
                </div>
                ${isPhotoInAlbum ? '<div class="album-check"><i class="fas fa-check-circle"></i></div>' : '<div class="album-add"><i class="fas fa-plus-circle"></i></div>'}
            </div>
        `;
    }).join('');

    // Hide any other open sections
    const uploadSection = document.getElementById('uploadSection');
    const albumModal = document.getElementById('albumModal');
    if (uploadSection) uploadSection.style.display = 'none';
    if (albumModal) albumModal.style.display = 'none';
    
    // Show photo view section
    const photoViewSection = document.getElementById('photoViewSection');
    if (photoViewSection) {
        photoViewSection.style.display = 'block';
        
        // Fill in photo data
        document.getElementById('photoViewName').textContent = photo.name;
        document.getElementById('photoViewDate').textContent = photo.date;
        document.getElementById('photoViewSize').textContent = photo.size;
        document.getElementById('zoomablePhotoView').src = photo.url;
        document.getElementById('zoomablePhotoView').alt = photo.name;
        
        const descriptionInput = document.getElementById('photoDescriptionInput');
        descriptionInput.value = photo.description || '';
        document.getElementById('descriptionCharCount').textContent = `${(photo.description || '').length}/100`;
        
        const favoriteBadge = document.getElementById('favoriteBadgeView');
        if (photo.isFavorite) {
            favoriteBadge.style.display = 'inline-block';
        } else {
            favoriteBadge.style.display = 'none';
        }
        
        // Update action buttons
        const addToAlbumBtn = document.getElementById('addToAlbumViewBtn');
        const removeFromAlbumBtn = document.getElementById('removeFromAlbumViewBtn');
        
        if (isInCustomAlbumView && isInCurrentAlbum) {
            addToAlbumBtn.style.display = 'none';
            removeFromAlbumBtn.style.display = 'flex';
            removeFromAlbumBtn.setAttribute('data-id', photo.id);
        } else {
            addToAlbumBtn.style.display = 'flex';
            addToAlbumBtn.setAttribute('data-id', photo.id);
            removeFromAlbumBtn.style.display = 'none';
        }
        
        document.getElementById('deleteViewBtn').setAttribute('data-id', photo.id);
        
        // Update albums list
        const albumsListView = document.getElementById('albumsListView');
        if (albumsListView) {
            albumsListView.innerHTML = albumsListHTML || '<p class="no-albums-message">No custom albums available. Create a new album first.</p>';
        }
        
        // Scroll to view
        photoViewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    this.setupPhotoViewEventListeners(photo.id);
}

// New method to setup photo view event listeners
setupPhotoViewEventListeners(photoId) {
    const photo = this.photos.find(p => p.id === photoId);
    if (!photo) return;
    
    let currentScale = 1;
    const MIN_SCALE = 0.5;
    const MAX_SCALE = 5;
    const ZOOM_STEP = 0.25;
    
    const zoomablePhoto = document.getElementById('zoomablePhotoView');
    const updateScale = () => {
        if (zoomablePhoto) {
            zoomablePhoto.style.transform = `scale(${currentScale})`;
            zoomablePhoto.dataset.scale = currentScale;
        }
    };
    
    // Close button
    const closeBtn = document.getElementById('closePhotoViewBtn');
    const closeHandler = () => {
        const photoViewSection = document.getElementById('photoViewSection');
        if (photoViewSection) {
            photoViewSection.style.display = 'none';
            // Reset zoom
            currentScale = 1;
            updateScale();
        }
    };
    if (closeBtn) {
        closeBtn.removeEventListener('click', closeHandler);
        closeBtn.addEventListener('click', closeHandler);
    }

    // Add after other button handlers
    const sharePhotoBtn = document.getElementById('sharePhotoViewBtn');
    if (sharePhotoBtn) {
        sharePhotoBtn.removeEventListener('click', this.sharePhotoHandler);
        this.sharePhotoHandler = () => {
            this.shareCurrentPhoto(photoId);
        };
        sharePhotoBtn.addEventListener('click', this.sharePhotoHandler);
    }
    
    // Zoom controls
    const zoomInBtn = document.getElementById('zoomInViewBtn');
    const zoomOutBtn = document.getElementById('zoomOutViewBtn');
    const resetZoomBtn = document.getElementById('resetZoomViewBtn');
    
    if (zoomInBtn) {
        zoomInBtn.removeEventListener('click', this.zoomInHandler);
        this.zoomInHandler = () => {
            if (currentScale < MAX_SCALE) {
                currentScale += ZOOM_STEP;
                updateScale();
            }
        };
        zoomInBtn.addEventListener('click', this.zoomInHandler);
    }
    
    if (zoomOutBtn) {
        zoomOutBtn.removeEventListener('click', this.zoomOutHandler);
        this.zoomOutHandler = () => {
            if (currentScale > MIN_SCALE) {
                currentScale -= ZOOM_STEP;
                updateScale();
            }
        };
        zoomOutBtn.addEventListener('click', this.zoomOutHandler);
    }
    
    if (resetZoomBtn) {
        resetZoomBtn.removeEventListener('click', this.resetZoomHandler);
        this.resetZoomHandler = () => {
            currentScale = 1;
            updateScale();
        };
        resetZoomBtn.addEventListener('click', this.resetZoomHandler);
    }
    
    // Download button
    const downloadBtn = document.getElementById('downloadPhotoViewBtn');
    if (downloadBtn) {
        downloadBtn.removeEventListener('click', this.downloadHandler);
        this.downloadHandler = () => this.downloadPhoto(photoId);
        downloadBtn.addEventListener('click', this.downloadHandler);
    }
    
    // Description input
    const descriptionInput = document.getElementById('photoDescriptionInput');
    const charCount = document.getElementById('descriptionCharCount');
    if (descriptionInput) {
        descriptionInput.removeEventListener('input', this.descriptionInputHandler);
        this.descriptionInputHandler = (e) => {
            const length = e.target.value.length;
            if (charCount) charCount.textContent = `${length}/100`;
            clearTimeout(this.descriptionSaveTimeout);
            this.descriptionSaveTimeout = setTimeout(() => {
                this.updatePhotoDescription(photoId, e.target.value);
            }, 1000);
        };
        descriptionInput.addEventListener('input', this.descriptionInputHandler);
        
        descriptionInput.removeEventListener('blur', this.descriptionBlurHandler);
        this.descriptionBlurHandler = () => {
            clearTimeout(this.descriptionSaveTimeout);
            this.updatePhotoDescription(photoId, descriptionInput.value);
        };
        descriptionInput.addEventListener('blur', this.descriptionBlurHandler);
    }
    
    // Get panel elements
    const addToAlbumPanel = document.getElementById('addToAlbumPanel');
    const deletePanel = document.getElementById('photoDeletePanel');
    
    // Add to Album button - FIXED: removed actionDropdown reference
    const addToAlbumBtn = document.getElementById('addToAlbumViewBtn');
    if (addToAlbumBtn && addToAlbumPanel) {
        addToAlbumBtn.removeEventListener('click', this.addToAlbumHandler);
        this.addToAlbumHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Hide delete panel if open
            if (deletePanel) deletePanel.style.display = 'none';
            // Show add to album panel
            addToAlbumPanel.style.display = 'block';
            // Refresh albums list
            this.refreshAlbumsListView(photoId);
        };
        addToAlbumBtn.addEventListener('click', this.addToAlbumHandler);
    }
    
    // Remove from Album button - FIXED: removed actionDropdown reference
    const removeFromAlbumBtn = document.getElementById('removeFromAlbumViewBtn');
    if (removeFromAlbumBtn) {
        removeFromAlbumBtn.removeEventListener('click', this.removeFromAlbumHandler);
        this.removeFromAlbumHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.removePhotoFromAlbum(photoId);
            const photoViewSection = document.getElementById('photoViewSection');
            if (photoViewSection) photoViewSection.style.display = 'none';
        };
        removeFromAlbumBtn.addEventListener('click', this.removeFromAlbumHandler);
    }
    
    // Delete button - FIXED: removed actionDropdown reference
    const deleteBtn = document.getElementById('deleteViewBtn');
    if (deleteBtn && deletePanel) {
        deleteBtn.removeEventListener('click', this.showDeleteHandler);
        this.showDeleteHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Hide add to album panel if open
            if (addToAlbumPanel) addToAlbumPanel.style.display = 'none';
            // Show delete panel
            deletePanel.style.display = 'block';
        };
        deleteBtn.addEventListener('click', this.showDeleteHandler);
    }
    
    // Close add panel button
    const closeAddPanelBtn = document.getElementById('closeAddPanelBtn');
    if (closeAddPanelBtn && addToAlbumPanel) {
        closeAddPanelBtn.removeEventListener('click', this.closeAddPanelHandler);
        this.closeAddPanelHandler = () => {
            addToAlbumPanel.style.display = 'none';
        };
        closeAddPanelBtn.addEventListener('click', this.closeAddPanelHandler);
    }
    
    // Create new album button
    const createNewAlbumBtn = document.getElementById('createNewAlbumViewBtn');
    if (createNewAlbumBtn) {
        createNewAlbumBtn.removeEventListener('click', this.createAlbumHandler);
        this.createAlbumHandler = () => {
            const photoViewSection = document.getElementById('photoViewSection');
            if (photoViewSection) photoViewSection.style.display = 'none';
            this.openAlbumModal();
        };
        createNewAlbumBtn.addEventListener('click', this.createAlbumHandler);
    }
    
    // Confirm delete button
    const confirmDeleteBtn = document.getElementById('confirmPhotoDeleteBtn');
    if (confirmDeleteBtn && deletePanel) {
        confirmDeleteBtn.removeEventListener('click', this.confirmDeleteHandler);
        this.confirmDeleteHandler = async () => {
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
            
            await this.deletePhotoFromFirebase(photoId);
            
            for (const album of this.albums) {
                if (!album.isSystemAlbum && album.photos && album.photos.includes(photoId)) {
                    album.photos = album.photos.filter(pid => pid !== photoId);
                    album.count = album.photos.length;
                    album.lastModified = Date.now();
                    await this.saveAlbumToFirebase(album);
                }
            }
            
            this.updateSystemAlbumCounts();
            this.renderPhotosGrid();
            this.renderAlbumsGrid();
            this.updatePhotoCountBadge();
            
            const photoViewSection = document.getElementById('photoViewSection');
            if (photoViewSection) photoViewSection.style.display = 'none';
            
            this.showNotification(`"${photo.name}" deleted successfully`);
        };
        confirmDeleteBtn.addEventListener('click', this.confirmDeleteHandler);
    }
    
    // Cancel delete button
    const cancelDeleteBtn = document.getElementById('cancelPhotoDeleteBtn');
    if (cancelDeleteBtn && deletePanel) {
        cancelDeleteBtn.removeEventListener('click', this.cancelDeleteHandler);
        this.cancelDeleteHandler = () => {
            deletePanel.style.display = 'none';
            if (confirmDeleteBtn) {
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
            }
        };
        cancelDeleteBtn.addEventListener('click', this.cancelDeleteHandler);
    }
    
    // Mouse wheel zoom
    const zoomContainer = document.querySelector('.photo-zoom-container-view');
    if (zoomContainer) {
        zoomContainer.removeEventListener('wheel', this.wheelHandler);
        this.wheelHandler = (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                if (currentScale < MAX_SCALE) {
                    currentScale += ZOOM_STEP;
                    updateScale();
                }
            } else {
                if (currentScale > MIN_SCALE) {
                    currentScale -= ZOOM_STEP;
                    updateScale();
                }
            }
        };
        zoomContainer.addEventListener('wheel', this.wheelHandler);
    }
}

// Add this helper method to refresh albums list
refreshAlbumsListView(photoId) {
    const albumsListView = document.getElementById('albumsListView');
    if (!albumsListView) return;
    
    const customAlbums = this.albums.filter(a => !a.isSystemAlbum);
    
    if (customAlbums.length === 0) {
        albumsListView.innerHTML = '<p class="no-albums-message">No custom albums available. Create a new album first.</p>';
        return;
    }
    
    albumsListView.innerHTML = customAlbums.map(album => {
        const isPhotoInAlbum = album.photos && album.photos.includes(photoId);
        return `
            <div class="album-item ${isPhotoInAlbum ? 'already-in-album' : ''}" 
                data-album-id="${album.id}" 
                data-album-name="${album.name}" 
                data-album-color="${album.color}" 
                data-album-icon="${album.icon}" 
                data-is-in-album="${isPhotoInAlbum}">
                <div class="album-icon" style="background: ${album.color}20; border-color: ${album.color}">
                    <i class="${album.icon}" style="color: ${album.color}"></i>
                </div>
                <div class="album-info">
                    <div class="album-name">${this.escapeHtml(album.name)}</div>
                    <div class="album-count">${album.photos ? album.photos.length : 0} photos</div>
                </div>
                ${isPhotoInAlbum ? '<div class="album-check"><i class="fas fa-check-circle"></i></div>' : '<div class="album-add"><i class="fas fa-plus-circle"></i></div>'}
            </div>
        `;
    }).join('');
    
    // Re-attach click handlers to album items
    const albumItems = albumsListView.querySelectorAll('.album-item');
    albumItems.forEach(item => {
        item.removeEventListener('click', this.albumItemClickHandler);
        this.albumItemClickHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const albumId = item.getAttribute('data-album-id');
            const albumName = item.getAttribute('data-album-name');
            const isAlreadyInAlbum = item.getAttribute('data-is-in-album') === 'true';
            
            if (isAlreadyInAlbum) {
                this.showNotification(`Photo is already in "${albumName}"`, 'warning');
                return;
            }
            
            await this.addPhotoToAlbum(photoId, albumId);
            const photoViewSection = document.getElementById('photoViewSection');
            if (photoViewSection) photoViewSection.style.display = 'none';
        };
        item.addEventListener('click', this.albumItemClickHandler);
    });
}

// Helper: Escape HTML
escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


    // Download photo
    downloadPhoto(id) {
        const photo = this.photos.find(p => p.id === id);
        if (photo) {
            const link = document.createElement('a');
            link.href = photo.url;
            link.download = `${photo.name}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            this.showNotification(`Downloading: ${photo.name}`);
        }
    }

    // Replace the getFilteredPhotos method with this updated version
    getFilteredPhotos() {
        if (this.currentFilter === 'home') {
            // When viewing "All Photos", only show photos that are NOT in any custom album
            // Get all photo IDs that are in custom albums
            const photosInCustomAlbums = new Set();
            this.albums.forEach(album => {
                if (!album.isSystemAlbum && album.photos) {
                    album.photos.forEach(photoId => photosInCustomAlbums.add(photoId));
                }
            });
            
            // Return photos that are NOT in any custom album
            return this.photos.filter(p => !photosInCustomAlbums.has(p.id));
        }
        
        const album = this.albums.find(a => a.id.toString() === this.currentFilter.toString());
        
        if (album) {
            if (album.id === 'favorites') {
                return this.photos.filter(p => p.isFavorite);
            } else if (album.id === 'recent') {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                return this.photos.filter(p => {
                    const photoDate = new Date(p.date);
                    return photoDate >= thirtyDaysAgo;
                });
            } else {
                // For custom albums, return photos that are in this album
                return this.photos.filter(p => album.photos.includes(p.id));
            }
        }
        
        return this.photos;
    }

    groupPhotosByDate(photos) {
        const groups = {};
        const sortedPhotos = [...photos].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        sortedPhotos.forEach(photo => {
            const date = new Date(photo.date);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            let groupKey;
            
            if (date.toDateString() === today.toDateString()) {
                groupKey = 'Today';
            } else if (date.toDateString() === yesterday.toDateString()) {
                groupKey = 'Yesterday';
            } else if (this.isThisWeek(date)) {
                groupKey = 'This week';
            } else if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()) {
                groupKey = 'This month';
            } else {
                groupKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            }
            
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(photo);
        });
        
        return groups;
    }

    isThisWeek(date) {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return date >= weekAgo && date < today;
    }

    formatDateHeader(dateKey) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (dateKey === 'Today' || dateKey === 'Yesterday' || dateKey === 'This week' || dateKey === 'This month') {
            return dateKey;
        }
        return dateKey;
    }


    // ========== ALBUM OPERATIONS ==========

    // Add photo to album
    async addPhotoToAlbum(photoId, albumId) {
        const album = this.albums.find(a => a.id === albumId);
        const photo = this.photos.find(p => p.id === photoId);
        
        if (!album || !photo) {
            this.showNotification('Album or photo not found', 'error');
            return;
        }
        
        // Check if photo is already in album
        if (album.photos.includes(photoId)) {
            this.showNotification(`"${photo.name}" is already in "${album.name}"`, 'warning');
            return;
        }
        
        // Add photo to album
        album.photos.push(photoId);
        album.count = album.photos.length;
        album.lastModified = Date.now();
        
        // Save to Firebase
        await this.saveAlbumToFirebase(album);
        
        // Update UI based on current view
        if (this.currentFilter === 'home') {
            // If currently viewing "All Photos", this photo will disappear
            this.renderPhotosGrid();
        } else if (this.currentFilter === albumId.toString()) {
            // If viewing this album, the photo will appear
            this.renderPhotosGrid();
        }
        
        this.renderAlbumsGrid();
        
        this.showNotification(`"${photo.name}" added to "${album.name}"`);
    }

    // Remove photo from album
    async removePhotoFromAlbum(photoId) {
        // Check if we're in an album view
        const isInAlbumView = this.currentFilter !== 'home' && 
                            this.currentFilter !== 'favorites' && 
                            this.currentFilter !== 'recent';
        
        if (!isInAlbumView) {
            this.showNotification('Not in an album view', 'error');
            return;
        }
        
        const albumId = this.currentFilter;
        const album = this.albums.find(a => a.id === albumId);
        const photo = this.photos.find(p => p.id === photoId);
        
        if (!album || !photo) {
            this.showNotification('Album or photo not found', 'error');
            return;
        }
        
        // Check if photo is in the album
        if (!album.photos.includes(photoId)) {
            this.showNotification(`Photo is not in "${album.name}"`, 'warning');
            return;
        }
        
        // Remove photo from album
        album.photos = album.photos.filter(id => id !== photoId);
        album.count = album.photos.length;
        album.lastModified = Date.now();
        
        // Save to Firebase
        await this.saveAlbumToFirebase(album);
        
        // Update UI
        this.renderPhotosGrid(); // This will now show the photo in "All Photos" if not in any other album
        this.renderAlbumsGrid();
        
        this.showNotification(`Photo removed from "${album.name}"`);
    }


    // Replace the updateSystemAlbumCounts method with this updated version
    updateSystemAlbumCounts() {
        const homePhotosAlbum = this.albums.find(a => a.id === 'home');
        if (homePhotosAlbum) {
            // For "All Photos", count only photos NOT in any custom album
            const photosInCustomAlbums = new Set();
            this.albums.forEach(album => {
                if (!album.isSystemAlbum && album.photos) {
                    album.photos.forEach(photoId => photosInCustomAlbums.add(photoId));
                }
            });
            
            homePhotosAlbum.photos = this.photos
                .filter(p => !photosInCustomAlbums.has(p.id))
                .map(p => p.id);
            homePhotosAlbum.count = homePhotosAlbum.photos.length;
        }

        const favoritesAlbum = this.albums.find(a => a.id === 'favorites');
        if (favoritesAlbum) {
            favoritesAlbum.photos = this.photos.filter(p => p.isFavorite).map(p => p.id);
            favoritesAlbum.count = favoritesAlbum.photos.length;
        }

        const recentAlbum = this.albums.find(a => a.id === 'recent');
        if (recentAlbum) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            recentAlbum.photos = this.photos
                .filter(p => new Date(p.date) >= thirtyDaysAgo)
                .map(p => p.id);
            recentAlbum.count = recentAlbum.photos.length;
        }
    }

    // Get default albums (system albums only)
    getDefaultAlbums() {
        return [
            {
                id: 'home',
                name: 'Home',
                count: 0,
                icon: 'fas fa-images',
                color: '#3b82f6',
                description: 'All your photos in one place',
                photos: [],
                isSystemAlbum: true
            },
            {
                id: 'favorites',
                name: 'Favorites',
                count: 0,
                icon: 'fas fa-star',
                color: '#f59e0b',
                description: 'Your favorite photos',
                photos: [],
                isSystemAlbum: true
            },
            {
                id: 'recent',
                name: 'Recent',
                count: 0,
                icon: 'fas fa-clock',
                color: '#10b981',
                description: 'Photos from the last 30 days',
                photos: [],
                isSystemAlbum: true
            },
            //Special "Create Album" button album
            {
                id: 'new_album',
                name: 'Create',
                count: 0,          // won't be displayed
                icon: 'fas fa-plus-circle',
                color: '#8b5cf6',   // purple to stand out
                description: 'Click to create a new custom album',
                photos: [],
                isSystemAlbum: true,
                isCreateTrigger: true   // custom flag
            }
        ];
    }
    
    // Get random color for album
    getRandomColor() {
        const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        return colors[Math.floor(Math.random() * colors.length)];
    }


    // ========== DELETE OPERATIONS ==========


    // Batch delete photos
async confirmBatchDelete() {
    if (this.selectedPhotos.size === 0) {
        this.showNotification('No photos selected', 'warning');
        return;
    }
    
    const count = this.selectedPhotos.size;
    
    // Get photos that are in albums to show warning
    const photosInAlbums = [];
    for (const album of this.albums) {
        if (!album.isSystemAlbum && album.photos) {
            for (const photoId of this.selectedPhotos) {
                if (album.photos.includes(photoId) && !photosInAlbums.includes(photoId)) {
                    photosInAlbums.push(photoId);
                }
            }
        }
    }
    
    this.itemToDelete = {
        type: 'batch',
        ids: Array.from(this.selectedPhotos),
        count: count,
        photosInAlbums: photosInAlbums.length
    };
    
    const modal = document.getElementById('confirmBatchDelete');
    const message = document.getElementById('deleteMessage');
    
    if (modal && message) {
        let warningText = '';
        if (photosInAlbums.length > 0) {
            warningText = `<div style="margin-top: 8px; font-size: 0.7rem; opacity: 0.8;">
                ${photosInAlbums.length} of these photos are in custom albums and will be removed from them.
            </div>`;
        }
        
        message.innerHTML = `Delete ${count} selected photo${count !== 1 ? 's' : ''}? This action cannot be undone.${warningText}`;
        modal.style.display = 'block';
    }
}

    // Enhanced performDelete with loading indicator
    async performDelete() {
        if (!this.itemToDelete) return;
        
        const { type, id, ids, count } = this.itemToDelete;
        
        if (type === 'batch') {
            await this.performBatchDelete();
            return;
        } else if (type === 'photo') {
            this.showLoadingOverlay('Deleting photo...');
            await this.deletePhotoFromFirebase(id);
            this.updateLoadingProgress(100, 'Photo deleted');
            
            // Update albums
            for (const album of this.albums) {
                if (!album.isSystemAlbum && album.photos && album.photos.includes(id)) {
                    album.photos = album.photos.filter(photoId => photoId !== id);
                    album.count = album.photos.length;
                    album.lastModified = Date.now();
                    await this.saveAlbumToFirebase(album);
                }
            }
            
        } else if (type === 'album') {
            this.showLoadingOverlay('Deleting album...');
            await this.deleteAlbumFromFirebase(id);
            this.updateLoadingProgress(100, 'Album deleted');
            
            // Reset filter if we were viewing this album
            if (this.currentFilter === id) {
                this.currentFilter = 'home';
                document.getElementById('currentFilterTitle').textContent = 'Home';
                const manageAlbumBtn = document.getElementById('manageAlbumBtn');
                if (manageAlbumBtn) manageAlbumBtn.style.display = 'none';
            }
        }
        
        this.updateSystemAlbumCounts();
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
        this.updatePhotoCountBadge();
        
        this.closeDeleteModal();
        this.itemToDelete = null;
        
        // Hide overlay after short delay
        setTimeout(() => this.hideLoadingOverlay(), 500);
    }

    // Enhanced performBatchDelete with loading indicator
    async performBatchDelete() {
        if (!this.itemToDelete || this.itemToDelete.type !== 'batch') return;
        
        const { ids, count } = this.itemToDelete;
        let successCount = 0;
        let processedCount = 0;
        
        // Show loading overlay
        this.showLoadingOverlay(`Deleting ${count} photo${count !== 1 ? 's' : ''}...`);
        this.updateLoadingProgress(0, `0 of ${count} photos deleted`);
        
        // Process deletions one by one with progress
        for (const id of ids) {
            const deleted = await this.deletePhotoFromFirebase(id);
            if (deleted) successCount++;
            
            processedCount++;
            const progress = (processedCount / count) * 100;
            this.updateLoadingProgress(progress, `${processedCount} of ${count} photos deleted`);
            
            // Small delay to prevent UI blocking
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Update albums (remove deleted photos from all albums)
        this.showLoadingOverlay('Updating albums...');
        this.updateLoadingProgress(0, 'Removing photos from albums...');
        
        let albumProcessed = 0;
        const albumsToUpdate = this.albums.filter(album => !album.isSystemAlbum && album.photos);
        
        for (const album of albumsToUpdate) {
            const originalLength = album.photos.length;
            album.photos = album.photos.filter(photoId => !ids.includes(photoId));
            
            if (album.photos.length !== originalLength) {
                album.count = album.photos.length;
                album.lastModified = Date.now();
                await this.saveAlbumToFirebase(album);
            }
            
            albumProcessed++;
            const progress = (albumProcessed / albumsToUpdate.length) * 100;
            this.updateLoadingProgress(progress, `Updating album: ${album.name}`);
        }
        
        // Update system albums
        this.updateSystemAlbumCounts();
        
        // Clear batch selection and exit batch mode
        this.clearBatchSelection();
        this.batchMode = false;
        
        // Update UI
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
        this.updatePhotoCountBadge();
        this.updateBatchModeUI();
        
        // Close modal and show success
        this.closeDeleteModal();
        this.itemToDelete = null;
        
        this.updateLoadingProgress(100, 'Complete!');
        
        // Show notification after overlay hides
        setTimeout(() => {
            this.showNotification(`Successfully deleted ${successCount} photo${successCount !== 1 ? 's' : ''}`);
        }, 500);
    }


    // ========== LOADING & UI STATE ==========

    // Show loading
    showLoadingOverlay(message = 'Processing...') {
        // Remove existing overlay if any
        this.hideLoadingOverlay();
        
        const overlay = document.createElement('div');
        overlay.id = 'photosLoadingOverlay';
        overlay.className = 'photos-loading-overlay';
        overlay.innerHTML = `
            <div class="photos-loading-content">
                <div class="photos-loading-spinner"></div>
                <div class="photos-loading-message">${message}</div>
                <div class="photos-loading-progress">
                    <div class="photos-loading-progress-fill"></div>
                </div>
                <div class="photos-loading-detail"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        // Store for progress updates
        this.loadingOverlay = overlay;
    }

    // Hide loading
    hideLoadingOverlay() {
        const overlay = document.getElementById('photosLoadingOverlay');
        if (overlay) {
            overlay.remove();
            this.loadingOverlay = null;
        }
    }

    // Update progress
    updateLoadingProgress(progress, detail = '') {
        if (this.loadingOverlay) {
            const fill = this.loadingOverlay.querySelector('.photos-loading-progress-fill');
            const detailEl = this.loadingOverlay.querySelector('.photos-loading-detail');
            
            if (fill) {
                fill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
            }
            if (detailEl && detail) {
                detailEl.textContent = detail;
            }
            
            // Update progress bar visibility
            if (progress === 100) {
                setTimeout(() => this.hideLoadingOverlay(), 500);
            }
        }
    }


    // ========== UI RENDERING ==========

    // Main render
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Photos container not found:', containerId);
            return;
        }

        container.innerHTML = this.getPhotosHTML();
        this.attachEventListeners();
        this.renderPhotosGrid();
        this.renderAlbumsGrid();
        this.updatePhotoCountBadge();
        
        setTimeout(() => this.checkAndShowLimitWarning(), 1000);
    }

    // HTML template
// HTML template
getPhotosHTML() {
    return `
        <div class="photos-container">
            <div class="module-card">
                <div class="module-icon" style="color: var(--primary);">
                    <span class="material-icons">photo_library</span>
                </div>
                <div class="module-info">
                    <div class="module-title">Photo Library</div>
                    <div class="module-description">Secure photo storage and management</div>
                </div>
                <div class="module-actions">
                    <div class="photo-count-badge" id="photoCountBadge" title="${this.photos.length} of ${this.uploadLimits.maxTotalPhotos} photos">
                        <i class="fas fa-images"></i>
                        <span>${this.photos.length}/${this.uploadLimits.maxTotalPhotos}</span>
                    </div>
                    <button class="btn btn-primary" id="uploadPhotosBtn">
                        <i class="fas fa-cloud-upload-alt"></i> Upload
                    </button>
                </div>
            </div>             

            <!-- Upload Section -->
            <div class="upload-section" id="uploadSection" style="display: none;">
                <div class="upload-content">
                    <div class="upload-header">
                        <h3 class="upload-title">Upload Photos</h3>
                        <p>
                            <i class="fas fa-info-circle"></i>
                            Limits: Max ${this.uploadLimits.maxFilesPerUpload} files per upload, ${this.uploadLimits.maxFileSizeMB}MB per file
                        </p>
                    </div>
                    <div class="upload-body">
                        <div class="upload-area" id="photoUploadArea">
                            <i class="fas fa-cloud-upload-alt upload-icon"></i>
                            <h4>Drop photos here or click to browse</h4>
                            <p>Supported formats: JPG, PNG, GIF, WEBP</p>
                            <input type="file" id="photoInput" multiple accept="image/*" style="display: none;">
                            <button class="btn btn-primary" id="browseFilesBtn" type="button">
                                <i class="fas fa-folder-open"></i> Browse Files
                            </button>
                        </div>
                        
                        <div class="file-preview" id="filePreview" style="display: none;"></div>
                        
                        <div class="upload-progress" id="uploadProgress" style="display: none;">
                            <div class="progress-bar">
                                <div class="progress-fill" id="progressFill"></div>
                            </div>
                            <div class="progress-info">
                                <span id="progressText">Uploading...</span>
                                <span id="progressPercent">0%</span>
                            </div>
                        </div>
                    </div>
                    <div class="upload-actions">
                        <button class="btn btn-primary" id="startUploadBtn" style="display: none;">
                            <i class="fas fa-upload"></i> Start Upload
                        </button>
                        <button class="btn btn-secondary" id="cancelUploadBtn">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>

            <!-- Album Management Section -->
            <div class="album-management-section" id="albumModal" style="display: none;">
                <div class="album-management-content">
                    <div class="album-management-header">
                        <h3 class="album-management-title" id="albumModalTitle">Create New Album</h3>
                    </div>
                    <div class="album-management-body">
                        <div class="form-group">
                            <label class="form-label" for="albumName">Album Name (max 7 characters, no spaces)</label>
                            <input type="text" 
                                id="albumName" 
                                class="form-input" 
                                placeholder="e.g., Vacation"
                                maxlength="7"
                                oninput="this.value = this.value.replace(/\\s/g, '')">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="albumDescription">Description</label>
                            <textarea id="albumDescription" class="form-textarea" rows="1" placeholder="Add a description"></textarea>
                        </div>
                    </div>
                    
                    <!-- Album Delete Confirmation (hidden by default) -->
                    <div class="album-delete-confirmation-panel" id="albumDeleteConfirm" style="display: none;">
                        <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                            <div style="
                                width: 32px;
                                height: 32px;
                                background: rgba(239, 68, 68, 0.15);
                                border-radius: 8px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">
                                <span class="material-icons" style="color: var(--danger, #ef4444); font-size: 18px;">warning</span>
                            </div>
                            <div>
                                <div style="color: var(--f-label); font-size: 0.85rem; font-weight: 500;">
                                    Are you sure you want to delete this Album?
                                </div>
                                <div style="color: var(--text-secondary, #a0a0b0); font-size: 0.7rem; margin-top: 2px;">
                                    This will not delete the photos inside the album, but they will be moved to your main library.
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-top: 4px;">
                            <button class="btn btn-danger confirm-album-delete-btn" id="confirmAlbumDeleteBtn"><i class="fas fa-trash"></i> Delete Album</button>
                            <button class="btn btn-secondary" id="cancelAlbumDeleteBtn">Cancel</button>
                        </div>
                    </div>
                    
                    <div class="album-management-actions">
                        <button class="btn btn-danger" id="deleteAlbumBtn" style="display: none;">
                            <i class="fas fa-trash"></i> Delete Album
                        </button>
                        <div style="flex: 1;"></div>
                        <button class="btn btn-primary" id="saveAlbumBtn"><i class="fas fa-folder-plus"></i> Create Album</button>
                        <button class="btn btn-secondary" id="cancelAlbumBtn">Cancel</button>
                    </div>
                </div>
            </div>

            <div class="albums-section">
                <div class="photo-section-header">
                    <div class="section-title-info">
                        <h3 class="" id="currentFilterTitle">Home</h3>
                    </div>
                    <div class="album-actions">
                        <button class="btn btn-primary" id="manageAlbumBtn" style="display: none;">
                            <i class="fas fa-edit"></i> Manage Album
                        </button>
                    </div>    
                </div>
                <div class="albums-grid" id="albumsGrid">
                    <!-- Albums will be dynamically generated here -->
                </div>
            </div>

            <div class="photo-section-header">
                <p class="section-description" id="albumSectionDescription">Organize your photos into albums</p>
                <div class="view-options">
                    <span class="view-info" id="viewInfo">Showing all photos</span>
                    <button class="btn btn-icon" id="toggleBlurBtn" title="Disable blur effect">
                        <i class="fas fa-eye-slash" id="blurToggleIcon"></i>
                    </button>
                </div>
            </div>

            <div class="batch-actions-group" id="normalActions">
                <button class="btn btn-icon" id="batchModeBtn" title="Select multiple photos">
                    <i class="fas fa-check-square"></i> Select
                </button>
            </div>

            <div class="batch-actions-group" id="batchActions" style="display: none;">
                <span class="selection-count" id="selectionCount">No photos selected</span>
                <button class="btn btn-primary" id="selectAllBtn" title="Select all photos">
                    <i class="fas fa-check-double"></i> All
                </button>
                <button class="btn btn-danger" id="batchDeleteBtn" disabled>
                    <i class="fas fa-trash-alt"></i> Delete Selected
                </button>
                <button class="btn btn-secondary" id="cancelBatchBtn">
                    Cancel
                </button>
            </div>

            <!-- Batch Delete Confirmation Panel (Inline) -->
            <div class="batch-delete-panel" id="confirmBatchDelete" style="display: none;">
                <div class="batch-confirmation-content">
                    <div class="batch-delete-warning">
                        <div style="
                            width: 32px;
                            height: 32px;
                            background: rgba(239, 68, 68, 0.15);
                            border-radius: 8px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">
                            <span class="material-icons" style="color: var(--danger, #ef4444); font-size: 18px;">warning</span>
                        </div>
                        <span id="deleteMessage"></span>
                    </div>
                    <div class="batch-confirmation-actions">
                        <button class="btn btn-danger" id="confirmBatchDeleteBtn"><i class="fas fa-trash"></i> Delete</button>
                        <button class="btn btn-secondary" id="cancelBatchDeleteBtn"> Cancel</button>
                    </div>
                </div>
            </div>

            <!-- Photo View Section (Inline like Album Management) -->
            <div class="photo-view-section" id="photoViewSection" style="display: none;">
                <div class="photo-view-content">
                    <div class="photo-view-header">
                        <div class="photo-view-title-info">
                            <h3 class="photo-view-name" id="photoViewName"></h3>
                            <div class="photo-view-meta">
                                <span class="photo-view-date" id="photoViewDate"></span>
                                <span class="photo-view-size" id="photoViewSize"></span>
                                <span class="favorite-badge-view" id="favoriteBadgeView" style="display: none;">
                                    <i class="fas fa-star"></i> Favorite
                                </span>
                            </div>
                            <div class="photo-description-container">
                                <input type="text" 
                                    class="photo-description-input-view" 
                                    id="photoDescriptionInput"
                                    placeholder="Add a short description (max 100 chars)" 
                                    maxlength="100"
                                    value="">
                                <span class="description-char-count-view" id="descriptionCharCount">0/100</span>
                            </div>
                        </div>
                        <button class="close-photo-view" id="closePhotoViewBtn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="photo-view-body">
                        <div class="photo-zoom-container-view">
                            <img src="" alt="" class="zoomable-photo-view" id="zoomablePhotoView" data-scale="1">
                        </div>
                    </div>
                    
                    <div class="photo-view-footer">
                        <div class="photo-view-actions">
                            <button class="btn-icon share-photo-view-btn" id="sharePhotoViewBtn" title="Share this photo">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-icon add-to-album-view-btn" id="addToAlbumViewBtn" style="display: none;" title="Add to Album">
                                <i class="fas fa-folder-plus"></i>
                            </button>
                            <button class="btn-icon remove-from-album-view-btn" id="removeFromAlbumViewBtn" style="display: none;" title="Remove from Album">
                                <i class="fas fa-folder-minus"></i>
                            </button>
                            <button class="btn-icon delete-view-btn" id="deleteViewBtn" title="Delete Photo">
                                <i class="fas fa-trash"></i>
                            </button>
                            <button class="btn-icon zoom-in-view-btn" id="zoomInViewBtn" title="Zoom In">
                                <i class="fas fa-search-plus"></i>
                            </button>
                            <button class="btn-icon zoom-out-view-btn" id="zoomOutViewBtn" title="Zoom Out">
                                <i class="fas fa-search-minus"></i>
                            </button>
                            <button class="btn-icon reset-zoom-view-btn" id="resetZoomViewBtn" title="Reset Zoom">
                                <i class="fas fa-expand-alt"></i>
                            </button>
                            <button class="btn-icon download-photo-view-btn" id="downloadPhotoViewBtn" title="Download Photo">
                                <i class="fas fa-download"></i>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Delete Confirmation Panel (Inline) -->
                    <div class="photo-delete-panel" id="photoDeletePanel" style="display: none;">
                        <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                            <div style="
                                width: 32px;
                                height: 32px;
                                background: rgba(239, 68, 68, 0.15);
                                border-radius: 8px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">
                                <span class="material-icons" style="color: var(--danger, #ef4444); font-size: 18px;">warning</span>
                            </div>
                            <div>
                                <div style="color: var(--f-label); font-size: 0.85rem; font-weight: 500;">
                                    Are you sure you want to delete this photo?
                                </div>
                                <div style="color: var(--text-secondary, #a0a0b0); font-size: 0.7rem; margin-top: 2px;">
                                    secondary massages*
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-top: 4px;">
                            <button type="button" class="btn btn-danger" id="confirmPhotoDeleteBtn"><i class="fas fa-trash"></i> Delete</button>
                            <button type="button" class="btn btn-secondary" id="cancelPhotoDeleteBtn">Cancel</button>
                        </div>
                    </div>
                    
                    <!-- Add to Album Panel (Inline) -->
                    <div class="add-to-album-panel" id="addToAlbumPanel" style="display: none;">
                        <div class="photo-confirmation-content-panel">
                            <p>Select Album:</p>
                            <div class="albums-list-view" id="albumsListView">
                                <!-- Albums will be inserted here dynamically -->
                            </div>
                        </div>
                        <div class="photo-confirmation-actions-panel">
                            <button class="btn btn-primary" id="createNewAlbumViewBtn"><i class="fas fa-folder-plus"></i> Create New Album</button>
                            <button class="btn btn-secondary" id="closeAddPanelBtn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="photos-grid grid-view" id="photosGrid">
                <!-- Photos will be dynamically generated here -->
            </div>

            <div class="empty-state" id="emptyState" style="display: none;">
                <i class="fas fa-images empty-state-icon"></i>
                <h3>No Photos Yet</h3>
                <p>Start by uploading your first photo to build your library</p>
                <button class="btn btn-primary" id="uploadFirstPhotosBtn">
                    <i class="fas fa-cloud-upload-alt"></i> Upload Your First Photos
                </button>
            </div>
        </div>
    `;
}

    // Event attachment
    attachEventListeners() {
        document.getElementById('uploadPhotosBtn')?.addEventListener('click', () => this.openUploadSection());
        document.getElementById('uploadFirstPhotosBtn')?.addEventListener('click', () => this.openUploadSection());
        document.getElementById('browseFilesBtn')?.addEventListener('click', () => document.getElementById('photoInput').click());
        document.getElementById('startUploadBtn')?.addEventListener('click', () => this.handleFileUpload());
        document.getElementById('cancelUploadBtn')?.addEventListener('click', () => this.closeUploadSection());
        document.getElementById('photoInput')?.addEventListener('change', (e) => this.handleFileSelect(e));

        // Album buttons
        document.getElementById('saveAlbumBtn')?.addEventListener('click', () => this.createAlbum());
        document.getElementById('cancelAlbumBtn')?.addEventListener('click', () => this.closeAlbumModal());
        document.getElementById('deleteAlbumBtn')?.addEventListener('click', () => {
            if (this.editingAlbumId) {
                this.confirmDeleteAlbum(this.editingAlbumId);
            }
        });
        document.getElementById('manageAlbumBtn')?.addEventListener('click', () => {
            if (this.currentFilter !== 'home' && this.currentFilter !== 'favorites' && this.currentFilter !== 'recent') {
                this.openAlbumModal(this.currentFilter);
            }
        });

        // Batch mode buttons
        document.getElementById('batchModeBtn')?.addEventListener('click', () => this.toggleBatchMode());
        document.getElementById('cancelBatchBtn')?.addEventListener('click', () => this.toggleBatchMode());
        document.getElementById('selectAllBtn')?.addEventListener('click', () => this.selectAllPhotos());
        document.getElementById('batchDeleteBtn')?.addEventListener('click', () => this.confirmBatchDelete());
        
        // Blur toggle button
        document.getElementById('toggleBlurBtn')?.addEventListener('click', () => this.toggleBlur());

        // Batch Delete
        document.getElementById('confirmBatchDeleteBtn')?.addEventListener('click', () => this.performDelete());
        document.getElementById('cancelBatchDeleteBtn')?.addEventListener('click', () => this.closeDeleteModal());

        // Modal close buttons
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) modal.style.display = 'none';
            });
        });

        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        // Drag and drop upload
        this.setupDragAndDrop();
    }

    renderPhotosGrid() {
        const photosGrid = document.getElementById('photosGrid');
        const emptyState = document.getElementById('emptyState');
        if (!photosGrid) return;

        photosGrid.innerHTML = '';
        
        let filteredPhotos = this.getFilteredPhotos();

        if (filteredPhotos.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
                emptyState.querySelector('h3').textContent = this.getEmptyStateTitle();
                emptyState.querySelector('p').textContent = this.getEmptyStateMessage();
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        filteredPhotos.sort((a, b) => new Date(b.date) - new Date(a.date));

        const groupedPhotos = this.groupPhotosByDate(filteredPhotos);
        
        Object.keys(groupedPhotos).forEach(date => {
            const photos = groupedPhotos[date];
            
            const dateHeader = document.createElement('div');
            dateHeader.className = 'date-group-header';
            dateHeader.innerHTML = `
                <h3 class="date-group-title">${this.formatDateHeader(date)}</h3>
                <span class="date-group-count">${photos.length} photo${photos.length !== 1 ? 's' : ''}</span>
            `;
            photosGrid.appendChild(dateHeader);
            
            const photosContainer = document.createElement('div');
            photosContainer.className = 'date-group-photos';

            photos.forEach(photo => {
                const photoCard = document.createElement('div');
                photoCard.className = 'photo-card';
                
                const isSelected = this.selectedPhotos.has(photo.id);
                const selectionCheckbox = this.batchMode ? `
                    <div class="photo-selection">
                        <input type="checkbox" 
                            class="photo-select-checkbox" 
                            data-id="${photo.id}" 
                            ${isSelected ? 'checked' : ''}>
                    </div>
                ` : '';
                
                photoCard.innerHTML = `
                    <div class="photo-thumbnail">
                        <img src="${photo.url}" alt="${photo.name}" loading="lazy" style="filter: ${this.blurEnabled ? 'blur(3px)' : 'none'};">
                        <div class="photo-overlay">
                            ${selectionCheckbox}
                            <button class="btn-icon favorite-btn ${photo.isFavorite ? 'favorite' : ''}" data-id="${photo.id}" title="${photo.isFavorite ? 'Remove favorite' : 'Add to favorites'}">
                                <i class="${photo.isFavorite ? 'fas' : 'far'} fa-star"></i>
                            </button>
                        </div>
                    </div>
                `;
                photosContainer.appendChild(photoCard);
            });
            
            photosGrid.appendChild(photosContainer);
        });

        this.attachPhotoEventListeners();
        this.renderAlbumsGrid();
        this.updatePhotoCountBadge();
    }

    renderAlbumsGrid() {
        const albumsGrid = document.getElementById('albumsGrid');
        const albumSectionDescription = document.getElementById('albumSectionDescription');
        
        if (!albumsGrid) return;

        albumsGrid.innerHTML = this.albums.map(album => {

            return `
                <div class="album-card ${this.currentFilter === album.id.toString() ? 'active' : ''}" 
                    data-id="${album.id}" data-action="filter"
                    style="border-color: ${album.color}40; ${this.currentFilter === album.id.toString() ? `border-color: ${album.color}; border-width: 2px;` : ''}">
                    <div class="album-header">
                        <div class="album-cover" style="background: ${album.color}20; border-color: ${album.color}">
                            <i class="${album.icon}" style="color: ${album.color}"></i>
                        </div>
                    </div>
                    <div class="album-info">
                        <div class="album-name" style="color: ${album.color}; opacity: ${this.currentFilter === album.id.toString() ? '1' : '0.7'}">
                            ${album.name}
                        </div>
                        <div class="album-count" style="color: ${album.color}; opacity: ${this.currentFilter === album.id.toString() ? '0.9' : '0.7'}">
                            ${album.count} photo${album.count !== 1 ? 's' : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (albumSectionDescription) {
            if (this.currentFilter !== 'home' && this.currentFilter !== 'favorites' && this.currentFilter !== 'recent') {
                const album = this.albums.find(a => a.id.toString() === this.currentFilter.toString());
                if (album && album.description) {
                    albumSectionDescription.textContent = album.description;
                } else {
                    albumSectionDescription.textContent = 'Organize your photos into albums';
                }
            } else {
                albumSectionDescription.textContent = 'Organize your photos into albums';
            }
        }

        this.attachAlbumEventListeners();
    }

    attachPhotoEventListeners() {
        document.querySelectorAll('.favorite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.currentTarget.getAttribute('data-id');
                this.toggleFavorite(id);
            });
        });

        document.querySelectorAll('.photo-select-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = e.target.getAttribute('data-id');
                if (e.target.checked) {
                    this.selectedPhotos.add(id);
                } else {
                    this.selectedPhotos.delete(id);
                }
                this.updateBatchDeleteButton();
            });
        });

        document.querySelectorAll('.photo-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.favorite-btn') || e.target.closest('.photo-select-checkbox')) {
                    return;
                }
                
                if (this.batchMode) {
                    const checkbox = card.querySelector('.photo-select-checkbox');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        const event = new Event('change', { bubbles: true });
                        checkbox.dispatchEvent(event);
                    }
                    return;
                }
                
                const id = card.querySelector('.favorite-btn').getAttribute('data-id');
                this.viewPhoto(id);
            });
        });
    }

    attachAlbumEventListeners() {
        document.querySelectorAll('.album-card[data-action="filter"]').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.btn-icon')) {
                    const albumId = card.getAttribute('data-id');
                    this.applyFilter(albumId);
                }
            });
        });
    }

    applyFilter(albumId) {
        // If it's the "Create Album" trigger, open modal and do nothing else
        const album = this.albums.find(a => a.id.toString() === albumId.toString());
        if (album && album.isCreateTrigger) {
            this.openAlbumModal();
            return;
        }

        this.currentFilter = albumId.toString();
        
        const currentFilterTitle = document.getElementById('currentFilterTitle');
        const albumSectionDescription = document.getElementById('albumSectionDescription');
        const manageAlbumBtn = document.getElementById('manageAlbumBtn');
        
        if (currentFilterTitle) {
            const album = this.albums.find(a => a.id.toString() === albumId.toString());
            currentFilterTitle.textContent = album ? album.name : 'Home';
        }
        
        if (albumSectionDescription) {
            if (albumId !== 'home' && albumId !== 'favorites' && albumId !== 'recent') {
                const album = this.albums.find(a => a.id.toString() === albumId.toString());
                if (album && album.description) {
                    albumSectionDescription.textContent = album.description;
                } else {
                    albumSectionDescription.textContent = 'Organize your photos into albums';
                }
            } else {
                albumSectionDescription.textContent = 'Organize your photos into albums';
            }
        }
        
        if (manageAlbumBtn) {
            const album = this.albums.find(a => a.id.toString() === albumId.toString());
            manageAlbumBtn.style.display = album && !album.isSystemAlbum ? 'block' : 'none';
        }
        
        this.renderPhotosGrid();
        this.updateActiveFilter();
    }

    updateActiveFilter() {
        document.querySelectorAll('.album-card').forEach(card => {
            card.classList.remove('active');
        });
        
        let activeCard;
        if (this.currentFilter === 'favorites' || this.currentFilter === 'recent') {
            activeCard = document.querySelector(`.album-card[data-id="${this.currentFilter}"]`);
        } else {
            activeCard = document.querySelector(`.album-card[data-id="${this.currentFilter}"]`);
        }
        
        if (activeCard) {
            activeCard.classList.add('active');
        }
        
        this.updateViewInfo();
    }

    updateViewInfo() {
        const viewInfo = document.getElementById('viewInfo');
        if (viewInfo) {
            const album = this.albums.find(a => a.id.toString() === this.currentFilter.toString());
            const filterName = album ? album.name : 'Home';
            const photoCount = this.getFilteredPhotos().length;
            viewInfo.textContent = `${photoCount} photo${photoCount !== 1 ? 's' : ''}`;
            
            if (album && album.description) {
                viewInfo.title = album.description;
            }
        }
    }

    // Empty state message
    getEmptyStateTitle() {
        const album = this.albums.find(a => a.id.toString() === this.currentFilter.toString());
        if (album) {
            return `No Photos in "${album.name}"`;
        }
        return 'No Photos Yet';
    }

    // Empty state message
    getEmptyStateMessage() {
        const album = this.albums.find(a => a.id.toString() === this.currentFilter.toString());
        if (album) {
            if (album.id === 'home') {
                return 'All your photos are organized in albums. Upload new photos or remove them from albums to see them here.';
            } else if (album.id === 'favorites') {
                return 'Mark photos as favorites to see them here';
            } else if (album.id === 'recent') {
                return 'Photos from the last 30 days will appear here';
            } else {
                return 'Add photos to this album to see them here';
            }
        }
        return 'Upload photos to get started';
    }


    // ========== MODAL CONTROLS ==========

    openUploadSection() {
        const uploadSection = document.getElementById('uploadSection');
        if (uploadSection) {
            uploadSection.style.display = 'flex';
            this.resetUploadForm();
        }
    }

    closeUploadSection() {
        const uploadSection = document.getElementById('uploadSection');
        if (uploadSection) {
            uploadSection.style.display = 'none';
            this.resetUploadForm();
        }
    }

    resetUploadForm() {
        const filePreview = document.getElementById('filePreview');
        const uploadProgress = document.getElementById('uploadProgress');
        const startUploadBtn = document.getElementById('startUploadBtn');
        const photoInput = document.getElementById('photoInput');
        const progressFill = document.getElementById('progressFill');
        const progressPercent = document.getElementById('progressPercent');

        if (filePreview) {
            filePreview.innerHTML = '';
            filePreview.style.display = 'none';
        }
        if (uploadProgress) uploadProgress.style.display = 'none';
        if (startUploadBtn) startUploadBtn.style.display = 'none';
        if (photoInput) photoInput.value = '';
        if (progressFill) progressFill.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        
        this.selectedFiles = null;
    }

// Updated openAlbumModal method - removed photo selection
openAlbumModal(albumId = null) {
    const albumModal = document.getElementById('albumModal');
    const modalTitle = document.getElementById('albumModalTitle');
    const saveAlbumBtn = document.getElementById('saveAlbumBtn');
    const deleteAlbumBtn = document.getElementById('deleteAlbumBtn');
    const deleteConfirm = document.getElementById('albumDeleteConfirm');
    
    if (albumModal) {
        albumModal.style.display = 'block';
        
        // Hide inline delete confirmation initially
        if (deleteConfirm) {
            deleteConfirm.style.display = 'none';
        }
        
        this.editingAlbumId = albumId;
        const isEditing = albumId !== null;
        
        if (modalTitle) {
            modalTitle.textContent = isEditing ? 'Manage Album' : 'Create New Album';
        }
        
        if (saveAlbumBtn) {
            saveAlbumBtn.innerHTML = isEditing ? '<i class="fas fa-save"></i> Update Album' : '<i class="fas fa-folder-plus"></i> Create Album';
        }
        
        // Show/hide delete button based on edit mode
        if (deleteAlbumBtn) {
            deleteAlbumBtn.style.display = isEditing ? 'inline-flex' : 'none';
        }
        
        // Show informative message instead of photo selection
        const infoMessage = document.createElement('div');
        infoMessage.className = 'no-photos-message';
        infoMessage.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <p>Photos cannot be added to albums during creation.</p>
            <p>After creating the album, go to a photo and use the "Add to Album" option.</p>
        `;
        
        if (isEditing) {
            const album = this.albums.find(a => a.id === albumId);
            if (album) {
                const albumNameInput = document.getElementById('albumName');
                const albumDescriptionInput = document.getElementById('albumDescription');
                
                if (albumNameInput) albumNameInput.value = album.name;
                if (albumDescriptionInput) albumDescriptionInput.value = album.description || '';
            }
        } else {
            const albumNameInput = document.getElementById('albumName');
            const albumDescriptionInput = document.getElementById('albumDescription');
            
            if (albumNameInput) albumNameInput.value = '';
            if (albumDescriptionInput) albumDescriptionInput.value = '';
        }
        
        // Setup delete album button to show inline confirmation
        if (deleteAlbumBtn) {
            const newDeleteBtn = deleteAlbumBtn.cloneNode(true);
            deleteAlbumBtn.parentNode.replaceChild(newDeleteBtn, deleteAlbumBtn);
            
            newDeleteBtn.addEventListener('click', () => {
                if (this.editingAlbumId) {
                    newDeleteBtn.style.display = 'none';
                    if (deleteConfirm) {
                        deleteConfirm.style.display = 'block';
                    }
                }
            });
        }
        
        // Setup confirm delete button
        const confirmDeleteBtn = document.getElementById('confirmAlbumDeleteBtn');
        if (confirmDeleteBtn) {
            const newConfirmBtn = confirmDeleteBtn.cloneNode(true);
            confirmDeleteBtn.parentNode.replaceChild(newConfirmBtn, confirmDeleteBtn);
            
            newConfirmBtn.addEventListener('click', async () => {
                if (this.editingAlbumId) {
                    const album = this.albums.find(a => a.id === this.editingAlbumId);
                    if (album) {
                        newConfirmBtn.disabled = true;
                        newConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
                        
                        await this.deleteAlbumFromFirebase(this.editingAlbumId);
                        
                        if (this.currentFilter === this.editingAlbumId) {
                            this.currentFilter = 'home';
                            const currentFilterTitle = document.getElementById('currentFilterTitle');
                            const manageAlbumBtn = document.getElementById('manageAlbumBtn');
                            if (currentFilterTitle) currentFilterTitle.textContent = 'Home';
                            if (manageAlbumBtn) manageAlbumBtn.style.display = 'none';
                        }
                        
                        this.updateSystemAlbumCounts();
                        this.renderPhotosGrid();
                        this.renderAlbumsGrid();
                        this.updatePhotoCountBadge();
                        
                        this.showNotification(`Album "${album.name}" deleted successfully`);
                        
                        this.closeAlbumModal();
                    }
                }
            });
        }
        
        // Setup cancel delete button
        const cancelDeleteBtn = document.getElementById('cancelAlbumDeleteBtn');
        if (cancelDeleteBtn) {
            const newCancelBtn = cancelDeleteBtn.cloneNode(true);
            cancelDeleteBtn.parentNode.replaceChild(newCancelBtn, cancelDeleteBtn);
            
            newCancelBtn.addEventListener('click', () => {
                if (deleteConfirm) {
                    deleteConfirm.style.display = 'none';
                }
                if (deleteAlbumBtn) {
                    deleteAlbumBtn.style.display = 'inline-flex';
                }
            });
        }
    }
}

// Updated createAlbum method - removed photo selection dependency
async createAlbum() {
    const albumName = document.getElementById('albumName')?.value.trim();
    const description = document.getElementById('albumDescription')?.value.trim();

    if (!albumName) {
        this.showNotification('Please enter an album name', 'error');
        return;
    }

    if (albumName.includes(' ')) {
        this.showNotification('Album name must be a single word (no spaces allowed)', 'error');
        return;
    }

    if (albumName.length > 12) {
        this.showNotification('Album name must be 12 characters or less', 'error');
        return;
    }

    const isEditing = this.editingAlbumId !== null;
    
    if (isEditing) {
        const album = this.albums.find(a => a.id === this.editingAlbumId);
        
        if (album && !album.isSystemAlbum) {
            const nameConflict = this.albums.some(a => 
                a.id !== this.editingAlbumId && 
                a.name.toLowerCase() === albumName.toLowerCase() &&
                !a.isSystemAlbum
            );
            
            if (nameConflict) {
                this.showNotification('An album with this name already exists', 'error');
                return;
            }
            
            album.name = albumName;
            album.description = description || '';
            // Keep existing photos when editing
            album.lastModified = Date.now();
            
            await this.saveAlbumToFirebase(album);
            
            this.showNotification(`Album "${albumName}" updated successfully!`);
        }
    } else {
        if (this.albums.some(a => 
            a.name.toLowerCase() === albumName.toLowerCase() && 
            !a.isSystemAlbum
        )) {
            this.showNotification('An album with this name already exists', 'error');
            return;
        }

        const newAlbum = {
            id: this.generateAlbumId(),
            name: albumName,
            description: description || '',
            count: 0, // Start with 0 photos
            icon: 'fas fa-folder',
            color: this.getRandomColor(),
            photos: [], // Start with empty array
            createdDate: new Date().toISOString(),
            isSystemAlbum: false,
            lastModified: Date.now()
        };

        await this.saveAlbumToFirebase(newAlbum);
        
        this.showNotification(`Album "${albumName}" created successfully! Add photos by clicking on a photo and using "Add to Album".`);
    }
    
    this.renderAlbumsGrid();
    this.closeAlbumModal();
    this.editingAlbumId = null;
}

// Updated closeAlbumModal
closeAlbumModal() {
    const albumModal = document.getElementById('albumModal');
    const albumNameInput = document.getElementById('albumName');
    const albumDescriptionInput = document.getElementById('albumDescription');
    const deleteConfirm = document.getElementById('albumDeleteConfirm');
    const deleteAlbumBtn = document.getElementById('deleteAlbumBtn');
    
    if (albumModal) {
        albumModal.style.display = 'none';
        // Reset delete confirmation
        if (deleteConfirm) {
            deleteConfirm.style.display = 'none';
        }
        if (deleteAlbumBtn && this.editingAlbumId) {
            deleteAlbumBtn.style.display = 'inline-flex';
        }
    }
    if (albumNameInput) albumNameInput.value = '';
    if (albumDescriptionInput) albumDescriptionInput.value = '';
    
    this.editingAlbumId = null;
}

closeDeleteModal() {
    const modal = document.getElementById('confirmBatchDelete');
    if (modal) {
        modal.style.display = 'none';
    }
    this.itemToDelete = null;
}


    // ========== BATCH MODE ==========

    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        if (!this.batchMode) {
            this.clearBatchSelection();
        }
        this.updateBatchModeUI();
        this.renderPhotosGrid();
    }

    clearBatchSelection() {
        this.selectedPhotos.clear();
        this.updateBatchDeleteButton();
    }

    selectAllPhotos() {
        const filteredPhotos = this.getFilteredPhotos();
        filteredPhotos.forEach(photo => {
            this.selectedPhotos.add(photo.id);
        });
        this.updateBatchDeleteButton();
        this.renderPhotosGrid();
    }

    updateBatchDeleteButton() {
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        const selectionCount = document.getElementById('selectionCount');
        const batchActions = document.getElementById('batchActions');
        
        if (batchDeleteBtn && selectionCount && batchActions) {
            const count = this.selectedPhotos.size;
            
            if (count > 0) {
                batchDeleteBtn.disabled = false;
                selectionCount.textContent = `${count} photo${count !== 1 ? 's' : ''}`;
                batchActions.style.display = 'flex';
            } else {
                batchDeleteBtn.disabled = true;
                selectionCount.textContent = 'No photos selected';
                batchActions.style.display = 'none';
            }
        }
    }

    // Update UI
    updateBatchModeUI() {
        const batchModeBtn = document.getElementById('batchModeBtn');
        const normalActions = document.getElementById('normalActions');
        const batchActions = document.getElementById('batchActions');
        const photosGrid = document.getElementById('photosGrid');
        
        if (batchModeBtn && normalActions && batchActions) {
            if (this.batchMode) {
                batchModeBtn.classList.add('active');
                batchModeBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
                normalActions.style.display = 'none';
                batchActions.style.display = 'flex';
                // Clear selection when entering batch mode
                this.selectedPhotos.clear();
            } else {
                batchModeBtn.classList.remove('active');
                batchModeBtn.innerHTML = '<i class="fas fa-check-square"></i> Select';
                normalActions.style.display = 'flex';
                batchActions.style.display = 'none';
                // Clear selection when exiting batch mode
                this.selectedPhotos.clear();
            }
            this.updateBatchDeleteButton();
            this.renderPhotosGrid(); // Re-render to show/hide checkboxes
        }
    }


    // ========== FILE SELECTION ==========

    showFilePreview(files) {
        const filePreview = document.getElementById('filePreview');
        const startUploadBtn = document.getElementById('startUploadBtn');
        
        filePreview.innerHTML = '';
        filePreview.style.display = 'block';
        
        files.forEach((file, index) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const previewItem = document.createElement('div');
                    previewItem.className = 'preview-item';
                    previewItem.innerHTML = `
                        <img src="${e.target.result}" alt="${file.name}">
                        <div class="photo-preview-info">
                            <span class="preview-name">${file.name}</span>
                            <span class="preview-size">${this.formatFileSize(file.size)}</span>
                        </div>
                    `;
                    filePreview.appendChild(previewItem);
                };
                reader.readAsDataURL(file);
            }
        });
        
        if (startUploadBtn) {
            startUploadBtn.style.display = 'block';
        }
    }

     // Handle file selection
    handleFileSelect(e) {
        const files = Array.from(e.target.files || e.dataTransfer?.files || []);
        
        if (files.length === 0) return;
        
        // Check if adding these files would exceed total limit
        if (this.photos.length + files.length > this.uploadLimits.maxTotalPhotos) {
            const remaining = this.uploadLimits.maxTotalPhotos - this.photos.length;
            this.showNotification(
                `Cannot upload ${files.length} photos. You can only upload ${remaining} more photos. Maximum limit is ${this.uploadLimits.maxTotalPhotos} photos.`,
                'error'
            );
            return;
        }
        
        // Check max files per upload
        if (files.length > this.uploadLimits.maxFilesPerUpload) {
            this.showNotification(
                `Too many files. You can upload maximum ${this.uploadLimits.maxFilesPerUpload} files at once.`,
                'error'
            );
            return;
        }
        
        // Check individual file sizes
        const oversizedFiles = [];
        files.forEach(file => {
            const fileSizeMB = file.size / (1024 * 1024);
            if (fileSizeMB > this.uploadLimits.maxFileSizeMB) {
                oversizedFiles.push(`${file.name} (${fileSizeMB.toFixed(1)}MB)`);
            }
        });
        
        if (oversizedFiles.length > 0) {
            this.showNotification(
                `Files too large (max ${this.uploadLimits.maxFileSizeMB}MB each): ${oversizedFiles.join(', ')}`,
                'error'
            );
            return;
        }
        
        // Check file types
        const invalidFiles = [];
        files.forEach(file => {
            if (!file.type.startsWith('image/')) {
                invalidFiles.push(file.name);
            }
        });
        
        if (invalidFiles.length > 0) {
            this.showNotification(
                `Invalid file type. Please upload images only: ${invalidFiles.join(', ')}`,
                'error'
            );
            return;
        }
        
        // All checks passed
        this.showFilePreview(files);
        this.selectedFiles = files;
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('photoUploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('drag-over');
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('drag-over');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileSelect({ target: { files } });
                }
            });
        }
    }

   
    // ========== UTILITIES ==========

// ========== UTILITIES ==========

// Show notification using the bottom info bar
// From photos-module.js - showNotification method
// ========== UTILITIES ==========
// Backward compatibility wrapper
showNotification(message, type = 'success') {
    if (window.toastManager) {
        window.toastManager.show(message, type);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}



    // Check and show limit warning
    checkAndShowLimitWarning() {
        const currentCount = this.photos.length;
        const maxLimit = this.uploadLimits.maxTotalPhotos;
        
        const warningThreshold = maxLimit * 0.8;
        
        if (currentCount >= warningThreshold && currentCount < maxLimit) {
            const remaining = maxLimit - currentCount;
            
            if (remaining <= 10) {
                this.showNotification(
                    `Warning: You have only ${remaining} photo${remaining !== 1 ? 's' : ''} remaining. Maximum limit is ${maxLimit}.`,
                    'warning'
                );
            } else if (currentCount >= warningThreshold) {
                this.showNotification(
                    `Warning: You have used ${currentCount} of ${maxLimit} photos (${Math.round((currentCount/maxLimit)*100)}%).`,
                    'warning'
                );
            }
        }
        
        if (currentCount >= maxLimit) {
            this.showNotification(
                `Photo library is full! Maximum limit of ${maxLimit} photos reached. Delete some photos to upload more.`,
                'error'
            );
        }
    }

    updatePhotoCountBadge() {
        const badge = document.getElementById('photoCountBadge');
        if (badge) {
            badge.innerHTML = `
                <i class="fas fa-images"></i>
                <span>${this.photos.length}/${this.uploadLimits.maxTotalPhotos}</span>
            `;
            badge.title = `${this.photos.length} of ${this.uploadLimits.maxTotalPhotos} photos`;
            
            const percentage = this.photos.length / this.uploadLimits.maxTotalPhotos;
            if (percentage >= 0.9) {
                badge.style.background = '#fff5f5';
                badge.style.borderColor = '#fecaca';
                badge.style.color = '#dc2626';
            } else if (percentage >= 0.7) {
                badge.style.background = '#fffbeb';
                badge.style.borderColor = '#fde68a';
                badge.style.color = '#d97706';
            }
        }
    }
    
    toggleBlur() {
        this.blurEnabled = !this.blurEnabled;
        
        document.querySelectorAll('.photo-thumbnail img').forEach(img => {
            if (this.blurEnabled) {
                img.style.filter = 'blur(3px)';
            } else {
                img.style.filter = 'none';
            }
        });
        
        const toggleIcon = document.getElementById('blurToggleIcon');
        const toggleBtn = document.getElementById('toggleBlurBtn');
        
        if (toggleIcon) {
            toggleIcon.className = this.blurEnabled ? 'fas fa-eye-slash' : 'fas fa-eye';
        }
        
        if (toggleBtn) {
            toggleBtn.title = this.blurEnabled ? 'Disable blur effect' : 'Enable blur effect';
        }
    }


    // ========== RESET & CLEANUP ==========

    // Reset data for logout
    async resetDataForLogout() {
        try {
            // Clear Firebase listeners
            if (this.firebaseListeners.photos) {
                const homeDb = window.authModule?.getHomeDatabaseInstance();
                if (homeDb && homeDb.db) {
                    const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
                    if (encodedPhone) {
                        const photosRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/photos`);
                        photosRef.off('child_added', this.firebaseListeners.photos.added);
                        photosRef.off('child_changed', this.firebaseListeners.photos.changed);
                        photosRef.off('child_removed', this.firebaseListeners.photos.removed);
                        
                        const albumsRef = homeDb.db.ref(`userData/${encodedPhone}/photosModuleData/albums`);
                        albumsRef.off('child_added', this.firebaseListeners.albums.added);
                        albumsRef.off('child_changed', this.firebaseListeners.albums.changed);
                        albumsRef.off('child_removed', this.firebaseListeners.albums.removed);
                    }
                }
            }

            // Clear IndexedDB
            if (this.db) {
                const transaction = this.db.transaction(['photos', 'albums', 'syncMetadata'], 'readwrite');
                transaction.objectStore('photos').clear();
                transaction.objectStore('albums').clear();
                transaction.objectStore('syncMetadata').clear();
            }
            
            // Reset to empty state
            this.photos = [];
            this.albums = this.getDefaultAlbums();
            this.selectedFiles = null;
            this.currentFilter = 'home';
            this.editingAlbumId = null;
            this.itemToDelete = null;
            this.currentPhotoId = null;
            this.pendingOperations.clear();
            this.firebaseListeners = {};
            this.selectedPhotos.clear();
            this.batchMode = false;
            
            console.log('Photos module reset for logout');
            
            if (document.getElementById('photosGrid')) {
                this.renderPhotosGrid();
                this.renderAlbumsGrid();
            }
            
            return true;
        } catch (error) {
            console.error('Error resetting photos data for logout:', error);
            return false;
        }
    }

    // Clear local data only
    async clearLocalData() {
        try {
            if (this.db) {
                const transaction = this.db.transaction(['photos', 'albums', 'syncMetadata'], 'readwrite');
                transaction.objectStore('photos').clear();
                transaction.objectStore('albums').clear();
                transaction.objectStore('syncMetadata').clear();
            }
            
            this.photos = [];
            this.albums = [];
            this.selectedFiles = null;
            this.currentFilter = 'home';
            this.editingAlbumId = null;
            this.itemToDelete = null;
            this.currentPhotoId = null;
            this.pendingOperations.clear();
            this.selectedPhotos.clear();
            this.batchMode = false;
            
            console.log('Photos module local data cleared');
            
            return true;
        } catch (error) {
            console.error('Error clearing photos local data:', error);
            return false;
        }
    }


    shareCurrentPhoto(photoId) {
        const photo = this.photos.find(p => p.id === photoId);
        if (!photo) return;

        // Close photo view
        const photoViewSection = document.getElementById('photoViewSection');
        if (photoViewSection) photoViewSection.style.display = 'none';

        // Pass photo to share module
        if (window.shareModule && typeof window.shareModule.prepareShareWithPhoto === 'function') {
            window.shareModule.prepareShareWithPhoto(photo);
        }

        // Navigate to share page
        if (window.xDrive && window.xDrive.navigateToModule) {
            window.xDrive.navigateToModule('share');
        } else {
            // Fallback: trigger click on share menu item
            const shareMenuItem = document.querySelector('.navbar-menu .menu-item[data-page="share"]');
            if (shareMenuItem) shareMenuItem.click();
        }

        this.showNotification('Opening share with selected photo...', 'info');
    }
}

// Initialize photos module globally
let photosModule;

document.addEventListener('DOMContentLoaded', function() {
    photosModule = new PhotosModule();
    window.photosModule = photosModule;
    
    window.addEventListener('authSuccess', async () => {
        if (photosModule) {
            await photosModule.initFirebaseSync();
            photosModule.renderPhotosGrid();
            photosModule.renderAlbumsGrid();
        }
    });
    
    window.addEventListener('authLogout', function() {
        if (photosModule) {
            photosModule.resetDataForLogout();
        }
    });
});