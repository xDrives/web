// Notes Module - Reusable Notes System with Firebase Primary + IndexedDB Cache
class NotesModule {
    constructor() {
        // ========== 1. PROPERTY DECLARATIONS ==========
        this.storageKey = 'notes-module-data';
        this.dbName = 'NotesDB';
        this.dbVersion = 2;
        this.db = null;
        this.notes = [];
        this.currentTags = [];
        this.editingNoteId = null;
        this.currentZoom = 1;
        this.currentViewNoteId = null;
        this.pendingDeleteId = null;
        this.autoSaveTimer = null;
        this.statusTimer = null;
        this.zoomNotificationTimer = null;
        
        // Firebase sync tracking
        this.syncInProgress = false;
        this.lastSyncTime = null;
        this.isInitialized = false;
        this.pendingOperations = new Map();
        this.firebaseListeners = {};
        this.init();
    }

    // ========== 2. INITIALIZATION & SETUP ==========
    async init() {
        console.log('Notes Module initializing with Firebase primary storage');
        
        // Initialize IndexedDB first
        await this.initIndexedDB();
        
        // Load from IndexedDB cache first (this will display data immediately)
        await this.loadFromIndexedDB();
        
        // Then load data from Firebase in background
        await this.initFirebaseSync();
        
        this.isInitialized = true;
    }

    // Initialize IndexedDB
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
                
                // Create notes store with proper indexes
                if (!db.objectStoreNames.contains('notes')) {
                    const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
                    noteStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                    noteStore.createIndex('isArchived', 'isArchived', { unique: false });
                    noteStore.createIndex('isPinned', 'isPinned', { unique: false });
                    noteStore.createIndex('lastModified', 'lastModified', { unique: false });
                }
                
                // Create syncMetadata store
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

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser.email);
            if (!encodedEmail) return;

            console.log('Setting up Firebase real-time listeners for notes...');

            // Listen for notes changes
            const notesRef = homeDb.db.ref(`userData/${encodedEmail}/notesModuleData/notes`);
            this.setupFirebaseListener('notes', notesRef);

            // Load initial data from Firebase
            await this.loadFromFirebase();

        } catch (error) {
            console.error('Error initializing Firebase sync:', error);
        }
    }

    // Load from IndexedDB cache - MODIFIED to show data immediately
    async loadFromIndexedDB() {
        try {
            const cachedNotes = await this.getAllFromIndexedDB('notes');
            if (cachedNotes && cachedNotes.length > 0) {
                this.notes = cachedNotes;
                console.log('Notes loaded from IndexedDB cache:', this.notes.length, 'notes');
            } else {
                this.notes = [];
                console.log('No notes found in IndexedDB cache, starting empty');
            }
            
            // Update display immediately with cached data
            this.updateNotesDisplay();
        } catch (error) {
            console.error('Error loading from IndexedDB:', error);
            this.notes = [];
            this.updateNotesDisplay();
        }
    }

    // Load from Firebase - MODIFIED to merge data properly
    async loadFromFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Cannot load from Firebase - user not authenticated');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser.email);
            if (!encodedEmail) return false;

            console.log('Loading notes data from Firebase...');

            const notesRef = homeDb.db.ref(`userData/${encodedEmail}/notesModuleData/notes`);
            const notesSnapshot = await notesRef.once('value');
            const notesData = notesSnapshot.val();

            if (notesData) {
                const firebaseNotes = Object.values(notesData).map(note => ({
                    ...note,
                    isPinned: note.isPinned || false,
                    isArchived: note.isArchived || false,
                    tags: note.tags || [],
                    lastUpdated: note.lastUpdated || new Date().toISOString(),
                    createdDate: note.createdDate || new Date().toISOString(),
                    lastModified: note.lastModified || Date.now()
                }));
                
                // Check if data has changed
                const needsUpdate = this.hasNotesDataChanged(firebaseNotes, this.notes);
                
                if (needsUpdate) {
                    console.log('Firebase data differs from cache, updating...');
                    this.notes = firebaseNotes;
                    await this.saveAllToIndexedDB('notes', firebaseNotes);
                    this.updateNotesDisplay();
                } else {
                    console.log('Firebase data matches cache, no update needed');
                }
            } else {
                // No data in Firebase, upload local data
                console.log('No notes data in Firebase, uploading local cache...');
                await this.uploadLocalNotesToFirebase();
            }
            
            return true;

        } catch (error) {
            console.error('Error loading notes from Firebase:', error);
            return false;
        }
    }

    // Setup Firebase real-time listener
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
                const id = parseInt(snapshot.key);
                this.handleFirebaseDelete(type, id);
            }
        };

        ref.on('child_added', listeners.added);
        ref.on('child_changed', listeners.changed);
        ref.on('child_removed', listeners.removed);

        this.firebaseListeners[type] = listeners;
    }

    // Helper method to check if data has changed
    hasNotesDataChanged(firebaseNotes, localNotes) {
        if (firebaseNotes.length !== localNotes.length) return true;
        
        // Sort both arrays by ID for comparison
        const sortedFirebase = [...firebaseNotes].sort((a, b) => a.id - b.id);
        const sortedLocal = [...localNotes].sort((a, b) => a.id - b.id);
        
        for (let i = 0; i < sortedFirebase.length; i++) {
            if (sortedFirebase[i].id !== sortedLocal[i].id) return true;
            if (sortedFirebase[i].title !== sortedLocal[i].title) return true;
            if (sortedFirebase[i].content !== sortedLocal[i].content) return true;
            if (sortedFirebase[i].isPinned !== sortedLocal[i].isPinned) return true;
            if (sortedFirebase[i].isArchived !== sortedLocal[i].isArchived) return true;
            if (JSON.stringify(sortedFirebase[i].tags) !== JSON.stringify(sortedLocal[i].tags)) return true;
        }
        
        return false;
    }

    // Upload local notes to Firebase
    async uploadLocalNotesToFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) return;
        
        console.log('Uploading local notes to Firebase...');
        
        for (const note of this.notes) {
            await this.saveNoteToFirebase(note);
        }
        
        console.log('Local notes uploaded to Firebase');
    }


    // ========== 3. DATABASE OPERATIONS ==========
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

    // Save all notes to IndexedDB and Firebase
    async saveData() {
        // Save to IndexedDB cache
        await this.saveAllToIndexedDB('notes', this.notes);
        
        // Save to Firebase if online and authenticated
        if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
            for (const note of this.notes) {
                await this.saveNoteToFirebase(note);
            }
        }
    }

    
    // ========== 4. FIREBASE SYNC OPERATIONS ==========
    // Handle Firebase add event
    async handleFirebaseAdd(type, data) {
        if (this.pendingOperations.has(`${type}:${data.id}`)) {
            // This is our own operation, ignore
            this.pendingOperations.delete(`${type}:${data.id}`);
            return;
        }

        console.log(`Firebase ${type} added:`, data.id);

        if (type === 'notes') {
            // Check if note already exists in cache
            const existingIndex = this.notes.findIndex(n => n.id === data.id);
            if (existingIndex === -1) {
                this.notes.push(data);
                await this.saveToIndexedDB('notes', data);
                this.updateNotesDisplay();
            }
        }
    }

    // Handle Firebase update event
    async handleFirebaseUpdate(type, data) {
        if (this.pendingOperations.has(`${type}:${data.id}`)) {
            // This is our own operation, ignore
            this.pendingOperations.delete(`${type}:${data.id}`);
            return;
        }

        console.log(`Firebase ${type} updated:`, data.id);

        if (type === 'notes') {
            const index = this.notes.findIndex(n => n.id === data.id);
            if (index !== -1) {
                this.notes[index] = data;
                await this.saveToIndexedDB('notes', data);
                this.updateNotesDisplay();
            }
        }
    }

    // Handle Firebase delete event
    async handleFirebaseDelete(type, id) {
        if (this.pendingOperations.has(`${type}:${id}`)) {
            // This is our own operation, ignore
            this.pendingOperations.delete(`${type}:${id}`);
            return;
        }

        console.log(`Firebase ${type} deleted:`, id);

        if (type === 'notes') {
            this.notes = this.notes.filter(n => n.id !== id);
            await this.deleteFromIndexedDB('notes', id);
            this.updateNotesDisplay();
        }
    }

    // Save note to Firebase
    async saveNoteToFirebase(note) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser.email);
            if (!encodedEmail) return false;

            // Mark as pending operation
            this.pendingOperations.set(`notes:${note.id}`, true);

            // Save to Firebase
            const noteRef = homeDb.db.ref(`userData/${encodedEmail}/notesModuleData/notes/${note.id}`);
            await noteRef.set(note);

            // Update local cache
            const existingIndex = this.notes.findIndex(n => n.id === note.id);
            if (existingIndex !== -1) {
                this.notes[existingIndex] = note;
            } else {
                this.notes.push(note);
            }
            
            await this.saveToIndexedDB('notes', note);
            
            // Clear pending operation after a delay
            setTimeout(() => {
                this.pendingOperations.delete(`notes:${note.id}`);
            }, 500);
            
            console.log('Note saved to Firebase:', note.id);
            return true;

        } catch (error) {
            console.error('Error saving note to Firebase:', error);
            this.showNotification('Error saving note to cloud', 'error');
            return false;
        }
    }

    // Delete note from Firebase
    async deleteNoteFromFirebase(noteId) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser.email);
            if (!encodedEmail) return false;

            // Mark as pending operation
            this.pendingOperations.set(`notes:${noteId}`, true);

            // Delete from Firebase
            const noteRef = homeDb.db.ref(`userData/${encodedEmail}/notesModuleData/notes/${noteId}`);
            await noteRef.remove();

            // Delete from local cache
            this.notes = this.notes.filter(n => n.id !== noteId);
            await this.deleteFromIndexedDB('notes', noteId);

            // Clear pending operation after a delay
            setTimeout(() => {
                this.pendingOperations.delete(`notes:${noteId}`);
            }, 500);

            console.log('Note deleted from Firebase:', noteId);
            return true;

        } catch (error) {
            console.error('Error deleting note from Firebase:', error);
            this.showNotification('Error deleting note from cloud', 'error');
            return false;
        }
    }


    // ========== 5. CORE NOTE OPERATIONS ==========
    // Add new note
    async addNote(noteData) {
        const now = new Date().toISOString();
        const maxId = this.notes.length > 0 ? Math.max(...this.notes.map(n => n.id)) : 0;
        const newNote = {
            id: maxId + 1,
            isPinned: false,
            isArchived: false,
            lastUpdated: now,
            createdDate: now,
            lastModified: Date.now(),
            ...noteData
        };
        
        this.notes.push(newNote);
        await this.saveToIndexedDB('notes', newNote);
        
        if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
            await this.saveNoteToFirebase(newNote);
        }
        
        this.updateNotesDisplay();
        this.showNotification('Note created successfully');
    }

    // Update existing note
    async updateNote(noteId, noteData) {
        const index = this.notes.findIndex(n => n.id === noteId);
        if (index !== -1) {
            this.notes[index] = {
                ...this.notes[index],
                ...noteData,
                lastUpdated: new Date().toISOString(),
                lastModified: Date.now()
            };
            
            const updatedNote = this.notes[index];
            await this.saveToIndexedDB('notes', updatedNote);
            
            if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
                await this.saveNoteToFirebase(updatedNote);
            }
            
            this.updateNotesDisplay();
            this.showNotification('Note updated successfully');
        }
    }

    // Delete note
    async deleteNote(noteId) {
        this.notes = this.notes.filter(n => n.id !== noteId);
        await this.deleteFromIndexedDB('notes', noteId);
        
        if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
            await this.deleteNoteFromFirebase(noteId);
        }
        
        this.updateNotesDisplay();
        
        if (this.currentViewNoteId === noteId) {
            this.closeNoteViewModal();
        }
        
        this.showNotification('Note deleted successfully');
    }


    // Toggle pin
    async togglePin(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
            note.isPinned = !note.isPinned;
            note.lastUpdated = new Date().toISOString();
            note.lastModified = Date.now();
            
            await this.saveToIndexedDB('notes', note);
            
            if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
                await this.saveNoteToFirebase(note);
            }
            
            this.updateNotesDisplay();
        }
    }

    // Archive note
    async archiveNote(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
            note.isArchived = true;
            note.isPinned = false;
            note.lastUpdated = new Date().toISOString();
            note.lastModified = Date.now();
            
            await this.saveToIndexedDB('notes', note);
            
            if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
                await this.saveNoteToFirebase(note);
            }
            
            this.updateNotesDisplay();
            this.showNotification('Note archived');
        }
    }

    // Restore note from archive
    async restoreNote(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
            note.isArchived = false;
            note.lastUpdated = new Date().toISOString();
            note.lastModified = Date.now();
            
            await this.saveToIndexedDB('notes', note);
            
            if (window.authModule && window.authModule.isLoggedIn() && navigator.onLine) {
                await this.saveNoteToFirebase(note);
            }
            
            this.updateNotesDisplay();
            this.showNotification('Note restored');
        }
    }

    getActiveNotes() {
        return this.notes.filter(note => !note.isArchived);
    }

    getNotes() {
        return this.notes;
    }


    // ========== 6. EDITOR MANAGEMENT ==========
    initializeEditor() {
        const titleInput = document.getElementById('noteTitle');
        if (titleInput) {
            titleInput.addEventListener('input', () => this.updateTitleCounter());
            this.updateTitleCounter();
        }

        const toolbarButtons = document.querySelectorAll('.note-toolbar-btn');
        toolbarButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                const command = this.dataset.command;
                const value = this.dataset.value;
                
                if (command) {
                    document.execCommand(command, false, value);
                }
                
                setTimeout(() => notesModule.updateCharacterCount(), 10);
            });
        });

        const updateUndoRedoState = () => {
            document.querySelector('[data-command="undo"]').disabled =
                !document.queryCommandEnabled('undo');
            document.querySelector('[data-command="redo"]').disabled =
                !document.queryCommandEnabled('redo');
        };

        const contentEditable = document.getElementById('noteContent');
        if (contentEditable) {
            this.updateCharacterCount();
            
            // Remove placeholder - just set empty content
            contentEditable.innerHTML = '';
            
            // Remove any placeholder-related event listeners
            contentEditable.addEventListener('input', () => {
                this.updateCharacterCount();
            });
            
            contentEditable.addEventListener('keyup', updateUndoRedoState);
            
            // Add focus/blur events only for character counting, not placeholder
            contentEditable.addEventListener('focus', () => {
                this.updateCharacterCount();
            });
            
            contentEditable.addEventListener('blur', () => {
                this.updateCharacterCount();
            });
        }

        const editor = document.getElementById('noteContent');

        document.querySelectorAll('[data-move]').forEach(btn => {
            btn.addEventListener('click', () => {
                editor.focus();
                this.moveCursor(btn.dataset.move);
            });
        });

        document.querySelectorAll('[data-clip]').forEach(btn => {
            btn.addEventListener('click', async () => {
                editor.focus();
                const action = btn.dataset.clip;

                if (action === 'import') {
                    this.importTextFile()
                }
                
                if (action === 'copy') {
                    this.copySelection();
                }

                if (action === 'cut') {
                    this.cutSelection();
                }

                if (action === 'paste') {
                    await this.pasteFromClipboard();
                }

                if (action === 'clear') {
                    this.clearEditor();
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('noteViewModal');
            if (modal && modal.style.display === 'flex') {
                if (e.ctrlKey || e.metaKey) {
                    switch(e.key) {
                        case '+':
                        case '=':
                            e.preventDefault();
                            this.zoomIn();
                            break;
                        case '-':
                        case '_':
                            e.preventDefault();
                            this.zoomOut();
                            break;
                        case '0':
                            e.preventDefault();
                            this.resetZoom();
                            break;
                    }
                }
            }
        });

        this.startAutoSave();
        this.restoreDraft();
    }

    async handleNoteSubmit(e) {
        e.preventDefault();
        
        const title = document.getElementById('noteTitle').value;
        const contentElement = document.getElementById('noteContent');
        let content = contentElement.innerHTML;
        
        if (!title.trim()) {
            this.showNotification('Please enter a note title', 'error');
            return;
        }
        
        // Just check if content is empty
        if (!content.trim()) {
            this.showNotification('Please enter note content', 'error');
            return;
        }
        
        const now = new Date().toISOString();
        const noteData = {
            title: title,
            content: content,
            tags: [...this.currentTags],
            lastUpdated: now
        };
        
        if (this.editingNoteId) {
            await this.updateNote(this.editingNoteId, noteData);
            this.clearEditor();
        } else {
            await this.addNote(noteData);
            this.clearEditor();
        }
    }

    editNote(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;

        this.editingNoteId = noteId;

        document.getElementById('noteId').value = note.id;
        document.getElementById('noteTitle').value = note.title;
        
        const contentElement = document.getElementById('noteContent');
        if (note.content && note.content.trim()) {
            contentElement.innerHTML = note.content;
        } else {
            contentElement.innerHTML = '';  // Empty instead of placeholder
        }

        this.currentTags = [...note.tags];
        this.renderTags();

        this.restoreDraft();

        document.getElementById('noteEditorTitle').textContent = 'Edit Note';
        document.getElementById('saveNoteBtn').innerHTML = '<i class="fas fa-save"></i> Update';
        document.getElementById('cancelEditBtn').style.display = 'inline-block';

        this.updateCharacterCount();
        document.getElementById('noteTitle').focus();
    }

    clearEditor() {
        this.clearDraft();
        
        document.getElementById('noteForm').reset();
        
        const contentElement = document.getElementById('noteContent');
        if (contentElement) {
            contentElement.innerHTML = '';  // Just set empty, no placeholder
        }
        
        this.currentTags = [];
        this.renderTags();
        this.editingNoteId = null;
        
        document.getElementById('noteEditorTitle').textContent = 'New Note';
        document.getElementById('saveNoteBtn').innerHTML = '<i class="fas fa-save"></i> Save Note';
        document.getElementById('cancelEditBtn').style.display = 'none';
        
        document.getElementById('noteId').value = '';
        
        this.updateCharacterCount();
        this.updateTitleCounter();
        
        document.getElementById('noteTitle').focus();
    }

    cancelEdit() {
        this.clearEditor();
    }

    updateCharacterCount() {
        const contentElement = document.getElementById('noteContent');
        const charCountElement = document.getElementById('charCountValue');
        const wordCountElement = document.getElementById('wordCountValue');
        const statusElement = document.getElementById('contentStatus');
        const charCountContainer = document.getElementById('noteCharCount');
        const wordCountContainer = document.getElementById('noteWordCount');
        
        if (!contentElement || !charCountElement || !wordCountElement) return;
        
        let text = contentElement.textContent || '';
        
        const charCount = text.trim().length;
        const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
        
        charCountElement.textContent = charCount;
        wordCountElement.textContent = wordCount;
        
        let status = 'Ready';
        let statusClass = '';
        
        if (charCount === 0) {
            status = 'Empty';
        } else if (charCount < 50) {
            status = 'Very Short';
            statusClass = 'warning';
        } else if (charCount < 200) {
            status = 'Short';
        } else if (charCount < 1000) {
            status = 'Good';
        } else if (charCount < 2000) {
            status = 'Long';
        } else {
            status = 'Very Long';
            statusClass = 'warning';
        }
        
        if (charCount > 5000) {
            statusClass = 'danger';
            status = 'Too Long';
        }
        
        statusElement.textContent = status;
        
        charCountContainer.className = 'note-editor-char-count ' + statusClass;
        wordCountContainer.className = 'note-editor-char-count ' + statusClass;
    }

    updateTitleCounter() {
        const titleInput = document.getElementById('noteTitle');
        const counter = document.getElementById('noteTitleCounter');
        
        if (!titleInput || !counter) return;
        
        const length = titleInput.value.length;
        const maxLength = parseInt(titleInput.getAttribute('maxlength')) || 32;
        
        counter.textContent = `${length}/${maxLength}`;
        
        counter.className = 'note-title-counter';
        
        if (length === 0) {
            counter.style.display = 'none';
        } else {
            counter.style.display = 'block';
            
            if (length > maxLength * 0.6) {
                counter.classList.add('warning');
            }
            
            if (length > maxLength * 0.8) {
                counter.classList.add('danger');
            }
        }
    }


    // ========== 7. AUTO-SAVE & DRAFTS ==========
    startAutoSave() {
        this.autoSaveTimer = setInterval(() => {
            this.saveDraft();
        }, 2000);
    }

    saveDraft() {
        const titleEl = document.getElementById('noteTitle');
        const contentEl = document.getElementById('noteContent');

        if (!titleEl || !contentEl) return;

        const title = titleEl.value.trim();
        const content = contentEl.innerHTML.trim();

        if (!title && !content) return;

        const draft = {
            title,
            content,
            tags: this.currentTags,
            time: Date.now()
        };

        const key = this.editingNoteId
            ? `note_draft_edit_${this.editingNoteId}`
            : `note_draft_new`;

        localStorage.setItem(key, JSON.stringify(draft));

        const status = document.getElementById('contentStatus');
        if (status) status.textContent = 'Saved';
    }

    restoreDraft() {
        const titleEl = document.getElementById('noteTitle');
        const contentEl = document.getElementById('noteContent');

        if (!titleEl || !contentEl) return;

        let key = 'note_draft_new';

        if (this.editingNoteId) {
            key = `note_draft_edit_${this.editingNoteId}`;
        }

        const saved = localStorage.getItem(key);
        if (!saved) return;

        const draft = JSON.parse(saved);

        titleEl.value = draft.title || '';
        
        // Restore content without placeholder
        if (draft.content && draft.content.trim()) {
            contentEl.innerHTML = draft.content;
        } else {
            contentEl.innerHTML = '';
        }
        
        this.currentTags = draft.tags || [];
        this.renderTags();

        this.updateCharacterCount();
    }

    clearDraft() {
        localStorage.removeItem('note_draft_new');

        if (this.editingNoteId) {
            localStorage.removeItem(`note_draft_edit_${this.editingNoteId}`);
        }
    }


    // ========== 8. TAG MANAGEMENT ==========
    addTag() {
        const tagInput = document.getElementById('noteTagInput');
        const tagText = tagInput.value.trim();
        
        if (tagText && !this.currentTags.includes(tagText)) {
            if (this.currentTags.length >= 3) {
                this.showNotification('Maximum 3 tags allowed', 'warning');
                tagInput.value = '';
                return;
            }
            
            this.currentTags.push(tagText);
            this.renderTags();
            tagInput.value = '';
        }
    }

    removeTag(tag) {
        this.currentTags = this.currentTags.filter(t => t !== tag);
        this.renderTags();
    }

    renderTags() {
        const tagPreview = document.getElementById('noteTagPreview');
        if (tagPreview) {
            tagPreview.innerHTML = '';
            this.currentTags.forEach(tag => {
                const tagElement = document.createElement('div');
                tagElement.className = 'note-tag-item';
                tagElement.setAttribute('data-full-text', tag);
                tagElement.innerHTML = `
                    ${tag.length > 15 ? tag.substring(0, 12) + '...' : tag}
                    <span class="note-tag-remove" onclick="notesModule.removeTag('${tag}')">&times;</span>
                `;
                tagPreview.appendChild(tagElement);
            });
        }
    }


    // ========== 9. NOTE VIEW MODAL ==========
    openNoteViewModal(noteId) {
        // Keep existing implementation
        this.currentViewNoteId = noteId;
        this.currentZoom = 1;
        
        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;

        const modal = document.getElementById('noteViewModal');
        const title = document.getElementById('noteViewTitle');
        const updated = document.getElementById('noteViewUpdated');
        const content = document.getElementById('noteViewContent');
        const counter = document.getElementById('noteViewCounter');

        title.textContent = note.title;
        
        const updatedDate = new Date(note.lastUpdated);
        const createdDate = new Date(note.createdDate);
        updated.textContent = `Updated ${this.formatTimeAgo(updatedDate)} | Created ${createdDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        })}`;
        
        content.innerHTML = note.content;
        
        this.applyZoom(content);

        const currentIndex = this.notes.findIndex(n => n.id === noteId);
        counter.textContent = `${currentIndex + 1} of ${this.notes.length}`;

        document.getElementById('prevNoteBtn').disabled = currentIndex === 0;
        document.getElementById('nextNoteBtn').disabled = currentIndex === this.notes.length - 1;

        this.updateMoreDropdown(note);
        this.updateZoomControls();

        modal.style.display = 'flex';
        this.closeMoreDropdown();
    }

    closeNoteViewModal() {
        const modal = document.getElementById('noteViewModal');
        modal.style.display = 'none';
        this.currentViewNoteId = null;
        this.closeMoreDropdown();
    }

    navigateNote(direction) {
        if (!this.currentViewNoteId) return;

        const currentIndex = this.notes.findIndex(n => n.id === this.currentViewNoteId);
        let newIndex;

        if (direction === 'prev' && currentIndex > 0) {
            newIndex = currentIndex - 1;
        } else if (direction === 'next' && currentIndex < this.notes.length - 1) {
            newIndex = currentIndex + 1;
        } else {
            return;
        }

        this.currentZoom = 1;
        this.openNoteViewModal(this.notes[newIndex].id);
    }

    applyZoom(element) {
        if (!element) return;
        
        const baseFontSize = 1.05;
        const baseLineHeight = 1.7;
        
        const newFontSize = baseFontSize * this.currentZoom;
        const newLineHeight = baseLineHeight * (this.currentZoom > 1 ? 1 : this.currentZoom);
        
        element.style.fontSize = `${newFontSize}rem`;
        element.style.lineHeight = `${newLineHeight}`;
        element.style.padding = this.currentZoom > 1 ? '15px' : '30px';
        
        if (this.currentZoom !== 1) {
            element.classList.add('zoomed');
        } else {
            element.classList.remove('zoomed');
        }
        
        const zoomDisplay = document.getElementById('zoomLevelDisplay');
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.currentZoom * 100)}%`;
        }
        
        this.updateZoomControls();
    }

    zoomIn() {
        if (this.currentZoom < 2) {
            this.currentZoom += 0.1;
            this.currentZoom = Math.round(this.currentZoom * 10) / 10;
            this.applyZoom(document.getElementById('noteViewContent'));
            this.showZoomNotification(`Zoom: ${Math.round(this.currentZoom * 100)}%`);
        }
    }

    zoomOut() {
        if (this.currentZoom > 0.5) {
            this.currentZoom -= 0.1;
            this.currentZoom = Math.round(this.currentZoom * 10) / 10;
            this.applyZoom(document.getElementById('noteViewContent'));
            this.showZoomNotification(`Zoom: ${Math.round(this.currentZoom * 100)}%`);
        }
    }

    resetZoom() {
        this.currentZoom = 1;
        this.applyZoom(document.getElementById('noteViewContent'));
        this.showZoomNotification('Zoom reset to 100%');
    }

    updateZoomControls() {
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetZoomBtn = document.getElementById('resetZoomBtn');
        
        if (zoomInBtn) {
            zoomInBtn.disabled = this.currentZoom >= 2;
            zoomInBtn.title = `Zoom In (${Math.round(this.currentZoom * 100)}% → ${Math.round((this.currentZoom + 0.1) * 100)}%)`;
        }
        if (zoomOutBtn) {
            zoomOutBtn.disabled = this.currentZoom <= 0.5;
            zoomOutBtn.title = `Zoom Out (${Math.round(this.currentZoom * 100)}% → ${Math.round((this.currentZoom - 0.1) * 100)}%)`;
        }
        if (resetZoomBtn) {
            resetZoomBtn.disabled = this.currentZoom === 1;
            resetZoomBtn.title = 'Reset Zoom to 100%';
        }
    }

    showZoomNotification(message) {
        let notification = document.getElementById('zoomNotification');
        
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'zoomNotification';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 0.9rem;
                z-index: 10010;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.1);
            `;
            document.body.appendChild(notification);
        }
        
        notification.innerHTML = `<i class="fas fa-search"></i> ${message}`;
        
        clearTimeout(this.zoomNotificationTimer);
        this.zoomNotificationTimer = setTimeout(() => {
            if (notification && notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 1500);
    }


    // ========== 10. MORE DROPDOWN ==========
    updateMoreDropdown(note) {
        const dropdownContainer = document.querySelector('.note-view-more-dropdown');
        const dropdownMenu = document.querySelector('.note-more-dropdown-menu');
        const moreBtn = document.querySelector('.note-more-btn');
        
        if (!dropdownContainer || !dropdownMenu || !moreBtn) {
            console.error('Dropdown elements not found');
            return;
        }
        
        dropdownMenu.innerHTML = `
            <div class="note-more-dropdown-item" onclick="notesModule.copyNoteContent()">
                <i class="fas fa-copy"></i>
                <span>Copy Note</span>
            </div>
            ${this.currentViewNoteId ? 
                (this.notes.find(n => n.id === this.currentViewNoteId)?.isArchived ?
                    `<div class="note-more-dropdown-item" onclick="notesModule.restoreCurrentNote()">
                        <i class="fas fa-undo"></i>
                        <span>Restore Note</span>
                    </div>` :
                    `<div class="note-more-dropdown-item" onclick="notesModule.archiveCurrentNote()">
                        <i class="fas fa-archive"></i>
                        <span>Archive Note</span>
                    </div>`
                ) : ''
            }
            <div class="note-more-dropdown-item" onclick="notesModule.exportNote()">
                <i class="fas fa-download"></i>
                <span>Export as Text</span>
            </div>
            <div class="note-more-dropdown-item delete" onclick="notesModule.deleteCurrentNote()">
                <i class="fas fa-trash"></i>
                <span>Delete Note</span>
            </div>
        `;

        const newMoreBtn = moreBtn.cloneNode(true);
        moreBtn.parentNode.replaceChild(newMoreBtn, moreBtn);
        
        newMoreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMoreDropdown();
        });
    }

    toggleMoreDropdown() {
        const dropdownMenu = document.querySelector('.note-more-dropdown-menu');
        if (dropdownMenu) {
            dropdownMenu.classList.toggle('show');
            
            if (dropdownMenu.classList.contains('show')) {
                setTimeout(() => {
                    document.addEventListener('click', this.closeDropdownOnClickOutside.bind(this));
                }, 0);
            } else {
                document.removeEventListener('click', this.closeDropdownOnClickOutside.bind(this));
            }
        }
    }

    closeMoreDropdown() {
        const dropdownMenu = document.querySelector('.note-more-dropdown-menu');
        if (dropdownMenu) {
            dropdownMenu.classList.remove('show');
            document.removeEventListener('click', this.closeDropdownOnClickOutside.bind(this));
        }
    }

    closeDropdownOnClickOutside(e) {
        const dropdownContainer = document.querySelector('.note-view-more-dropdown');
        const dropdownMenu = document.querySelector('.note-more-dropdown-menu');
        
        if (dropdownContainer && dropdownMenu && 
            !dropdownContainer.contains(e.target) && 
            dropdownMenu.classList.contains('show')) {
            this.closeMoreDropdown();
        }
    }

    copyNoteContent() {
        if (!this.currentViewNoteId) return;

        const note = this.notes.find(n => n.id === this.currentViewNoteId);
        if (!note) return;

        const tempElement = document.createElement('div');
        tempElement.innerHTML = note.content;
        const plainText = tempElement.textContent || tempElement.innerText || '';

        navigator.clipboard.writeText(`${note.title}\n\n${plainText}`).catch(err => {
            console.error('Failed to copy note: ', err);
            this.showNotification('Failed to copy note to clipboard', 'error');
        });
    }

    exportNote() {
        if (!this.currentViewNoteId) return;
        
        const note = this.notes.find(n => n.id === this.currentViewNoteId);
        if (!note) return;
        
        const tempElement = document.createElement('div');
        tempElement.innerHTML = note.content;
        const plainText = tempElement.textContent || tempElement.innerText || '';
        
        const exportText = `=== ${note.title} ===\n\n` +
                        `Updated: ${note.lastUpdated}\n` +
                        `Tags: ${note.tags.join(', ')}\n` +
                        `Pinned: ${note.isPinned ? 'Yes' : 'No'}\n\n` +
                        `${plainText}\n\n` +
                        `--- End of Note ---`;
        
        const blob = new Blob([exportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${note.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.closeMoreDropdown();
    }

    archiveCurrentNote() {
        if (!this.currentViewNoteId) return;
        this.archiveNote(this.currentViewNoteId);
        this.closeNoteViewModal();
        this.closeMoreDropdown();
    }

    restoreCurrentNote() {
        if (!this.currentViewNoteId) return;
        this.restoreNote(this.currentViewNoteId);
        this.closeNoteViewModal();
        this.closeMoreDropdown();
    }

    deleteCurrentNote() {
        if (this.currentViewNoteId) {
            this.deleteNote(this.currentViewNoteId);
            this.closeMoreDropdown();
        }
    }

    
    // ========== 11. SEARCH & FILTER ==========
    handleSearch(searchTerm) {
        const notesGrid = document.getElementById('notesGrid');
        const term = searchTerm.toLowerCase().trim();
        
        if (!notesGrid) return;
        
        const noteCards = notesGrid.querySelectorAll('.note-card');
        let visibleCount = 0;
        
        noteCards.forEach(card => {
            const title = card.querySelector('.note-title').textContent.toLowerCase();
            const tags = card.querySelectorAll('.note-tag-pill');
            const tagTexts = Array.from(tags).map(tag => tag.textContent.toLowerCase());
            
            const matches = title.includes(term) || 
                        tagTexts.some(tag => tag.includes(term));
            
            if (term === '' || matches) {
                card.style.display = 'flex';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });
        
        if (term && visibleCount === 0) {
            this.showSearchEmptyState(term);
        } else {
            const existingEmptyState = notesGrid.querySelector('.search-empty-state');
            if (existingEmptyState) {
                existingEmptyState.remove();
            }
        }
        
        this.updateSearchResultsCount(term, visibleCount, noteCards.length);
    }

    showSearchEmptyState(searchTerm) {
        const notesGrid = document.getElementById('notesGrid');
        if (!notesGrid) return;
        
        const existingEmptyState = notesGrid.querySelector('.search-empty-state');
        if (existingEmptyState) {
            existingEmptyState.remove();
        }
        
        const emptyState = document.createElement('div');
        emptyState.className = 'search-empty-state';
        emptyState.innerHTML = `
            <i class="fas fa-search"></i>
            <h3>No notes found</h3>
            <p>No notes match "<strong>${searchTerm}</strong>"</p>
            <p class="search-suggestions">Try searching by title, tag, or different keywords</p>
        `;
        
        notesGrid.appendChild(emptyState);
    }

    updateSearchResultsCount(searchTerm, visibleCount, totalCount) {
        const searchInput = document.getElementById('noteSearch');
        const searchContainer = searchInput?.parentElement;
        
        if (!searchContainer) return;
        
        const existingCount = searchContainer.querySelector('.search-results-count');
        if (existingCount) {
            existingCount.remove();
        }
        
        if (searchTerm && searchTerm.length > 0) {
            const countElement = document.createElement('div');
            countElement.className = 'search-results-count';
            countElement.innerHTML = `
                <span>${visibleCount} of ${totalCount} notes</span>
                <button class="btn-clear-search" id="clearSearchBtn" title="Clear search">
                    <i class="fas fa-times"></i>
                </button>
            `;
            
            searchContainer.appendChild(countElement);
            
            document.getElementById('clearSearchBtn')?.addEventListener('click', () => {
                searchInput.value = '';
                this.handleSearch('');
                this.updateSearchResultsCount('', 0, 0);
            });
        }
    }

    updateNotesDisplay() {
        const notesGrid = document.getElementById('notesGrid');
        if (notesGrid) {
            notesGrid.innerHTML = this.renderNotesGrid();
        }
        this.updateActiveFilterCount();
    }

    renderNotesGrid() {
        const notesGrid = document.getElementById('notesGrid');
        if (!notesGrid) return '';
        
        const currentFilter = document.querySelector('.tab.icon.active')?.dataset.filter || 'all';
        
        // Handle empty notes state
        if (this.notes.length === 0) {
            return this.getEmptyStateHTML(currentFilter);
        }
        
        let filteredNotes = [...this.notes];
        
        // Apply filters based on current tab
        switch(currentFilter) {
            case 'pinned':
                filteredNotes = filteredNotes.filter(n => !n.isArchived && n.isPinned);
                break;
            case 'archived':
                filteredNotes = filteredNotes.filter(n => n.isArchived);
                break;
            case 'recent':
                filteredNotes = filteredNotes.filter(n => !n.isArchived && 
                    (n.lastUpdated.includes('Just now') || 
                    n.lastUpdated.includes('day') ||
                    n.lastUpdated.includes('hour')));
                break;
            case 'tags':
                filteredNotes = filteredNotes.filter(n => !n.isArchived && n.tags && n.tags.length > 0);
                break;
            case 'all':
            default:
                filteredNotes = filteredNotes.filter(n => !n.isArchived);
                break;
        }
        
        // Sort: pinned notes first, then by last modified date
        filteredNotes.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            
            // Sort by lastModified (newer first)
            const aTime = a.lastModified || new Date(a.lastUpdated).getTime();
            const bTime = b.lastModified || new Date(b.lastUpdated).getTime();
            return bTime - aTime;
        });
        
        // Check if no notes after filtering
        if (filteredNotes.length === 0) {
            return this.getEmptyStateHTML(currentFilter);
        }
        
        // Generate HTML for each note
        return filteredNotes.map(note => {
            // Format last updated time
            let lastUpdatedText = '';
            if (note.lastUpdated) {
                lastUpdatedText = this.formatTimeAgo(note.lastUpdated);
            } else if (note.lastModified) {
                lastUpdatedText = this.formatTimeAgo(note.lastModified);
            } else {
                lastUpdatedText = 'Just now';
            }
            
            return `
                <div class="note-card ${note.isArchived ? 'archived' : ''}" data-note-id="${note.id}">
                    <div class="note-card-header">
                        <div class="note-card-icon">
                            <i class="fas ${note.isArchived ? 'fa-archive' : 
                                            note.isPinned ? 'fa-thumbtack note-pinned' : 
                                            'fa-file-alt'}"></i>
                        </div>
                        <div class="note-title-wrapper">
                            <div class="note-title" title="${this.escapeHTML(note.title)}">
                                ${this.escapeHTML(note.title.length > 50 ? note.title.substring(0, 47) + '...' : note.title)}
                            </div>
                        </div>
                        <div class="note-card-actions">
                            ${note.isArchived ? 
                                `
                                <div class="note-card-action restore-action" onclick="event.stopPropagation(); notesModule.restoreNote(${note.id})" title="Restore">
                                    <i class="fas fa-undo"></i>
                                </div>
                                <div class="note-card-action delete-action" onclick="event.stopPropagation(); notesModule.deleteNote(${note.id})" title="Delete Permanently">
                                    <i class="fas fa-trash"></i>
                                </div>
                                ` :
                                `
                                <div class="note-card-action pin-action" onclick="event.stopPropagation(); notesModule.togglePin(${note.id})" title="${note.isPinned ? 'Unpin' : 'Pin'}">
                                    ${note.isPinned ? 
                                        '<i class="fas fa-thumbtack note-pinned"></i>' : 
                                        '<i class="fas fa-thumbtack note-unpinned"></i>'
                                    }
                                </div>
                                <div class="note-card-action archive-action" onclick="event.stopPropagation(); notesModule.archiveNote(${note.id})" title="Archive">
                                    <i class="fas fa-archive"></i>
                                </div>
                                <div class="note-card-action edit-action" onclick="event.stopPropagation(); notesModule.editNote(${note.id})" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </div>
                                `
                            }
                        </div>
                    </div>
                    
                    <div class="note-card-footer">
                        <div class="note-footer-left">
                            <div class="note-last-updated">
                                <i class="fas fa-clock"></i> 
                                <span class="update-text">Updated ${lastUpdatedText}</span>
                                ${note.isArchived ? ' <span class="archived-indicator">(Archived)</span>' : ''}
                            </div>
                            ${note.tags && note.tags.length > 0 ? `
                                <div class="note-tags-preview">
                                    ${note.tags.slice(0, 3).map(tag => 
                                        `<span class="note-tag-pill" title="${this.escapeHTML(tag)}">${this.escapeHTML(tag.length > 10 ? tag.substring(0, 8) + '...' : tag)}</span>`
                                    ).join('')}
                                    ${note.tags.length > 3 ? 
                                        `<span class="more-tags" title="${this.escapeHTML(note.tags.slice(3).join(', '))}">+${note.tags.length - 3}</span>` : 
                                        ''
                                    }
                                </div>
                            ` : `
                                <div class="no-tags">No tags</div>
                            `}
                        </div>
                        <div class="note-footer-right">
                            <div class="note-actions-mini">
                                <button class="btn-view-note" onclick="event.stopPropagation(); notesModule.openNoteViewModal(${note.id})" title="View Full Note">
                                    <i class="fas fa-expand"></i> View
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    getEmptyStateHTML(filter) {
        const messages = {
            'all': 'No notes yet. Create your first note!',
            'pinned': 'No pinned notes. Pin important notes to see them here.',
            'archived': 'No archived notes. Archive notes you want to keep but don\'t need in your main view.',
            'recent': 'No recent notes.',
            'tags': 'No notes with tags. Add tags to organize your notes better.'
        };
        
        const message = messages[filter] || 'No notes found.';
        
        return `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <i class="fas ${filter === 'archived' ? 'fa-archive' : 'fa-sticky-note'}"></i>
                </div>
                <h3>${message}</h3>
                ${filter === 'archived' ? 
                    '<p>Archived notes are hidden from your main view but can be restored anytime.</p>' : 
                    '<p>Click the "+" button to create a new note.</p>'
                }
            </div>
        `;
    }

    updateActiveFilterCount() {
        const countElement = document.getElementById('filterCountValue');
        const activeFilterCount = document.getElementById('activeFilterCount');
        if (!countElement || !activeFilterCount) return;
        
        const activeFilter = document.querySelector('.tab.icon.active')?.dataset.filter || 'all';
        
        let count = 0;
        
        switch(activeFilter) {
            case 'all':
                count = this.getActiveNotes().length;
                break;
            case 'pinned':
                count = this.getActiveNotes().filter(n => n.isPinned).length;
                break;
            case 'archived':
                count = this.notes.filter(n => n.isArchived).length;
                break;
            case 'recent':
                count = this.getActiveNotes().filter(n => 
                    n.lastUpdated.includes('Just now') || 
                    n.lastUpdated.includes('day') ||
                    n.lastUpdated.includes('hour')
                ).length;
                break;
            case 'tags':
                count = this.getActiveNotes().filter(n => n.tags && n.tags.length > 0).length;
                break;
            default:
                count = this.getActiveNotes().length;
        }
        
        countElement.textContent = count;
        
        activeFilterCount.classList.add('pulse');
        setTimeout(() => {
            activeFilterCount.classList.remove('pulse');
        }, 300);
    }

    
    // ========== 12. TEXT PROCESSING ==========
    moveCursor(direction) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        try {
            selection.modify(
                'move',
                direction === 'left' || direction === 'up' ? 'backward' : 'forward',
                direction === 'up' || direction === 'down' ? 'line' : 'character'
            );
        } catch (e) {
            console.warn('Cursor movement not supported in this browser');
        }
    }

    copySelection() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString();
        navigator.clipboard?.writeText(text)
            .then(() => this.setEditorStatus('Copied'))
            .catch(() => document.execCommand('copy'));
    }

    cutSelection() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString();

        navigator.clipboard?.writeText(text)
            .then(() => {
                document.execCommand('delete');
                this.setEditorStatus('Cut');
            })
            .catch(() => document.execCommand('cut'));
    }

    async pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            document.execCommand('insertText', false, text);
            this.setEditorStatus('Pasted');
        } catch {
            document.execCommand('paste');
        }
    }

    setEditorStatus(text) {
        const status = document.getElementById('contentStatus');
        if (!status) return;

        status.textContent = text;

        clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
            status.textContent = 'Ready';
        }, 1200);
    }

    importTextFile() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.txt,.md,.text';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (file.size > 2 * 1024 * 1024) {
                this.showNotification('File is too large. Maximum size is 2MB.', 'warning');
                return;
            }
            
            try {
                const content = await this.readFileAsText(file);
                this.processImportedText(file.name, content);
            } catch (error) {
                this.showNotification('Error reading file. Please try again.', 'error');
                console.error('Import error:', error);
            }
            
            document.body.removeChild(fileInput);
        });
        
        document.body.appendChild(fileInput);
        fileInput.click();
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }

    processImportedText(fileName, content) {
        const lines = content.split('\n');
        let title = '';
        
        for (let line of lines) {
            if (line.trim() && line.length < 100 && !line.startsWith('#') && !line.startsWith('//')) {
                title = line.trim();
                break;
            }
        }
        
        if (!title) {
            title = fileName.replace(/\.[^/.]+$/, "");
            title = title.replace(/[_-]/g, ' ');
            title = title.charAt(0).toUpperCase() + title.slice(1);
        }
        
        if (title.length > 50) {
            title = title.substring(0, 47) + '...';
        }
        
        const textContent = this.convertTextToHTML(content);
        
        this.fillEditorWithImportedContent(title, textContent);
    }

    convertTextToHTML(text) {
        const lines = text.split('\n');
        let htmlContent = '';
        let inParagraph = false;
        
        for (let line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine === '') {
                if (inParagraph) {
                    htmlContent += '</p>';
                    inParagraph = false;
                }
                htmlContent += '<br>';
            } else {
                if (trimmedLine.startsWith('# ')) {
                    if (inParagraph) {
                        htmlContent += '</p>';
                        inParagraph = false;
                    }
                    htmlContent += `<h2>${trimmedLine.substring(2)}</h2>`;
                } else if (trimmedLine.startsWith('## ')) {
                    if (inParagraph) {
                        htmlContent += '</p>';
                        inParagraph = false;
                    }
                    htmlContent += `<h3>${trimmedLine.substring(3)}</h3>`;
                } else if (trimmedLine.startsWith('### ')) {
                    if (inParagraph) {
                        htmlContent += '</p>';
                        inParagraph = false;
                    }
                    htmlContent += `<h4>${trimmedLine.substring(4)}</h4>`;
                } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
                    if (!inParagraph) {
                        htmlContent += '<ul>';
                        inParagraph = true;
                    }
                    htmlContent += `<li>${trimmedLine.substring(2)}</li>`;
                } else if (/^\d+\.\s/.test(trimmedLine)) {
                    if (!inParagraph) {
                        htmlContent += '<ol>';
                        inParagraph = true;
                    }
                    const listContent = trimmedLine.replace(/^\d+\.\s/, '');
                    htmlContent += `<li>${listContent}</li>`;
                } else {
                    if (!inParagraph) {
                        htmlContent += '<p>';
                        inParagraph = true;
                    } else {
                        htmlContent += '<br>';
                    }
                    htmlContent += this.escapeHTML(trimmedLine);
                }
            }
        }
        
        if (inParagraph) {
            htmlContent += '</p>';
        }
        
        if (htmlContent.includes('<ul>') && !htmlContent.includes('</ul>')) {
            htmlContent += '</ul>';
        }
        if (htmlContent.includes('<ol>') && !htmlContent.includes('</ol>')) {
            htmlContent += '</ol>';
        }
        
        return htmlContent || this.escapeHTML(text);
    }

    fillEditorWithImportedContent(title, content) {
        this.clearEditor();
        
        const titleInput = document.getElementById('noteTitle');
        if (titleInput) {
            titleInput.value = title;
        }
        
        const contentElement = document.getElementById('noteContent');
        if (contentElement) {
            contentElement.innerHTML = content;
            contentElement.classList.remove('placeholder-text');
        }
        
        this.updateCharacterCount();
        this.showNotification('Text imported successfully! You can now edit and save as a new note.');
        
        setTimeout(() => {
            if (contentElement) {
                contentElement.focus();
                
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(contentElement);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }, 100);
    }

    escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    async importData(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                
                if (!importedData.notes || !Array.isArray(importedData.notes)) {
                    throw new Error('Invalid data format: missing notes array');
                }
                
                const existingNoteIds = new Set(this.notes.map(n => n.id));
                let maxId = Math.max(...this.notes.map(n => n.id), 0);
                
                importedData.notes.forEach(note => {
                    if (!existingNoteIds.has(note.id)) {
                        this.notes.push(note);
                    } else {
                        note.id = ++maxId;
                        this.notes.push(note);
                    }
                });
                
                await this.saveData();
                this.updateNotesDisplay();
                
                this.showNotification(`Successfully imported ${importedData.notes.length} notes`);
            } catch (error) {
                console.error('Error importing data:', error);
                this.showNotification('Error importing data: ' + error.message, 'error');
            }
        };
        reader.readAsText(file);
    }


    // ========== 13. UTILITY METHODS ==========
    formatTimeAgo(timestamp) {
        if (!timestamp) return 'Just now';
        
        const now = new Date();
        const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
        const seconds = Math.floor((now - date) / 1000);
        
        if (seconds < 60) return 'Just now';
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        
        const weeks = Math.floor(days / 7);
        if (weeks < 4) return `${weeks}w ago`;
        
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: days < 365 ? undefined : 'numeric'
        });
    }

    copyToClipboardAndNotify(text, message) {
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification(message);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            this.showNotification('Failed to copy to clipboard', 'error');
        });
    }

// Backward compatibility wrapper
showNotification(message, type = 'success') {
    if (window.toastManager) {
        window.toastManager.show(message, type);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

    // ========== 14. RESET & CLEANUP ==========
    // Reset data for logout
    async resetDataForLogout() {
        try {
            // Clear Firebase listeners
            if (this.firebaseListeners.notes) {
                const homeDb = window.authModule?.getHomeDatabaseInstance();
                if (homeDb && homeDb.db) {
                    const encodedEmail = window.authModule.encodeEmail(window.authModule.currentUser?.email);
                    if (encodedEmail) {
                        const notesRef = homeDb.db.ref(`userData/${encodedEmail}/notesModuleData/notes`);
                        notesRef.off('child_added', this.firebaseListeners.notes.added);
                        notesRef.off('child_changed', this.firebaseListeners.notes.changed);
                        notesRef.off('child_removed', this.firebaseListeners.notes.removed);
                    }
                }
            }

            // Clear IndexedDB
            if (this.db) {
                const transaction = this.db.transaction(['notes', 'syncMetadata'], 'readwrite');
                transaction.objectStore('notes').clear();
                transaction.objectStore('syncMetadata').clear();
            }
            
            // Reset data
            this.notes = [];
            this.currentTags = [];
            this.editingNoteId = null;
            this.currentZoom = 1;
            this.currentViewNoteId = null;
            this.pendingOperations.clear();
            this.firebaseListeners = {};
            
            console.log('Notes module reset for logout');
            
            if (document.getElementById('notesGrid')) {
                this.updateNotesDisplay();
            }
            
            return true;
        } catch (error) {
            console.error('Error resetting notes data for logout:', error);
            return false;
        }
    }

    // Clear local data only
    async clearLocalData() {
        try {
            if (this.db) {
                const transaction = this.db.transaction(['notes', 'syncMetadata'], 'readwrite');
                transaction.objectStore('notes').clear();
                transaction.objectStore('syncMetadata').clear();
            }
            
            this.notes = [];
            this.currentTags = [];
            this.editingNoteId = null;
            this.currentZoom = 1;
            this.currentViewNoteId = null;
            this.pendingOperations.clear();
            this.firebaseListeners = {};
            
            console.log('Notes module local data cleared');
            
            return true;
        } catch (error) {
            console.error('Error clearing notes local data:', error);
            return false;
        }
    }

    
    // ========== 15. UI RENDERING ==========
render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('Notes container not found:', containerId);
        return;
    }

    container.innerHTML = this.getNotesHTML();
    this.attachEventListeners();
    this.initializeEditor();
    
    // Force a refresh of the notes display after a short delay to ensure data is loaded
    setTimeout(() => {
        if (this.notes && this.notes.length > 0) {
            this.updateNotesDisplay();
        } else {
            // Try to load from IndexedDB again if notes are still empty
            this.loadFromIndexedDB().then(() => {
                this.updateNotesDisplay();
            });
        }
    }, 50);
}

getNotesHTML() {
    // Check if notes are loaded
    const hasNotes = this.notes && this.notes.length > 0;
    const notesGridContent = hasNotes ? this.renderNotesGrid() : this.getLoadingStateHTML();
    
    return `
        <div class="notes-container">
            <div class="module-card">
                <div class="module-icon" style="color: var(--primary);">
                    <span class="material-icons">notes</span>
                </div>
                <div class="module-info">
                    <div class="module-title">Notes Manager</div>
                    <div class="module-description">Organize your thoughts and ideas</div>
                </div>
            </div>

            <!-- Note Editor - Always visible at bottom -->
            <div class="note-editor-section">                
                <form id="noteForm" class="note-form-inline">
                    <input type="hidden" id="noteId">
                    <div class="note-editor-container-inline">
                        <div class="note-editor-header">
                            <div class="note-editor-header-left">
                                <i class="fas fa-edit"></i>
                                <span class="note-editor-title" id="noteEditorTitle">Create New Note</span>
                            </div>
                            <div class="note-editor-header-right">
                                <span class="note-editor-badge" id="noteEditorBadge">
                                    <i class="fas fa-pencil-alt"></i> Draft
                                </span>
                            </div>
                        </div>
                        <div class="note-editor-toolbar">
                            <div class="note-toolbar-group">
                                <button type="button" class="note-toolbar-btn" data-clip="import" title="Import Text File">
                                    <i class="fas fa-file-import"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-clip="clear" title="Clear Editor">
                                    <i class="fas fa-broom"></i>
                                </button>
                            </div>                               
                            <div class="note-toolbar-group">
                                <button type="button" class="note-toolbar-btn" data-command="undo" title="Undo (Ctrl+Z)">
                                    <i class="fas fa-undo"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-command="redo" title="Redo (Ctrl+Y)">
                                    <i class="fas fa-redo"></i>
                                </button>
                            </div>
                            <div class="note-toolbar-group">
                                <button type="button" class="note-toolbar-btn" data-clip="copy" title="Copy (Ctrl+C)">
                                    <i class="fas fa-copy"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-clip="cut" title="Cut (Ctrl+X)">
                                    <i class="fas fa-cut"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-clip="paste" title="Paste (Ctrl+V)">
                                    <i class="fas fa-paste"></i>
                                </button>
                            </div>
                            <div class="note-toolbar-group">
                                <button type="button" class="note-toolbar-btn" data-command="bold" title="Bold (Ctrl+B)">
                                    <i class="fas fa-bold"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-command="italic" title="Italic (Ctrl+I)">
                                    <i class="fas fa-italic"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-command="underline" title="Underline (Ctrl+U)">
                                    <i class="fas fa-underline"></i>
                                </button>
                            </div>
                            <div class="note-toolbar-group">
                                <button type="button" class="note-toolbar-btn" data-command="insertUnorderedList" title="Bullet List">
                                    <i class="fas fa-list-ul"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-command="insertOrderedList" title="Numbered List">
                                    <i class="fas fa-list-ol"></i>
                                </button>
                            </div>
                            <div class="note-toolbar-group">
                                <button type="button" class="note-toolbar-btn" data-move="left" title="Move Cursor Left">
                                    <i class="fas fa-arrow-left"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-move="right" title="Move Cursor Right">
                                    <i class="fas fa-arrow-right"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-move="up" title="Move Cursor Up">
                                    <i class="fas fa-arrow-up"></i>
                                </button>
                                <button type="button" class="note-toolbar-btn" data-move="down" title="Move Cursor Down">
                                    <i class="fas fa-arrow-down"></i>
                                </button>
                            </div>
                        </div>

                        <div class="note-title-section">
                            <div class="note-title-wrapper editor-title-wrapper">
                                <div class="note-title-icon-wrapper">
                                    <i class="fas fa-heading"></i>
                                </div>
                                <input 
                                    type="text" 
                                    class="note-title-input" 
                                    id="noteTitle" 
                                    placeholder="Enter note title..." 
                                    maxlength="32"
                                    autocomplete="off"
                                >
                                <div class="note-title-counter" id="noteTitleCounter">0/32</div>
                            </div>
                        </div>

                        <div class="note-content-section">
                            <div class="note-content-header">
                                <div class="note-content-header-left">
                                    <i class="fas fa-paragraph"></i>
                                    <span>Content</span>
                                </div>
                                <div class="note-content-stats">
                                    <span class="stat-item" id="noteCharCount">
                                        <i class="fas fa-font"></i>
                                        <span id="charCountValue">0</span>
                                    </span>
                                    <span class="stat-item" id="noteWordCount">
                                        <i class="fas fa-file-word"></i>
                                        <span id="wordCountValue">0</span>
                                    </span>
                                </div>
                            </div>
                            <div class="note-editor-content-wrapper">
                                <div 
                                    class="note-editor-content-inline" 
                                    id="noteContent" 
                                    contenteditable="true"
                                    placeholder="Start writing your note here..."
                                ></div>
                            </div>
                        </div>

                        <div class="note-tags-section">
                            <div class="note-tags-header">
                                <i class="fas fa-tags"></i>
                                <span>Tags</span>
                                <span class="tags-limit">(max 3)</span>
                            </div>
                            <div class="note-tags-input-container">
                                <div class="note-tag-preview" id="noteTagPreview"></div>
                                <input 
                                    type="text" 
                                    class="note-tag-input" 
                                    id="noteTagInput" 
                                    placeholder="Add tag and press Enter"
                                    maxlength="20"
                                >
                            </div>
                        </div>

                        <div class="note-editor-footer">
                            <div class="note-editor-status">
                                <span id="contentStatus" class="status-badge">
                                    <i class="fas fa-circle"></i> Ready
                                </span>
                                <span class="last-saved" id="lastSavedStatus">
                                </span>
                            </div>
                            <div class="note-editor-actions">
                                <button type="button" class="btn btn-secondary" id="cancelEditBtn" style="display: none;">
                                    <i class="fas fa-times"></i> Cancel
                                </button>
                                <button class="btn btn-primary" id="saveNoteBtn">
                                    <i class="fas fa-save"></i> Save Note
                                </button>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            <div class="notes-actions">
                <div class="notes-search">
                    <span class="material-icons">search</span>
                    <input type="text" placeholder="Search notes..." id="noteSearch">
                </div>
                <div id="filterIcon" class="filter-design">
                    <div class="filter-container icon">
                        <div class="tab icon active" data-filter="all" title="All Notes">
                            <i class="fas fa-th-large"></i>
                        </div>
                        <div class="tab icon" data-filter="recent" title="Recent">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div class="tab icon" data-filter="pinned" title="Pinned">
                            <i class="fas fa-thumbtack"></i>
                        </div>
                        <div class="tab icon" data-filter="archived" title="Archived">
                            <i class="fas fa-archive"></i>
                        </div>
                        <div class="tab icon" data-filter="tags" title="Tagged">
                            <i class="fas fa-tags"></i>
                        </div>
                        <div class="active-filter-count" id="activeFilterCount">
                            <span id="filterCountValue">0</span>
                        </div>
                    </div>
                </div>
            </div>                
            <div class="notes-grid" id="notesGrid">
                ${notesGridContent}
            </div>
        </div>

        <!-- Note View Modal -->
        <div class="note-view-modal" id="noteViewModal">
            <div class="note-view-modal-content">
                <div class="note-view-modal-header">
                    <div class="note-card-action" style="margin-right:8px;">
                        <i class="fas fa-file-alt"></i>
                    </div>
                    <div class="note-view-title-section">
                        <h3 class="note-view-title" id="noteViewTitle"></h3>
                        <div class="note-view-meta">
                            <span class="note-view-updated" id="noteViewUpdated"></span>
                        </div>
                    </div>
                    <div class="note-view-actions">                       
                        <div class="note-view-more-dropdown">
                            <button class="note-more-btn">
                                <i class="fa-solid fa-ellipsis-vertical"></i>
                            </button>
                            <div class="note-more-dropdown-menu">
                                <!-- Dropdown items will be populated dynamically -->
                            </div>
                        </div>
                        <button class="note-view-close-modal">&times;</button>
                    </div>
                </div>
                <div class="note-view-content" id="noteViewContent"></div>
                <div class="note-view-footer">
                    <div class="zoom-controls">
                        <button class="zoom-action-btn" id="zoomOutBtn" title="Zoom Out (Ctrl -)">
                            <i class="fas fa-search-minus"></i>
                        </button>
                        <span class="zoom-level" id="zoomLevelDisplay">100%</span>
                        <button class="zoom-action-btn" id="zoomInBtn" title="Zoom In (Ctrl +)">
                            <i class="fas fa-search-plus"></i>
                        </button>
                        <button class="zoom-action-btn" id="resetZoomBtn" title="Reset Zoom">
                            <i class="fas fa-expand-arrows-alt"></i>
                        </button>
                    </div>
                    <div class="note-view-navigation">
                        <button class="btn btn-icon" id="prevNoteBtn">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <span class="note-view-counter" id="noteViewCounter"></span>
                        <button class="btn btn-icon" id="nextNoteBtn">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Add this new helper method for loading state
getLoadingStateHTML() {
    return `
        <div class="loading-state">
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
            </div>
            <p>Loading your notes...</p>
        </div>
    `;
}

    attachEventListeners() {
        const saveNoteBtn = document.getElementById('saveNoteBtn');
        if (saveNoteBtn) {
            saveNoteBtn.addEventListener('click', (e) => this.handleNoteSubmit(e));
        }

        const cancelEditBtn = document.getElementById('cancelEditBtn');
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => this.cancelEdit());
        }

        const searchInput = document.getElementById('noteSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        document.querySelectorAll('.tab.icon').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab.icon').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.updateNotesDisplay();
                this.updateActiveFilterCount();
            });
        });

        const tagInput = document.getElementById('noteTagInput');
        if (tagInput) {
            tagInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addTag();
                }
            });
        }

        const viewCloseModal = document.querySelector('.note-view-close-modal');
        if (viewCloseModal) {
            viewCloseModal.addEventListener('click', () => this.closeNoteViewModal());
        }

        const prevNoteBtn = document.getElementById('prevNoteBtn');
        if (prevNoteBtn) {
            prevNoteBtn.addEventListener('click', () => this.navigateNote('prev'));
        }

        const nextNoteBtn = document.getElementById('nextNoteBtn');
        if (nextNoteBtn) {
            nextNoteBtn.addEventListener('click', () => this.navigateNote('next'));
        }

        const zoomInBtn = document.getElementById('zoomInBtn');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => this.zoomIn());
        }
        
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => this.zoomOut());
        }
        
        const resetZoomBtn = document.getElementById('resetZoomBtn');
        if (resetZoomBtn) {
            resetZoomBtn.addEventListener('click', () => this.resetZoom());
        }
        
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('deleteConfirmModal');
            if (modal && modal.style.display === 'flex') {
                if (e.key === 'Escape') {
                    modal.style.display = 'none';
                    this.pendingDelete = null;
                } else if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    this.confirmDelete();
                }
            }
        });

        this.initializeMoreDropdown();
        this.attachNoteCardClickListeners();
    }

    initializeMoreDropdown() {
        const moreBtn = document.querySelector('.note-more-btn');
        if (moreBtn) {
            const newMoreBtn = moreBtn.cloneNode(true);
            moreBtn.parentNode.replaceChild(newMoreBtn, moreBtn);
            
            newMoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMoreDropdown();
            });
        }
    }

    attachNoteCardClickListeners() {
        const notesGrid = document.getElementById('notesGrid');
        if (notesGrid) {
            notesGrid.addEventListener('click', (e) => {
                const noteCard = e.target.closest('.note-card');
                if (noteCard) {
                    const noteId = parseInt(noteCard.dataset.noteId);
                    this.openNoteViewModal(noteId);
                }
            });
        }
    }

}

// Initialize notes module globally with Firebase sync listeners
let notesModule;

document.addEventListener('DOMContentLoaded', function() {
    notesModule = new NotesModule();
    window.notesModule = notesModule;
    
    window.addEventListener('authSuccess', async () => {
        if (notesModule) {
            await notesModule.initFirebaseSync();
        }
    });
    
    window.addEventListener('authLogout', function() {
        if (notesModule) {
            notesModule.resetDataForLogout();
        }
    });
});