// ==================== SHARE MODULE - MERGED TEXT & PHOTOS WITH UPLOAD ====================

class ShareModule {
    constructor() {
        this.currentUser = null;
        this.encodedPhone = null;
        this.mainDB = null;
        this.shareDB = null;
        this.shareApp = null;
        this.shareDatabaseUrl = null;
        this.siteUrl = null;
        this.secureLinks = {};
        this.currentSection = 'create';
        
        // Selected photos for sharing (no limit)
        this.selectedPhotoIds = new Set();
        this.availablePhotos = [];

        this.pendingPhotoForShare = null;

        this.editMode = false;
        this.currentEditLinkId = null;
        this.containerRendered = false;

        // Links shared with the current user
        this.sharedWithMeLinks = {};
    }

    // ========== INITIALIZATION ==========
    async initShareModule() {
        try {
            const authModule = window.authModule;
            if (authModule && authModule.isAuthenticated) {
                this.currentUser = authModule.currentUser;
                this.encodedPhone = this.encodePhone(this.currentUser.phone);
                this.mainDB = authModule.masterDB;
                await this.getShareDatabaseUrl();
                await this.getSiteUrl();
                await this.connectToShareDatabase();
            } else {
                this.loadUserDataFromStorage();
                if (window.authModule && window.authModule.masterDB) {
                    this.mainDB = window.authModule.masterDB;
                    await this.getShareDatabaseUrl();
                    await this.getSiteUrl();
                    await this.connectToShareDatabase();
                }
            }

            await this.loadUserLinks();
            await this.loadSharedWithMeLinks();

            setInterval(() => this.deleteExpiredLinks(), 60 * 60 * 1000);

            if (this.currentSection === 'links') {
                this.renderLinksList();
            }
            if (this.currentSection === 'shared-with-me') {
                this.renderSharedWithMeLinks();
            }

            if (this.pendingPhotoForShare) {
                this.applyPhotoToShare(this.pendingPhotoForShare);
                this.pendingPhotoForShare = null;
            }

            return true;
        } catch (error) {
            console.error('Error initializing share module:', error);
            this.showError('Could not initialise sharing features. Please refresh the page.');
            return false;
        }
    }

    // STEP 1: Read share database URL from main database
    async getShareDatabaseUrl() {
        if (!this.mainDB) {
            console.error('Main database not available');
            return null;
        }
        
        try {
            const snapshot = await this.mainDB.ref('shareURL/url').once('value');
            
            if (snapshot.exists()) {
                this.shareDatabaseUrl = snapshot.val();
                console.log('Share database URL found:', this.shareDatabaseUrl);
                localStorage.setItem('shareDatabaseUrl', this.shareDatabaseUrl);
                return this.shareDatabaseUrl;
            } else {
                const backupSnapshot = await this.mainDB.ref('shareURL/value').once('value');
                if (backupSnapshot.exists()) {
                    this.shareDatabaseUrl = backupSnapshot.val();
                    console.log('Share database URL found (backup):', this.shareDatabaseUrl);
                    localStorage.setItem('shareDatabaseUrl', this.shareDatabaseUrl);
                    return this.shareDatabaseUrl;
                }
                
                console.error('No share database URL found in main database');
                return null;
            }
        } catch (error) {
            console.error('Error reading share database URL:', error);
            const cachedUrl = localStorage.getItem('shareDatabaseUrl');
            if (cachedUrl) {
                console.log('Using cached share database URL:', cachedUrl);
                this.shareDatabaseUrl = cachedUrl;
                return cachedUrl;
            }
            return null;
        }
    }

    // STEP 2: Read site URL from master database
    async getSiteUrl() {
        if (!this.mainDB) {
            console.error('Main database not available for site URL');
            return null;
        }
        
        try {
            const snapshot = await this.mainDB.ref('siteURL/url').once('value');
            
            if (snapshot.exists()) {
                this.siteUrl = snapshot.val();
                console.log('Site URL found:', this.siteUrl);
                localStorage.setItem('siteUrl', this.siteUrl);
                return this.siteUrl;
            } else {
                const backupSnapshot = await this.mainDB.ref('siteURL/value').once('value');
                if (backupSnapshot.exists()) {
                    this.siteUrl = backupSnapshot.val();
                    console.log('Site URL found (backup):', this.siteUrl);
                    localStorage.setItem('siteUrl', this.siteUrl);
                    return this.siteUrl;
                }
                
                console.warn('No site URL found in main database, using default');
                this.siteUrl = "https://xdrives.github.io/share/content.html";
                localStorage.setItem('siteUrl', this.siteUrl);
                return this.siteUrl;
            }
        } catch (error) {
            console.error('Error reading site URL:', error);
            const cachedUrl = localStorage.getItem('siteUrl');
            if (cachedUrl) {
                console.log('Using cached site URL:', cachedUrl);
                this.siteUrl = cachedUrl;
                return cachedUrl;
            }
            this.siteUrl = "https://xdrives.github.io/web/content.html";
            return this.siteUrl;
        }
    }

    // Get current site URL (with fallback)
    getSiteUrlSync() {
        if (this.siteUrl) return this.siteUrl;
        const cachedUrl = localStorage.getItem('siteUrl');
        if (cachedUrl) {
            this.siteUrl = cachedUrl;
            return cachedUrl;
        }
        return "https://xdrives.github.io/web/content.html";
    }

    // STEP 3: Connect to share database
    async connectToShareDatabase() {
        if (!this.shareDatabaseUrl) {
            console.error('No share database URL available');
            this.showError('Share database URL not configured. Please contact support.');
            return false;
        }

        try {
            let existingApp = firebase.apps.find(app => {
                return app.options && app.options.databaseURL === this.shareDatabaseUrl;
            });

            if (existingApp) {
                this.shareApp = existingApp;
                this.shareDB = existingApp.database();
                console.log('Using existing share database connection');
            } else {
                const appName = `shareDB_${Date.now()}`;
                this.shareApp = firebase.initializeApp(
                    { databaseURL: this.shareDatabaseUrl },
                    appName
                );
                this.shareDB = this.shareApp.database();
                console.log('Connected to share database:', this.shareDatabaseUrl);
            }

            const connectedRef = this.shareDB.ref('.info/connected');
            const isConnected = await connectedRef.once('value');
            if (isConnected.val() === true) {
                console.log('Share database connection confirmed');
                return true;
            } else {
                console.warn('Share database connection may be unavailable');
                this.showError('Cannot reach share database. Some features may be limited.');
                return false;
            }
        } catch (error) {
            console.error('Error connecting to share database:', error);
            this.showError('Failed to connect to share database. Please check your internet connection.');
            return false;
        }
    }

    loadUserDataFromStorage() {
        try {
            const userDataStr = localStorage.getItem('currentUser');
            if (userDataStr) {
                this.currentUser = JSON.parse(userDataStr);
                if (this.currentUser?.phone) {
                    this.encodedPhone = this.encodePhone(this.currentUser.phone);
                }
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    // ========== ENCODING ==========
encodePhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');   // digits only
    // (optional) keep the existing replacements if you have dots or @ in emails
    return cleaned.replace(/\./g, ',').replace(/@/g, '-at-');
}

    decodePhone(encodedPhone) {
        if (!encodedPhone) return '';
        return encodedPhone.replace(/-at-/g, '@').replace(/,/g, '.');
    }

    // ========== HASHING & ID GENERATION ==========
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    generateId() {
        return 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // ========== DATABASE OPERATIONS ==========
    
    async loadUserLinks() {
        if (!this.encodedPhone || !this.shareDB) {
            console.warn('Cannot load links: No share database connection');
            return;
        }

        try {
            const userLinksSnapshot = await this.shareDB.ref(`userLinks/${this.encodedPhone}`).once('value');
            const userLinkIds = userLinksSnapshot.val() || {};

            this.secureLinks = {};
            for (const linkId of Object.keys(userLinkIds)) {
                const linkSnapshot = await this.shareDB.ref(`shareLinks/${linkId}`).once('value');
                const linkData = linkSnapshot.val();
                if (linkData) {
                    this.secureLinks[linkId] = linkData;
                }
            }

            console.log(`Loaded ${Object.keys(this.secureLinks).length} links from share database`);
            await this.deleteExpiredLinks();

            if (this.currentSection === 'links') {
                this.renderLinksList();
            }
        } catch (error) {
            console.error('Error loading user links from share database:', error);
            this.secureLinks = {};
            this.showError('Failed to load shared links. Please check your connection.');
        }
    }

    async loadSharedWithMeLinks() {
        if (!this.encodedPhone || !this.shareDB) {
            console.warn('Cannot load shared-with-me links: No share database connection');
            return;
        }

        try {
            const sharedRef = this.shareDB.ref(`sharedWithMe/${this.encodedPhone}`);
            const snapshot = await sharedRef.once('value');
            const sharedLinkIds = snapshot.val() || {};

            this.sharedWithMeLinks = {};
            for (const linkId of Object.keys(sharedLinkIds)) {
                const linkSnapshot = await this.shareDB.ref(`shareLinks/${linkId}`).once('value');
                const linkData = linkSnapshot.val();
                if (linkData) {
                    this.sharedWithMeLinks[linkId] = linkData;
                } else {
                    await sharedRef.child(linkId).remove();
                }
            }

            console.log(`Loaded ${Object.keys(this.sharedWithMeLinks).length} shared-with-me links`);

            if (this.currentSection === 'shared-with-me') {
                this.renderSharedWithMeLinks();
            }
        } catch (error) {
            console.error('Error loading shared-with-me links:', error);
            this.sharedWithMeLinks = {};
        }
    }

    async saveUserLinks() {
        if (!this.encodedPhone || !this.shareDB) {
            console.error('Cannot save: No share database connection');
            return false;
        }
        
        try {
            for (const [linkId, linkData] of Object.entries(this.secureLinks)) {
                await this.shareDB.ref(`shareLinks/${linkId}`).set(linkData);
                await this.shareDB.ref(`userLinks/${this.encodedPhone}/${linkId}`).set(true);
            }
            
            console.log(`Saved ${Object.keys(this.secureLinks).length} links to share database`);
            return true;
        } catch (error) {
            console.error('Error saving to share database:', error);
            return false;
        }
    }

    async updateSharedWithMeIndex(linkId, oldAllowedPhones = [], newAllowedPhones = []) {
        if (!this.shareDB) return;

        const oldSet = new Set(oldAllowedPhones);
        const newSet = new Set(newAllowedPhones);

        const toAdd = newAllowedPhones.filter(phone => !oldSet.has(phone) && phone !== this.currentUser.phone);
        const toRemove = oldAllowedPhones.filter(phone => !newSet.has(phone) && phone !== this.currentUser.phone);

        for (const phone of toAdd) {
            const encoded = this.encodePhone(phone);
            await this.shareDB.ref(`sharedWithMe/${encoded}/${linkId}`).set(true);
        }

        for (const phone of toRemove) {
            const encoded = this.encodePhone(phone);
            await this.shareDB.ref(`sharedWithMe/${encoded}/${linkId}`).remove();
        }
    }

    async deleteLink(linkId) {
        if (!this.shareDB || !this.encodedPhone) return false;
        
        try {
            const linkData = this.secureLinks[linkId] || this.sharedWithMeLinks[linkId];
            if (linkData && linkData.allowedPhones && linkData.allowedPhones.length) {
                for (const phone of linkData.allowedPhones) {
                    const encoded = this.encodePhone(phone);
                    await this.shareDB.ref(`sharedWithMe/${encoded}/${linkId}`).remove();
                }
            }

            await this.shareDB.ref(`shareLinks/${linkId}`).remove();
            await this.shareDB.ref(`userLinks/${this.encodedPhone}/${linkId}`).remove();
            
            delete this.secureLinks[linkId];
            delete this.sharedWithMeLinks[linkId];
            
            console.log(`Link ${linkId} deleted from share database`);
            return true;
        } catch (error) {
            console.error('Error deleting from share database:', error);
            return false;
        }
    }

    async updateLinkStatus(linkId, newStatus) {
        if (!this.shareDB || !this.encodedPhone) return false;
        
        try {
            const linkData = this.secureLinks[linkId];
            if (!linkData) {
                console.error('Link not found:', linkId);
                return false;
            }
            
            linkData.status = newStatus;
            this.secureLinks[linkId] = linkData;
            
            await this.shareDB.ref(`shareLinks/${linkId}`).update({ status: newStatus });
            
            console.log(`Link ${linkId} status updated to ${newStatus} in share database`);
            return true;
        } catch (error) {
            console.error('Error updating link status:', error);
            return false;
        }
    }

    async toggleLinkStatus(linkId) {
        const link = this.secureLinks[linkId];
        if (!link) return false;
        
        const newStatus = link.status === 'active' ? 'pending' : 'active';
        const success = await this.updateLinkStatus(linkId, newStatus);
        
        if (success) {
            const statusText = newStatus === 'active' ? 'activated' : 'paused';
            this.showSuccess(`Link ${statusText} successfully!`);
        }
        
        return success;
    }

    async deleteExpiredLinks() {
        if (!this.shareDB || !this.encodedPhone) return;
        
        const now = new Date();
        let deletedCount = 0;
        
        for (const [linkId, linkData] of Object.entries(this.secureLinks)) {
            if (linkData.expiration && new Date(linkData.expiration) < now) {
                console.log(`Deleting expired link: ${linkData.title} (${linkId})`);
                
                if (linkData.allowedPhones) {
                    for (const phone of linkData.allowedPhones) {
                        const encoded = this.encodePhone(phone);
                        await this.shareDB.ref(`sharedWithMe/${encoded}/${linkId}`).remove();
                    }
                }

                await this.shareDB.ref(`shareLinks/${linkId}`).remove();
                await this.shareDB.ref(`userLinks/${this.encodedPhone}/${linkId}`).remove();
                
                delete this.secureLinks[linkId];
                deletedCount++;
            }
        }

        for (const [linkId, linkData] of Object.entries(this.sharedWithMeLinks)) {
            if (linkData.expiration && new Date(linkData.expiration) < now) {
                await this.shareDB.ref(`sharedWithMe/${this.encodedPhone}/${linkId}`).remove();
                delete this.sharedWithMeLinks[linkId];
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`Deleted ${deletedCount} expired links from share database`);
            this.renderLinksList();
            this.renderSharedWithMeLinks();
        }
        
        return deletedCount;
    }

    // ========== UNIFIED CREATE LINK ==========
    async createShareLink(title, textContent, photoIds, protectionType, password, expiration, viewOnce = false, viewOnceSeconds = 10, status = 'active', watermarkText = null, allowedPhones = []) {
        const linkId = this.generateId();
        const now = new Date().toISOString();
        const photos = [];
        for (const photoId of photoIds) {
            const photo = this.availablePhotos.find(p => p.id === photoId);
            if (photo) {
                photos.push({
                    id: photo.id,
                    name: photo.name,
                    url: photo.url,
                    size: photo.size,
                    date: photo.date,
                    description: photo.description || ''
                });
            }
        }
        let passwordHash = null, hasPassword = false;
        if (protectionType === 'password' && password) {
            passwordHash = await this.hashPassword(password);
            hasPassword = true;
        }
        const linkData = {
            id: linkId, title: title, type: 'mixed',
            textContent: textContent || '', photos: photos, photoCount: photos.length,
            passwordHash: passwordHash, hasPassword: hasPassword,
            createdAt: now, expiration: expiration || null, views: 0,
            ownerPhone: this.currentUser.phone,
            ownerId: this.encodedPhone,
            viewOnce: viewOnce, viewOnceSeconds: viewOnce ? viewOnceSeconds : null,
            isDestroyed: false, status: status, watermarkText: watermarkText,
            allowedPhones: allowedPhones,
        };
        this.secureLinks[linkId] = linkData;
        await this.saveUserLinks();

        if (allowedPhones && allowedPhones.length) {
            for (const phone of allowedPhones) {
                if (phone !== this.currentUser.phone) {
                    const encoded = this.encodePhone(phone);
                    await this.shareDB.ref(`sharedWithMe/${encoded}/${linkId}`).set(true);
                }
            }
        }

        const secureUrl = `${this.getSiteUrlSync()}?id=${linkId}`;
        return { linkId, secureUrl, linkData };
    }

    // ========== STATISTICS ==========
    getStats() {
        const links = Object.values(this.secureLinks);
        const totalLinks = links.length;
        const totalViews = links.reduce((sum, link) => sum + (link.views || 0), 0);
        const totalPhotosShared = links
            .filter(link => link.type === 'photos')
            .reduce((sum, link) => sum + (link.photoCount || 0), 0);
        
        const now = new Date();
        const activeLinks = links.filter(link => {
            if (link.isDestroyed) return false;
            if (!link.expiration) return true;
            return new Date(link.expiration) > now;
        }).length;
        
        const expiredLinks = links.filter(link => {
            if (link.isDestroyed) return false;
            if (!link.expiration) return false;
            return new Date(link.expiration) <= now;
        }).length;
        
        const destroyedLinks = links.filter(link => link.isDestroyed).length;
        const viewOnceLinks = links.filter(link => link.viewOnce).length;
        const passwordProtected = links.filter(link => link.hasPassword).length;
        const openLinks = links.filter(link => !link.hasPassword).length;
        const textLinks = links.filter(link => link.type === 'text').length;
        const photoLinks = links.filter(link => link.type === 'photos').length;
        
        let mostViewedLink = null;
        let maxViews = 0;
        for (const link of links) {
            if ((link.views || 0) > maxViews) {
                maxViews = link.views || 0;
                mostViewedLink = link;
            }
        }
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentLinks = links.filter(link => new Date(link.createdAt) > sevenDaysAgo);
        
        return { 
            totalLinks, totalViews, totalPhotosShared, activeLinks, expiredLinks, 
            destroyedLinks, viewOnceLinks, passwordProtected, openLinks, textLinks, photoLinks,
            mostViewedLink, maxViews, recentLinksCount: recentLinks.length
        };
    }

    isLinkAccessible(linkData) {
        if (!linkData) return false;
        if (linkData.status === 'pending') return false;
        if (linkData.isDestroyed) return false;
        if (linkData.expiration && new Date(linkData.expiration) < new Date()) return false;
        return true;
    }

    // ========== PHOTO SELECTION ==========
    togglePhotoSelection(photoId) {
        if (this.selectedPhotoIds.has(photoId)) this.selectedPhotoIds.delete(photoId);
        else this.selectedPhotoIds.add(photoId);
        this.updatePhotoUI();
    }

    updatePhotoUI() {
        const selectedCountEl = document.getElementById('selectedPhotoCount');
        if (selectedCountEl) selectedCountEl.textContent = `${this.selectedPhotoIds.size} photo(s) selected`;
        
        this.renderPhotoSelectionGrid();
        
        const emptyActionDiv = document.getElementById('emptyPhotosAction');
        if (emptyActionDiv) emptyActionDiv.style.display = 'block';
        
        const createBtn = document.getElementById('createLinkSubmitBtn');
        if (createBtn) createBtn.disabled = false;
    }

    // ========== UI METHODS ==========
    async render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!this.containerRendered) {
            container.innerHTML = this.getShareHTML();
            this.setupEventListeners();
            this.showSection(this.currentSection);
            await this.initShareModule();
            this.containerRendered = true;
        } else {
            this.renderLinksList();
            this.renderSharedWithMeLinks();
            this.updatePhotoUI();
            if (this.pendingPhotoForShare) {
                this.applyPhotoToShare(this.pendingPhotoForShare);
                this.pendingPhotoForShare = null;
            }
        }
    }

    getShareHTML() {
        const stats = this.getStats();
        return `
            <div class="share-container">
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <i class="fas fa-share-alt"></i>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Secure Share</div>
                        <div class="module-description">Share text and photos together with password protection</div>
                    </div>
                </div>

                <div class="share-grid">
                    <div class="share-sidebar">
                        <div class="share-nav-item active" data-section="create">
                            <i class="fas fa-plus-circle"></i><span>Create</span>
                        </div>
                        <div class="share-nav-item" data-section="links">
                            <i class="fas fa-link"></i><span>My Links</span>
                        </div>
                        <div class="share-nav-item" data-section="shared-with-me">
                            <i class="fas fa-users"></i><span>Share With Me</span>
                        </div>
                        <div class="share-nav-item" data-section="about">
                            <i class="fas fa-info-circle"></i><span>About</span>
                        </div>
                    </div>

                    <div class="share-content">
                        <div id="shareSuccess" class="share-message success" style="display: none;">
                            <i class="fas fa-check-circle"></i><span id="successMessage"></span>
                        </div>
                        <div id="shareError" class="share-message error" style="display: none;">
                            <i class="fas fa-exclamation-circle"></i><span id="errorMessage"></span>
                        </div>
                        
                        <!-- CREATE SECTION -->
                        <div class="share-section" id="create-section">
                            <div class="share-card">
                                <form id="createLinkForm">
                                    <div class="section-card">
                                        <div class="section-card-header">
                                            <div class="section-card-title">
                                                <i class="fas fa-plus-circle"></i>
                                                <span>Create Share Link</span>
                                            </div>
                                            <span class="section-card-badge">
                                                Share text and photos together with password protection
                                            </span>
                                        </div>
                                    </div>
                                    <div class="section-card">
                                        <div class="section-card-header">
                                            <div class="section-card-title">
                                                <i class="fas fa-file-alt"></i>
                                                <span>Content</span>
                                            </div>
                                            <span class="section-card-badge">
                                                <i class="fas fa-pen"></i>
                                                Title &amp; Text
                                            </span>
                                        </div>
                                        <div class="section-card-content">
                                            <div class="form-group">
                                                <label class="form-label">Link Title *</label>
                                                <input type="text" id="linkTitle" class="form-input" 
                                                    placeholder="e.g., Vacation Memories, Secret Notes" 
                                                    required maxlength="24">
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">Text Content (optional)</label>
                                                <textarea id="linkContent" class="form-textarea" rows="4" 
                                                        placeholder="Write anything you want to share..."></textarea>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Photos Section -->
                                    <div class="section-card">
                                        <div class="section-card-header">
                                            <div class="section-card-title">
                                                <i class="fas fa-images"></i>
                                                <span>Photos to Share</span>
                                            </div>
                                            <span class="section-card-badge">
                                                <span id="selectedPhotoCount" class="badge-count">0</span>
                                            </span>
                                        </div>
                                        <div class="section-card-content">
                                            <div id="photoSelectionGrid" class="photo-selection-grid"></div>
                                            <div id="emptyPhotosAction" style="padding: 0 14px 14px 14px; margin-top: 12px;">
                                                <button type="button" id="browsePhotosBtn" class="btn btn-primary">
                                                    <i class="fas fa-images"></i> Open Photo Library
                                                </button>
                                                <div class="form-help">Select photos from your library – they will appear above.</div>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Security & Privacy Section -->
                                    <div class="section-card">
                                        <div class="section-card-header">
                                            <div class="section-card-title">
                                                <i class="fas fa-shield-alt"></i>
                                                <span>Security &amp; Privacy</span>
                                            </div>
                                            <span class="section-card-badge">
                                                <i class="fas fa-lock"></i>
                                                End-to-End Encrypted
                                            </span>
                                        </div>     
                                        <!-- Password Protection -->
                                        <div class="section-option">
                                            <div class="section-option-info">
                                                <div class="section-option-icon">
                                                    <i class="fas fa-lock"></i>
                                                </div>
                                                <div>
                                                    <div class="section-option-label">Password Protection</div>
                                                    <div class="section-option-desc">Require a password to view this content</div>
                                                </div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="passwordProtectionToggle">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="section-option-container" id="passwordFieldGroup" style="display: none;">
                                            <div class="password-input-group">
                                                <input type="password" class="form-input" id="linkPassword"
                                                    placeholder="Min. 4 characters" minlength="4">
                                                <button type="button" class="toggle-password-btn" data-target="linkPassword">
                                                    <i class="fas fa-eye"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <!-- View Once -->
                                        <div class="section-divider"></div>
                                        <div class="section-option">
                                            <div class="section-option-info">
                                                <div class="section-option-icon">
                                                    <i class="fas fa-eye-slash"></i>
                                                </div>
                                                <div>
                                                    <div class="section-option-label">View Once</div>
                                                    <div class="section-option-desc">Content self-destructs after being viewed</div>
                                                </div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="viewOnceToggle">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="section-option-container" id="viewOnceSecondsContainer" style="display: none;">
                                            <div class="view-once-slider-row">
                                                <span class="view-once-slider-label">View duration:</span>
                                                <span class="view-once-slider-value" id="secondsValueDisplay">3</span>
                                                <span class="view-once-slider-unit">seconds</span>
                                            </div>
                                            <input type="range" id="viewOnceSecondsSlider" min="1" max="10" step="1" value="3"
                                                class="form-range">
                                        </div>
                                        <!-- Watermark -->
                                        <div class="section-divider"></div>
                                        <div class="section-option">
                                            <div class="section-option-info">
                                                <div class="section-option-icon">
                                                    <i class="fas fa-copyright"></i>
                                                </div>
                                                <div>
                                                    <div class="section-option-label">Watermark Photos</div>
                                                    <div class="section-option-desc">Overlay custom text on all shared images</div>
                                                </div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="watermarkToggle">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="section-option-container" id="watermarkTextContainer" style="display: none;">
                                            <input type="text" id="watermarkText" class="form-input"
                                                placeholder="e.g., Confidential, © 2026, Private"
                                                value="Confidential" maxlength="30">
                                            <div class="form-help" style="margin-top: 4px;">Max 30 characters</div>
                                        </div>
                                        <!-- Share With Specific Users -->
                                        <div class="section-divider"></div>
                                        <div class="section-option">
                                            <div class="section-option-info">
                                                <div class="section-option-icon">
                                                    <i class="fas fa-user-plus"></i>
                                                </div>
                                                <div>
                                                    <div class="section-option-label">Share With Specific Users</div>
                                                    <div class="section-option-desc">Only these phone numbers can view the content</div>
                                                </div>
                                            </div>
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="shareWithToggle">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </div>
                                        <div class="section-option-container" id="shareWithContainer" style="display: none;">
                                            <input type="text" id="shareWithInput" class="form-input"
                                                placeholder="Enter phone numbers, comma separated"
                                                value="">
                                            <div id="shareWithStatus" class="phone-validator-status"></div>
                                            <div class="form-help" style="margin-top: 4px;">
                                                Separate multiple phone numbers with commas. Users must be signed in to xDrive.
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Expiration Section -->
                                    <div class="section-card">
                                        <div class="section-card-header">
                                            <div class="section-card-title">
                                                <i class="fas fa-calendar-alt"></i>
                                                <span>Expiration</span>
                                            </div>
                                            <span class="section-card-badge">
                                                <i class="fas fa-clock"></i>
                                                Max 7 days
                                            </span>
                                        </div>
                                        <div class="expiration-input-row">
                                            <div class="expiration-input-wrapper">
                                                <input type="datetime-local" id="expirationDate" class="form-input expiration-input">
                                                <span class="expiration-input-icon">
                                                    <i class="fas fa-calendar-day"></i>
                                                </span>
                                            </div>
                                            <div class="form-help">
                                                Leave empty for no expiration &nbsp;·&nbsp; max 7 days from now
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Form Actions -->
                                    <div class="form-actions">
                                        <button type="submit" class="btn btn-primary" id="createLinkSubmitBtn">
                                            <i class="fas fa-link"></i> Create Share Link
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="clearFormBtn">
                                            <i class="fas fa-times"></i> Clear
                                        </button>
                                    </div>
                                </form>
                            </div>
                            <!-- Result Section -->
                            <div id="linkResultSection" class="link-result-section" style="display: none;">
                                <div class="result-header">
                                    <i class="fas fa-link"></i>
                                    <h3>Share Link Created</h3>
                                    <button class="close-result-btn" id="closeResultBtn">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                                <div class="result-body">
                                    <p>Share this link with others:</p>
                                    <div class="link-url-display" id="resultLinkUrl"></div>
                                    <div id="resultWarning" class="warning-text" style="display: none;">
                                        <strong>Important:</strong> Share the password separately from the link.
                                    </div>
                                    <div id="resultViewOnceWarning" class="warning-text" style="display: none;">
                                        <strong>View Once Mode Active:</strong> Content will self‑destruct after
                                        <span id="resultSecondsValue">3</span> seconds!
                                    </div>
                                    <div id="resultPhotoInfo" class="result-photo-info" style="display: none;"></div>
                                    <div class="info-text">The link contains only a unique ID – no personal information is exposed.</div>
                                </div>
                                <div class="result-actions">
                                    <button class="btn btn-success" id="copyResultLinkBtn"><i class="fas fa-copy"></i> Copy Link</button>
                                    <button class="btn btn-success" id="shareResultLinkBtn"><i class="fas fa-share-alt"></i> Share Link</button>
                                    <button class="btn btn-secondary" id="closeResultActionBtn"><i class="fas fa-times"></i> Close</button>
                                </div>
                            </div>
                        </div>
                        <!-- MY LINKS SECTION -->
                        <div class="share-section" id="links-section">
                            <div class="section-card">
                                <div class="section-card-header">
                                    <div class="section-card-title">
                                        <i class="fas fa-link"></i>
                                        <span>My Share Links</span>
                                    </div>
                                    <span class="section-card-badge">
                                        <i class="fas fa-shield-alt"></i>
                                        Manage and track your shared links
                                    </span>
                                </div>
                            </div>
                            <div id="linksListContainer"></div>
                        </div>
                        <!-- SHARED WITH ME SECTION -->
                        <div class="share-section" id="shared-with-me-section">
                            <div class="section-card">
                                <div class="section-card-header">
                                    <div class="section-card-title">
                                        <i class="fas fa-users"></i>
                                        <span>Shared With Me</span>
                                    </div>
                                    <span class="section-card-badge">
                                        <i class="fas fa-share-alt"></i>
                                        Links that others have shared with you
                                    </span>
                                </div>
                            </div>
                            <div id="sharedWithMeContainer"></div>
                        </div>
                        <!-- ABOUT SECTION -->
                        <div class="share-section" id="about-section">
                            <div class="section-card">
                                <div class="section-card-header">
                                    <div class="section-card-title">
                                        <i class="fas fa-info-circle"></i>
                                        <span>About Secure Share</span>
                                    </div>
                                    <span class="section-card-badge">
                                        <i class="fas fa-shield-alt"></i>
                                        Learn about security and features
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ========== RENDER LINKS LIST ==========
    async renderLinksList() {
        const container = document.getElementById('linksListContainer');
        if (!container) {
            console.warn('linksListContainer not found');
            return;
        }

        const links = Object.values(this.secureLinks);
        if (links.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-unlink empty-state-icon"></i>
                    <p>No share links created yet</p>
                    <button class="btn btn-primary" id="goToCreateBtn">Create Your First Link</button>
                </div>
            `;
            document.getElementById('goToCreateBtn')?.addEventListener('click', () => this.showSection('create'));
            return;
        }

        let html = '';
        const now = new Date();

        for (const link of links) {
            const isExpired = link.expiration && new Date(link.expiration) < now;
            const isDestroyed = link.isDestroyed === true;
            const isPending = link.status === 'pending';
            const isActive = link.status === 'active' || !link.status;
            const secureUrl = `${this.getSiteUrlSync()}?id=${link.id}`;

            let statusBadgeClass = 'badge-active';
            let statusLabel = 'Active';
            if (isDestroyed) { statusBadgeClass = 'badge-destroyed'; statusLabel = 'Destroyed'; }
            else if (isExpired) { statusBadgeClass = 'badge-expired'; statusLabel = 'Expired'; }
            else if (isPending) { statusBadgeClass = 'badge-pending'; statusLabel = 'Pending'; }

            let typeIcon = 'fa-file-alt';
            let typeLabel = 'Mixed';
            if (link.type === 'text') { typeIcon = 'fa-file-alt'; typeLabel = 'Text'; }
            else if (link.type === 'photos') { typeIcon = 'fa-images'; typeLabel = 'Photos'; }
            else if (link.type === 'mixed') { typeIcon = 'fa-layer-group'; typeLabel = 'Text + Photos'; }

            let expirationDisplay = '';
            if (link.expiration) {
                const expDate = new Date(link.expiration);
                expirationDisplay = `Expires: ${expDate.toLocaleDateString()} at ${expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            }

            html += `
                <div class="link-card ${isExpired || isDestroyed || isPending ? 'inactive' : ''}" data-link-id="${link.id}">
                    <div class="link-card-header">
                        <div class="link-title-section">
                            <span class="link-title-icon"><i class="fas fa-share-alt"></i></span>
                            <span class="link-title">${this.escapeHtml(link.title)}</span>
                        </div>
                        <div class="link-header-actions">
                            <button class="btn-icon edit-link-btn" data-id="${link.id}" ${isExpired || isDestroyed || isPending ? 'disabled' : ''} title="Edit Link">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-icon share-link-btn" data-url="${secureUrl}" data-title="${this.escapeHtml(link.title)}" ${isPending ? 'disabled' : ''} title="Share Link">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-icon copy-link-btn" data-url="${secureUrl}" ${isPending ? 'disabled' : ''} title="Copy Link">
                                <i class="fas fa-copy"></i>
                            </button>
                            <button class="btn-icon toggle-status-btn" data-id="${link.id}" data-status="${link.status || 'active'}" title="${isPending ? 'Activate' : 'Pause'}">
                                <i class="fas ${isPending ? 'fa-play' : 'fa-pause'}"></i>
                            </button>
                            <button class="btn-icon delete-link-btn" data-id="${link.id}" title="Delete Link">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="link-card-body">
                        <div class="link-details-grid">
                            <div class="link-detail-item">
                                <i class="fas fa-calendar-alt"></i>
                                <span>Created ${new Date(link.createdAt).toLocaleDateString()}</span>
                            </div>
                            ${link.expiration ? `
                                <div class="link-detail-item ${isExpired ? 'expired' : ''}">
                                    <i class="fas fa-calendar-times"></i>
                                    <span>${expirationDisplay}</span>
                                </div>
                            ` : ''}
                            <div class="link-detail-item">
                                <i class="fas fa-eye"></i>
                                <span>${link.views || 0} views</span>
                            </div>
                            ${link.photos && link.photos.length ? `
                                <div class="link-detail-item">
                                    <i class="fas fa-image"></i>
                                    <span>${link.photos.length} photo(s)</span>
                                </div>
                            ` : ''}
                            ${link.textContent ? `
                                <div class="link-detail-item">
                                    <i class="fas fa-file-alt"></i>
                                    <span>Text included</span>
                                </div>
                            ` : ''}
                        </div>
                        <div class="link-feature-badges">
                            ${link.hasPassword ? '<span class="link-badge badge-password"><i class="fas fa-lock"></i> Protected</span>' : ''}
                            ${link.viewOnce ? '<span class="link-badge badge-viewonce"><i class="fas fa-eye-slash"></i> View Once</span>' : ''}
                            ${isDestroyed ? '<span class="link-badge badge-destroyed"><i class="fas fa-trash-alt"></i> Destroyed</span>' : ''}
                            ${isExpired ? '<span class="link-badge badge-expired"><i class="fas fa-clock"></i> Expired</span>' : ''}
                            ${isPending ? '<span class="link-badge badge-pending"><i class="fas fa-pause-circle"></i> Pending</span>' : ''}
                            ${isActive && !isExpired && !isDestroyed && !isPending ? '<span class="link-badge badge-active"><i class="fas fa-check-circle"></i> Active</span>' : ''}
                        </div>
                        ${await this.renderAccessRequests(link.id)}
                        <div class="link-delete-section" id="deleteSection_${link.id}" style="display: none;">
                            <div class="delete-confirm">
                                <div class="warning-text">This action cannot be undone. The link will be permanently removed.</div>
                                <div class="delete-buttons">
                                    <button class="btn btn-secondary cancel-delete-btn" data-id="${link.id}">Cancel</button>
                                    <button class="btn btn-danger confirm-delete-btn" data-id="${link.id}">Delete Permanently</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
        this.attachLinkEventListeners(container);
    }

    // ========== RENDER SHARED WITH ME LINKS ==========
    async renderSharedWithMeLinks() {
        const container = document.getElementById('sharedWithMeContainer');
        if (!container) {
            console.warn('sharedWithMeContainer not found');
            return;
        }

        const links = Object.values(this.sharedWithMeLinks);
        if (links.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users empty-state-icon"></i>
                    <p>No links have been shared with you yet.</p>
                    <p class="small">When someone shares a link with you, it will appear here.</p>
                </div>
            `;
            return;
        }

        let html = '';
        const now = new Date();

        for (const link of links) {
            const isExpired = link.expiration && new Date(link.expiration) < now;
            const isDestroyed = link.isDestroyed === true;
            const isPending = link.status === 'pending';
            const isActive = link.status === 'active' || !link.status;
            const secureUrl = `${this.getSiteUrlSync()}?id=${link.id}`;

            const isAccessible = isActive && !isExpired && !isDestroyed && !isPending;

            html += `
                <div class="link-card ${isExpired || isDestroyed || isPending ? 'inactive' : ''}" data-link-id="${link.id}">
                    <div class="link-card-header">
                        <div class="link-title-section">
                            <span class="link-title-icon"><i class="fas fa-share-alt"></i></span>
                            <span class="link-title">${this.escapeHtml(link.title)}</span>
                            <span class="link-owner-badge">
                                by ${this.escapeHtml(link.ownerPhone)}
                            </span>
                        </div>
                        <div class="link-header-actions">
                            <a href="${secureUrl}" 
                               target="_blank" 
                               rel="noopener noreferrer"
                               class="btn-icon open-link-btn ${!isAccessible ? 'disabled' : ''}"
                               ${!isAccessible ? 'style="pointer-events:none; opacity:0.4;"' : ''}
                               title="Open Link">
                                <i class="fas fa-external-link-alt"></i>
                            </a>

                            <button class="btn-icon share-link-btn" data-url="${secureUrl}" data-title="${this.escapeHtml(link.title)}" ${isPending ? 'disabled' : ''} title="Share Link">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-icon copy-link-btn" data-url="${secureUrl}" ${isPending ? 'disabled' : ''} title="Copy Link">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
        this.attachSharedLinkEventListeners(container);
    }

    attachSharedLinkEventListeners(container) {
        container.querySelectorAll('.copy-link-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                await this.copyToClipboard(url);
                this.showSuccess('Link copied!');
            });
        });

        container.querySelectorAll('.share-link-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                const title = btn.getAttribute('data-title') || 'Shared Content';
                await this.shareLink(url, title);
            });
        });
    }

    async renderAccessRequests(linkId) {
        const pendingRequests = await this.getPendingRequests(linkId);
        if (pendingRequests.length === 0) return '';

        let requestsHtml = `
            <div class="access-requests-section">
                <div class="requests-header">
                    <i class="fas fa-users"></i>
                    <span>${pendingRequests.length} pending access request(s)</span>
                </div>
                <div class="requests-list">
        `;

        for (const req of pendingRequests) {
            const plainPhone = req.requesterPhone;
            requestsHtml += `
                <div class="request-item" data-request-phone="${plainPhone}">
                    <span>${this.escapeHtml(plainPhone)}</span>
                    <span class="request-time">${new Date(req.requestedAt).toLocaleString()}</span>
                    <div class="request-actions">
                        <button class="btn btn-small btn-success approve-request-btn" data-link="${linkId}" data-phone="${plainPhone}">Approve</button>
                        <button class="btn btn-small btn-danger deny-request-btn" data-link="${linkId}" data-phone="${plainPhone}">Deny</button>
                    </div>
                </div>
            `;
        }

        requestsHtml += `
                </div>
            </div>
        `;

        return requestsHtml;
    }

    attachLinkEventListeners(container) {
        container.querySelectorAll('.copy-link-btn').forEach(btn => {
            btn.removeEventListener('click', this.copyLinkHandler);
            this.copyLinkHandler = async (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                await this.copyToClipboard(url);
                this.showSuccess('Link copied!');
            };
            btn.addEventListener('click', this.copyLinkHandler);
        });

        container.querySelectorAll('.edit-link-btn').forEach(btn => {
            btn.removeEventListener('click', this.editLinkHandler);
            this.editLinkHandler = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                await this.editLink(id);
            };
            btn.addEventListener('click', this.editLinkHandler);
        });
        
        container.querySelectorAll('.share-link-btn').forEach(btn => {
            btn.removeEventListener('click', this.shareLinkHandler);
            this.shareLinkHandler = async (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                const title = btn.getAttribute('data-title') || 'Shared Content';
                await this.shareLink(url, title);
            };
            btn.addEventListener('click', this.shareLinkHandler);
        });
        
        container.querySelectorAll('.toggle-status-btn').forEach(btn => {
            btn.removeEventListener('click', this.toggleStatusHandler);
            this.toggleStatusHandler = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                await this.toggleLinkStatus(id);
                this.renderLinksList();
            };
            btn.addEventListener('click', this.toggleStatusHandler);
        });
        
        container.querySelectorAll('.delete-link-btn').forEach(btn => {
            btn.removeEventListener('click', this.deleteLinkHandler);
            this.deleteLinkHandler = (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this.toggleDeleteSection(id);
            };
            btn.addEventListener('click', this.deleteLinkHandler);
        });
        
        container.querySelectorAll('.cancel-delete-btn').forEach(btn => {
            btn.removeEventListener('click', this.cancelDeleteHandler);
            this.cancelDeleteHandler = (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this.hideDeleteSection(id);
            };
            btn.addEventListener('click', this.cancelDeleteHandler);
        });
        
        container.querySelectorAll('.confirm-delete-btn').forEach(btn => {
            btn.removeEventListener('click', this.confirmDeleteHandler);
            this.confirmDeleteHandler = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                await this.deleteLink(id);
                this.showSuccess('Link deleted');
                this.renderLinksList();
            };
            btn.addEventListener('click', this.confirmDeleteHandler);
        });

        container.addEventListener('click', async (e) => {
            const approveBtn = e.target.closest('.approve-request-btn');
            if (approveBtn) {
                e.stopPropagation();
                const linkId = approveBtn.dataset.link;
                const phone = approveBtn.dataset.phone;
                const requestItem = approveBtn.closest('.request-item');
                
                const success = await this.approveAccessRequest(linkId, phone);
                if (success) {
                    if (requestItem) {
                        const section = requestItem.closest('.access-requests-section');
                        requestItem.remove();
                        if (section && section.querySelectorAll('.request-item').length === 0) {
                            section.remove();
                        }
                    }
                    this.showSuccess(`Access granted to ${phone}`);
                }
                return;
            }

            const denyBtn = e.target.closest('.deny-request-btn');
            if (denyBtn) {
                e.stopPropagation();
                const linkId = denyBtn.dataset.link;
                const phone = denyBtn.dataset.phone;
                const requestItem = denyBtn.closest('.request-item');
                
                const success = await this.denyAccessRequest(linkId, phone);
                if (success) {
                    if (requestItem) {
                        const section = requestItem.closest('.access-requests-section');
                        requestItem.remove();
                        if (section && section.querySelectorAll('.request-item').length === 0) {
                            section.remove();
                        }
                    }
                    this.showSuccess(`Access denied for ${phone}`);
                }
                return;
            }
        });
    }

    toggleDeleteSection(linkId) {
        const section = document.getElementById(`deleteSection_${linkId}`);
        if (section) {
            document.querySelectorAll('.share-delete-section').forEach(s => {
                if (s.id !== `deleteSection_${linkId}`) {
                    s.style.display = 'none';
                }
            });
            section.style.display = section.style.display === 'none' ? 'block' : 'none';
        }
    }

    hideDeleteSection(linkId) {
        const section = document.getElementById(`deleteSection_${linkId}`);
        if (section) {
            section.style.display = 'none';
        }
    }

    showResultSection(linkData, secureUrl, contentType, photoCount) {
        const resultSection = document.getElementById('linkResultSection');
        if (!resultSection) return;
        
        resultSection.setAttribute('data-share-title', linkData.title || 'Shared Content');
    
        const linkUrlEl = document.getElementById('resultLinkUrl');
        const warningEl = document.getElementById('resultWarning');
        const viewOnceWarningEl = document.getElementById('resultViewOnceWarning');
        const photoInfoEl = document.getElementById('resultPhotoInfo');
        const secondsSpan = document.getElementById('resultSecondsValue');
        
        if (linkUrlEl) linkUrlEl.textContent = secureUrl;
        
        if (warningEl) {
            warningEl.style.display = linkData.hasPassword ? 'block' : 'none';
        }
        
        if (viewOnceWarningEl && linkData.viewOnce) {
            viewOnceWarningEl.style.display = 'block';
            if (secondsSpan) {
                secondsSpan.textContent = linkData.viewOnceSeconds || 3;
            }
        } else if (viewOnceWarningEl) {
            viewOnceWarningEl.style.display = 'none';
        }
        
        if (photoInfoEl && contentType === 'photos') {
            photoInfoEl.style.display = 'block';
            photoInfoEl.innerHTML = `
                <div class="photo-share-info">
                    <i class="fas fa-images"></i>
                    <span>${photoCount} photo${photoCount !== 1 ? 's' : ''} shared</span>
                </div>
            `;
        } else if (photoInfoEl) {
            photoInfoEl.style.display = 'none';
        }
        
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    hideResultSection() {
        const resultSection = document.getElementById('linkResultSection');
        if (resultSection) {
            resultSection.style.display = 'none';
        }
    }

    attachResultEvents() {
        const closeResult = () => this.hideResultSection();
        
        const closeBtn = document.getElementById('closeResultBtn');
        const closeActionBtn = document.getElementById('closeResultActionBtn');
        const copyBtn = document.getElementById('copyResultLinkBtn');
        const shareBtn = document.getElementById('shareResultLinkBtn');
        
        if (closeBtn) closeBtn.addEventListener('click', closeResult);
        if (closeActionBtn) closeActionBtn.addEventListener('click', closeResult);
        
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const linkUrl = document.getElementById('resultLinkUrl')?.textContent;
                if (linkUrl) {
                    await this.copyToClipboard(linkUrl);
                    this.showSuccess('Link copied!');
                    setTimeout(() => this.hideResultSection(), 1500);
                }
            });
        }
        
        if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
                const resultSection = document.getElementById('linkResultSection');
                const linkUrl = document.getElementById('resultLinkUrl')?.textContent;
                const linkTitle = resultSection?.getAttribute('data-share-title') || 'Shared Content';
                
                if (linkUrl) {
                    await this.shareLink(linkUrl, linkTitle);
                    setTimeout(() => this.hideResultSection(), 1500);
                }
            });
        }
    }

    togglePasswordField(show) {
        const passwordFieldGroup = document.getElementById('passwordFieldGroup');
        if (passwordFieldGroup) {
            passwordFieldGroup.style.display = show ? 'block' : 'none';
        }
        const passwordInput = document.getElementById('linkPassword');
        if (passwordInput && !show) {
            passwordInput.value = '';
        }
    }

    // ========== HANDLE CREATE LINK ==========
    async handleCreateLink(e) {
        e.preventDefault();

        const title = document.getElementById('linkTitle')?.value.trim();
        const textContent = document.getElementById('linkContent')?.value;
        const passwordProtection = document.getElementById('passwordProtectionToggle')?.checked || false;
        const password = passwordProtection ? document.getElementById('linkPassword')?.value : '';
        let expiration = document.getElementById('expirationDate')?.value;
        const viewOnce = document.getElementById('viewOnceToggle')?.checked || false;
        let viewOnceSeconds = 3;
        if (viewOnce) {
            const slider = document.getElementById('viewOnceSecondsSlider');
            viewOnceSeconds = slider ? parseInt(slider.value, 10) : 3;
        }

        const watermarkEnabled = document.getElementById('watermarkToggle')?.checked || false;
        const watermarkText = watermarkEnabled
            ? (document.getElementById('watermarkText')?.value.trim() || 'Confidential')
            : null;

        const linkStatus = 'active';

        const shareWithToggle = document.getElementById('shareWithToggle')?.checked || false;
        const shareWithInput = document.getElementById('shareWithInput')?.value || '';
        const allowedPhones = shareWithToggle
            ? shareWithInput.split(',').map(phone => {
                const trimmed = phone.trim();
                const validation = PhoneValidator.validatePhone(trimmed);
                if (!validation.valid) {
                    throw new Error(`Invalid phone number: "${trimmed}" – ${validation.reason}`);
                }
                return PhoneValidator.normalizePhone(trimmed);
            })
            : [];
            
        if (!expiration) {
            const defaultExp = new Date();
            defaultExp.setDate(defaultExp.getDate() + 7);
            expiration = defaultExp.toISOString().slice(0, 16);
        }

        if (!title || title.length < 3) {
            this.showError('Title must be at least 3 characters');
            return;
        }
        if (title.length > 24) {
            this.showError('Title is too long (max 24 characters)');
            return;
        }
        if (passwordProtection && (!password || password.length < 4)) {
            this.showError('Password must be at least 4 characters');
            return;
        }
        if (textContent && textContent.length > 50000) {
            this.showError(`Text is too long. Maximum 50000 characters.`);
            return;
        }

        const submitBtn = document.getElementById('createLinkSubmitBtn');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-hourglass-start"></i> Processing...';

        let operationSuccess = false;

        try {
            const photoIds = Array.from(this.selectedPhotoIds);

            if (this.editMode && this.currentEditLinkId) {
                await this.updateShareLink(
                    this.currentEditLinkId,
                    title,
                    textContent,
                    photoIds,
                    passwordProtection ? 'password' : 'nopassword',
                    password,
                    expiration,
                    viewOnce,
                    viewOnceSeconds,
                    linkStatus,
                    watermarkText,
                    allowedPhones
                );

                this.hideResultSection();
                this.showSuccess('Share link updated successfully!');
                this.renderLinksList();
                this.cancelEdit();
            } else {
                const result = await this.createShareLink(
                    title,
                    textContent,
                    photoIds,
                    passwordProtection ? 'password' : 'nopassword',
                    password,
                    expiration,
                    viewOnce,
                    viewOnceSeconds,
                    linkStatus,
                    watermarkText,
                    allowedPhones
                );

                this.hideResultSection();
                this.showResultSection(result.linkData, result.secureUrl, 'mixed', result.linkData.photoCount);
                this.showSuccess('Share link created successfully!');
                this.clearForm();
                this.renderLinksList();
            }

            operationSuccess = true;
        } catch (error) {
            console.error('Link operation error:', error);
            this.showError(error.message || 'Operation failed');
        } finally {
            submitBtn.disabled = false;
            const defaultText = this.editMode ? '<i class="fas fa-save"></i> Update Link' : '<i class="fas fa-link"></i> Create Share Link';
            submitBtn.innerHTML = defaultText;
        }
    }

    clearForm() {
        document.getElementById('linkTitle').value = '';
        document.getElementById('linkContent').value = '';
        document.getElementById('linkPassword').value = '';

        document.getElementById('watermarkToggle').checked = false;
        document.getElementById('watermarkTextContainer').style.display = 'none';
        document.getElementById('watermarkText').value = 'Confidential';

        document.getElementById('shareWithToggle').checked = false;
        document.getElementById('shareWithContainer').style.display = 'none';
        document.getElementById('shareWithInput').value = '';

        const defaultExpiration = new Date();
        defaultExpiration.setDate(defaultExpiration.getDate() + 7);
        document.getElementById('expirationDate').value = defaultExpiration.toISOString().slice(0, 16);
        
        const passwordToggle = document.getElementById('passwordProtectionToggle');
        if (passwordToggle) {
            passwordToggle.checked = false;
            this.togglePasswordField(false);
        }
        const viewOnceToggle = document.getElementById('viewOnceToggle');
        if (viewOnceToggle) {
            viewOnceToggle.checked = false;
            const secondsContainer = document.getElementById('viewOnceSecondsContainer');
            if (secondsContainer) secondsContainer.style.display = 'none';
        }
        const secondsSlider = document.getElementById('viewOnceSecondsSlider');
        if (secondsSlider) secondsSlider.value = '3';
        
        this.selectedPhotoIds.clear();
        this.availablePhotos = [];
        this.updatePhotoUI();
    }

    // ========== UPDATE SHARE LINK ==========
    // Complete updateShareLink method
    async updateShareLink(linkId, title, textContent, photoIds, protectionType, password, expiration, viewOnce, viewOnceSeconds, status, watermarkText = null, allowedPhones = []) {
        const existingLink = this.secureLinks[linkId];
        if (!existingLink) throw new Error('Link not found');
        
        const oldAllowedPhones = existingLink.allowedPhones || [];

        // Normalize all phone numbers for consistent comparison
        const normalizedAllowedPhones = allowedPhones
            .map(phone => {
                const trimmed = phone.trim();
                const validation = PhoneValidator.validatePhone(trimmed);
                if (!validation.valid) {
                    throw new Error(`Invalid phone number: "${trimmed}" – ${validation.reason}`);
                }
                return PhoneValidator.normalizePhone(trimmed);
            })
            .filter(p => p.length > 0);

        let passwordHash = existingLink.passwordHash;
        let hasPassword = existingLink.hasPassword;
        
        if (protectionType === 'password' && password) {
            passwordHash = await this.hashPassword(password);
            hasPassword = true;
        } else if (protectionType === 'nopassword') {
            passwordHash = null;
            hasPassword = false;
        }
        
        // Rebuild photos array from selected photo IDs
        const photos = [];
        for (const photoId of photoIds) {
            const photo = this.availablePhotos.find(p => p.id === photoId);
            if (photo) {
                photos.push({
                    id: photo.id,
                    name: photo.name,
                    url: photo.url,
                    size: photo.size,
                    date: photo.date,
                    description: photo.description || ''
                });
            }
        }
        
        const updatedLinkData = {
            ...existingLink,
            title: title,
            textContent: textContent || '',
            photos: photos,
            photoCount: photos.length,
            passwordHash: passwordHash,
            hasPassword: hasPassword,
            expiration: expiration || null,
            viewOnce: viewOnce,
            viewOnceSeconds: viewOnce ? viewOnceSeconds : null,
            status: status,
            updatedAt: new Date().toISOString(),
            watermarkText: watermarkText,
            allowedPhones: normalizedAllowedPhones,   // store normalized version
        };
        
        this.secureLinks[linkId] = updatedLinkData;
        
        // Update in Firebase
        await this.shareDB.ref(`shareLinks/${linkId}`).update({
            title: title,
            textContent: textContent || '',
            photos: photos,
            photoCount: photos.length,
            passwordHash: passwordHash,
            hasPassword: hasPassword,
            expiration: expiration || null,
            viewOnce: viewOnce,
            viewOnceSeconds: viewOnce ? viewOnceSeconds : null,
            status: status,
            updatedAt: new Date().toISOString(),
            watermarkText: watermarkText,
            allowedPhones: normalizedAllowedPhones
        });

        // Update sharedWithMe index (add/remove users based on changes)
        await this.updateSharedWithMeIndex(linkId, oldAllowedPhones, normalizedAllowedPhones);
        
        return updatedLinkData;
    }

    // ========== EDIT LINK ==========
    async editLink(linkId) {
        const link = this.secureLinks[linkId];
        if (!link) {
            this.showError('Link not found');
            return;
        }
        
        const now = new Date();
        const isExpired = link.expiration && new Date(link.expiration) < now;
        if (link.isDestroyed || isExpired || link.status === 'pending') {
            this.showError('Cannot edit expired, destroyed, or paused links');
            return;
        }
        
        this.showSection('create');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.editMode = true;
        this.currentEditLinkId = linkId;
        this.setEditModeUI(true);
        
        this.populateEditForm(link);
        
        document.getElementById('createLinkForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    populateEditForm(link) {
        const titleInput = document.getElementById('linkTitle');
        if (titleInput) titleInput.value = link.title || '';
        
        const contentTextarea = document.getElementById('linkContent');
        if (contentTextarea) contentTextarea.value = link.textContent || '';
        
        const passwordToggle = document.getElementById('passwordProtectionToggle');
        if (passwordToggle) {
            passwordToggle.checked = link.hasPassword || false;
            this.togglePasswordField(link.hasPassword || false);
            if (link.hasPassword) {
                const passwordInput = document.getElementById('linkPassword');
                if (passwordInput) passwordInput.value = '';
            }
        }
        
        const viewOnceToggle = document.getElementById('viewOnceToggle');
        const secondsContainer = document.getElementById('viewOnceSecondsContainer');
        const secondsSlider = document.getElementById('viewOnceSecondsSlider');
        const secondsDisplay = document.getElementById('secondsValueDisplay');
        
        if (viewOnceToggle) {
            viewOnceToggle.checked = link.viewOnce || false;
            if (secondsContainer) secondsContainer.style.display = link.viewOnce ? 'block' : 'none';
            if (secondsSlider && link.viewOnceSeconds) {
                secondsSlider.value = link.viewOnceSeconds;
                if (secondsDisplay) secondsDisplay.textContent = link.viewOnceSeconds;
            } else if (secondsSlider) {
                secondsSlider.value = 3;
                if (secondsDisplay) secondsDisplay.textContent = '3';
            }
        }
        
        const watermarkToggle = document.getElementById('watermarkToggle');
        const watermarkTextInput = document.getElementById('watermarkText');
        const watermarkContainer = document.getElementById('watermarkTextContainer');

        if (watermarkToggle && watermarkTextInput && watermarkContainer) {
            const hasWatermark = link.watermarkText && link.watermarkText.length > 0;
            watermarkToggle.checked = hasWatermark;
            watermarkContainer.style.display = hasWatermark ? 'block' : 'none';
            watermarkTextInput.value = hasWatermark ? link.watermarkText : 'Confidential';
        }

        const shareWithToggle = document.getElementById('shareWithToggle');
        const shareWithInput = document.getElementById('shareWithInput');
        const shareWithContainer = document.getElementById('shareWithContainer');
        if (shareWithToggle && shareWithInput && shareWithContainer) {
            const hasShareWith = link.allowedPhones && link.allowedPhones.length > 0;
            shareWithToggle.checked = hasShareWith;
            shareWithContainer.style.display = hasShareWith ? 'block' : 'none';
            shareWithInput.value = hasShareWith ? link.allowedPhones.join(', ') : '';
        }

        if (link.expiration) {
            const expDate = new Date(link.expiration);
            const year = expDate.getFullYear();
            const month = String(expDate.getMonth() + 1).padStart(2, '0');
            const day = String(expDate.getDate()).padStart(2, '0');
            const hours = String(expDate.getHours()).padStart(2, '0');
            const minutes = String(expDate.getMinutes()).padStart(2, '0');
            const expLocal = `${year}-${month}-${day}T${hours}:${minutes}`;
            const expirationInput = document.getElementById('expirationDate');
            if (expirationInput) expirationInput.value = expLocal;
        } else {
            const defaultExp = new Date();
            defaultExp.setDate(defaultExp.getDate() + 7);
            const expirationInput = document.getElementById('expirationDate');
            if (expirationInput) expirationInput.value = defaultExp.toISOString().slice(0, 16);
        }

        this.selectedPhotoIds.clear();
        this.availablePhotos = [];
        
        if (link.photos && link.photos.length) {
            this.availablePhotos = link.photos.map(photo => ({
                id: photo.id,
                name: photo.name || 'Untitled',
                url: photo.url,
                size: photo.size || 0,
                date: photo.date || new Date().toISOString(),
                description: photo.description || ''
            }));
            
            for (const photo of this.availablePhotos) {
                this.selectedPhotoIds.add(photo.id);
            }
        }
        
        setTimeout(() => {
            this.renderPhotoSelectionGrid();
        }, 50);
    }

    renderPhotoSelectionGrid() {
        const gridContainer = document.getElementById('photoSelectionGrid');
        if (!gridContainer) return;
        
        gridContainer.innerHTML = this.availablePhotos.map(photo => `
            <div class="share-photo-card ${this.selectedPhotoIds.has(photo.id) ? 'selected' : ''}" data-photo-id="${photo.id}">
                <div class="share-photo-thumbnail">
                    <img src="${photo.url}" alt="${this.escapeHtml(photo.name)}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23666%22%3E%3Cpath d=%22M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z%22/%3E%3C/svg%3E'">
                    <div class="share-photo-overlay">
                        <input type="checkbox" class="share-photo-checkbox" ${this.selectedPhotoIds.has(photo.id) ? 'checked' : ''}>
                    </div>
                </div>
                <div class="share-photo-info">
                    <span class="share-photo-name">${this.escapeHtml(photo.name.substring(0, 20))}</span>
                </div>
            </div>
        `).join('');
        
        gridContainer.querySelectorAll('.share-photo-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const photoId = card.dataset.photoId;
                    this.togglePhotoSelection(photoId);
                }
            });
            const checkbox = card.querySelector('.share-photo-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const photoId = card.getAttribute('data-photo-id');
                    if (checkbox.checked) {
                        this.selectedPhotoIds.add(photoId);
                    } else {
                        this.selectedPhotoIds.delete(photoId);
                    }
                    this.updatePhotoUI();
                });
            }
        });
    }

    setEditModeUI(isEditing) {
        const submitBtn = document.getElementById('createLinkSubmitBtn');
        const formTitle = document.querySelector('#create-section .section-header h2');
        const cancelEditBtn = document.getElementById('cancelEditBtn');
        
        if (isEditing) {
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Link';
                submitBtn.classList.add('btn-edit-mode');
            }
            if (formTitle) formTitle.textContent = 'Edit Share Link';
            
            if (!cancelEditBtn) {
                const formActions = document.querySelector('#createLinkForm .form-actions');
                if (formActions) {
                    const cancelBtn = document.createElement('button');
                    cancelBtn.type = 'button';
                    cancelBtn.id = 'cancelEditBtn';
                    cancelBtn.className = 'btn btn-secondary';
                    cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Edit';
                    cancelBtn.addEventListener('click', () => this.cancelEdit());
                    formActions.appendChild(cancelBtn);
                }
            } else {
                cancelEditBtn.style.display = 'inline-flex';
            }
        } else {
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-link"></i> Create Share Link';
                submitBtn.classList.remove('btn-edit-mode');
            }
            if (formTitle) formTitle.textContent = 'Create Share Link';
            if (cancelEditBtn) cancelEditBtn.style.display = 'none';
            
            this.clearForm();
        }
    }

    cancelEdit() {
        this.editMode = false;
        this.currentEditLinkId = null;
        this.setEditModeUI(false);
        this.clearForm();
        this.availablePhotos = [];
        this.selectedPhotoIds.clear();
        this.updatePhotoUI();
    }

    // ========== OPEN PHOTO LIBRARY ==========
    async openPhotoLibraryForSharing() {
        if (window.photosModule && typeof window.photosModule.selectMultiplePhotos === 'function') {
            const selectedPhotos = await window.photosModule.selectMultiplePhotos();
            if (selectedPhotos && selectedPhotos.length) {
                this.addPhotosToShare(selectedPhotos);
            }
        } else {
            window.xDrive?.navigateToModule('photos');
            window.addEventListener('photosSelectedForShare', (event) => {
                if (event.detail?.photos) {
                    this.addPhotosToShare(event.detail.photos);
                }
            }, { once: true });
        }
    }

    addPhotosToShare(photos) {
        for (const photo of photos) {
            if (!this.availablePhotos.some(p => p.id === photo.id)) {
                this.availablePhotos.unshift(photo);
            }
            this.selectedPhotoIds.add(photo.id);
        }
        this.updatePhotoUI();
        this.showSuccess(`${photos.length} photo(s) added to share`);
    }

    applyPhotoToShare(photo) {
        if (!photo || !photo.id) return;

        const existing = this.availablePhotos.find(p => p.id === photo.id);
        if (!existing) {
            this.availablePhotos.unshift(photo);
        }

        this.selectedPhotoIds.clear();
        this.selectedPhotoIds.add(photo.id);

        this.updatePhotoUI();

        if (this.currentSection !== 'create') {
            this.showSection('create');
        }

        setTimeout(() => {
            this.updatePhotoUI();
        }, 100);
    }

    // ========== SHARE LINK ==========
    async shareLink(url, title = 'Shared Content') {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: title,
                    text: 'Check out this shared content!',
                    url: url
                });
                this.showSuccess('Shared successfully!');
                return true;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Share failed:', error);
                    return this.fallbackShareCopy(url);
                }
                return false;
            }
        } else {
            return this.fallbackShareCopy(url);
        }
    }

    async fallbackShareCopy(url) {
        const copied = await this.copyToClipboard(url);
        if (copied) {
            this.showSuccess('Link copied to clipboard! (Share not supported on this device)');
        } else {
            this.showError('Could not copy link. Please copy manually.');
        }
        return copied;
    }

    // ========== ACCESS REQUESTS ==========
    async getPendingRequests(linkId) {
        if (!this.shareDB) return [];
        try {
            const snapshot = await this.shareDB.ref(`accessRequests/${linkId}`).once('value');
            const data = snapshot.val() || {};
            return Object.entries(data)
                .filter(([phone, req]) => req.status === 'pending')
                .map(([phone, req]) => ({ phone, ...req }));
        } catch (error) {
            console.error('Error fetching requests:', error);
            return [];
        }
    }

    async approveAccessRequest(linkId, requesterPhone) {
        if (!this.shareDB) return false;
        try {
            const linkRef = this.shareDB.ref(`shareLinks/${linkId}`);
            const linkSnapshot = await linkRef.once('value');
            const linkData = linkSnapshot.val();
            if (!linkData) return false;

            const allowed = linkData.allowedPhones || [];
            if (!allowed.includes(requesterPhone)) {
                allowed.push(requesterPhone);
                await linkRef.update({ allowedPhones: allowed });
            }

            const encodedRequester = this.encodePhone(requesterPhone);
            await this.shareDB.ref(`sharedWithMe/${encodedRequester}/${linkId}`).set(true);

            await this.shareDB.ref(`accessRequests/${linkId}/${this.encodePhone(requesterPhone)}`).remove();

            if (this.secureLinks[linkId]) {
                this.secureLinks[linkId].allowedPhones = allowed;
            }

            this.showSuccess(`Access granted to ${requesterPhone}`);
            return true;
        } catch (error) {
            console.error('Approval error:', error);
            this.showError('Failed to approve request');
            return false;
        }
    }

    async denyAccessRequest(linkId, requesterPhone) {
        if (!this.shareDB) return false;
        try {
            await this.shareDB.ref(`accessRequests/${linkId}/${this.encodePhone(requesterPhone)}`).remove();
            this.showSuccess(`Access denied for ${requesterPhone}`);
            return true;
        } catch (error) {
            console.error('Denial error:', error);
            this.showError('Failed to deny request');
            return false;
        }
    }

    // ========== UI HELPERS ==========
    showSuccess(message) {
        const successEl = document.getElementById('shareSuccess');
        const messageEl = document.getElementById('successMessage');
        if (successEl && messageEl) {
            messageEl.textContent = message;
            successEl.style.display = 'flex';
            setTimeout(() => {
                successEl.style.display = 'none';
            }, 3000);
        }
    }

    showError(message) {
        const errorEl = document.getElementById('shareError');
        const messageEl = document.getElementById('errorMessage');
        if (errorEl && messageEl) {
            messageEl.textContent = message;
            errorEl.style.display = 'flex';
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 5000);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('Copy failed:', error);
            return false;
        }
    }

    showSection(section) {
        document.querySelectorAll('.share-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        const navItem = document.querySelector(`.share-nav-item[data-section="${section}"]`);
        if (navItem) navItem.classList.add('active');

        document.querySelectorAll('.share-section').forEach(el => {
            el.classList.remove('active');
        });
        const target = document.getElementById(`${section}-section`);
        if (target) target.classList.add('active');

        if (section === 'links') {
            this.deleteExpiredLinks().then(() => {
                this.renderLinksList();
            });
        }
        if (section === 'shared-with-me') {
            this.renderSharedWithMeLinks();
        }
        if (section === 'create') {
            this.updatePhotoUI();
        }
    }

    setupEventListeners() {
        document.querySelectorAll('.share-nav-item').forEach(item => {
            item.addEventListener('click', () => this.showSection(item.getAttribute('data-section')));
        });
        
        document.getElementById('browsePhotosBtn')?.addEventListener('click', () => {
            this.openPhotoLibraryForSharing();
        });

        document.getElementById('createLinkForm')?.addEventListener('submit', (e) => this.handleCreateLink(e));
        document.getElementById('clearFormBtn')?.addEventListener('click', () => this.clearForm());
        this.attachResultEvents();

        document.getElementById('passwordProtectionToggle')?.addEventListener('change', (e) => this.togglePasswordField(e.target.checked));
        document.getElementById('viewOnceToggle')?.addEventListener('change', (e) => {
            const container = document.getElementById('viewOnceSecondsContainer');
            if (container) container.style.display = e.target.checked ? 'block' : 'none';
        });
        const secondsSlider = document.getElementById('viewOnceSecondsSlider');
        if (secondsSlider) {
            secondsSlider.addEventListener('input', () => {
                const display = document.getElementById('secondsValueDisplay');
                if (display) display.textContent = secondsSlider.value;
            });
        }

        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const input = document.getElementById(targetId);
                if (input) {
                    const type = input.type === 'password' ? 'text' : 'password';
                    input.type = type;
                    const icon = btn.querySelector('i');
                    if (icon) {
                        icon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
                    }
                }
            });
        });

        const watermarkToggle = document.getElementById('watermarkToggle');
        const watermarkContainer = document.getElementById('watermarkTextContainer');
        if (watermarkToggle && watermarkContainer) {
            watermarkToggle.addEventListener('change', (e) => {
                watermarkContainer.style.display = e.target.checked ? 'block' : 'none';
            });
        }

        const shareWithToggle = document.getElementById('shareWithToggle');
        const shareWithContainer = document.getElementById('shareWithContainer');
        if (shareWithToggle && shareWithContainer) {
            shareWithToggle.addEventListener('change', (e) => {
                shareWithContainer.style.display = e.target.checked ? 'block' : 'none';
            });
        }

        const shareWithInput = document.getElementById('shareWithInput');
        const shareWithStatus = document.getElementById('shareWithStatus');
        if (shareWithInput && shareWithStatus) {
            shareWithInput.addEventListener('input', () => {
                const raw = shareWithInput.value.trim();
                if (!raw) {
                    shareWithStatus.innerHTML = '';
                    shareWithStatus.className = 'phone-validator-status';
                    return;
                }
                const numbers = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
                const results = numbers.map(num => PhoneValidator.validatePhone(num));
                const invalid = results.filter(r => !r.valid);
                if (invalid.length === 0) {
                    shareWithStatus.innerHTML = `<i class="fas fa-check-circle" style="color: #10b981;"></i> All numbers valid`;
                    shareWithStatus.className = 'phone-validator-status valid';
                } else {
                    const invalidNumbers = numbers.filter((_, i) => !results[i].valid);
                    const reasons = invalidNumbers.map(n => `${n} (${PhoneValidator.validatePhone(n).reason})`).join('; ');
                    shareWithStatus.innerHTML = `<i class="fas fa-times-circle" style="color: #ef4444;"></i> Invalid: ${reasons}`;
                    shareWithStatus.className = 'phone-validator-status invalid';
                }
            });
        }

        this.setupExpirationLimit();
        const defaultExpiration = new Date();
        defaultExpiration.setDate(defaultExpiration.getDate() + 7);
        const expirationInput = document.getElementById('expirationDate');
        if (expirationInput && !expirationInput.value) {
            expirationInput.value = defaultExpiration.toISOString().slice(0, 16);
        }
    }

    setupExpirationLimit() {
        const expirationInput = document.getElementById('expirationDate');
        if (!expirationInput) return;
        
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 7);
        expirationInput.max = maxDate.toISOString().slice(0, 16);
        
        const minDate = new Date();
        minDate.setHours(0, 0, 0, 0);
        expirationInput.min = minDate.toISOString().slice(0, 16);
        
        if (!expirationInput.value) {
            expirationInput.value = maxDate.toISOString().slice(0, 16);
        }
    }
}

// Initialize
const shareModule = new ShareModule();
window.shareModule = shareModule;

window.addEventListener('authSuccess', () => shareModule.initShareModule());
window.addEventListener('authReady', () => shareModule.initShareModule());