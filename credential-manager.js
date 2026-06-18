
class CredentialManager {
    constructor() {
        // ========== 1. CORE PROPERTIES ==========
        this.credentials = [];
        this.serviceKeywords = {};
        this.showPasswords = false;
        
        // ========== 2. INDEXEDDB PROPERTIES ==========
        this.dbName = 'CredentialDatabase';
        this.dbVersion = 2;
        this.db = null;
        
        // ========== 3. FIREBASE SYNC PROPERTIES ==========
        this.syncInProgress = false;
        this.isInitialized = false;
        this.pendingOperations = new Map();
        this.firebaseListeners = {};
        
        // ========== 5. TOTP PROPERTIES ==========
        this.totpInterval = null;
        this.currentTotpCodes = new Map();
        this.totpRefreshTimer = null;
        
        // ========== 6. UI STATE PROPERTIES ==========
        this.currentPreviewFilter = 'all';
        this.currentSearchTerm = '';
        this.isUpdating = false;
        this.debounceTimer = null;
        this.searchDebounceTimer = null;
        this.syncTimer = null;
        this.previewUpdateTimer = null;
        
        // Initialize
        this.initializeServiceKeywords();
        this.init();

        // ========== 7. FORM STATE PROPERTIES ==========
        this.isEditing = false;
        this.editingRowIndex = null;
        this.currentFormData = {
            serviceTag: '',
            username: '',
            password: '',
            twofa: '',
            customField: '',
            note: ''
        };
    }

    // ========== INITIALIZATION & SETUP ==========
    async init() {
        console.log('Credential Manager initializing with Firebase primary storage');
        
        // Initialize IndexedDB first
        await this.initIndexedDB();
        
        // Load from IndexedDB cache first (this will display data immediately)
        await this.loadFromIndexedDB();
        
        // Render UI if container exists (this will show cached data immediately)
        if (document.getElementById('credentialContainer')) {
            this.render('credentialContainer');
        }
        
        // Then load data from Firebase in background (this will sync and update)
        await this.initFirebaseSync();
        
        // Start TOTP timer after everything is loaded
        this.startTOTPTimer();

        this.updateFilterCount();
        
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
                console.log('Credential IndexedDB initialized successfully');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create credentials store with proper schema
                if (!db.objectStoreNames.contains('credentials')) {
                    const credentialStore = db.createObjectStore('credentials', { keyPath: 'id' });
                    credentialStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                    credentialStore.createIndex('syncVersion', 'syncVersion', { unique: false });
                }
                
                // Create syncMetadata store
                if (!db.objectStoreNames.contains('syncMetadata')) {
                    db.createObjectStore('syncMetadata', { keyPath: 'key' });
                }
                
                console.log('Credential IndexedDB schema created');
            };
        });
    }

    // Load credentials from IndexedDB
    async loadFromIndexedDB() {
        try {
            const data = await this.getFromIndexedDB('credentials', 'main_credentials');
            if (data && data.credentials && data.credentials.length > 0) {
                this.credentials = data.credentials;
                this.showPasswords = data.showPasswords || false;
                
                // Validate that credentials have proper structure
                if (this.credentials[0] && this.credentials[0].entries && this.credentials[0].entries.length > 0) {
                    console.log('Credential data loaded from IndexedDB cache, entries count:', this.credentials[0].entries.length);
                } else {
                    // If cached data is invalid, initialize empty
                    console.log('Cached credential data was invalid, initializing empty');
                    this.initializeEmptyData();
                }
            } else {
                // No data in cache, initialize empty
                console.log('No credential data found in IndexedDB cache, initializing empty');
                this.initializeEmptyData();
            }
            
            // Update UI if rendered
            if (document.getElementById('credential')) {
                this.updatePreview();
            }

            this.updateFilterCount();

        } catch (error) {
            console.error('Error loading from IndexedDB:', error);
            this.initializeEmptyData();
        }
    }

    // Get item from IndexedDB
    async getFromIndexedDB(storeName, id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve(null);
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }
    
    // Save metadata to IndexedDB
    async saveSyncMetadataToIndexedDB(key, value) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['syncMetadata'], 'readwrite');
            const store = transaction.objectStore('syncMetadata');
            const request = store.put({ key, value, timestamp: Date.now() });
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Get metadata from IndexedDB
    async getSyncMetadataFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve(null);
                return;
            }
            
            const transaction = this.db.transaction(['syncMetadata'], 'readonly');
            const store = transaction.objectStore('syncMetadata');
            const request = store.get(key);
            
            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result.value : null);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Initialize Firebase sync
    async initFirebaseSync() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Firebase sync not available - user not authenticated');
            return;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return;

            console.log('Setting up Firebase real-time listeners for credentials...');

            // Listen for credential data changes
            const credRef = homeDb.db.ref(`userData/${encodedEmail}/credentialData`);
            this.setupFirebaseListener('credentials', credRef);

            // Load initial data from Firebase
            await this.loadFromFirebase();

        } catch (error) {
            console.error('Error initializing Firebase sync:', error);
        }
    }

    // Setup Firebase real-time listener
    setupFirebaseListener(type, ref) {
        if (this.firebaseListeners[type]) {
            if (this.firebaseListeners[type].value) {
                ref.off('value', this.firebaseListeners[type].value);
            }
        }

        const listener = (snapshot) => {
            const data = snapshot.val();
            if (data && this.pendingOperations.size === 0) {
                this.handleFirebaseUpdate(data);
            }
        };

        ref.on('value', listener);
        this.firebaseListeners[type] = { value: listener };
    }


    // Load from Firebase
    async loadFromFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Cannot load from Firebase - user not authenticated');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return false;

            console.log('Loading credential data from Firebase...');

            const ref = homeDb.db.ref(`userData/${encodedEmail}/credentialData`);
            const snapshot = await ref.once('value');
            const firebaseData = snapshot.val();

            if (firebaseData && Object.keys(firebaseData).length > 0) {
                const metadata = firebaseData._metadata || {};
                delete firebaseData._metadata;
                
                const entries = [];
                const rowIds = Object.keys(firebaseData).filter(key => key.startsWith('credential_'));
                
                const sortedRows = rowIds
                    .map(id => ({ id, data: firebaseData[id] }))
                    .sort((a, b) => (a.data.rowIndex || 0) - (b.data.rowIndex || 0));
                
                for (const { data } of sortedRows) {
                    // Get row-level pending status
                    const isRowPending = data.pending || false;
                    const pendingAt = data.pendingAt || null;
                    
                    // Apply the SAME pending status to ALL fields in the row
                    entries.push({ 
                        value: data.serviceTag || '', 
                        display: data.serviceTag || '', 
                        pending: isRowPending,  // Use row-level pending
                        pendingAt: pendingAt,
                        isEmpty: !data.serviceTag, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: data.username || '', 
                        display: data.username || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !data.username, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: data.password || '', 
                        display: data.password || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !data.password, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: data.twofa || '',           
                        display: data.twofa || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !data.twofa, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: data.customField || '',
                        display: data.customField || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !data.customField, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1,
                        customLabel: data.customFieldLabel || 'Custom Field'
                    });
                    entries.push({ 
                        value: data.note || '',
                        display: data.note || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !data.note, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                }
                
                const firebaseCredentials = [{
                    id: 1,
                    entries: entries.length > 0 ? entries : this.getDefaultEntries(),
                    lastUpdated: metadata.lastSync || 'Never'
                }];
                
                // Compare with current data to see if update is needed
                const needsUpdate = this.hasCredentialDataChanged(firebaseCredentials, this.credentials);
                
                if (needsUpdate) {
                    console.log('Firebase data differs from cache, updating...');
                    this.credentials = firebaseCredentials;
                    this.showPasswords = false;
                    
                    // Save to IndexedDB cache
                    await this.saveToIndexedDB({
                        credentials: this.credentials,
                        showPasswords: this.showPasswords,
                        lastUpdated: metadata.lastSync,
                        syncVersion: metadata.version
                    });
                    
                    // Update UI if rendered
                    if (document.getElementById('credential')) {
                        this.updatePreview();
                    }

                    this.updateFilterCount();
                    console.log('Credential data updated from Firebase');
                } else {
                    console.log('Firebase data matches cache, no update needed');
                }
                return true;
                
            } else {
                // No data in Firebase, upload local data
                console.log('No credential data in Firebase, uploading local cache...');
                await this.saveAllRowsToFirebase();
                return false;
            }
            
        } catch (error) {
            console.error('Error loading from Firebase:', error);
            return false;
        }
    }

    // Helper method to compare credential data
    hasCredentialDataChanged(firebaseData, localData) {
        if (!firebaseData || !localData) return true;
        if (firebaseData.length !== localData.length) return true;
        
        const firebaseEntries = firebaseData[0]?.entries || [];
        const localEntries = localData[0]?.entries || [];
        
        if (firebaseEntries.length !== localEntries.length) return true;
        
        // Check if any values are different
        for (let i = 0; i < firebaseEntries.length; i++) {
            if (firebaseEntries[i]?.value !== localEntries[i]?.value) {
                return true;
            }
            if (firebaseEntries[i]?.pending !== localEntries[i]?.pending) {
                return true;
            }
        }
        
        return false;
    }

    // Initialize empty data
    initializeEmptyData() {
        console.log('Initializing empty credential data');
        
        const defaultEntries = [];
        for (let i = 0; i < 6; i++) {
            defaultEntries.push({
                value: '',
                display: '',
                pending: false,
                pendingAt: null,
                isEmpty: true,
                isWhitespaceOnly: false,
                originalIndex: i,
                lineNumber: 1
            });
        }
        
        this.credentials = [{
            id: 1,
            entries: defaultEntries,
            lastUpdated: "Never",
        }];
        
        // Save to IndexedDB immediately
        this.saveToStorage();
        
        console.log('Empty credential data initialized');
    }

    // Get default entries
    getDefaultEntries() {
        const defaultEntries = [];
        for (let i = 0; i < 6; i++) {
            defaultEntries.push({
                value: '',
                display: '',
                pending: false,
                pendingAt: null,
                isEmpty: true,
                isWhitespaceOnly: false,
                originalIndex: i,
                lineNumber: 1
            });
        }
        return defaultEntries;
    }


    // ========== DATABASE OPERATIONS ==========
    // Save all credentials to IndexedDB
    async saveToIndexedDB(data) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['credentials'], 'readwrite');
            const store = transaction.objectStore('credentials');
            
            const credentialData = {
                id: 'main_credentials',
                credentials: data.credentials,
                showPasswords: data.showPasswords,
                lastUpdated: data.lastUpdated || new Date().toISOString(),
                syncVersion: data.syncVersion || Date.now()
            };
            
            const request = store.put(credentialData);
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Save credential data to Firebase (primary operation)
    async saveToFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Cannot save to Firebase - user not authenticated');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return false;

            // Mark as pending operation
            this.pendingOperations.set('credential_sync', true);

            // Prepare data for Firebase
            const firebaseData = {
                metadata: {
                    credentialCount: this.credentials.reduce((total, cred) => 
                        total + (cred.entries ? cred.entries.length : 0), 0),
                    lastUpdated: new Date().toISOString(),
                    syncVersion: Date.now(),
                    showPasswords: this.showPasswords
                },
                credentials: this.credentials.map(credential => ({
                    id: credential.id,
                    entries: credential.entries ? credential.entries.map(entry => ({
                        value: entry.value,
                        display: entry.display,
                        pending: entry.pending || false,
                        pendingAt: entry.pendingAt || null,
                        isEmpty: entry.isEmpty || false,
                        isWhitespaceOnly: entry.isWhitespaceOnly || false,
                        originalIndex: entry.originalIndex || 0,
                        lineNumber: entry.lineNumber || 0
                    })) : [],
                    lastUpdated: credential.lastUpdated || 'Never'
                }))
            };

            // Save to Firebase
            const ref = homeDb.db.ref(`userData/${encodedEmail}/credentialData`);
            await ref.set(firebaseData);

            // Save to IndexedDB cache
            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: firebaseData.metadata.lastUpdated,
                syncVersion: firebaseData.metadata.syncVersion
            });

            return true;

        } catch (error) {
            console.error('Error saving to Firebase:', error);
            this.showNotification('Error saving to cloud', 'error');
            return false;
        }
    }

    // Save to local storage
    async saveToStorage() {
        if (this.isUpdating) return;
        
        try {
            this.isUpdating = true;
            
            // Save to IndexedDB cache
            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: new Date().toISOString(),
                syncVersion: Date.now()
            });
            
            console.log('Credential data saved to IndexedDB cache');
            
            // Queue sync to Firebase
            setTimeout(() => this.syncToFirebase(), 100);
            
        } catch (error) {
            console.error('Error saving to IndexedDB:', error);
        } finally {
            this.isUpdating = false;
        }
    }


    // ========== FIREBASE SYNC OPERATIONS ==========
    // Handle Firebase update
    async handleFirebaseUpdate(data) {
        if (this.pendingOperations.size > 0) return;
        
        console.log('Firebase credential data updated');
        
        if (data && typeof data === 'object') {
            const metadata = data._metadata;
            delete data._metadata;
            
            const rowIds = Object.keys(data).filter(key => key.startsWith('credential_'));
            
            if (rowIds.length > 0) {
                // Convert Firebase data back to entries array
                const entries = [];
                const sortedRows = rowIds
                    .map(id => ({ id, rowData: data[id] }))
                    .sort((a, b) => (a.rowData.rowIndex || 0) - (b.rowData.rowIndex || 0));
                
                for (const { rowData } of sortedRows) {
                    // Get row-level pending status
                    const isRowPending = rowDataata.pending || false;
                    const pendingAt = rowDataata.pendingAt || null;
                    
                    // Apply the SAME pending status to ALL fields in the row
                    entries.push({ 
                        value: rowData.serviceTag || '', 
                        display: rowData.serviceTag || '', 
                        pending: isRowPending,  // Use row-level pending
                        pendingAt: pendingAt,
                        isEmpty: !rowData.serviceTag, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: rowData.username || '', 
                        display: rowData.username || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !rowData.username, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: rowData.password || '', 
                        display: rowData.password || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !rowData.password, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: rowData.twofa || '',           
                        display: rowData.twofa || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !rowData.twofa, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                    entries.push({ 
                        value: rowData.customField || '',
                        display: rowData.customField || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !rowData.customField, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1,
                        customLabel: rowData.customFieldLabel || 'Custom Field'
                    });
                    entries.push({ 
                        value: rowData.note || '',
                        display: rowData.note || '', 
                        pending: isRowPending,  // Same for all fields
                        pendingAt: pendingAt,
                        isEmpty: !rowData.note, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 6) + 1 
                    });
                }
                
                const newCredentials = [{
                    id: 1,
                    entries: entries,
                    lastUpdated: metadata?.lastSync || 'Never'
                }];
                
                // Check if data actually changed
                if (this.hasCredentialDataChanged(newCredentials, this.credentials)) {
                    this.credentials = newCredentials;
                    
                    // Save to IndexedDB cache
                    await this.saveToIndexedDB({
                        credentials: this.credentials,
                        showPasswords: this.showPasswords,
                        lastUpdated: metadata?.lastSync,
                        syncVersion: metadata?.version
                    });
                    
                    // Update UI if rendered
                    if (document.getElementById('credential')) {
                        this.updatePreview();
                    }
                    
                    console.log('Credential data updated from Firebase real-time update');
                } else {
                    console.log('Firebase update received but data unchanged');
                }
            }
        }
    }

    // Save credential row to Firebase
    async saveCredentialRowToFirebase(rowId, rowData) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return false;

            // Mark as pending operation
            this.pendingOperations.set(`credential_sync_${rowId}`, true);

            // Save to Firebase
            const ref = homeDb.db.ref(`userData/${encodedEmail}/credentialData/${rowId}`);
            await ref.set(rowData);

            setTimeout(() => {
                this.pendingOperations.delete(`credential_sync_${rowId}`);
            }, 500);

            console.log(`Credential row ${rowId} saved to Firebase`);
            return true;

        } catch (error) {
            console.error('Error saving credential row to Firebase:', error);
            this.showNotification('Error saving to cloud', 'error');
            return false;
        }
    }

    // Save all credential rows to Firebase
    async saveAllRowsToFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return false;

            const credentialSet = this.getCredentialSet();
            const entries = credentialSet.entries || [];
            const rows = Math.ceil(entries.length / 6);
            
            const updates = {};
            
            for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
                const startIndex = rowIndex * 6;
                const rowId = `credential_${rowIndex}`;
                
                // Check if the ENTIRE ROW is pending
                const isRowPending = entries[startIndex]?.pending || false;
                
                const rowData = {
                    serviceTag: entries[startIndex]?.value || '',
                    username: entries[startIndex + 1]?.value || '',
                    password: entries[startIndex + 2]?.value || '',
                    twofa: entries[startIndex + 3]?.value || '',
                    customField: entries[startIndex + 4]?.value || '',
                    customFieldLabel: entries[startIndex + 4]?.customLabel || 'Custom Field',
                    note: entries[startIndex + 5]?.value || '',
                    // SINGLE pending flag
                    pending: isRowPending,
                    pendingAt: entries[startIndex]?.pendingAt || null,
                    rowIndex: rowIndex,
                    lastUpdated: new Date().toISOString()
                };
                
                updates[`userData/${encodedEmail}/credentialData/${rowId}`] = rowData;
            }
            
            // Store metadata
            updates[`userData/${encodedEmail}/credentialData/_metadata`] = {
                totalRows: rows,
                lastSync: new Date().toISOString(),
                version: Date.now()
            };
            
            const ref = homeDb.db.ref();
            await ref.update(updates);
            
            console.log(`All ${rows} credential rows saved to Firebase with row-level pending`);
            return true;

        } catch (error) {
            console.error('Error saving all rows to Firebase:', error);
            this.showNotification('Error saving to cloud', 'error');
            return false;
        }
    }

    // Sync to Firebase
    async syncRowToFirebase(rowIndex) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }
        
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        const startIndex = rowIndex * 6;
        
        // Check if the ENTIRE ROW is pending (check first field, since all are synced)
        const isRowPending = entries[startIndex]?.pending || false;
        
        const rowData = {
            serviceTag: entries[startIndex]?.value || '',
            username: entries[startIndex + 1]?.value || '',
            password: entries[startIndex + 2]?.value || '',
            twofa: entries[startIndex + 3]?.value || '',
            customField: entries[startIndex + 4]?.value || '',
            customFieldLabel: entries[startIndex + 4]?.customLabel || 'Custom Field',
            note: entries[startIndex + 5]?.value || '',
            // SINGLE pending flag for the entire row
            pending: isRowPending,
            pendingAt: entries[startIndex]?.pendingAt || null,
            rowIndex: rowIndex,
            lastUpdated: new Date().toISOString()
        };
        
        this.pendingOperations.set(`credential_sync_${rowIndex}`, true);
        const result = await this.saveCredentialRowToFirebase(`credential_${rowIndex}`, rowData);
        
        setTimeout(() => {
            this.pendingOperations.delete(`credential_sync_${rowIndex}`);
        }, 500);
        
        return result;
    }


    // New method to sync after row deletion
    async syncAfterRowDeletion(deletedRowIndices) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return;
        }
        
        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;
            
            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return;
            
            const credentialSet = this.getCredentialSet();
            const entries = credentialSet.entries || [];
            const rowsCount = Math.ceil(entries.length / 6);
            
            // Mark sync operation as pending
            this.pendingOperations.set('credential_sync', true);
            
            const updates = {};
            const deletions = {};
            
            // Prepare updates for remaining rows
            for (let rowIndex = 0; rowIndex < rowsCount; rowIndex++) {
                const startIndex = rowIndex * 6;
                const rowId = `credential_${rowIndex}`;
                
                const rowData = {
                    serviceTag: entries[startIndex]?.value || '',
                    username: entries[startIndex + 1]?.value || '',
                    password: entries[startIndex + 2]?.value || '',
                    note: entries[startIndex + 5]?.value || '',
                    twofa: entries[startIndex + 3]?.value || '',
                    customField: entries[startIndex + 4]?.value || '',
                    pending: entries.slice(startIndex, startIndex + 6).some(entry => entry?.pending),
                    pendingAt: entries[startIndex]?.pendingAt || null,
                    rowIndex: rowIndex,
                    lastUpdated: new Date().toISOString()
                };
                
                updates[`userData/${encodedEmail}/credentialData/${rowId}`] = rowData;
            }
            
            // Mark rows that were deleted for removal
            for (const deletedRowIndex of deletedRowIndices) {
                const oldRowId = `credential_${deletedRowIndex}`;
                deletions[`userData/${encodedEmail}/credentialData/${oldRowId}`] = null;
            }
            
            // Combine updates and deletions
            const allUpdates = { ...updates, ...deletions };
            
            // Store metadata
            allUpdates[`userData/${encodedEmail}/credentialData/_metadata`] = {
                totalRows: rowsCount,
                lastSync: new Date().toISOString(),
                version: Date.now()
            };
            
            // Apply all updates to Firebase
            const ref = homeDb.db.ref();
            await ref.update(allUpdates);
            
            // Save to IndexedDB cache
            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: new Date().toISOString(),
                syncVersion: Date.now()
            });
            
            // Clear pending operation after delay
            setTimeout(() => {
                this.pendingOperations.delete('credential_sync');
            }, 500);
            
            console.log('Empty rows deleted and synced to Firebase');
            
        } catch (error) {
            console.error('Error syncing after row deletion:', error);
            this.showNotification('Error syncing to cloud', 'error');
        }
    }

    // New method to sync after single row deletion
    async syncAfterSingleRowDeletion(deletedRowIndex) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return;
        }
        
        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;
            
            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
            if (!encodedEmail) return;
            
            const credentialSet = this.getCredentialSet();
            const entries = credentialSet.entries || [];
            const rowsCount = Math.ceil(entries.length / 6);
            
            this.pendingOperations.set('credential_sync', true);
            
            const updates = {};
            
            // Update all rows after the deleted one (they shift up)
            for (let rowIndex = 0; rowIndex < rowsCount; rowIndex++) {
                const startIndex = rowIndex * 6;
                const rowId = `credential_${rowIndex}`;
                
                const rowData = {
                    serviceTag: entries[startIndex]?.value || '',
                    username: entries[startIndex + 1]?.value || '',
                    password: entries[startIndex + 2]?.value || '',
                    note: entries[startIndex + 5]?.value || '',
                    twofa: entries[startIndex + 3]?.value || '',
                    customField: entries[startIndex + 4]?.value || '',
                    pending: entries.slice(startIndex, startIndex + 6).some(entry => entry?.pending),
                    pendingAt: entries[startIndex]?.pendingAt || null,
                    rowIndex: rowIndex,
                    lastUpdated: new Date().toISOString()
                };
                
                updates[`userData/${encodedEmail}/credentialData/${rowId}`] = rowData;
            }
            
            // Mark the deleted row for removal (if it existed)
            const deletedRowId = `credential_${deletedRowIndex}`;
            updates[`userData/${encodedEmail}/credentialData/${deletedRowId}`] = null;
            
            // Also remove any rows beyond the new count (if any)
            const oldRowCount = rowsCount + 1;
            for (let i = rowsCount; i < oldRowCount; i++) {
                updates[`userData/${encodedEmail}/credentialData/credential_${i}`] = null;
            }
            
            // Store metadata
            updates[`userData/${encodedEmail}/credentialData/_metadata`] = {
                totalRows: rowsCount,
                lastSync: new Date().toISOString(),
                version: Date.now()
            };
            
            const ref = homeDb.db.ref();
            await ref.update(updates);
            
            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: new Date().toISOString(),
                syncVersion: Date.now()
            });
            
            setTimeout(() => {
                this.pendingOperations.delete('credential_sync');
            }, 500);
            
            console.log(`Row ${deletedRowIndex + 1} deleted and synced to Firebase`);
            
        } catch (error) {
            console.error('Error syncing after row deletion:', error);
            this.showNotification('Error syncing to cloud', 'error');
        }
    }


    // ========== CORE CREDENTIAL OPERATIONS ==========
    // Data Management
    updateCredentials(credentialData) {
        const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
        if (credentialIndex !== -1) {
            this.credentials[credentialIndex] = {
                ...this.credentials[credentialIndex],
                ...credentialData,
                id: 1,
                lastUpdated: 'Just now'
            };
        } else {
            this.credentials.push({
                id: 1,
                ...credentialData,
                lastUpdated: 'Just now'
            });
        }
        
        // Save to local storage and trigger sync
        this.saveToStorage();
    }

    getCredentialSet() {
        // Ensure credentials exists and has at least one entry
        if (!this.credentials || this.credentials.length === 0) {
            this.initializeEmptyData();
        }
        
        const credential = this.credentials.find(cr => cr.id === 1);
        if (!credential) {
            this.initializeEmptyData();
            return this.credentials[0];
        }
        
        return credential;
    }


deleteRow(rowIndex) {
    const credentialSet = this.getCredentialSet();
    const entries = credentialSet.entries || [];
    const startIndex = rowIndex * 6;
    const rowEntries = entries.slice(startIndex, startIndex + 6);
    
    // Check if row has data
    const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
    
    if (!hasData) {
        this.showNotification('Cannot delete empty row', 'warning');
        return;
    }
    
    // Remove any existing confirmation bar
    this.removeDeleteConfirmationBar();
    
    // Get the service name for the confirmation message
    const serviceName = rowEntries[0]?.value || 'Untitled';
    const rowNumber = rowIndex + 1;
    
    // Store the row index to delete
    this.pendingDeleteRowIndex = rowIndex;
    
    // Create and insert confirmation bar at the top (below search/filter)
    const confirmationBar = this.createDeleteConfirmationBar(rowIndex, serviceName, rowNumber);
    
    // Insert after the search/filter section, before preview container
    const previewSection = document.querySelector('.preview-section');
    const previewContainer = document.getElementById('previewContainer');
    
    if (previewSection && previewContainer) {
        // Insert before the preview container
        previewSection.insertBefore(confirmationBar, previewContainer);
    } else {
        // Fallback: insert at the top of preview container
        const container = document.getElementById('previewContainer');
        if (container && container.parentNode) {
            container.parentNode.insertBefore(confirmationBar, container);
        }
    }
    
    // Scroll to the confirmation bar
    confirmationBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Create inline confirmation bar (shown at top below search/filter)
createDeleteConfirmationBar(rowIndex, serviceName, rowNumber) {
    const div = document.createElement('div');
    div.className = 'delete-confirmation-bar';
    div.setAttribute('data-row-index', rowIndex);
    div.style.cssText = `
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 8px;
        margin: 0 0 16px 0;
        padding: 12px 16px;
        animation: slideDown 0.2s ease;
    `;
    
    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; gap: 12px;flex-direction: column;">
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
                        Delete "<strong style="color: var(--danger, #ef4444);">${this.escapeHtml(serviceName)}</strong>" (Row ${rowNumber})?
                    </div>
                    <div style="color: var(--text-secondary, #a0a0b0); font-size: 0.7rem; margin-top: 2px;">
                        All data in this row will be permanently deleted.
                    </div>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 10px; justify-content: flex-end;">
                <button class="delete-confirm-btn btn btn-danger">
                    <i class="fas fa-trash"></i> Delete
                </button>
                <button class="delete-cancel-btn btn btn-secondary">
                    Cancel
                </button>
            </div>
        </div>
        <div class="delete-confirm-error" style="
            color: var(--danger, #ef4444);
            font-size: 0.65rem;
            margin-top: 10px;
            display: none;
        "></div>
    `;
    
    // Add event listeners
    const confirmBtn = div.querySelector('.delete-confirm-btn');
    const cancelBtn = div.querySelector('.delete-cancel-btn');
    const errorDiv = div.querySelector('.delete-confirm-error');
    
    confirmBtn.addEventListener('click', () => {
        this.deleteRowConfirmed(rowIndex);
    });
    
    cancelBtn.addEventListener('click', () => {
        this.removeDeleteConfirmationBar();
        this.pendingDeleteRowIndex = null;
    });
    
    return div;
}

// Remove delete confirmation bar
removeDeleteConfirmationBar() {
    const existingBar = document.querySelector('.delete-confirmation-bar');
    if (existingBar) {
        // Add fade out animation before removal
        existingBar.style.animation = 'fadeOut 0.15s ease';
        setTimeout(() => {
            if (existingBar.parentNode) {
                existingBar.remove();
            }
        }, 150);
    }
}

async deleteRowConfirmed(rowIndex) {
    const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
    if (credentialIndex !== -1) {
        const entries = this.credentials[credentialIndex].entries;
        const startIndex = rowIndex * 6;
        
        entries.splice(startIndex, 6);
        
        entries.forEach((entry, index) => {
            entry.originalIndex = index;
            entry.lineNumber = Math.floor(index / 6) + 1;
        });
        
        this.credentials[credentialIndex].lastUpdated = 'Just now';
        
        await this.saveToStorage();
        await this.syncAfterSingleRowDeletion(rowIndex);
        
        // Remove confirmation bar before updating preview
        this.removeDeleteConfirmationBar();
        this.pendingDeleteRowIndex = null;
        this.updatePreview();
        this.showNotification(`Row ${rowIndex + 1} deleted successfully`, 'success');
    }
}

addDeleteStyles() {
    if (!document.getElementById('delete-styles')) {
        const style = document.createElement('style');
        style.id = 'delete-styles';
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes fadeOut {
                from {
                    opacity: 1;
                    transform: translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateY(-10px);
                }
            }
            
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-4px); }
                75% { transform: translateX(4px); }
            }
            
            .delete-confirmation-bar {
                animation: slideDown 0.2s ease;
            }
        `;
        document.head.appendChild(style);
    }
}


    // ========== UI RENDERING ==========
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Credential container not found:', containerId);
            return;
        }

        container.innerHTML = this.getManagerHTML();
        this.attachEventListeners();
        this.attachFormEventListeners();
        this.updatePreview();
    }

    getManagerHTML() {
        return `
            <div class="credential-container" style="padding: 0; margin: 0">
                ${this.getHeaderHTML()}
                ${this.credentialHTML()}
                ${this.getPreviewSectionHTML()}
            </div>
        `;
    }

    getHeaderHTML() {
        return `
            <div class="module-card">
                <div class="module-icon" style="color: var(--primary);">
                    <span class="material-icons">vpn_key</span>
                </div>
                <div class="module-info">
                    <div class="module-title">Credential Manager</div>
                    <div class="module-description">Responsive sliding columns</div>
                </div>
                <div style="display: flex; gap: 8px; margin-right: 8px;">
                    <button onclick="credentialManager.copyAll()" class="btn btn-secondary">
                        <i class="fas fa-copy"></i> Copy All
                    </button>
                    <button id="toggleCredentialFormBtn" 
                        onclick="credentialManager.toggleCredentialForm()" 
                        class="btn btn-primary"
                        style="display: inline-flex; align-items: center; gap: 8px;">
                        <i class="fas fa-chevron-up"></i> Hide Form
                    </button>
                </div>
            </div>
        `;
    }

    // ========== ADD THIS METHOD TO GET THE FORM HTML ==========
    getCredentialFormHTML() {
        return `
            <div class="settings-card" id="credentialFormCard" style="margin-bottom: 8px;">
                <div class="card-title" style="color: var(--text-secondary);">
                    <span class="material-icons">${this.isEditing ? 'edit_note' : 'add_circle'}</span>
                    ${this.isEditing ? 'Edit Credential' : 'Add New Credential'}
                    ${this.isEditing ? `
                        <button onclick="credentialManager.cancelEdit()" class="btn btn-secondary" style="margin-left: auto;">
                            Cancel
                        </button>
                    ` : ''}
                </div>
                
                <form class="settings-form" id="credentialForm">
                    <div class="form-row">
                        <!-- 1. Service Tag -->
                        <div class="form-group">
                            <label class="form-label" for="formServiceTag">
                                Service Tag <span style="color: var(--danger);">*</span>
                            </label>
                            <input type="text" 
                                id="formServiceTag"
                                class="form-input" style="color: var(--text-secondary);"
                                placeholder="e.g., Google, GitHub, Facebook"
                                autocomplete="off">
                        </div>
                        
                        <!-- 2. Username/ID -->
                        <div class="form-group">
                            <label class="form-label" for="formUsername">
                                Username / Email
                            </label>
                            <input type="text" 
                                id="formUsername"
                                class="form-input" style="color: var(--text-secondary);"
                                placeholder="username@example.com"
                                autocomplete="off">
                        </div>
                        
                        <!-- 3. Password -->
                        <div class="form-group">
                            <label class="form-label" for="formPassword">
                                Password
                            </label>
                            <div class="password-input-group">
                                <input type="password" 
                                    id="formPassword"
                                    class="form-input" style="color: var(--text-secondary);"
                                    placeholder="Enter password"
                                    autocomplete="off">
                                <button type="button" class="toggle-password-btn" data-target="formPassword">
                                    <span class="material-icons">visibility</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- MORE OPTIONS CHECKBOX -->
                    <div style="margin: 4px 0; padding-top: 8px; border-top: 1px solid var(--border);">
                        <span 
                            id="moreOptionsToggle"
                            style="color: var(--text-secondary); font-size: 0.85rem; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 8px;"
                            onclick="credentialManager.toggleMoreOptions()">
                            <span class="material-icons" style="font-size: 16px;">expand_more</span>
                            More Options (2FA & Custom Field)
                        </span>
                    </div>
                    
                    <!-- COLLAPSIBLE EXTRA FIELDS -->
                    <div id="extraFieldsContainer" style="display: none;">
                        <div class="form-row">
                            <!-- 4. 2FA Secret -->
                            <div class="form-group">
                                <label class="form-label" for="form2FA">
                                    2FA Secret
                                </label>
                                <div class="password-input-group">
                                    <input type="password" 
                                        id="form2FA"
                                        class="form-input" style="color: var(--text-secondary);"
                                        placeholder="TOTP secret key (Base32)"
                                        autocomplete="off">
                                    <button type="button" class="toggle-password-btn" data-target="form2FA">
                                        <span class="material-icons">visibility</span>
                                    </button>
                                </div>
                                <div id="form2FAStatus" class="form-help"></div>
                            </div>
                            
                            <!-- 5. CUSTOM FIELD WITH INLINE EDIT -->
                            <div class="form-group">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <label class="form-label" for="formCustomField" id="customFieldLabel" style="margin-bottom: 0;">
                                        Custom Field
                                    </label>
                                    <button type="button" 
                                        class="inline-edit-label-btn" 
                                        data-field="customField"
                                        style="
                                            background: transparent;
                                            border: none;
                                            cursor: pointer;
                                            color: var(--text-secondary);
                                            font-size: 0.65rem;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 4px;
                                            padding: 2px 6px;
                                            border-radius: 4px;
                                            transition: all 0.2s;
                                        ">
                                        <span class="material-icons" style="font-size: 12px;">edit</span>
                                    </button>
                                </div>
                                <input type="text" 
                                    id="formCustomField"
                                    class="form-input" style="color: var(--text-secondary);"
                                    placeholder="Custom data"
                                    autocomplete="off">
                                <div class="form-help">To add custom label, click 'Edit' icon*</div>
                                <div class="inline-label-edit-container" data-field="customField" style="display: none; margin-top: 8px;"></div>
                            </div>

                            <!-- 6. Note -->
                            <div class="form-group">
                                <label class="form-label" for="formNote">
                                    Note
                                </label>
                                <input type="text" 
                                    id="formNote"
                                    class="form-input" style="color: var(--text-secondary);"
                                    placeholder="Short note (max 24 chars)"
                                    maxlength="24"
                                    autocomplete="off">
                                <div class="form-help" id="noteCharCount">0 / 24 characters</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Form Actions -->
                    <div class="form-actions" style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
                        <button type="button" onclick="credentialManager.clearForm()" class="btn btn-secondary">
                            <i class="fas fa-broom"></i> Clear
                        </button>

                        <button id="credentialFormAddBtn" 
                            type="button"
                            onclick="credentialManager.submitAdd()" 
                            class="btn btn-primary"
                            style="${this.isEditing ? 'display: none;' : ''}">
                            <i class="fas fa-save"></i> Save Credential
                        </button>
                        
                        <button id="credentialFormUpdateBtn" 
                            type="button"
                            onclick="credentialManager.submitUpdate()" 
                            class="btn btn-primary"
                            style="${this.isEditing ? '' : 'display: none;'}">
                            <i class="fas fa-pen"></i> Update Credential
                        </button>
                    </div>
                </form>
            </div>
        `;
    }

    // Add this method to toggle More Options visibility
    toggleMoreOptions() {
        const extraContainer = document.getElementById('extraFieldsContainer');
        
        if (extraContainer) {
            const isVisible = extraContainer.style.display !== 'none';
            
            if (isVisible) {
                extraContainer.style.display = 'none';
                // Optionally update icon
                const icon = document.querySelector('#moreOptionsToggle .material-icons');
                if (icon) icon.textContent = 'expand_more';
            } else {
                extraContainer.style.display = 'block';
                extraContainer.style.animation = 'fadeSlideDown 0.2s ease';
                const icon = document.querySelector('#moreOptionsToggle .material-icons');
                if (icon) icon.textContent = 'expand_less';
            }
        }
    }

    // Also add CSS animation
    addMoreOptionsStyles() {
        if (!document.getElementById('more-options-styles')) {
            const style = document.createElement('style');
            style.id = 'more-options-styles';
            style.textContent = `
                @keyframes fadeSlideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                #extraFieldsContainer {
                    transition: all 0.2s ease;
                }
            `;
            document.head.appendChild(style);
        }
    }

    editCustomFieldLabel(fieldId) {
        const labelElement = document.getElementById(`${fieldId}Label`);
        if (!labelElement) return;
        
        const currentLabel = labelElement.textContent.trim();
        const container = document.querySelector(`.inline-label-edit-container[data-field="${fieldId}"]`);
        if (!container) return;
        
        // Hide any other open inline editors
        document.querySelectorAll('.inline-label-edit-container').forEach(cont => {
            if (cont !== container) {
                cont.style.display = 'none';
            }
        });
        
        // Toggle display
        if (container.style.display === 'block') {
            container.style.display = 'none';
            return;
        }
        
        // Create inline edit interface (similar to delete confirmation)
        container.innerHTML = `
            <div style="
                background: rgba(56, 189, 248, 0.08);
                border: 1px solid rgba(56, 189, 248, 0.3);
                border-radius: 6px;
                padding: 8px 10px;
                animation: slideDown 0.2s ease;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                        <input type="text" 
                            class="inline-label-input"
                            placeholder="Enter custom label"
                            value="${this.escapeHtml(currentLabel)}"
                            style="
                                background: rgba(0, 0, 0, 0.3);
                                border: 1px solid rgba(56, 189, 248, 0.3);
                                border-radius: 4px;
                                padding: 5px 8px;
                                color: var(--text-secondary);
                                font-size: 0.7rem;
                                width: 100px;
                            "
                            maxlength="16" autocomplete="off">
                        
                        <button class="inline-label-save-btn" data-field="${fieldId}" style="
                            background: transparent;
                            border: none;
                            padding: 5px 8px;
                            color: var(--primary);
                            cursor: pointer;
                            font-size: 0.65rem;
                            font-weight: 500;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            transition: all 0.2s;
                        ">
                            <span class="material-icons" style="font-size: 12px;">check</span>
                        </button>
                        
                        <button class="inline-label-cancel-btn" style="
                            background: transparent;
                            border: none;
                            padding: 5px 8px;
                            color: var(--text-secondary);
                            cursor: pointer;
                            font-size: 0.65rem;
                            font-weight: 500;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            transition: all 0.2s;
                        ">
                            <span class="material-icons" style="font-size: 12px;">close</span>
                        </button>
                    </div>
                </div>
                <div class="inline-label-error" style="
                    color: var(--danger);
                    font-size: 0.55rem;
                    margin-top: 6px;
                    display: none;
                "></div>
            </div>
        `;
        
        container.style.display = 'block';
        
        // Add event listeners
        const input = container.querySelector('.inline-label-input');
        const saveBtn = container.querySelector('.inline-label-save-btn');
        const cancelBtn = container.querySelector('.inline-label-cancel-btn');
        const errorDiv = container.querySelector('.inline-label-error');
        
        saveBtn.addEventListener('click', () => {
            const newLabel = input.value.trim();
            if (!newLabel) {
                errorDiv.textContent = 'Label cannot be empty';
                errorDiv.style.display = 'block';
                input.style.borderColor = 'var(--danger)';
                return;
            }
            
            // Save to localStorage
            localStorage.setItem(`${fieldId}_label`, newLabel);
            
            // Update the label in the UI
            const targetLabel = document.getElementById(`${fieldId}Label`);
            if (targetLabel) {
                targetLabel.textContent = newLabel;
            }
            
            // Also update preview
            this.updatePreviewFieldLabel(fieldId, newLabel);
            
            // Close inline editor
            container.style.display = 'none';
            
            this.showNotification(`Field label changed to "${newLabel}"`, 'success');
        });
        
        cancelBtn.addEventListener('click', () => {
            container.style.display = 'none';
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveBtn.click();
            } else if (e.key === 'Escape') {
                cancelBtn.click();
            }
        });
        
        input.addEventListener('input', () => {
            errorDiv.style.display = 'none';
            input.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        });
        
        // Focus the input
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }

    // Save the custom label (for compatibility with existing code)
    saveCustomFieldLabel() {
        // This method now handled by inline editor
        // Find and trigger the save from any open inline editor
        const openContainer = document.querySelector('.inline-label-edit-container[style*="display: block"]');
        if (openContainer) {
            const saveBtn = openContainer.querySelector('.inline-label-save-btn');
            if (saveBtn) {
                saveBtn.click();
            }
        }
    }


// Update field label in preview section
updatePreviewFieldLabel(fieldId, newLabel) {
    // Store the custom label for future renders
    this[`${fieldId}Label`] = newLabel;
    // Refresh preview to show updated label
    this.updatePreview();
}

// Get custom field label (with fallback)
getCustomFieldLabel() {
    return localStorage.getItem('customField_label') || 'Custom Field';
}



// ========== UPDATE credentialHTML TO INCLUDE THE FORM ==========

// Add this method to the CredentialManager class
toggleCredentialForm() {
    const formCard = document.querySelector('.settings-card');
    const toggleBtn = document.getElementById('toggleCredentialFormBtn');
    
    if (formCard) {
        const isHidden = formCard.style.display === 'none';
        
        if (isHidden) {
            formCard.style.display = '';
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
                toggleBtn.classList.remove('btn-primary');
                toggleBtn.classList.add('btn-primary');
            }
        } else {
            formCard.style.display = 'none';
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Add Credential';
                toggleBtn.classList.remove('btn-primary');
                toggleBtn.classList.add('btn-primary');
            }
        }
    }
}

// Update credentialHTML method - replace the existing one
credentialHTML() {
    const credentialSet = this.getCredentialSet();
    const entries = credentialSet.entries || [];
    const allHeaders = ['Service Tag', 'Username/ID', 'Password', 'Note', '2FA', 'Custom Field'];
    
    const rowsNeeded = Math.ceil(entries.length / 6);
    const needsVerticalScroll = rowsNeeded >= 5;
    const tableHeight = needsVerticalScroll ? '220px' : 'auto';
    
    return `
        <div class="table-wrapper" style="
            width: 100%;
            max-width: 100%;
            background: var(--panel);
            margin: 8px 0;
        ">
            <!-- Credential Input Form -->
            ${this.getCredentialFormHTML()}
        </div>
    `;
}


// ========== ADD FORM HANDLER METHODS ==========

// Get form data
getFormData() {
    return {
        serviceTag: document.getElementById('formServiceTag')?.value || '',
        username: document.getElementById('formUsername')?.value || '',
        password: document.getElementById('formPassword')?.value || '',
        note: document.getElementById('formNote')?.value || '',
        twofa: document.getElementById('form2FA')?.value || '',
        customField: document.getElementById('formCustomField')?.value || ''
    };
}

// Clear form
clearForm() {
    const serviceTag = document.getElementById('formServiceTag');
    const username = document.getElementById('formUsername');
    const password = document.getElementById('formPassword');
    const note = document.getElementById('formNote');
    const twofa = document.getElementById('form2FA');
    const customField = document.getElementById('formCustomField');
    
    if (serviceTag) serviceTag.value = '';
    if (username) username.value = '';
    if (password) {
        password.value = '';
        password.type = 'password';
        const toggleBtn = document.querySelector('.toggle-password-btn[data-target="formPassword"]');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('.material-icons');
            if (icon) icon.textContent = 'visibility';
        }
    }
    if (note) {
        note.value = '';
        const counterSpan = document.getElementById('noteCharCount');
        if (counterSpan) counterSpan.innerHTML = '0 / 24 characters';
    }
    if (twofa) twofa.value = '';
    if (customField) customField.value = '';
    
    const statusDiv = document.getElementById('form2FAStatus');
    if (statusDiv) statusDiv.innerHTML = '';
    
    if (serviceTag) serviceTag.focus();
}

// Toggle password visibility in form
toggleFormPassword() {
    const passwordField = document.getElementById('formPassword');
    const button = document.querySelector('.credential-input-form button[onclick="credentialManager.toggleFormPassword()"] i');
    
    if (passwordField.type === 'password') {
        passwordField.type = 'text';
        if (button) button.className = 'fas fa-eye-slash';
    } else {
        passwordField.type = 'password';
        if (button) button.className = 'fas fa-eye';
    }
}

// Submit form (Add or Update)
submitForm() {
    // Get current form values directly from DOM
    const formData = {
        serviceTag: document.getElementById('formServiceTag')?.value || '',
        username: document.getElementById('formUsername')?.value || '',
        password: document.getElementById('formPassword')?.value || '',
        note: document.getElementById('formNote')?.value || '',
        twofa: document.getElementById('form2FA')?.value || '',
        customField: document.getElementById('formCustomField')?.value || ''
    };
    
    // Validate required fields
    if (!formData.serviceTag.trim()) {
        this.showNotification('Please enter a service tag', 'warning');
        document.getElementById('formServiceTag')?.focus();
        return;
    }
    
    if (this.isEditing && this.editingRowIndex !== null) {
        // UPDATE existing credential
        this.updateCredentialRow(this.editingRowIndex, formData);
        this.showNotification(`Updated "${formData.serviceTag}"`, 'success');
        this.cancelEdit(); // This will reset form and exit edit mode
    } else {
        // ADD new credential
        this.addCredentialForm(formData);
        this.showNotification(`Added "${formData.serviceTag}"`, 'success');
        this.clearForm(); // Clear form for next entry
    }
}

// Submit Add (for adding new credential)
submitAdd() {
    // Get current form values directly from DOM
    const formData = {
        serviceTag: document.getElementById('formServiceTag')?.value || '',
        username: document.getElementById('formUsername')?.value || '',
        password: document.getElementById('formPassword')?.value || '',
        note: document.getElementById('formNote')?.value || '',
        twofa: document.getElementById('form2FA')?.value || '',
        customField: document.getElementById('formCustomField')?.value || ''
    };
    
    // Validate required fields
    if (!formData.serviceTag.trim()) {
        this.showNotification('Please enter a service tag', 'warning');
        document.getElementById('formServiceTag')?.focus();
        return;
    }
    
    // ADD new credential
    this.addCredentialForm(formData);
    this.showNotification(`Added "${formData.serviceTag}"`, 'success');
    this.clearForm(); // Clear form for next entry
}

// Submit Update (for updating existing credential)
submitUpdate() {
    // Get current form values directly from DOM
    const formData = {
        serviceTag: document.getElementById('formServiceTag')?.value || '',
        username: document.getElementById('formUsername')?.value || '',
        password: document.getElementById('formPassword')?.value || '',
        note: document.getElementById('formNote')?.value || '',
        twofa: document.getElementById('form2FA')?.value || '',
        customField: document.getElementById('formCustomField')?.value || ''
    };
    
    // Validate required fields
    if (!formData.serviceTag.trim()) {
        this.showNotification('Please enter a service tag', 'warning');
        document.getElementById('formServiceTag')?.focus();
        return;
    }
    
    if (this.isEditing && this.editingRowIndex !== null) {
        // UPDATE existing credential
        this.updateCredentialRow(this.editingRowIndex, formData);
        this.showNotification(`Updated "${formData.serviceTag}"`, 'success');
        this.cancelEdit(); // This will reset form and exit edit mode
    } else {
        this.showNotification('No credential selected for update', 'warning');
    }
}

// Add credential from form data - NOW STORES CUSTOM LABEL
addCredentialForm(formData) {
    const credentialSet = this.getCredentialSet();
    const entries = credentialSet.entries || [];
    
    // Truncate note to 24 characters
    const noteValue = formData.note ? formData.note.substring(0, 24) : '';
    
    // Add warning if truncated
    if (formData.note && formData.note.length > 24) {
        this.showNotification('Note was truncated to 24 characters', 'warning');
    }
    
    // Get custom field label from form (or use default)
    const customFieldLabel = document.getElementById('customFieldLabel')?.textContent.trim() || 'Custom Field';
    
    const startIndex = entries.length;
    const newRowNumber = Math.floor(startIndex / 6) + 1;
    
    // Field order: 0:Service, 1:Username, 2:Password, 3:2FA, 4:customField, 5:Note
    const newEntries = [
        { value: formData.serviceTag, display: formData.serviceTag, pending: false, pendingAt: null, isEmpty: !formData.serviceTag, isWhitespaceOnly: false, originalIndex: startIndex, lineNumber: newRowNumber },
        { value: formData.username, display: formData.username, pending: false, pendingAt: null, isEmpty: !formData.username, isWhitespaceOnly: false, originalIndex: startIndex + 1, lineNumber: newRowNumber },
        { value: formData.password, display: formData.password, pending: false, pendingAt: null, isEmpty: !formData.password, isWhitespaceOnly: false, originalIndex: startIndex + 2, lineNumber: newRowNumber },
        { value: formData.twofa, display: formData.twofa, pending: false, pendingAt: null, isEmpty: !formData.twofa, isWhitespaceOnly: false, originalIndex: startIndex + 3, lineNumber: newRowNumber },
        { value: formData.customField, display: formData.customField, pending: false, pendingAt: null, isEmpty: !formData.customField, isWhitespaceOnly: false, originalIndex: startIndex + 4, lineNumber: newRowNumber, customLabel: customFieldLabel || 'Custom Field' }, // ADD custom label
        { value: noteValue, display: noteValue, pending: false, pendingAt: null, isEmpty: !noteValue, isWhitespaceOnly: false, originalIndex: startIndex + 5, lineNumber: newRowNumber }
    ];
    
    entries.push(...newEntries);
    
    this.updateCredentials({ entries: entries, lastUpdated: 'Just now' });
    this.updatePreview();
    
    const newRowIndex = Math.floor(startIndex / 6);
    setTimeout(() => this.syncRowToFirebase(newRowIndex), 100);
}

// Update existing credential row - NOW PRESERVES CUSTOM LABEL
updateCredentialRow(rowIndex, formData) {
    const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
    if (credentialIndex !== -1) {
        const entries = this.credentials[credentialIndex].entries;
        const startIndex = rowIndex * 6;
        
        // Truncate note to 24 characters
        const noteValue = formData.note ? formData.note.substring(0, 24) : '';
        
        // Add warning if truncated
        if (formData.note && formData.note.length > 24) {
            this.showNotification('Note was truncated to 24 characters', 'warning');
        }
        
        // Get custom field label (preserve existing or use current form value)
        const existingCustomEntry = entries[startIndex + 4];
        const customFieldLabel = document.getElementById('customFieldLabel')?.textContent.trim() || 
                                 existingCustomEntry?.customLabel || 
                                 'Custom Field';

        if (startIndex + 5 < entries.length) {
            entries[startIndex].value = formData.serviceTag;
            entries[startIndex].display = formData.serviceTag;
            entries[startIndex].isEmpty = !formData.serviceTag;
            
            entries[startIndex + 1].value = formData.username;
            entries[startIndex + 1].display = formData.username;
            entries[startIndex + 1].isEmpty = !formData.username;
            
            entries[startIndex + 2].value = formData.password;
            entries[startIndex + 2].display = formData.password;
            entries[startIndex + 2].isEmpty = !formData.password;
            
            entries[startIndex + 3].value = formData.twofa;
            entries[startIndex + 3].display = formData.twofa;
            entries[startIndex + 3].isEmpty = !formData.twofa;
            
            entries[startIndex + 4].value = formData.customField;
            entries[startIndex + 4].display = formData.customField;
            entries[startIndex + 4].isEmpty = !formData.customField;
            entries[startIndex + 4].customLabel = customFieldLabel || 'Custom Field'; // PRESERVE custom label
            
            entries[startIndex + 5].value = noteValue;
            entries[startIndex + 5].display = noteValue;
            entries[startIndex + 5].isEmpty = !noteValue;
            
            const allFieldsFilled = formData.serviceTag && formData.username && formData.password;
            if (allFieldsFilled) {
                for (let i = 0; i < 6; i++) {
                    if (entries[startIndex + i]) {
                        entries[startIndex + i].pending = false;
                        entries[startIndex + i].pendingAt = null;
                    }
                }
            }
            
            this.credentials[credentialIndex].lastUpdated = 'Just now';
            this.saveToStorage();
            this.updatePreview();
            setTimeout(() => this.syncRowToFirebase(rowIndex), 100);
        }
    }
}

// Edit credential (called from table row)
editCredential(rowIndex) {
    const credentialSet = this.getCredentialSet();
    const entries = credentialSet.entries || [];
    const startIndex = rowIndex * 6;
    
    if (startIndex + 5 < entries.length) {
        // Set editing state
        this.isEditing = true;
        this.editingRowIndex = rowIndex;
        
        // Populate currentFormData with existing values
        this.currentFormData = {
            serviceTag: entries[startIndex]?.value || '',
            username: entries[startIndex + 1]?.value || '',
            password: entries[startIndex + 2]?.value || '',
            twofa: entries[startIndex + 3]?.value || '',
            customField: entries[startIndex + 4]?.value || '',
            note: entries[startIndex + 5]?.value || ''
        };
        
        // Update the form UI without re-rendering entire container
        this.updateFormToEditMode();
        
        // Scroll to form
        const form = document.querySelector('.settings-card');
        if (form) {
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Focus on service tag field
        const serviceTagField = document.getElementById('formServiceTag');
        if (serviceTagField) {
            serviceTagField.focus();
        }
        
        this.showNotification(`Editing "${this.currentFormData.serviceTag || 'credential'}"`, 'info');
    }
}


// Cancel edit mode
cancelEdit() {
    this.isEditing = false;
    this.editingRowIndex = null;
    this.currentFormData = {
        serviceTag: '',
        username: '',
        password: '',
        note: '',
        twofa: '',
        customField: ''
    };
    
    // Update just the form section back to add mode
    const formContainer = document.querySelector('.settings-card');
    if (formContainer) {
        const parent = formContainer.parentNode;
        const newFormHTML = this.getCredentialFormHTML();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newFormHTML;
        const newForm = tempDiv.firstElementChild;
        parent.replaceChild(newForm, formContainer);
        this.attachFormEventListeners();
        
        // Ensure form stays visible after cancel (don't hide it)
        const updatedForm = document.querySelector('.settings-card');
        if (updatedForm) {
            updatedForm.style.display = '';
        }
        
        // Update toggle button if needed
        const toggleBtn = document.getElementById('toggleCredentialFormBtn');
        if (toggleBtn && toggleBtn.innerHTML.includes('Show')) {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
            toggleBtn.classList.remove('btn-secondary');
            toggleBtn.classList.add('btn-primary');
        }
    } else {
        // Fallback to full re-render
        const container = document.getElementById('credentialContainer');
        if (container) {
            container.innerHTML = this.getManagerHTML();
            this.attachEventListeners();
            this.attachFormEventListeners();
        }
    }
    
    this.showNotification('Edit cancelled', 'info');
}

attachFormEventListeners() {
    const form = document.getElementById('credentialForm');
    if (form) {
        form.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    if (this.isEditing) {
                        this.submitUpdate();
                    } else {
                        this.submitAdd();
                    }
                }
            }
        });
    }
    
    // Note field character counter
    const noteField = document.getElementById('formNote');
    if (noteField) {
        const updateCharCount = () => {
            const count = noteField.value.length;
            const counterSpan = document.getElementById('noteCharCount');
            if (counterSpan) {
                counterSpan.innerHTML = `${count} / 24 characters`;
                counterSpan.style.color = count > 24 ? 'var(--danger)' : 'var(--muted)';
            }
            if (count > 24) {
                noteField.value = noteField.value.substring(0, 24);
                if (counterSpan) counterSpan.innerHTML = `24 / 24 characters (max reached)`;
            }
        };
        noteField.addEventListener('input', updateCharCount);
        noteField.addEventListener('keydown', updateCharCount);
        updateCharCount();
    }
    
    // Password visibility toggles
    document.querySelectorAll('.toggle-password-btn').forEach(btn => {
        btn.removeEventListener('click', this.handlePasswordToggle);
        btn.addEventListener('click', (e) => {
            const targetId = btn.getAttribute('data-target');
            this.toggleFormPasswordVisibility(targetId, btn);
        });
    });
    
    // ADD THIS: Inline label edit buttons
    document.querySelectorAll('.inline-edit-label-btn').forEach(btn => {
        btn.removeEventListener('click', this.handleInlineLabelEdit);
        btn.addEventListener('click', (e) => {
            const fieldId = btn.getAttribute('data-field');
            this.editCustomFieldLabel(fieldId);
        });
    });
    
    // Add/Update buttons
    const addBtn = document.getElementById('credentialFormAddBtn');
    if (addBtn) {
        const newAddBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newAddBtn, addBtn);
        newAddBtn.onclick = (e) => {
            e.preventDefault();
            this.submitAdd();
        };
        newAddBtn.style.display = this.isEditing ? 'none' : 'inline-flex';
    }
    
    const updateBtn = document.getElementById('credentialFormUpdateBtn');
    if (updateBtn) {
        const newUpdateBtn = updateBtn.cloneNode(true);
        updateBtn.parentNode.replaceChild(newUpdateBtn, updateBtn);
        newUpdateBtn.onclick = (e) => {
            e.preventDefault();
            this.submitUpdate();
        };
        newUpdateBtn.style.display = this.isEditing ? 'inline-flex' : 'none';
    }
    
    // Cancel button
    const cancelBtn = document.querySelector('.settings-card .btn-secondary[onclick*="cancelEdit"]');
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.onclick = (e) => {
            e.preventDefault();
            this.cancelEdit();
        };
    }
    
    // Clear button
    const clearBtn = document.querySelector('.settings-card .btn-secondary[onclick*="clearForm"]');
    if (clearBtn) {
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
        newClearBtn.onclick = (e) => {
            e.preventDefault();
            this.clearForm();
        };
    }
    
    // 2FA validation
    const twofaField = document.getElementById('form2FA');
    if (twofaField) {
        twofaField.addEventListener('input', (e) => {
            const statusDiv = document.getElementById('form2FAStatus');
            if (statusDiv) {
                const isValid = this.validateTOTPSecret(e.target.value);
                if (e.target.value) {
                    statusDiv.innerHTML = isValid ? 
                        '<span style="color: var(--primary);">✓ Valid TOTP secret</span>' : 
                        '<span style="color: var(--danger);">✗ Invalid TOTP secret format</span>';
                } else {
                    statusDiv.innerHTML = '';
                }
            }
        });
    }
}


// Toggle password visibility for form fields
toggleFormPasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    const icon = button.querySelector('.material-icons');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        input.type = 'password';
        icon.textContent = 'visibility';
    }
}

// Update password strength indicator (optional)
updatePasswordStrengthIndicator(password) {
    // You can implement password strength indicator if desired
    // This is optional and can be expanded
    if (!password) return;
    
    // Simple strength calculation
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strength++;
    
    // You could add a strength indicator element to show this
}

getPreviewSectionHTML() {
    return `
        <div class="preview-section" style="margin-top: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <h3 style="margin: 0; color: var(--text); display: flex; align-items: center; gap: 8px; font-size: 0.96rem;">
                        <i class="fas fa-display" style="color: var(--active); font-size: 0.8rem;"></i>
                        Preview
                    </h3>
                    <button id="togglePasswordVisibility" style="
                        background: transparent;
                        border: 1px solid var(--active);
                        color: var(--active);
                        padding: 4px 6px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 0.65rem;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        transition: all 0.2s;
                    " onmouseover="this.style.backgroundColor='rgba(56,189,248,0.1)'"
                    onmouseout="this.style.backgroundColor='transparent'">
                        <i class="fas fa-eye" style="font-size: 0.65rem;"></i> Show Passwords
                    </button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <span style="font-size: 0.65rem; color: var(--muted); display: flex; align-items: center; gap: 4px;">
                        <i class="fas fa-circle" style="color: var(--primary); font-size: 0.48rem;"></i> Active
                    </span>
                    <span style="font-size: 0.65rem; color: var(--muted); display: flex; align-items: center; gap: 4px;">
                        <i class="fas fa-circle" style="color: var(--danger); font-size: 0.48rem;"></i> Pending
                    </span>
                </div>
            </div>
            
            <!-- Search and Filter Bar - UPDATED with search count -->
            <div class="preview-actions" style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                flex-wrap: wrap;
                gap: 12px;
            ">
                <!-- Search Input with Result Count - Matching notes module -->
                <div class="preview-search" style="
                    flex: 1;
                    min-width: 200px;
                    position: relative;
                    background: var(--card-bg);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    padding: 4px 8px;
                    display: flex;
                    align-items: center;
                    transition: all 0.3s;
                ">
                    <i class="fas fa-search" style="
                        color: var(--text-secondary);
                        font-size: 0.85rem;
                        margin-right: 8px;
                    "></i>
                    <input type="text" 
                        id="previewSearchInput" 
                        placeholder="Search in preview..." 
                        style="
                            flex: 1;
                            background: transparent;
                            border: none;
                            color: var(--text-primary);
                            font-size: 0.8rem;
                            padding: 4px 0;
                            outline: none;
                            width: 100%;
                        "
                        oninput="credentialManager.handlePreviewSearch()">
                    <!-- Search Results Count Badge -->
                    <div id="searchResultsCount" class="search-results-count" style="
                        display: none;
                        align-items: center;
                        gap: 6px;
                        margin-left: 8px;
                        padding-left: 8px;
                        border-left: 1px solid var(--border);
                        color: var(--text-secondary);
                        font-size: 0.65rem;
                        font-weight: 500;
                        white-space: nowrap;
                    ">
                        <span id="searchResultCountValue">0</span>
                        <span>results</span>
                        <button id="clearSearchBtn" class="btn-clear-search" style="
                            background: transparent;
                            border: none;
                            color: var(--danger);
                            cursor: pointer;
                            padding: 2px 4px;
                            font-size: 0.7rem;
                            transition: all 0.2s;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 4px;
                        " title="Clear search">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <!-- Filter Icons - Matching notes filter style -->
                <div class="preview-filter-container" style="
                    display: flex;
                    gap: 4px;
                    background: transparent;
                    border: none;
                    padding: 4px;
                    margin: 0;
                ">
                    <button id="previewFilterAll" 
                            class="preview-filter-btn active"
                            onclick="credentialManager.setPreviewFilter('all')"
                            style="
                                width: 28px;
                                height: 28px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                border-radius: 6px;
                                background: var(--active);
                                border: none;
                                color: var(--primary);
                                cursor: pointer;
                                transition: all 0.3s;
                                font-size: 0.85rem;
                            "
                            title="All Credentials">
                        <i class="fas fa-list-ol"></i>
                    </button>
                    <button id="previewFilterActive" 
                            class="preview-filter-btn"
                            onclick="credentialManager.setPreviewFilter('active')"
                            style="
                                width: 28px;
                                height: 28px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                border-radius: 6px;
                                background: transparent;
                                border: none;
                                color: var(--text-secondary);
                                cursor: pointer;
                                transition: all 0.3s;
                                font-size: 0.85rem;
                            "
                            title="Active Credentials">
                        <i class="fas fa-user-shield"></i>
                    </button>
                    <button id="previewFilterPending" 
                            class="preview-filter-btn"
                            onclick="credentialManager.setPreviewFilter('pending')"
                            style="
                                width: 28px;
                                height: 28px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                border-radius: 6px;
                                background: transparent;
                                border: none;
                                color: var(--text-secondary);
                                cursor: pointer;
                                transition: all 0.3s;
                                font-size: 0.85rem;
                            "
                            title="Pending Credentials">
                        <i class="fas fa-clock"></i>
                    </button>
                    
                    <!-- Active Filter Count Display -->
                    <div class="active-filter-count" id="credentialFilterCount" style="
                        margin-left: 8px;
                        display: flex;
                        align-items: center;
                        padding: 0 8px;
                        color: var(--primary);
                        background: transparent;
                        font-weight: 600;
                        font-size: 0.75rem;
                        justify-content: center;
                        transition: all 0.3s ease;
                    ">
                        <span id="filterCountValue">0</span>
                    </div>
                </div>
            </div>
            
            <!-- Container for delete confirmation bar (will be inserted dynamically) -->
            <div id="deleteConfirmationContainer"></div>
            
            <div id="previewContainer" style="
                border-top: 1px solid var(--border);
                height: 100%;
                overflow-y: auto;
            ">
                ${this.getPreviewContentHTML()}
            </div>
        </div>
    `;
}

     // Get preview content HTML - MODIFIED for TOTP support
    // ========== ADD THIS METHOD - Get Preview Content HTML with Edit Button ==========

    getPreviewContentHTML() {
        const credentialSet = this.getCredentialSet();
        let entries = credentialSet.entries || [];
        
        if (entries.length === 0) {
            return `
                <div style="text-align: center; padding: 32px 16px; color: var(--muted); font-size: 0.8rem;">
                    <i class="fas fa-key" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.3;"></i>
                    <h4 style="margin: 0 0 8px; font-weight: 500; font-size: 0.8rem;">No credentials to preview</h4>
                    <p style="margin: 0; font-size: 0.72rem;">Add credentials using the form above</p>
                </div>
            `;
        }
        
        let html = '';
        const rows = Math.ceil(entries.length / 6);
        const showPasswords = this.showPasswords || false;
        
        // Apply search filter
        let filteredRows = [];
        for (let rowIndex = rows - 1; rowIndex >= 0; rowIndex--) {
            const startIndex = rowIndex * 6;
            const rowEntries = entries.slice(startIndex, startIndex + 6);
            
            let matchesSearch = true;
            if (this.currentSearchTerm) {
                matchesSearch = rowEntries.some(entry => 
                    entry && entry.value && entry.value.toLowerCase().includes(this.currentSearchTerm)
                );
            }
            
            let matchesFilter = true;
            if (this.currentPreviewFilter !== 'all') {
                const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
                const isPending = rowEntries.some(entry => entry && entry.pending);
                
                switch(this.currentPreviewFilter) {
                    case 'active':
                        matchesFilter = hasData && !isPending;
                        break;
                    case 'pending':
                        matchesFilter = isPending;
                        break;
                }
            }
            
            if (matchesSearch && matchesFilter) {
                filteredRows.push({ rowIndex, rowEntries });
            }
        }
        
        if (filteredRows.length === 0) {
            return `
                <div style="text-align: center; padding: 32px 16px; color: var(--muted); font-size: 0.8rem;">
                    <i class="fas fa-search" style="font-size: 2.4rem; margin-bottom: 12px; display: block; opacity: 0.3;"></i>
                    <h4 style="margin: 0 0 8px; font-weight: 500; font-size: 0.8rem;">No matching credentials found</h4>
                    <p style="margin: 0; font-size: 0.72rem;">Try a different search or filter</p>
                </div>
            `;
        }
        
        for (const { rowIndex, rowEntries } of filteredRows) {
            const rowNumber = rowIndex + 1;
            const serviceEntry = rowEntries[0];
            const serviceInfo = serviceEntry && serviceEntry.value && serviceEntry.value.trim()
                ? this.getServiceInfo(serviceEntry.value) 
                : null;
            const isRowPending = rowEntries.some(entry => entry && entry.pending);
            // Get custom field label for THIS ROW only
            const customFieldEntry = rowEntries[4];
            const customFieldLabel = (customFieldEntry && customFieldEntry.customLabel) || 'Custom Field';
            
            // Field order with DYNAMIC custom label
            const orderedFields = [
                { index: 1, name: 'Username', isSecret: false, col: 1 },
                { index: 2, name: 'Password', isSecret: true, col: 2 },
                { index: 3, name: '2FA', isSecret: true, col: 3 },
                { index: 4, name: customFieldLabel || 'Custom Field', isSecret: true, col: 4 },
                { index: 5, name: 'Note', isSecret: false, col: 5, maxLen: 24 }
            ];
                    
            html += `
                <div class="preview-card" style="
                    background: ${isRowPending ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.01) 100%)'};
                    border: 1px solid ${isRowPending ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)'};
                    border-radius: 8px;
                    padding: 6px;
                    margin-bottom: 8px;
                    transition: all 0.3s ease;
                    position: relative;
                    overflow: hidden;
                    font-size: 0.8rem;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <div style="
                                background: transparent;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 0 4px;
                                color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                                font-weight: 700;
                                font-size: 0.75rem;
                            ">
                                ${rowNumber}
                            </div>

                            ${serviceInfo ? `
                                <div style="display: flex; align-items: center; gap: 6px; padding: 4px; background: transparent; border-radius: 4px;">
                                    <i class="${serviceInfo.icon}" style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-size: 0.75rem;"></i>
                                    <span style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-weight: 600; font-size: 0.75rem;">${serviceInfo.name}</span>
                                </div>
                            ` : serviceEntry && serviceEntry.value && serviceEntry.value.trim() ? `
                                <div style="display: flex; align-items: center; gap: 6px; padding: 4px; background: transparent; border-radius: 4px; color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};">
                                    <i class="fas fa-globe" style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-size: 0.75rem;"></i>
                                    <span style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-weight: 600; font-size: 0.75rem;">
                                        ${this.escapeHtml(serviceEntry.value).substring(0, 20)}
                                    </span>
                                </div>
                            ` : ''}
                                                    
                            ${isRowPending ? `
                                <div style="display: flex; align-items: center; gap: 6px; padding: 4px; background: transparent; border-radius: 4px; color: var(--danger);">
                                    <i class="fas fa-clock" style="font-size: 0.75rem;"></i>
                                    <span style="font-weight: 600; font-size: 0.75rem;">Pending</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div style="display: flex; gap: 6.4px;">
                            <button onclick="credentialManager.editCredentialFromPreview(${rowIndex})" title="Edit Credential" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none;
                                color: var(--primary); cursor: pointer;
                                display: flex; align-items: center; justify-content: center;
                            ">
                                <i class="fas fa-pen" style="font-size: 0.7rem;"></i>
                            </button>
                            <button onclick="credentialManager.copyRow(${rowIndex})" title="Copy Row" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none;
                                color: var(--primary); cursor: pointer;
                                display: flex; align-items: center; justify-content: center;
                            ">
                                <i class="fas fa-copy" style="font-size: 0.75rem;"></i>
                            </button>
                            <button onclick="credentialManager.toggleRowStatus(${rowIndex})" title="${isRowPending ? 'Activate Row' : 'Mark Pending'}" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none; color: ${isRowPending ? 'var(--primary)' : 'var(--danger)'};
                                cursor: pointer; display: flex; align-items: center; justify-content: center;
                            ">
                                <i class="fas ${isRowPending ? 'fa-play-circle' : 'fa-pause-circle'}" style="font-size: 0.75rem;"></i>
                            </button>
                            <button onclick="credentialManager.deleteRow(${rowIndex})" title="Delete Row" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none;
                                color: var(--danger); cursor: pointer;
                                display: flex; align-items: center; justify-content: center;
                            ">
                                <i class="fas fa-trash" style="font-size: 0.75rem;"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;">
                        ${orderedFields.map(field => {
                            const entry = rowEntries[field.index];
                            if (!entry) return '';
                            
                            // Skip empty non-note fields
                            if (field.index !== 5 && (!entry.value || !entry.value.trim())) return '';
                            
                            const is2FA = field.index === 3;
                            const isPassword = field.index === 2;
                            const isCustom = field.index === 4;
                            const isNote = field.index === 5;
                            const isSecretField = field.isSecret;
                            const isPending = entry.pending;
                            
                            let displayValue = '';
                            let copyValue = '';
                            let hasTimer = false;
                            let timeLeft = 0;
                            const secret = entry.value;
                            
                            if (is2FA) {
                                timeLeft = this.getTimeRemaining();
                                displayValue = this.generateTOTP(secret);
                                copyValue = displayValue;
                                hasTimer = true;
                            } else if (isSecretField && !this.showPasswords && !isPending && entry.value && entry.value.trim() && !isCustom) {
                                displayValue = '••••••••••';
                                copyValue = entry.value;
                            } else if (isNote) {
                                let noteValue = entry.value || '';
                                if (noteValue.length > 24) {
                                    noteValue = noteValue.substring(0, 24);
                                }
                                displayValue = noteValue ? this.escapeHtml(noteValue) : '(empty)';
                                copyValue = noteValue;
                            } else {
                                displayValue = this.escapeHtml(entry.value);
                                copyValue = entry.value;
                            }
                            
                            const isClickable = !isPending && entry.value && entry.value.trim();
                            const cursorStyle = isClickable ? 'pointer' : 'default';
                            
                            let clickHandler = '';
                            if (is2FA && isClickable) {
                                clickHandler = `onclick="credentialManager.copyTOTPCode('${this.escapeHtml(secret)}')"`;
                            } else if (isClickable && !isSecretField) {
                                clickHandler = `onclick="credentialManager.copyToClipboard('${this.escapeHtml(copyValue)}')"`;
                            } else if (isClickable && isSecretField) {
                                clickHandler = `onclick="credentialManager.copyToClipboard('${this.escapeHtml(copyValue)}')"`;
                            }
                            
                            return `
                                <div class="preview-item ${hasTimer ? 'totp-display' : ''}" 
                                    data-value="${this.escapeHtml(entry.value)}" 
                                    data-secret="${is2FA ? this.escapeHtml(secret) : ''}"
                                    ${clickHandler}
                                    style="
                                        background: ${isPending ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.03)'};
                                        border: 1px solid ${isPending ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'};
                                        border-radius: 4px;
                                        padding: 4px 6px;
                                        cursor: ${cursorStyle};
                                        transition: all 0.2s;
                                        position: relative;
                                        overflow: hidden;
                                        font-size: 0.75rem;
                                        opacity: ${isPending ? '0.7' : '1'};
                                        min-height: ${hasTimer ? '48px' : 'auto'};
                                    ">
                                    <div style="display: flex; justify-content: space-between; align-items: ${hasTimer ? 'center' : 'flex-start'}; height: ${hasTimer ? '100%' : 'auto'};">
                                        <div style="flex: 1;">
                                            <div style="font-size: 0.65rem; font-weight: 600; color: ${isPending ? 'var(--danger)' : 'rgba(255,255,255,0.4)'}; margin-bottom: ${hasTimer ? '2px' : '4px'}; text-transform: uppercase; letter-spacing: 0.4px;">
                                                ${field.name}
                                                ${isNote ? ` <span style="font-size: 0.55rem; color: var(--muted);">(max 24)</span>` : ''}
                                            </div>
                                            ${hasTimer ? `
                                                <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                                                    <div style="font-size: 0.75rem; font-weight: 600; color: ${isPending ? 'var(--danger)' : 'var(--f-value)'}; font-family: 'Courier New', monospace;">
                                                        <span class="totp-code">${displayValue}</span>
                                                    </div>
                                                    <div style="font-size: 0.6rem; font-weight: 600; color: ${isPending ? 'var(--danger)' : 'var(--f-value)'};">
                                                        <span class="totp-time">${timeLeft}s</span>
                                                    </div>
                                                </div>
                                            ` : `
                                                <div style="
                                                    font-size: 0.75rem;
                                                    color: ${isPending ? 'var(--danger)' : 'var(--f-value)'};
                                                    font-family: monospace;
                                                    font-weight: 500;
                                                    word-break: break-all;
                                                    ${isPending ? 'text-decoration: line-through;' : ''}
                                                ">
                                                    ${displayValue}
                                                </div>
                                            `}
                                        </div>
                                        
                                        ${!hasTimer && isSecretField && !isPending && entry.value && entry.value.trim() && !isCustom ? `
                                            <button onclick="event.stopPropagation(); credentialManager.toggleSinglePassword(this, '${this.escapeHtml(entry.value)}')" 
                                                    title="${this.showPasswords ? 'Hide' : 'Show'}"
                                                    style="position: absolute; right: 8px; background: transparent; border: none; color: var(--f-label); cursor: pointer; padding: 4px;">
                                                <i class="fas ${this.showPasswords ? 'fa-eye-slash' : 'fa-eye'}" style="font-size: 0.6rem;"></i>
                                            </button>
                                        ` : ''}
                                    </div>
                                    
                                    ${hasTimer ? `
                                        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: rgba(0,0,0,0.1);">
                                            <div class="totp-progress-bar" style="height: 100%; width: ${(timeLeft / 30) * 100}%; background: ${isPending ? 'var(--danger)' : 'var(--f-value)'};"></div>
                                        </div>
                                    ` : ''}
                                    
                                    ${isPending ? `
                                        <div style="position: absolute; top: 0; right: 0; padding: 2px 6.4px; background: var(--danger); color: white; font-size: 0.56rem; border-radius: 0 2px 0 6.4px;">
                                            <i class="fas fa-clock" style="font-size: 0.56rem;"></i>
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        
        return html;
    }

// ========== ADD THIS METHOD - Edit from Preview ==========

// Edit from Preview
editCredentialFromPreview(rowIndex) {
    const credentialSet = this.getCredentialSet();
    const entries = credentialSet.entries || [];
    const startIndex = rowIndex * 6;
    
    if (startIndex + 5 < entries.length) {
        // Set editing state
        this.isEditing = true;
        this.editingRowIndex = rowIndex;
        
        // Populate currentFormData with existing values
        this.currentFormData = {
            serviceTag: entries[startIndex]?.value || '',
            username: entries[startIndex + 1]?.value || '',
            password: entries[startIndex + 2]?.value || '',
            twofa: entries[startIndex + 3]?.value || '',
            customField: entries[startIndex + 4]?.value || '',
            note: entries[startIndex + 5]?.value || '',
        };
        
        // Update the form UI without re-rendering entire container
        this.updateFormToEditMode();
        
        // Scroll to form
        const form = document.querySelector('.settings-card');
        if (form) {
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Focus on service tag field
        const serviceTagField = document.getElementById('formServiceTag');
        if (serviceTagField) {
            serviceTagField.focus();
        }
        
        this.showNotification(`Editing "${this.currentFormData.serviceTag || 'credential'}"`, 'info');
    }
}

updateFormToEditMode() {
    // Find the existing form container
    const formContainer = document.querySelector('.settings-card');
    if (!formContainer) {
        // Fallback to full re-render if form not found
        const container = document.getElementById('credentialContainer');
        if (container) {
            container.innerHTML = this.getManagerHTML();
            this.attachEventListeners();
            this.attachFormEventListeners();
        }
        return;
    }
    
    // Make sure form is visible when editing
    formContainer.style.display = '';
    
    // Update toggle button state
    const toggleBtn = document.getElementById('toggleCredentialFormBtn');
    if (toggleBtn) {
        toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
        toggleBtn.classList.remove('btn-secondary');
        toggleBtn.classList.add('btn-primary');
    }
    
    // Get the parent
    const parent = formContainer.parentNode;
    
    // Create new form HTML with edit mode
    const newFormHTML = this.getCredentialFormHTML();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newFormHTML;
    const newForm = tempDiv.firstElementChild;
    
    // Replace the old form with the new one
    parent.replaceChild(newForm, formContainer);
    
    // Re-attach form event listeners
    this.attachFormEventListeners();
    
    // Populate form fields with currentFormData
    this.populateFormFields();
}


// Update just the form section for editing (without re-rendering the whole container)
updateFormForEditing() {
    // Find the existing form container
    const formContainer = document.querySelector('.credential-input-form');
    if (!formContainer) {
        // If form doesn't exist, fall back to full re-render
        const container = document.getElementById('credentialContainer');
        if (container) {
            container.innerHTML = this.getManagerHTML();
            this.attachEventListeners();
            this.attachFormEventListeners();
        }
        return;
    }
    
    // Get the parent
    const parent = formContainer.parentNode;
    
    // Create new form HTML
    const newFormHTML = this.getCredentialFormHTML();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newFormHTML;
    const newForm = tempDiv.firstElementChild;
    
    // Replace the old form with the new one
    parent.replaceChild(newForm, formContainer);
    
    // Re-attach form event listeners
    this.attachFormEventListeners();
    
    // Populate form fields with currentFormData
    this.populateFormFields();
}

// Populate form fields with currentFormData
populateFormFields() {
    const serviceTagField = document.getElementById('formServiceTag');
    const usernameField = document.getElementById('formUsername');
    const passwordField = document.getElementById('formPassword');
    const twofaField = document.getElementById('form2FA');
    const customField = document.getElementById('formCustomField');
    const noteField = document.getElementById('formNote');
    
    if (serviceTagField) serviceTagField.value = this.currentFormData.serviceTag || '';
    if (usernameField) usernameField.value = this.currentFormData.username || '';
    if (passwordField) passwordField.value = this.currentFormData.password || '';
    if (twofaField) twofaField.value = this.currentFormData.twofa || '';
    if (customField) customField.value = this.currentFormData.customField || '';
    if (noteField) {
        const noteValue = (this.currentFormData.note || '').substring(0, 24);
        noteField.value = noteValue;
        const counterSpan = document.getElementById('noteCharCount');
        if (counterSpan) counterSpan.innerHTML = `${noteValue.length} / 24 characters`;
    }
    
    if (passwordField && passwordField.type !== 'password') {
        passwordField.type = 'password';
        const toggleBtn = document.querySelector('.toggle-password-btn[data-target="formPassword"]');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('.material-icons');
            if (icon) icon.textContent = 'visibility';
        }
    }
    
    if (twofaField && twofaField.type !== 'password') {
        twofaField.type = 'password';
        const toggleBtn = document.querySelector('.toggle-password-btn[data-target="form2FA"]');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('.material-icons');
            if (icon) icon.textContent = 'visibility';
        }
    }
    
    if (customField && customField.type !== 'password') {
        customField.type = 'password';
        const toggleBtn = document.querySelector('.toggle-password-btn[data-target="formCustomField"]');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('.material-icons');
            if (icon) icon.textContent = 'visibility';
        }
    }
    
    if (twofaField && this.currentFormData.twofa) {
        const statusDiv = document.getElementById('form2FAStatus');
        if (statusDiv) {
            const isValid = this.validateTOTPSecret(this.currentFormData.twofa);
            statusDiv.innerHTML = isValid ? 
                '<span style="color: var(--primary);">✓ Valid TOTP secret</span>' : 
                '<span style="color: var(--danger);">✗ Invalid TOTP secret format</span>';
        }
    }
    
    const addBtn = document.getElementById('credentialFormAddBtn');
    const updateBtn = document.getElementById('credentialFormUpdateBtn');
    
    if (addBtn) addBtn.style.display = this.isEditing ? 'none' : 'inline-flex';
    if (updateBtn) updateBtn.style.display = this.isEditing ? 'inline-flex' : 'none';
}

    // Update updatePreview method
    updatePreview() {
        const previewContainer = document.getElementById('previewContainer');
        if (!previewContainer) return;
        
        // Remove any existing confirmation bar before updating
        this.removeDeleteConfirmationBar();
        
        // Always update preview, even during editing
        // This ensures real-time updates
        previewContainer.innerHTML = this.getPreviewContentHTML();

        this.updateFilterCount();

    }




    // ========== SEARCH & FILTER ==========
    // Add these methods to handle preview search/filter

setPreviewFilter(filterType) {
    this.currentPreviewFilter = filterType;
    
    // Update button states
    document.querySelectorAll('.preview-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--text-secondary)';
    });
    
    const activeBtn = document.getElementById(`previewFilter${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'var(--active)';
        activeBtn.style.borderColor = 'var(--active)';
        activeBtn.style.color = 'var(--primary)';
    }
    
    this.updatePreview();
    this.updateFilterCount();
    this.updateSearchResultsCount(); // Add this line to update search count on filter change
}

// Add this new method to update the filter count
updateFilterCount() {
    const countElement = document.getElementById('filterCountValue');
    if (!countElement) return;
    
    const credentialSet = this.getCredentialSet();
    let entries = credentialSet.entries || [];
    
    // Count filtered rows based on current filter
    let count = 0;
    const rows = Math.ceil(entries.length / 6);
    
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const startIndex = rowIndex * 6;
        const rowEntries = entries.slice(startIndex, startIndex + 6);
        
        let matchesFilter = true;
        if (this.currentPreviewFilter !== 'all') {
            const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
            const isPending = rowEntries.some(entry => entry && entry.pending);
            
            switch(this.currentPreviewFilter) {
                case 'active':
                    matchesFilter = hasData && !isPending;
                    break;
                case 'pending':
                    matchesFilter = isPending;
                    break;
            }
        }
        
        // Also check if row has any data
        const hasAnyData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
        if (matchesFilter && hasAnyData) {
            count++;
        }
    }
    
    countElement.textContent = count;
    
    // Add pulse animation
    const filterCountDiv = document.getElementById('credentialFilterCount');
    if (filterCountDiv) {
        filterCountDiv.classList.add('pulse');
        setTimeout(() => {
            filterCountDiv.classList.remove('pulse');
        }, 300);
    }
}

handlePreviewSearch() {
    if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
        const searchInput = document.getElementById('previewSearchInput');
        if (searchInput) {
            this.currentSearchTerm = searchInput.value.toLowerCase().trim();
            this.updatePreview();
            this.updateFilterCount();
            this.updateSearchResultsCount();
        }
    }, 300);
}

// Add this new method to update search results count
updateSearchResultsCount() {
    const searchCountDiv = document.getElementById('searchResultsCount');
    const searchResultSpan = document.getElementById('searchResultCountValue');
    
    if (!searchCountDiv || !searchResultSpan) return;
    
    const credentialSet = this.getCredentialSet();
    let entries = credentialSet.entries || [];
    
    // Count matching rows based on search term
    let matchingRowsCount = 0;
    const rows = Math.ceil(entries.length / 6);
    
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const startIndex = rowIndex * 6;
        const rowEntries = entries.slice(startIndex, startIndex + 6);
        
        let matchesSearch = true;
        if (this.currentSearchTerm) {
            matchesSearch = rowEntries.some(entry => 
                entry && entry.value && entry.value.toLowerCase().includes(this.currentSearchTerm)
            );
        }
        
        const hasAnyData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
        
        if (matchesSearch && hasAnyData) {
            matchingRowsCount++;
        }
    }
    
    // Show/hide the search results count
    if (this.currentSearchTerm && matchingRowsCount > 0) {
        searchResultSpan.textContent = matchingRowsCount;
        searchCountDiv.style.display = 'flex';
        
        // Add clear search button functionality
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) {
            // Remove existing listener to avoid duplicates
            const newClearBtn = clearBtn.cloneNode(true);
            clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
            newClearBtn.addEventListener('click', () => {
                const searchInput = document.getElementById('previewSearchInput');
                if (searchInput) {
                    searchInput.value = '';
                    this.currentSearchTerm = '';
                    this.updatePreview();
                    this.updateFilterCount();
                    this.updateSearchResultsCount();
                    searchInput.focus();
                }
            });
        }
    } else if (this.currentSearchTerm && matchingRowsCount === 0) {
        // Show count with 0 results
        searchResultSpan.textContent = '0';
        searchCountDiv.style.display = 'flex';
    } else {
        searchCountDiv.style.display = 'none';
    }
}

    // ========== PASSWORD VISIBILITY ==========
    // Password visibility functions
    toggleAllPasswords() {
        const toggleBtn = document.getElementById('togglePasswordVisibility');
        if (!toggleBtn) return;
        
        this.showPasswords = !this.showPasswords;
        
        if (this.showPasswords) {
            toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Passwords';
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Show Passwords';
        }
        
        this.saveToStorage();
        this.updatePreview();
    }

    toggleSinglePassword(button, password) {
        event.stopPropagation();
        
        const previewItem = button.closest('.preview-item');
        const valueDisplay = previewItem.querySelector('div > div:nth-child(2)');
        
        if (valueDisplay.textContent === '••••••••••') {
            valueDisplay.textContent = password;
            button.innerHTML = '<i class="fas fa-eye-slash"></i>';
        } else {
            valueDisplay.textContent = '••••••••••';
            button.innerHTML = '<i class="fas fa-eye"></i>';
        }
    }


    // ========== COPY OPERATIONS ==========
    copyAll() {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        
        if (entries.length === 0) {
            this.showNotification('No credentials to copy', 'warning');
            return;
        }
        
        let out = '';
        const rows = Math.ceil(entries.length / 6); // Changed from 4 to 6
        
        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            const startIndex = rowIndex * 6; // Changed from 4 to 6
            const rowEntries = entries.slice(startIndex, startIndex + 6); // Changed from 4 to 6
            
            if (rowEntries.some(entry => entry && entry.value && entry.value.trim())) {
                out += `Row ${rowIndex + 1}:\n`;
                out += `  Service: ${rowEntries[0]?.value || ''}\n`;
                out += `  Username: ${rowEntries[1]?.value || ''}\n`;
                out += `  Password: ${rowEntries[2]?.value || ''}\n`;
                out += `  2FA: ${rowEntries[3]?.value || ''}\n`;
                out += `  Custom Field: ${rowEntries[4]?.value || ''}\n\n`;
                out += `  Note: ${rowEntries[5]?.value || ''}\n`;
            }
        }
        
        navigator.clipboard.writeText(out.trim()).then(() => {
            this.showNotification('All credentials copied to clipboard', 'success');
        });
    }

copyRow(rowIndex) {
    const credentialSet = this.getCredentialSet();
    const entries = credentialSet.entries || [];
    const startIndex = rowIndex * 6;
    const rowEntries = entries.slice(startIndex, startIndex + 6);
    
    const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
    if (!hasData) {
        this.showNotification('Cannot copy empty row', 'warning');
        return;
    }
    
    // Note: truncate note to 24 chars for display in copy
    const noteValue = rowEntries[5]?.value || '';
    const truncatedNote = noteValue.length > 24 ? noteValue.substring(0, 24) : noteValue;
    
    let rowText = `Row ${rowIndex + 1}:\n`;
    rowText += `  Service: ${rowEntries[0]?.value || ''}\n`;
    rowText += `  Username: ${rowEntries[1]?.value || ''}\n`;
    rowText += `  Password: ${rowEntries[2]?.value || ''}\n`;
    rowText += `  2FA: ${rowEntries[3]?.value || ''}\n`;
    rowText += `  Custom Field: ${rowEntries[4]?.value || ''}\n`;
    rowText += `  Note: ${truncatedNote}`;
    
    navigator.clipboard.writeText(rowText).then(() => {
        this.showNotification(`Row ${rowIndex + 1} copied to clipboard`, 'success');
    });
}


    // Add this method to handle note copying properly
    copyToClipboard(text) {
        if (!text) return;
        
        // If text contains ;, replace with line breaks for clipboard
        const clipboardText = text.includes(';') 
            ? text.split(';').map(line => line.trim()).join('\n')
            : text;
            
        navigator.clipboard.writeText(clipboardText).then(() => {
            this.showNotification('Copied to clipboard', 'success');
        });
    }

    // Method to copy TOTP code
    copyTOTPCode(secret) {
        try {
            // Clean the secret
            const cleanSecret = secret.trim();
            if (!cleanSecret) {
                this.showNotification('No TOTP secret found', 'warning');
                return;
            }
            
            // Generate fresh TOTP code
            const currentCode = this.generateTOTP(cleanSecret);
            
            // Don't copy if invalid
            if (currentCode === 'Error' || currentCode === 'Invalid') {
                this.showNotification('Invalid TOTP secret', 'error');
                return;
            }
            
            // Get time remaining for the message
            const timeLeft = this.getTimeRemaining();
            
            // Copy to clipboard
            navigator.clipboard.writeText(currentCode).then(() => {
                this.showNotification(`TOTP code copied: ${currentCode} (valid for ${timeLeft}s)`, 'success');
            }).catch(err => {
                console.error('Failed to copy TOTP:', err);
                this.showNotification('Failed to copy TOTP code', 'error');
            });
            
        } catch (error) {
            console.error('Error copying TOTP:', error);
            this.showNotification('Error generating TOTP code', 'error');
        }
    }


    // ========== ROW STATUS ==========
    toggleRowStatus(rowIndex) {
        const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
        if (credentialIndex !== -1) {
            const entries = this.credentials[credentialIndex].entries;
            const startIndex = rowIndex * 6;
            
            const rowHasData = entries.slice(startIndex, startIndex + 6)
                .some(entry => entry && entry.value && entry.value.trim());
            
            if (!rowHasData) {
                this.showNotification('Cannot toggle status for empty row', 'warning');
                return;
            }
            
            // Check current pending status (check any field, they're all the same)
            const isCurrentlyPending = entries[startIndex]?.pending || false;
            const newPendingStatus = !isCurrentlyPending;
            
            // Toggle ALL 6 fields at once
            for (let i = 0; i < 6; i++) {
                const entryIndex = startIndex + i;
                if (entryIndex < entries.length && entries[entryIndex]) {
                    entries[entryIndex].pending = newPendingStatus;
                    entries[entryIndex].pendingAt = newPendingStatus ? new Date().toISOString() : null;
                }
            }
            
            this.credentials[credentialIndex].lastUpdated = 'Just now';
            
            this.saveToStorage().then(() => {
                this.updatePreview();
                this.syncRowToFirebase(rowIndex);  // This will now save single pending flag
            });
            
            this.showNotification(`Row ${rowIndex + 1} ${newPendingStatus ? 'marked as pending' : 'activated'}`, 'success');
        }
    }

    // Helper method to get field name (for debugging)
    getFieldName(index) {
        const fieldNames = ['Service Tag', 'Username', 'Password', '2FA', 'Custom Field', 'Note'];
        return fieldNames[index] || `Field ${index}`;
    }



    // ========== TOTP OPERATIONS ==========
    // Start TOTP timer to refresh codes every second
    startTOTPTimer() {
        // Clear any existing interval
        if (this.totpInterval) {
            clearInterval(this.totpInterval);
        }
        
        // Update immediately
        this.updateTOTPCodes();
        
        // Update every second for smooth progress bar
        this.totpInterval = setInterval(() => {
            this.updateTOTPCodes();
        }, 1000);
    }

    stopTOTPTimer() {
        if (this.totpInterval) {
            clearInterval(this.totpInterval);
            this.totpInterval = null;
        }
    }

    // Update TOTP codes and progress bars
    updateTOTPCodes() {
        const previewContainer = document.getElementById('previewContainer');
        if (!previewContainer) return;

        // Find all TOTP displays
        const totpDisplays = previewContainer.querySelectorAll('.totp-display');
        
        totpDisplays.forEach(display => {
            const secret = display.dataset.secret;
            if (secret && secret !== 'undefined' && secret !== 'null') {
                try {
                    const timeLeft = this.getTimeRemaining();
                    const code = this.generateTOTP(secret.trim());
                    
                    // Only update if code is valid
                    if (code !== 'Error' && code !== 'Invalid') {
                        // Update code with time color
                        const codeSpan = display.querySelector('.totp-code');
                        if (codeSpan) {
                            codeSpan.textContent = code;
                        }
                        
                        // Update time indicator
                        const timeSpan = display.querySelector('.totp-time');
                        if (timeSpan) {
                            timeSpan.textContent = `${timeLeft}s`;
                        }
                        
                        // Update progress bar
                        const progressBar = display.querySelector('.totp-progress-bar');
                        if (progressBar) {
                            progressBar.style.width = `${(timeLeft / 30) * 100}%`;
                        }
                    }
                } catch (error) {
                    console.error('Error updating TOTP:', error);
                }
            }
        });
    }

    // Get time remaining in current 30-second interval
    getTimeRemaining() {
        const now = Math.floor(Date.now() / 1000);
        return 30 - (now % 30);
    }

    // Real TOTP generation function using the working implementation
    generateTOTP(secret) {
        try {
            // Clean the secret
            const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
            if (!cleanSecret) return 'Invalid';
            
            // Decode base32 secret
            const key = this.base32Decode(cleanSecret);
            if (key.length === 0) return 'Invalid';
            
            const step = 30;
            let counter = Math.floor(Date.now() / 1000 / step);
            const msg = new Array(8).fill(0);
            
            // Convert counter to 8-byte big-endian array
            for (let i = 7; i >= 0; i--) {
                msg[i] = counter & 0xff;
                counter >>= 8;
            }
            
            // Generate HMAC-SHA1
            const hash = this.hmacSha1(key, msg);
            
            // Dynamic truncation
            const offset = hash[hash.length - 1] & 0x0f;
            
            // Extract 4-byte dynamic binary code
            const bin = ((hash[offset] & 0x7f) << 24) |
                       ((hash[offset + 1] & 0xff) << 16) |
                       ((hash[offset + 2] & 0xff) << 8) |
                       (hash[offset + 3] & 0xff);
            
            // Generate 6-digit code (default for TOTP)
            const otp = bin % 1000000;
            
            // Pad with leading zeros
            return otp.toString().padStart(6, '0');
            
        } catch (error) {
            console.error('TOTP generation error:', error);
            return 'Error';
        }
    }

    // Add this method to handle 2FA code validation
    validateTOTPSecret(secret) {
        if (!secret) return false;
        
        // Basic validation for Base32 TOTP secret
        const base32Regex = /^[A-Z2-7]+=*$/i;
        const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
        
        if (!base32Regex.test(cleanSecret)) {
            return false;
        }
        
        // Check length (typically 16, 32 characters for SHA1 TOTP)
        const validLengths = [16, 32, 64]; // Common lengths for TOTP secrets
        if (!validLengths.includes(cleanSecret.length)) {
            // Not strictly invalid, but uncommon
            console.warn('Unusual TOTP secret length:', cleanSecret.length);
        }
        
        return true;
    }

    // Add QR code scanning helper method (optional)
    extractSecretFromQR(qrText) {
        // Common TOTP URI format: otpauth://totp/Service:user?secret=SECRET&issuer=Service
        const match = qrText.match(/secret=([A-Z2-7]+)/i);
        if (match) {
            return match[1];
        }
        
        // Also try different formats
        const match2 = qrText.match(/secret%3D([A-Z2-7]+)/i);
        if (match2) {
            return match2[1];
        }
        
        return null;
    }

    // Add method to generate TOTP URI for QR codes
    generateTOTPURI(service, account, secret) {
        return `otpauth://totp/${encodeURIComponent(service)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(service)}&algorithm=SHA1&digits=6&period=30`;
    }

    // Add this method to show TOTP validation in table
    update2FAValidation() {
        const inputs = document.querySelectorAll('input[data-col="4"]');
        inputs.forEach(input => {
            const secret = input.value.trim();
            if (secret) {
                const isValid = this.validateTOTPSecret(secret);
                if (isValid) {
                    input.style.borderColor = 'var(--primary)';
                    input.style.boxShadow = '0 0 0 1px var(--primary)';
                } else {
                    input.style.borderColor = 'var(--danger)';
                    input.style.boxShadow = '0 0 0 1px var(--danger)';
                }
            } else {
                input.style.borderColor = '';
                input.style.boxShadow = '';
            }
        });
    }


    // ========== HMAC & BASE32 UTILITIES ==========
    // Base32 decoding for TOTP secrets
    decodeBase32(base32) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleaned = base32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
        
        let bits = 0;
        let value = 0;
        let output = [];
        
        for (let i = 0; i < cleaned.length; i++) {
            const char = cleaned.charAt(i);
            const index = alphabet.indexOf(char);
            if (index === -1) continue;
            
            value = (value << 5) | index;
            bits += 5;
            
            if (bits >= 8) {
                output.push((value >>> (bits - 8)) & 0xFF);
                bits -= 8;
            }
        }
        
        return new Uint8Array(output);
    }

    sha1(msg) {
        function rol(n, s) { return (n << s) | (n >>> (32 - s)); }
        let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
        msg = msg.slice();
        const ml = msg.length * 8;
        msg.push(0x80);
        while ((msg.length * 8) % 512 !== 448) msg.push(0);
        for (let i = 7; i >= 0; i--) msg.push((ml >>> (i * 8)) & 255);
        for (let i = 0; i < msg.length; i += 64) {
            let w = new Array(80);
            for (let j = 0; j < 16; j++) w[j] = (msg[i + 4 * j] << 24) | (msg[i + 4 * j + 1] << 16) | (msg[i + 4 * j + 2] << 8) | msg[i + 4 * j + 3];
            for (let j = 16; j < 80; j++) w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
            let a = h0, b = h1, c = h2, d = h3, e = h4;
            for (let j = 0; j < 80; j++) {
                let f, k;
                if (j < 20) { f = (b & c) | ((~b) & d); k = 0x5a827999; }
                else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
                else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
                else { f = b ^ c ^ d; k = 0xca62c1d6; }
                const temp = (rol(a, 5) + f + e + k + w[j]) >>> 0;
                e = d; d = c; c = rol(b, 30) >>> 0; b = a; a = temp;
            }
            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
        }
        return [h0, h1, h2, h3, h4].flatMap(h => [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255]);
    }

    // Base32 decoding function from totp.html
    base32Decode(str) {
        const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = "", bytes = [];
        str = str.replace(/=+$/, '').toUpperCase();
        for (let c of str) {
            const v = base32chars.indexOf(c);
            if (v < 0) continue;
            bits += v.toString(2).padStart(5, '0');
        }
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.slice(i, i + 8), 2));
        }
        return bytes;
    }

    // HMAC-SHA1 implementation from totp.html
    hmacSha1(key, msg) {
        if (key.length > 64) key = this.sha1(key);
        const o = [], i = [];
        for (let n = 0; n < 64; n++) {
            const k = key[n] || 0;
            o[n] = 0x5c ^ k;
            i[n] = 0x36 ^ k;
        }
        return this.sha1(i.concat(msg).concat(o.concat(this.sha1(i.concat(msg)))));
    }


    // ========== SERVICE DETECTION ==========
    initializeServiceKeywords() {
        // Service name mapping with icons (unchanged)
        this.serviceKeywords = {
            'Google':        { keyword: 'google',        icon: 'fab fa-google',        color: '#DB4437' },
            'GitHub':        { keyword: 'github',        icon: 'fab fa-github',        color: '#4078c0' },
            'AWS':           { keyword: 'aws',           icon: 'fab fa-aws',           color: '#FF9900' },
            'Microsoft':     { keyword: 'microsoft',     icon: 'fab fa-microsoft',     color: '#00A4EF' },
            'Apple':         { keyword: 'apple',         icon: 'fab fa-apple',         color: '#000000' },
            'Amazon':        { keyword: 'amazon',        icon: 'fab fa-amazon',        color: '#FF9900' },
            'Facebook':      { keyword: 'facebook',      icon: 'fab fa-facebook',      color: '#1877F2' },
            'Twitter':       { keyword: 'twitter',       icon: 'fab fa-twitter',       color: '#1DA1F2' },
            'LinkedIn':      { keyword: 'linkedin',      icon: 'fab fa-linkedin',      color: '#0077B5' },
            'Netflix':       { keyword: 'netflix',       icon: 'fab fa-netflix',       color: '#E50914' },
            'YouTube':       { keyword: 'youtube',       icon: 'fab fa-youtube',       color: '#FF0000' },
            'Twitch':        { keyword: 'twitch',        icon: 'fab fa-twitch',        color: '#9146FF' },
            'Spotify':       { keyword: 'spotify',       icon: 'fab fa-spotify',       color: '#1DB954' },
            'SoundCloud':    { keyword: 'soundcloud',    icon: 'fab fa-soundcloud',    color: '#FF3300' },
            'Dropbox':       { keyword: 'dropbox',       icon: 'fab fa-dropbox',       color: '#0061FF' },
            'Salesforce':    { keyword: 'salesforce',    icon: 'fab fa-salesforce',    color: '#00A1E0' },
            'Slack':         { keyword: 'slack',         icon: 'fab fa-slack',         color: '#4A154B' },
            'Zoom':          { keyword: 'zoom',          icon: 'fab fa-zoom',          color: '#2D8CFF' },
            'Bitbucket':     { keyword: 'bitbucket',     icon: 'fab fa-bitbucket',     color: '#0052CC' },
            'GitLab':        { keyword: 'gitlab',        icon: 'fab fa-gitlab',        color: '#FC6D26' },
            'DigitalOcean':  { keyword: 'digitalocean',  icon: 'fab fa-digital-ocean', color: '#0080FF' },
            'Instagram':     { keyword: 'instagram',     icon: 'fab fa-instagram',     color: '#E4405F' },
            'TikTok':        { keyword: 'tiktok',        icon: 'fab fa-tiktok',        color: '#000000' },
            'Reddit':        { keyword: 'reddit',        icon: 'fab fa-reddit',        color: '#FF4500' },
            'Pinterest':     { keyword: 'pinterest',     icon: 'fab fa-pinterest',     color: '#E60023' },
            'Snapchat':      { keyword: 'snapchat',      icon: 'fab fa-snapchat',      color: '#FFFC00' },
            'Discord':       { keyword: 'discord',       icon: 'fab fa-discord',       color: '#5865F2' },
            'Telegram':      { keyword: 'telegram',      icon: 'fab fa-telegram',      color: '#0088CC' },
            'WhatsApp':      { keyword: 'whatsapp',      icon: 'fab fa-whatsapp',      color: '#25D366' },
            'WeChat':        { keyword: 'wechat',        icon: 'fab fa-weixin',        color: '#07C160' },
            'Steam':         { keyword: 'steam',         icon: 'fab fa-steam',         color: '#171A21' },
            'Xbox':          { keyword: 'xbox',          icon: 'fab fa-xbox',          color: '#107C10' },
            'PlayStation':   { keyword: 'playstation',   icon: 'fab fa-playstation',   color: '#003087' },
            'EpicGames':     { keyword: 'epic',          icon: 'fab fa-epic-games',    color: '#2A2A2A' },
            'PayPal':        { keyword: 'paypal',        icon: 'fab fa-paypal',        color: '#00457C' },
            'Stripe':        { keyword: 'stripe',        icon: 'fab fa-stripe',        color: '#008CDD' },
            'Visa':          { keyword: 'visa',          icon: 'fab fa-cc-visa',       color: '#1A1F71' },
            'MasterCard':    { keyword: 'mastercard',    icon: 'fab fa-cc-mastercard', color: '#EB001B' },
            'Amex':          { keyword: 'amex',          icon: 'fab fa-cc-amex',       color: '#2E77BC' },
            'Bitcoin':       { keyword: 'bitcoin',       icon: 'fab fa-bitcoin',       color: '#F7931A' },
            'eBay':          { keyword: 'ebay',          icon: 'fab fa-ebay',          color: '#E53238' },
            'Shopify':       { keyword: 'shopify',       icon: 'fab fa-shopify',       color: '#7AB55C' },
            'Coursera':      { keyword: 'coursera',      icon: 'fab fa-leanpub',       color: '#0056D2' },
            'Udemy':         { keyword: 'udemy',         icon: 'fab fa-udemy',         color: '#A435F0' },
            'KhanAcademy':   { keyword: 'khan',          icon: 'fab fa-leanpub',       color: '#14BF96' },
            'Gmail':         { keyword: 'gmail',         icon: 'far fa-envelope',      color: '#D14836' },
            'YahooMail':     { keyword: 'yahoo',         icon: 'fab fa-yahoo',         color: '#720E9E' },
            'Outlook':       { keyword: 'outlook',       icon: 'fab fa-microsoft',     color: '#0072C6' },
            'ProtonMail':    { keyword: 'protonmail',    icon: 'fas fa-shield-alt',    color: '#8B89CC' },
            'Uber':          { keyword: 'uber',          icon: 'fab fa-uber',          color: '#000000' },
            'Airbnb':        { keyword: 'airbnb',        icon: 'fab fa-airbnb',        color: '#FF5A5F' },
            'Medium':        { keyword: 'medium',        icon: 'fab fa-medium',        color: '#000000' },
            'WordPress':     { keyword: 'wordpress',     icon: 'fab fa-wordpress',     color: '#21759B' },
            'Blogger':       { keyword: 'blogger',       icon: 'fab fa-blogger',       color: '#FF5722' },
            'StackOverflow': { keyword: 'stackoverflow', icon: 'fab fa-stack-overflow',color: '#F48024' },
            'Quora':         { keyword: 'quora',         icon: 'fab fa-quora',         color: '#B92B27' },
            'Vimeo':         { keyword: 'vimeo',         icon: 'fab fa-vimeo',         color: '#1AB7EA' },
            'DeviantArt':    { keyword: 'deviantart',    icon: 'fab fa-deviantart',    color: '#05CC47' },
            'Dribbble':      { keyword: 'dribbble',      icon: 'fab fa-dribbble',      color: '#EA4C89' },
        };
    }

    getServiceInfo(serviceName) {
        if (!serviceName) return null;
        
        const lowerName = serviceName.toLowerCase();
        for (const [name, info] of Object.entries(this.serviceKeywords)) {
            if (info.keyword.toLowerCase() === lowerName) {
                return {
                    name: name,
                    icon: info.icon,
                    color: info.color
                };
            }
        }
        return null;
    }


    // ========== UTILITY METHODS ==========
    // Utility Methods
    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

// Backward compatibility wrapper
showNotification(message, type = 'success') {
    if (window.toastManager) {
        window.toastManager.show(message, type);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}




    // ========== STYLES & CSS ==========
    
    // Add this to your addStickyColumnStyles method or create a new method
addPreviewStyles() {
    if (!document.getElementById('preview-styles')) {
        const style = document.createElement('style');
        style.id = 'preview-styles';
        style.textContent = `
            /* Preview container smooth updates */
            #previewContainer {
                transition: opacity 0.1s ease;
            }
            
            .preview-card {
                transition: all 0.2s ease;
            }
            
            .preview-item {
                transition: all 0.15s ease;
            }

            .preview-item.note-field {
                cursor: pointer;
            }
            
            .totp-code, .totp-time {
                transition: color 0.1s ease;
            }
            
            .totp-progress-bar {
                transition: width 0.2s linear, background-color 0.1s ease;
            }
            
            /* 
            .preview-item div > div:first-child {
                color: var(--primary-light) !important; 
            }
                */
               
            /* Modal animations */
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            
            @keyframes slideUp {
                from { 
                    opacity: 0;
                    transform: translateY(20px);
                }
                to { 
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
}


    // ========== RESET & CLEANUP ==========
    // Clear local data for logout
    async clearLocalData() {
        // Clear timers
        this.stopTOTPTimer();

        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.syncTimer) clearTimeout(this.syncTimer);
        if (this.previewUpdateTimer) clearTimeout(this.previewUpdateTimer);
        
        try {
            // Clear IndexedDB
            if (this.db) {
                const transaction = this.db.transaction(['credentials', 'syncMetadata'], 'readwrite');
                transaction.objectStore('credentials').clear();
                transaction.objectStore('syncMetadata').clear();
            }
            
            // Reset data
            this.credentials = [];
            this.showPasswords = false;
            this.currentPreviewFilter = 'all';
            this.currentSearchTerm = '';
            this.pendingOperations.clear();
            
            // Remove Firebase listeners
            if (this.firebaseListeners.credentials) {
                const homeDb = window.authModule?.getHomeDatabaseInstance();
                if (homeDb && homeDb.db) {
                    const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
                    if (encodedEmail) {
                        const ref = homeDb.db.ref(`userData/${encodedEmail}/credentialData`);
                        ref.off('value', this.firebaseListeners.credentials.value);
                    }
                }
            }
            this.firebaseListeners = {};
            
            // Initialize empty data
            this.initializeEmptyData();
            
            console.log('Credential manager local data cleared');
            
            // Update UI if visible
            if (document.getElementById('credential')) {
                this.updatePreview();
            }
            
            return true;
        } catch (error) {
            console.error('Error clearing credential manager local data:', error);
            return false;
        }
    }

    // Reset data for logout
    async resetDataForLogout() {
        return this.clearLocalData();
    }


    // ========== EVENT HANDLERS ==========
    // Event Management
    attachEventListeners() {
        this.attachButtonListeners();
        this.updatePreview();
        this.addPreviewStyles();
        this.addDeleteStyles();
        this.addMoreOptionsStyles();
    }

    attachButtonListeners() {
        // Add toggle password visibility button event
        const toggleBtn = document.getElementById('togglePasswordVisibility');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleAllPasswords());
        }
    }


}

// Initialize credential manager globally
let credentialManager;

document.addEventListener('DOMContentLoaded', async function() {
    credentialManager = new CredentialManager();
    window.credentialManager = credentialManager;
    
    // Listen for logout event
    window.addEventListener('authLogout', function() {
        if (credentialManager) {
            credentialManager.clearLocalData();
        }
    });
    
    // Auto-save every 30 seconds
    setInterval(() => {
        if (credentialManager) {
            credentialManager.saveToStorage();
        }
    }, 30000);
    
    // Start TOTP timer
    setTimeout(() => {
        if (credentialManager && credentialManager.startTOTPTimer) {
            credentialManager.startTOTPTimer();
        }
    }, 500);
    
    // Listen for auth changes
    window.addEventListener('authSuccess', async () => {
        if (credentialManager) {
            await credentialManager.initFirebaseSync();
        }
    });
});