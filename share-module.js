// ==================== SHARE MODULE - MERGED TEXT & PHOTOS WITH UPLOAD ====================

class ShareModule {
    constructor() {
        this.currentUser = null;
        this.encodedEmail = null;
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

        // Upload properties (matching photos module)
        this.selectedFiles = null;
        this.uploadInProgress = false;
        this.uploadLimits = {
            maxFilesPerUpload: 5,
            maxFileSizeMB: 20,
            maxTotalPhotos: 100   // soft limit for memory
        };
        this.compressionConfig = {
            maxSizeMB: 1,
            targetSizeKB: 475,
            maxWidth: 1600,
            quality: 0.8,
            minQuality: 0.5
        };

        this.pendingPhotoForShare = null;

        this.editMode = false;           // Track if we're editing an existing link
        this.currentEditLinkId = null;   // ID of link being edited
        this.containerRendered = false;

    }

    // ========== INITIALIZATION ==========
async initShareModule() {
    try {
        const authModule = window.authModule;
        if (authModule && authModule.isAuthenticated) {
            this.currentUser = authModule.currentUser;
            this.encodedEmail = this.encodeEmail(this.currentUser.email);
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
        setInterval(() => this.deleteExpiredLinks(), 60 * 60 * 1000);

        // 🔁 If links section is active after loading, ensure it's refreshed
        if (this.currentSection === 'links') {
            this.renderLinksList();
        }

        // Apply any pending photo that was set before module was fully initialised
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
            // Read from shareURL/url path in main database
            const snapshot = await this.mainDB.ref('shareURL/url').once('value');
            
            if (snapshot.exists()) {
                this.shareDatabaseUrl = snapshot.val();
                console.log('Share database URL found:', this.shareDatabaseUrl);
                
                // Cache for future use
                localStorage.setItem('shareDatabaseUrl', this.shareDatabaseUrl);
                return this.shareDatabaseUrl;
            } else {
                // Try backup location
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
            // Try to use cached URL
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
            // Read from siteURL/url path in main database
            const snapshot = await this.mainDB.ref('siteURL/url').once('value');
            
            if (snapshot.exists()) {
                this.siteUrl = snapshot.val();
                console.log('Site URL found:', this.siteUrl);
                
                // Cache for future use
                localStorage.setItem('siteUrl', this.siteUrl);
                return this.siteUrl;
            } else {
                // Try backup location
                const backupSnapshot = await this.mainDB.ref('siteURL/value').once('value');
                if (backupSnapshot.exists()) {
                    this.siteUrl = backupSnapshot.val();
                    console.log('Site URL found (backup):', this.siteUrl);
                    localStorage.setItem('siteUrl', this.siteUrl);
                    return this.siteUrl;
                }
                
                // Fallback to default if nothing found in database
                console.warn('No site URL found in main database, using default');
                this.siteUrl = "https://xdrives.github.io/share/content.html";
                localStorage.setItem('siteUrl', this.siteUrl);
                return this.siteUrl;
            }
        } catch (error) {
            console.error('Error reading site URL:', error);
            // Try to use cached URL
            const cachedUrl = localStorage.getItem('siteUrl');
            if (cachedUrl) {
                console.log('Using cached site URL:', cachedUrl);
                this.siteUrl = cachedUrl;
                return cachedUrl;
            }
            // Final fallback
            this.siteUrl = "https://xdrives.github.io/web/content.html";
            return this.siteUrl;
        }
    }

    // Get current site URL (with fallback)
    getSiteUrlSync() {
        if (this.siteUrl) return this.siteUrl;
        
        // Try to get from localStorage
        const cachedUrl = localStorage.getItem('siteUrl');
        if (cachedUrl) {
            this.siteUrl = cachedUrl;
            return cachedUrl;
        }
        
        // Default fallback
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
                if (this.currentUser?.email) {
                    this.encodedEmail = this.encodeEmail(this.currentUser.email);
                }
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    // ========== ENCODING ==========
    encodeEmail(email) {
        if (!email) return '';
        return email.replace(/\./g, ',').replace(/@/g, '-at-');
    }

    decodeEmail(encodedEmail) {
        if (!encodedEmail) return '';
        return encodedEmail.replace(/-at-/g, '@').replace(/,/g, '.');
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

    // ========== DATABASE OPERATIONS - ALL USE SHARE DATABASE ==========
    
    // ========== UPDATED loadUserLinks ==========
async loadUserLinks() {
    if (!this.encodedEmail || !this.shareDB) {
        console.warn('Cannot load links: No share database connection');
        return;
    }

    try {
        const userLinksSnapshot = await this.shareDB.ref(`userLinks/${this.encodedEmail}`).once('value');
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

        // 🔁 Refresh the links list if the "Links" section is currently visible
        if (this.currentSection === 'links') {
            this.renderLinksList();
        }
    } catch (error) {
        console.error('Error loading user links from share database:', error);
        this.secureLinks = {};
        this.showError('Failed to load shared links. Please check your connection.');
    }
}
    async saveUserLinks() {
        if (!this.encodedEmail || !this.shareDB) {
            console.error('Cannot save: No share database connection');
            return false;
        }
        
        try {
            // Save to SHARE database
            for (const [linkId, linkData] of Object.entries(this.secureLinks)) {
                // Save the full link data under shareLinks/{linkId}
                await this.shareDB.ref(`shareLinks/${linkId}`).set(linkData);
                
                // Maintain user index for quick lookup
                await this.shareDB.ref(`userLinks/${this.encodedEmail}/${linkId}`).set(true);
            }
            
            console.log(`Saved ${Object.keys(this.secureLinks).length} links to share database`);
            return true;
        } catch (error) {
            console.error('Error saving to share database:', error);
            return false;
        }
    }

    async deleteLink(linkId) {
        if (!this.shareDB || !this.encodedEmail) return false;
        
        try {
            // Delete from share database
            await this.shareDB.ref(`shareLinks/${linkId}`).remove();
            await this.shareDB.ref(`userLinks/${this.encodedEmail}/${linkId}`).remove();
            
            // Remove from local object
            delete this.secureLinks[linkId];
            
            console.log(`Link ${linkId} deleted from share database`);
            return true;
        } catch (error) {
            console.error('Error deleting from share database:', error);
            return false;
        }
    }

    async updateLinkStatus(linkId, newStatus) {
        if (!this.shareDB || !this.encodedEmail) return false;
        
        try {
            const linkData = this.secureLinks[linkId];
            if (!linkData) {
                console.error('Link not found:', linkId);
                return false;
            }
            
            // Update status
            linkData.status = newStatus;
            this.secureLinks[linkId] = linkData;
            
            // Save to share database
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

    // Delete expired links automatically
    async deleteExpiredLinks() {
        if (!this.shareDB || !this.encodedEmail) return;
        
        const now = new Date();
        let deletedCount = 0;
        
        for (const [linkId, linkData] of Object.entries(this.secureLinks)) {
            if (linkData.expiration && new Date(linkData.expiration) < now) {
                console.log(`Deleting expired link: ${linkData.title} (${linkId})`);
                
                await this.shareDB.ref(`shareLinks/${linkId}`).remove();
                await this.shareDB.ref(`userLinks/${this.encodedEmail}/${linkId}`).remove();
                
                delete this.secureLinks[linkId];
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`Deleted ${deletedCount} expired links from share database`);
            this.renderLinksList();
        }
        
        return deletedCount;
    }

    // ========== UNIFIED CREATE LINK (TEXT + PHOTOS) ==========
    async createShareLink(title, textContent, photoIds, protectionType, password, expiration, viewOnce = false, viewOnceSeconds = 10, status = 'active') {
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
            ownerEmail: this.currentUser.email, ownerId: this.encodedEmail,
            viewOnce: viewOnce, viewOnceSeconds: viewOnce ? viewOnceSeconds : null,
            isDestroyed: false, status: status
        };
        this.secureLinks[linkId] = linkData;
        await this.saveUserLinks();
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

    // Check if link is accessible (add to content.html helper)
    isLinkAccessible(linkData) {
        if (!linkData) return false;
        if (linkData.status === 'pending') return false;
        if (linkData.isDestroyed) return false;
        if (linkData.expiration && new Date(linkData.expiration) < new Date()) return false;
        return true;
    }

    // ========== PHOTO SELECTION (no limit) ==========
    togglePhotoSelection(photoId) {
        if (this.selectedPhotoIds.has(photoId)) this.selectedPhotoIds.delete(photoId);
        else this.selectedPhotoIds.add(photoId);
        this.updatePhotoUI();
    }

updatePhotoUI() {
    const selectedCountEl = document.getElementById('selectedPhotoCount');
    if (selectedCountEl) selectedCountEl.textContent = `${this.selectedPhotoIds.size} photo(s) selected`;
    
    this.renderPhotoSelectionGrid();   // render the grid every time
    
    // Always show the library button, not only when empty
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
        // First time rendering - build the full HTML
        container.innerHTML = this.getShareHTML();
        this.setupEventListeners();
        this.showSection(this.currentSection);
        await this.initShareModule();
        this.containerRendered = true;
    } else {
        // Already rendered - just update dynamic content
        this.renderLinksList();
        this.updatePhotoUI();
        // Apply any pending photo that arrived before module was ready
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
                        <span class="material-icons">share</span>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Secure Share</div>
                        <div class="module-description">Share text and photos together with password protection</div>
                    </div>
                </div>

                <div class="share-grid">
                    <div class="share-sidebar">
                        <div class="share-nav-item active" data-section="create"><span class="material-icons">add_link</span><span>Create</span></div>
                        <div class="share-nav-item" data-section="links"><span class="material-icons">link</span><span>My Links</span></div>
                        <div class="share-nav-item" data-section="about"><span class="material-icons">info</span><span>About</span></div>
                    </div>

                    <div class="share-content">
                        <div id="shareSuccess" class="share-message success" style="display: none;"><span class="material-icons">check_circle</span><span id="successMessage"></span></div>
                        <div id="shareError" class="share-message error" style="display: none;"><span class="material-icons">error</span><span id="errorMessage"></span></div>

                        <!-- CREATE SECTION -->
                        <div class="share-section active" id="create-section">
                            <div class="section-header"><h2>Create Share Link</h2></div>
                            <div class="share-card">
                                <form id="createLinkForm">
                                    <div class="form-group">
                                        <label class="form-label">Link Title *</label>
                                        <input type="text" id="linkTitle" class="form-input" placeholder="e.g., Vacation Memories, Secret Notes" required maxlength="24">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">Text Content (optional)</label>
                                        <textarea id="linkContent" class="form-textarea" rows="4" placeholder="Write anything you want to share..."></textarea>
                                    </div>

                                    <!--  -->
                                    <div class="form-group">
                                        <div class="form-label form-label-border" style="margin-top: 4px;">
                                            <span>Photos to Share</span>
                                            <span id="selectedPhotoCount" class="form-label-right">0</span>
                                        </div>
                                        <div id="photoSelectionGrid" class="photo-selection-grid"></div>
                                        <div id="emptyPhotosAction" style="margin-top: 12px;">
                                            <button type="button" id="browsePhotosBtn" class="btn btn-primary">
                                                <i class="fas fa-images"></i> Open Photo Library
                                            </button>
                                            <div class="form-help">Select photos from your library – they will appear above.</div>
                                        </div>                                       
                                    </div>

                                    <!-- Security Options (unchanged) -->
                                    <div class="form-group">
                                        <label class="form-label">Security Options</label>
                                        <div class="security-option">
                                            <div class="security-option-header">
                                                <div class="security-option-title">Password Protection</div>
                                                <label class="toggle-switch"><input type="checkbox" id="passwordProtectionToggle"><span class="toggle-slider"></span></label>
                                            </div>
                                            <div class="security-option-description">Require password to access shared content</div>
                                            <div class="form-group" id="passwordFieldGroup" style="display: none; margin-top: 8px;">
                                                <label class="form-label">Set Access Password</label>
                                                <div class="password-input-group">
                                                    <input type="password" class="form-input" id="linkPassword" placeholder="Min. 4 characters" minlength="4">
                                                    <button type="button" class="toggle-password-btn" data-target="linkPassword"><span class="material-icons">visibility</span></button>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="security-option" style="margin-top: 8px;">
                                            <div class="security-option-header">
                                                <div class="security-option-title">View Once</div>
                                                <label class="toggle-switch"><input type="checkbox" id="viewOnceToggle"><span class="toggle-slider"></span></label>
                                            </div>
                                            <div class="security-option-description">Content self‑destructs after being viewed</div>
                                            <div id="viewOnceSecondsContainer" style="display: none; margin-top: 12px;">
                                                <label class="form-label">View Duration: <span id="secondsValueDisplay">3</span> seconds</label>
                                                <input type="range" id="viewOnceSecondsSlider" min="1" max="10" step="1" value="3" class="form-range">
                                            </div>
                                        </div>
                                    </div>

                                    <div class="form-group">
                                        <label class="form-label">Expiration</label>
                                        <input type="datetime-local" id="expirationDate" class="form-input">
                                        <div class="form-help">Leave empty for no expiration (max 7 days from now)</div>
                                    </div>

                                    <div class="form-actions">
                                        <button type="submit" class="btn btn-primary" id="createLinkSubmitBtn"><i class="fas fa-link"></i> Create Share Link</button>
                                        <button type="button" class="btn btn-secondary" id="clearFormBtn"><i class="fas fa-times"></i> Clear</button>
                                    </div>
                                </form>
                            </div>

                            <div id="linkResultSection" class="link-result-section" style="display: none;">
                                <div class="result-header"><span class="material-icons">link</span><h3>Share Link Created</h3><button class="close-result-btn" id="closeResultBtn"><span class="material-icons">close</span></button></div>
                                <div class="result-body"><p>Share this link with others:</p><div class="link-url-display" id="resultLinkUrl"></div><div id="resultWarning" class="warning-text" style="display: none;"><strong>Important:</strong> Share the password separately from the link.</div><div id="resultViewOnceWarning" class="warning-text" style="display: none;"><strong>View Once Mode Active:</strong> Content will self‑destruct after <span id="resultSecondsValue">3</span> seconds!</div><div id="resultPhotoInfo" class="result-photo-info" style="display: none;"></div><div class="info-text">The link contains only a unique ID – no personal information is exposed.</div></div>
                                <div class="result-actions">
                                    <button class="btn btn-success" id="copyResultLinkBtn">Copy Link</button>
                                    <button class="btn btn-success" id="shareResultLinkBtn">Share Link</button>
                                    <button class="btn btn-secondary" id="closeResultActionBtn">Close</button>
                                </div>
                            </div>
                        </div>

                        <!-- MY LINKS SECTION (unchanged) -->
                        <div class="share-section" id="links-section"><div class="section-header"><h2>My Share Links</h2><p>Manage and track your shared links</p></div><div id="linksListContainer"></div></div>
                        <div class="share-section" id="about-section"><div class="section-header"><h2>About Secure Share</h2><p>Learn about security and features</p></div></div>
                    </div>
                </div>
            </div>
        `;
    }


    // ========== RENDER LINKS LIST (updated to show both text & photos) ==========
    renderLinksList() {
        const container = document.getElementById('linksListContainer');
        if (!container) return;
        const links = Object.values(this.secureLinks);
        if (links.length === 0) {
            container.innerHTML = `<div class="empty-state"><span class="material-icons empty-state-icon">link_off</span><p>No share links created yet</p><button class="btn btn-primary" id="goToCreateBtn">Create Your First Link</button></div>`;
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
            
            let expirationDisplay = '';
            if (link.expiration) {
                const expDate = new Date(link.expiration);
                expirationDisplay = `<span>Expires: ${expDate.toLocaleDateString()} at ${expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
            }
            
            // Determine type badge text and icon
            let typeIcon = 'description';
            let typeLabel = 'Mixed';
            if (link.type === 'text') { typeIcon = 'description'; typeLabel = 'Text'; }
            else if (link.type === 'photos') { typeIcon = 'photo_library'; typeLabel = 'Photos'; }
            else if (link.type === 'mixed') { typeIcon = 'article'; typeLabel = 'Text + Photos'; }
            
            html += `
                <div class="share-link-item ${isExpired || isDestroyed || isPending ? 'expired' : ''}" data-link-id="${link.id}">
                    <div class="share-link-top-row">
                        <div class="share-title-section">
                            <div class="share-title">${this.escapeHtml(link.title)}</div>
                            <span class="share-type-badge"><span class="material-icons">${typeIcon}</span> ${typeLabel}</span>
                        </div>
                        <div class="share-actions-top-right">
                            <button class="btn-icon edit-link-btn" data-id="${link.id}" ${isExpired || isDestroyed || isPending ? 'disabled' : ''} title="Edit Link">
                                <span class="material-icons">edit</span>
                            </button>
                            <button class="btn-icon share-link-btn" data-url="${secureUrl}" data-title="${this.escapeHtml(link.title)}" ${isPending ? 'disabled' : ''} title="Share Link">
                                <span class="material-icons">share</span>
                            </button>
                            <button class="btn-icon copy-link-btn" data-url="${secureUrl}" ${isPending ? 'disabled' : ''} title="Copy Link">
                                <span class="material-icons">content_copy</span>
                            </button>
                            <button class="btn-icon toggle-status-btn" data-id="${link.id}" data-status="${link.status || 'active'}" title="${isPending ? 'Activate' : 'Pause'}">
                                <span class="material-icons">${isPending ? 'play_arrow' : 'pause'}</span>
                            </button>
                            <button class="btn-icon delete-link-btn" data-id="${link.id}" title="Delete Link">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    </div>
                    <div class="share-password-section" id="passwordSection_${link.id}" style="display: none;">
                        ${link.hasPassword ? `<div class="password-remove"><label class="remove-password-label"><input type="checkbox" id="removePassword_${link.id}"> <span>Remove password protection</span></label></div>` : ''}
                        <div class="password-wrapper"><div class="password-input-group"><input type="text" class="form-input password-input" id="password_${link.id}" placeholder="${link.hasPassword ? 'New password (min 4 chars)' : 'Set password (min 4 chars)'}"><div class="password-buttons"><button class="btn-sm btn-success save-password-btn" data-id="${link.id}"><span class="material-icons">check</span></button><button class="btn-sm btn-secondary cancel-password-btn" data-id="${link.id}"><span class="material-icons">close</span></button></div></div></div>
                    </div>
                    <div class="share-delete-section" id="deleteSection_${link.id}" style="display: none;">
                        <div class="delete-confirm"><div class="warning-text">This action cannot be undone. The link will be permanently removed.</div><div class="delete-buttons"><button class="btn btn-secondary cancel-delete-btn" data-id="${link.id}">Cancel</button><button class="btn btn-danger confirm-delete-btn" data-id="${link.id}">Delete Permanently</button></div></div>
                    </div>
                    <div class="share-details-section">
                        <div class="share-details">
                            <div class="share-detail"><span class="material-icons">calendar_today</span><span>Created ${new Date(link.createdAt).toLocaleDateString()}</span></div>
                            ${link.expiration && !isExpired ? `<div class="share-detail"><span class="material-icons">event_busy</span>${expirationDisplay}</div>` : ''}
                            ${link.expiration && isExpired ? `<div class="share-detail"><span class="material-icons">event_busy</span><span>Expired: ${new Date(link.expiration).toLocaleDateString()}</span></div>` : ''}
                            <div class="share-detail"><span class="material-icons">visibility</span><span>${link.views || 0} views</span></div>
                            ${link.photos && link.photos.length ? `<div class="share-detail"><span class="material-icons">image</span><span>${link.photos.length} photo(s)</span></div>` : ''}
                            ${link.textContent ? `<div class="share-detail"><span class="material-icons">description</span><span>Text included</span></div>` : ''}
                        </div>
                        <div class="link-badges">
                            ${link.hasPassword ? '<span class="link-badge badge-password"><span class="material-icons">lock</span> Protected</span>' : ''}
                            ${link.viewOnce ? '<span class="link-badge badge-viewonce"><span class="material-icons">visibility_off</span> View Once</span>' : ''}
                            ${isDestroyed ? '<span class="link-badge badge-destroyed"><span class="material-icons">delete_forever</span> Destroyed</span>' : ''}
                            ${isExpired ? '<span class="link-badge badge-expired"><span class="material-icons">schedule</span> Expired</span>' : ''}
                            ${isPending ? '<span class="link-badge badge-pending"><span class="material-icons">pause_circle</span> Pending</span>' : ''}
                            ${isActive && !isExpired && !isDestroyed && !isPending ? '<span class="link-badge badge-active"><span class="material-icons">check_circle</span> Active</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
        // Re-attach event listeners (same as original, unchanged)
        this.attachLinkEventListeners(container);
    }

attachLinkEventListeners(container) {
    // Copy link buttons
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

    // Edit link buttons
    container.querySelectorAll('.edit-link-btn').forEach(btn => {
        btn.removeEventListener('click', this.editLinkHandler);
        this.editLinkHandler = async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            await this.editLink(id);
        };
        btn.addEventListener('click', this.editLinkHandler);
    });
    
    // Share link buttons
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
    
    // Toggle status buttons
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
    
    // Delete buttons
    container.querySelectorAll('.delete-link-btn').forEach(btn => {
        btn.removeEventListener('click', this.deleteLinkHandler);
        this.deleteLinkHandler = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            this.toggleDeleteSection(id);
        };
        btn.addEventListener('click', this.deleteLinkHandler);
    });
    
    // Cancel delete buttons
    container.querySelectorAll('.cancel-delete-btn').forEach(btn => {
        btn.removeEventListener('click', this.cancelDeleteHandler);
        this.cancelDeleteHandler = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            this.hideDeleteSection(id);
        };
        btn.addEventListener('click', this.cancelDeleteHandler);
    });
    
    // Confirm delete buttons
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
}

    // Toggle delete section visibility
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

    // Hide delete section
    hideDeleteSection(linkId) {
        const section = document.getElementById(`deleteSection_${linkId}`);
        if (section) {
            section.style.display = 'none';
        }
    }

    // Helper: Hide all delete sections
    hideAllDeleteSections() {
        document.querySelectorAll('.share-delete-section').forEach(section => {
            section.style.display = 'none';
        });
    }

    // Show result section 
    showResultSection(linkData, secureUrl, contentType, photoCount) {
        const resultSection = document.getElementById('linkResultSection');
        if (!resultSection) return;
        
        // Store title for sharing
        resultSection.setAttribute('data-share-title', linkData.title || 'Shared Content');
    
        const linkUrlEl = document.getElementById('resultLinkUrl');
        const warningEl = document.getElementById('resultWarning');
        const viewOnceWarningEl = document.getElementById('resultViewOnceWarning');
        const photoInfoEl = document.getElementById('resultPhotoInfo');
        const secondsSpan = document.getElementById('resultSecondsValue');
        
        if (linkUrlEl) linkUrlEl.textContent = secureUrl;
        
        // Show password warning if needed
        if (warningEl) {
            warningEl.style.display = linkData.hasPassword ? 'block' : 'none';
        }
        
        // Show view once warning with custom seconds
        if (viewOnceWarningEl && linkData.viewOnce) {
            viewOnceWarningEl.style.display = 'block';
            if (secondsSpan) {
                secondsSpan.textContent = linkData.viewOnceSeconds || 3;
            }
        } else if (viewOnceWarningEl) {
            viewOnceWarningEl.style.display = 'none';
        }
        
        // Show photo info if photo share
        if (photoInfoEl && contentType === 'photos') {
            photoInfoEl.style.display = 'block';
            photoInfoEl.innerHTML = `
                <div class="photo-share-info">
                    <span class="material-icons">photo_library</span>
                    <span>${photoCount} photo${photoCount !== 1 ? 's' : ''} shared</span>
                </div>
            `;
        } else if (photoInfoEl) {
            photoInfoEl.style.display = 'none';
        }
        
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Hide result section
    hideResultSection() {
        const resultSection = document.getElementById('linkResultSection');
        if (resultSection) {
            resultSection.style.display = 'none';
        }
    }

    // Attach result section events
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
    
    // NEW: Share result button handler
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

    // Update security settings
    updateSecuritySettings(setting, value) {
        this.shareSettings = this.shareSettings || {};
        this.shareSettings[setting] = value;
        
        if (setting === 'passwordProtection' && !value) {
            const passwordInput = document.getElementById('linkPassword');
            if (passwordInput) passwordInput.value = '';
        }
    }

    toggleViewOnceHelp(show) {
        const helpText = document.getElementById('viewOnceHelp');
        const secondsContainer = document.getElementById('viewOnceSecondsContainer');
        
        if (helpText) {
            helpText.style.display = show ? 'block' : 'none';
        }
        
        if (secondsContainer) {
            secondsContainer.style.display = show ? 'block' : 'none';
        }
    }

    updateSecondsDisplay() {
        const slider = document.getElementById('viewOnceSecondsSlider');
        const display = document.getElementById('secondsValueDisplay');
        if (slider && display) {
            display.textContent = slider.value;
        }
    }

    // ========== HANDLE CREATE LINK (UNIFIED) ==========
async handleCreateLink(e) {
    e.preventDefault();

    // ----- Get form values -----
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
    const linkStatus = 'active';

    // ----- Set default expiration (7 days from now) if empty -----
    if (!expiration) {
        const defaultExp = new Date();
        defaultExp.setDate(defaultExp.getDate() + 7);
        expiration = defaultExp.toISOString().slice(0, 16);
    }

    // ----- Validation -----
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

    // Disable submit button during processing
    const submitBtn = document.getElementById('createLinkSubmitBtn');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-hourglass-start"></i> Processing...';

    let operationSuccess = false;  // Track success/failure

    try {
        const photoIds = Array.from(this.selectedPhotoIds);

        if (this.editMode && this.currentEditLinkId) {
            // ----- UPDATE EXISTING LINK -----
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
                linkStatus
            );

            this.hideResultSection();
            this.showSuccess('Share link updated successfully!');
            this.renderLinksList();
            this.cancelEdit();         // clears form, exits edit mode, and resets button text
        } else {
            // ----- CREATE NEW LINK -----
            const result = await this.createShareLink(
                title,
                textContent,
                photoIds,
                passwordProtection ? 'password' : 'nopassword',
                password,
                expiration,
                viewOnce,
                viewOnceSeconds,
                linkStatus
            );

            this.hideResultSection();
            this.showResultSection(result.linkData, result.secureUrl, 'mixed', result.linkData.photoCount);
            this.showSuccess('Share link created successfully!');
            this.clearForm();
            this.renderLinksList();
        }

        operationSuccess = true;  // Mark as successful
    } catch (error) {
        console.error('Link operation error:', error);
        this.showError(error.message || 'Operation failed');
    } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        // Only restore original button text if operation failed
        if (!operationSuccess) {
            submitBtn.innerHTML = originalBtnText;
        }
    }
}

clearForm() {
    document.getElementById('linkTitle').value = '';
    document.getElementById('linkContent').value = '';
    document.getElementById('linkPassword').value = '';
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
    
    // Clear photo selection and available photos
    this.selectedPhotoIds.clear();
    this.availablePhotos = []; // Reset available photos
    this.updatePhotoUI();
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

// ========== UPDATED EVENT LISTENERS ==========
    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.share-nav-item').forEach(item => {
            item.addEventListener('click', () => this.showSection(item.getAttribute('data-section')));
        });
        
        document.getElementById('browsePhotosBtn')?.addEventListener('click', () => {
            this.switchToPhotosModule();
        });

        document.getElementById('browsePhotosBtn')?.addEventListener('click', () => {
            this.openPhotoLibraryForSharing();
        });

        // Form submission
        document.getElementById('createLinkForm')?.addEventListener('submit', (e) => this.handleCreateLink(e));
        document.getElementById('clearFormBtn')?.addEventListener('click', () => this.clearForm());
        this.attachResultEvents();

        // Security toggles
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

        // Password visibility toggle
        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const input = document.getElementById(targetId);
                if (input) {
                    const type = input.type === 'password' ? 'text' : 'password';
                    input.type = type;
                    btn.querySelector('.material-icons').textContent = type === 'password' ? 'visibility' : 'visibility_off';
                }
            });
        });

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

    showWarning(message) {
        console.warn(message);
        const warningEl = document.createElement('div');
        warningEl.className = 'share-message warning';
        warningEl.innerHTML = `<span class="material-icons">warning</span><span>${message}</span>`;
        const container = document.querySelector('.share-content');
        if (container) {
            container.insertBefore(warningEl, container.firstChild);
            setTimeout(() => warningEl.remove(), 5000);
        }
    }

    toggleContentType(type) {
        const textArea = document.getElementById('textContentArea');
        const photoArea = document.getElementById('photoContentArea');
        
        if (type === 'text') {
            textArea.style.display = 'block';
            photoArea.style.display = 'none';
        } else {
            textArea.style.display = 'none';
            photoArea.style.display = 'block';
        }
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
        // Only delete expired links (they are removed from local cache)
        // No full database refetch – just re-render from cached data
        this.deleteExpiredLinks().then(() => {
            this.renderLinksList();
        });
    }
    
    // Refresh photo UI when showing create section
    if (section === 'create') {
        this.updatePhotoUI();
    }
}

    prepareShareWithPhoto(photo) {
        if (!photo) return;

        // Store as pending until module is ready
        if (!this.availablePhotos) {
            this.pendingPhotoForShare = photo;
            return;
        }

        this.applyPhotoToShare(photo);
    }

applyPhotoToShare(photo) {
    if (!photo || !photo.id) return;

    // Preserve any existing form data (title, text) if we're in create mode
    // No need to clear them

    // Ensure photo exists in availablePhotos
    const existing = this.availablePhotos.find(p => p.id === photo.id);
    if (!existing) {
        this.availablePhotos.unshift(photo);
    }

    // Clear previous selection and select this photo
    this.selectedPhotoIds.clear();
    this.selectedPhotoIds.add(photo.id);

    // Force refresh of both grid and preview
    this.updatePhotoUI();

    // Switch to 'create' section if not already there
    if (this.currentSection !== 'create') {
        this.showSection('create');
    }

    // Re-sync after a short delay
    setTimeout(() => {
        this.updatePhotoUI();
    }, 100);
}

switchToPhotosModule() {
    // Use the global app navigator if available
    if (window.xDrive && typeof window.xDrive.navigateToModule === 'function') {
        window.xDrive.navigateToModule('photos');
    } else {
        // Fallback: trigger click on the photos menu item
        const photosMenuItem = document.querySelector('.navbar-menu .menu-item[data-page="photos"]');
        if (photosMenuItem) photosMenuItem.click();
    }
}


// ========== SHARE LINK METHOD (Web Share API with fallback) ==========
async shareLink(url, title = 'Shared Content') {
    // Check if Web Share API is supported
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
                // Fallback to copy
                return this.fallbackShareCopy(url);
            }
            return false;
        }
    } else {
        // Fallback for desktop or unsupported browsers
        return this.fallbackShareCopy(url);
    }
}

// Fallback copy method for when Web Share API isn't available
async fallbackShareCopy(url) {
    const copied = await this.copyToClipboard(url);
    if (copied) {
        this.showSuccess('Link copied to clipboard! (Share not supported on this device)');
    } else {
        this.showError('Could not copy link. Please copy manually.');
    }
    return copied;
}



// Add this method to handle edit button click
async editLink(linkId) {
    const link = this.secureLinks[linkId];
    if (!link) {
        this.showError('Link not found');
        return;
    }
    
    // Check if link is editable
    const now = new Date();
    const isExpired = link.expiration && new Date(link.expiration) < now;
    if (link.isDestroyed || isExpired || link.status === 'pending') {
        this.showError('Cannot edit expired, destroyed, or paused links');
        return;
    }
    
    // Switch to create section
    this.showSection('create');
    
    // Wait for DOM to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Set edit mode BEFORE populating form
    this.editMode = true;
    this.currentEditLinkId = linkId;
    this.setEditModeUI(true);
    
    // Populate form with link data
    this.populateEditForm(link);
    
    // Scroll to form
    document.getElementById('createLinkForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Populate form with existing link data
populateEditForm(link) {
    // Title
    const titleInput = document.getElementById('linkTitle');
    if (titleInput) titleInput.value = link.title || '';
    
    // Text content
    const contentTextarea = document.getElementById('linkContent');
    if (contentTextarea) contentTextarea.value = link.textContent || '';
    
    // Password protection
    const passwordToggle = document.getElementById('passwordProtectionToggle');
    if (passwordToggle) {
        passwordToggle.checked = link.hasPassword || false;
        this.togglePasswordField(link.hasPassword || false);
        if (link.hasPassword) {
            const passwordInput = document.getElementById('linkPassword');
            if (passwordInput) passwordInput.value = '';
        }
    }
    
    // View Once
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
    
    // Expiration
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

    // IMPORTANT FIX: Load photos properly
    // Clear existing selections first
    this.selectedPhotoIds.clear();
    this.availablePhotos = [];
    
    if (link.photos && link.photos.length) {
        // Copy photos with all required properties
        this.availablePhotos = link.photos.map(photo => ({
            id: photo.id,
            name: photo.name || 'Untitled',
            url: photo.url,
            size: photo.size || 0,
            date: photo.date || new Date().toISOString(),
            description: photo.description || ''
        }));
        
        // Select all photos from the link
        for (const photo of this.availablePhotos) {
            this.selectedPhotoIds.add(photo.id);
        }
    }
    
    // Force UI updates with a small delay to ensure DOM is ready
    setTimeout(() => {
        this.updatePhotoUI();
        // Extra safety: re-render grid directly
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
    
    // Add click handlers
    gridContainer.querySelectorAll('.share-photo-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                const photoId = card.getAttribute('data-photo-id');
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

// Set UI to edit mode
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
        
        // Add cancel edit button if not exists
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
        
        // Clear form
        this.clearForm();
    }
}

cancelEdit() {
    this.editMode = false;
    this.currentEditLinkId = null;
    this.setEditModeUI(false);
    this.clearForm();
    // Make sure photo grid is empty
    this.availablePhotos = [];
    this.selectedPhotoIds.clear();
    this.updatePhotoUI();

}

// Update existing link (replace createShareLink for edit)
async updateShareLink(linkId, title, textContent, photoIds, protectionType, password, expiration, viewOnce, viewOnceSeconds, status) {
    const existingLink = this.secureLinks[linkId];
    if (!existingLink) throw new Error('Link not found');
    
    let passwordHash = existingLink.passwordHash;
    let hasPassword = existingLink.hasPassword;
    
    if (protectionType === 'password' && password) {
        passwordHash = await this.hashPassword(password);
        hasPassword = true;
    } else if (protectionType === 'nopassword') {
        passwordHash = null;
        hasPassword = false;                 // ← explicitly remove password
    }
    
    // Prepare photos array from selected photo IDs
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
    
    // If password protection is on but no new password provided, keep existing
    
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
        updatedAt: new Date().toISOString()
    };
    
    // Save to local cache
    this.secureLinks[linkId] = updatedLinkData;
    
    // Save to share database
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
        updatedAt: new Date().toISOString()
    });
    
    return updatedLinkData;
}

// Called when the user clicks "Open Photo Library"
async openPhotoLibraryForSharing() {
    // If photos module exists and has a multi‑select mode
    if (window.photosModule && typeof window.photosModule.selectMultiplePhotos === 'function') {
        const selectedPhotos = await window.photosModule.selectMultiplePhotos();
        if (selectedPhotos && selectedPhotos.length) {
            this.addPhotosToShare(selectedPhotos);
        }
    } else {
        // Fallback: navigate to photos module and use a global event
        window.xDrive?.navigateToModule('photos');
        // Listen for a custom event fired by photos module when sharing is done
        window.addEventListener('photosSelectedForShare', (event) => {
            if (event.detail?.photos) {
                this.addPhotosToShare(event.detail.photos);
            }
        }, { once: true });
    }
}

// Add multiple photos to the current share session
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

// Add this method to the ShareModule class
async refreshLinks() {
    const container = document.getElementById('linksListContainer');
    if (!container) return;

    // Show loading indicator
    container.innerHTML = `
        <div class="loading-placeholder">
            <span class="material-icons">sync</span>
            <p>Loading your links...</p>
        </div>
    `;

    try {
        // Re-fetch links from the share database
        await this.loadUserLinks();   // this updates this.secureLinks
        this.renderLinksList();       // render the actual list
    } catch (error) {
        console.error('Error refreshing links:', error);
        container.innerHTML = `
            <div class="share-message error" style="display: flex;">
                <span class="material-icons">error</span>
                <span>Failed to load links. Please try again later.</span>
            </div>
        `;
    }
}
}

// Initialize
const shareModule = new ShareModule();
window.shareModule = shareModule;

window.addEventListener('authSuccess', () => shareModule.initShareModule());
window.addEventListener('authReady', () => shareModule.initShareModule());