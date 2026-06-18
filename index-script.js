// ==================== XDRIVE APP - WITH VAULT UNLOCK & FOOTER NOTIFICATIONS ====================
class xDriveApp {
    constructor() {
        // Navbar properties
        this.currentPage = 'home';
        this.currentUser = null;
        this.userData = null;
        
        // Define general modules (accessible without lock)
        this.generalModules = ['emoji-art', 'text-repeater', 'photos', 'notes', 'share', 'credential', 'settings'];
        
        // Define secure modules (require account password)
        this.secureModules = [];
        
        // Track secure access state
        this.secureVaultUnlocked = false;
        this.pendingSecureModule = null;
        
        // Track UI visibility states
        this.showAuthSection = false;
        this.showLogoutSection = false;
        
        // Notification properties
        this.currentNotification = null;
        this.hasUnread = false;
        this.notificationListener = null;
        this.notificationPanelOpen = false;
        
        // Home module properties
        this.modules = [
            { id: 'photos', name: 'Photos', icon: 'photo_library', color: 'secondary', description: 'Secure photo storage', category: 'secure' },
            { id: 'notes', name: 'Notes', icon: 'notes', color: 'secondary', description: 'Secure encrypted notes', category: 'secure' },
            { id: 'credentials', name: 'Credentials', icon: 'vpn_key', color: 'secondary', description: 'Password manager', category: 'secure' },
            { id: 'share', name: 'Share', icon: 'share', color: 'secondary', description: 'Share content securely', category: 'secure' }, 
            { id: 'settings', name: 'Settings', icon: 'settings', color: 'secondary', description: 'Account & security', category: 'secure' },
            { id: 'emoji-art', name: 'Emoji Art', icon: 'emoji_emotions', color: 'primary', description: 'Create emoji art', category: 'general' },
            { id: 'text-repeater', name: 'Text Repeater', icon: 'repeat', color: 'primary', description: 'Pattern text generator', category: 'general' }
            
        ];
        
        this.init();
    }

    // ==================== INITIALIZATION ====================
    init() {
        this.initToastBar();
        this.setupEventListeners();
        this.updateActivePage();
        this.loadUserData().then((hasUser) => {
            if (hasUser) {
                this.initNotifications();
                this.showPage('home-page');
            }
        }).catch(error => console.error('Error loading user data:', error));
    }

    // ==================== NOTIFICATION METHODS ====================
    
    async initNotifications() {
        try {
            const authModule = window.authModule;
            if (authModule && authModule.isLoggedIn && authModule.isLoggedIn()) {
                this.currentUser = authModule.getUser();
                await this.loadLatestNotification();
                this.setupNotificationListener();
            }
        } catch (error) {
            console.error('Error initializing notifications:', error);
        }
    }

    encodeEmail(email) {
        return email.replace(/\./g, ',').replace(/@/g, '-at-');
    }

    shouldShowNotification(notificationData) {
        if (!notificationData || !notificationData.active) return false;
        
        const now = Date.now();
        
        if (notificationData.expiresAt && notificationData.expiresAt < now) {
            return false;
        }
        
        if (notificationData.recipientType === 'all') {
            return true;
        }
        
        if (notificationData.recipientType === 'specific' && notificationData.recipients) {
            const recipients = Array.isArray(notificationData.recipients) ? 
                notificationData.recipients : 
                Object.values(notificationData.recipients);
            
            const encodedEmail = this.encodeEmail(this.currentUser.email);
            return recipients.includes(this.currentUser.email) || 
                   recipients.includes(encodedEmail);
        }
        
        return false;
    }

    async loadLatestNotification() {
        try {
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB || !this.currentUser) return;
            
            const masterDB = authModule.masterDB;
            const snapshot = await masterDB.ref('notifications').once('value');
            
            if (snapshot.exists()) {
                const allNotificationsData = snapshot.val();
                
                const validNotifications = Object.entries(allNotificationsData)
                    .map(([id, data]) => {
                        if (this.shouldShowNotification(data)) {
                            return { id, ...data };
                        }
                        return null;
                    })
                    .filter(n => n !== null)
                    .sort((a, b) => b.timestamp - a.timestamp);
                
                if (validNotifications.length > 0) {
                    this.currentNotification = validNotifications[0];
                    this.hasUnread = !this.currentNotification.read;
                } else {
                    this.currentNotification = null;
                    this.hasUnread = false;
                }
            }
        } catch (error) {
            console.error('Error loading notification:', error);
        }
    }

    setupNotificationListener() {
        const authModule = window.authModule;
        if (!authModule || !authModule.masterDB) return;
        
        const masterDB = authModule.masterDB;
        
        if (this.notificationListener) {
            masterDB.ref('notifications').off('value', this.notificationListener);
        }
        
        this.notificationListener = masterDB.ref('notifications').on('value', (snapshot) => {
            if (!snapshot.exists()) {
                if (this.currentNotification !== null) {
                    this.currentNotification = null;
                    this.hasUnread = false;
                    if (this.currentPage === 'home') {
                        this.renderHome('home-container');
                        this.attachHomeEventListeners();
                    }
                }
                return;
            }
            
            const allNotificationsData = snapshot.val();
            const validNotifications = Object.entries(allNotificationsData)
                .map(([id, data]) => {
                    if (this.shouldShowNotification(data)) {
                        return { id, ...data };
                    }
                    return null;
                })
                .filter(n => n !== null)
                .sort((a, b) => b.timestamp - a.timestamp);
            
            const newNotification = validNotifications.length > 0 ? validNotifications[0] : null;
            
            if (newNotification?.id !== this.currentNotification?.id) {
                this.currentNotification = newNotification;
                this.hasUnread = newNotification && !newNotification.read;
                
                // Refresh home page to show updated notification
                if (this.currentPage === 'home') {
                    this.renderHome('home-container');
                    this.attachHomeEventListeners();
                }
            }
        });
    }

    async markNotificationAsRead() {
        if (this.currentNotification && !this.currentNotification.read) {
            this.currentNotification.read = true;
            this.hasUnread = false;
            
            const authModule = window.authModule;
            if (this.currentNotification.id && 
                !this.currentNotification.id.startsWith('demo_') && 
                authModule && authModule.masterDB) {
                await authModule.masterDB.ref(`notifications/${this.currentNotification.id}/read`).set(true);
            }
            
            // Refresh home page
            if (this.currentPage === 'home') {
                this.renderHome('home-container');
                this.attachHomeEventListeners();
            }
        }
    }

    getTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
        
        return new Date(timestamp).toLocaleDateString();
    }

    getNotificationIcon(type) {
        const icons = {
            info: 'info',
            update: 'system_update',
            warning: 'warning',
            important: 'priority_high',
            download: 'download',
            security: 'security'
        };
        return icons[type] || 'notifications';
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getNotificationFooterHTML() {
        if (!this.currentNotification) {
            return `
                <div class="notification-footer-empty">
                    <span class="material-icons">notifications_off</span>
                    <div class="notification-empty-text">
                        <p>No new notifications</p>
                        <small>Check back later for updates</small>
                    </div>
                </div>
            `;
        }
        
        const timeAgo = this.getTimeAgo(this.currentNotification.timestamp);
        const icon = this.getNotificationIcon(this.currentNotification.type);
        const hasDownload = this.currentNotification.type === 'download' && this.currentNotification.downloadUrl;
        
        return `
            <div class="notification-footer-card ${!this.currentNotification.read ? 'unread' : ''}" 
                 data-id="${this.currentNotification.id}">
                <div class="notification-footer-icon ${this.currentNotification.type}">
                    <span class="material-icons">${icon}</span>
                </div>
                <div class="notification-footer-content">
                    <div class="notification-header">
                        <div class="notification-footer-title">
                            ${this.escapeHtml(this.currentNotification.title)}
                        </div>
                        <div class="notification-footer-time">
                            ${timeAgo}
                        </div>
                    </div>
                    <div class="notification-footer-message">
                        ${this.escapeHtml(this.currentNotification.message)}
                    </div>
                    ${hasDownload ? `
                        <div class="notification-footer-action">
                            <a href="${this.currentNotification.downloadUrl}" target="_blank" class="notification-footer-link">
                                <span class="material-icons">file_download</span>
                                Download
                            </a>
                        </div>
                    ` : ''}
                    ${this.currentNotification.url ? `
                        <div class="notification-footer-action">
                            <a href="${this.currentNotification.url}" target="_blank" class="notification-footer-link">
                                <span class="material-icons">open_in_new</span>
                                Learn More
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // ==================== CENTRALIZED TOAST NOTIFICATION SYSTEM ====================
    
    // Show toast message using bottom bar (renamed to avoid confusion with Firebase notifications)
    showToastMessage(message, type = 'success') {
        const toastBar = document.getElementById('bottomNotificationBar');
        const toastIcon = document.getElementById('notificationIcon');
        const toastText = document.getElementById('notificationText');
        
        if (!toastBar || !toastText) {
            return;
        }
        
        // Clear any existing timeout
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }
        
        // Remove existing exit animation class
        toastBar.classList.remove('notification-bar-exit');
        
        // Set icon based on toast type
        let iconName = 'info';
        let barClass = 'info';
        
        switch(type) {
            case 'success':
                iconName = 'check_circle';
                barClass = 'success';
                break;
            case 'error':
                iconName = 'error';
                barClass = 'error';
                break;
            case 'warning':
                iconName = 'warning';
                barClass = 'warning';
                break;
            case 'info':
                iconName = 'info';
                barClass = 'info';
                break;
            default:
                iconName = 'info';
                barClass = 'info';
        }
        
        // Set the icon and text
        if (toastIcon) toastIcon.textContent = iconName;
        toastText.textContent = message;
        
        // Set the appropriate class for styling
        toastBar.className = `bottom-notification-bar ${barClass}`;
        
        // Show the toast
        toastBar.style.display = 'flex';
        toastBar.classList.add('notification-bar-enter');
        
        // Auto-hide after 3 seconds
        this.toastTimeout = setTimeout(() => {
            toastBar.classList.remove('notification-bar-enter');
            toastBar.classList.add('notification-bar-exit');
            
            // Hide after animation completes
            setTimeout(() => {
                if (toastBar) {
                    toastBar.style.display = 'none';
                    toastBar.classList.remove('notification-bar-exit');
                }
            }, 300);
        }, 3000);
    }
    
    // Initialize toast notification bar (create if missing)
    initToastBar() {
        // Check if toast bar already exists
        if (document.getElementById('bottomNotificationBar')) {
            return;
        }
        
        // Create toast bar if it doesn't exist
        const toastBar = document.createElement('div');
        toastBar.id = 'bottomNotificationBar';
        toastBar.className = 'bottom-notification-bar';
        toastBar.style.display = 'none';
        toastBar.innerHTML = `
            <span class="material-icons" id="notificationIcon">info</span>
            <span class="bottom-notification-text" id="notificationText"></span>
        `;
        document.body.appendChild(toastBar);
    }
    
    // Helper method to get toast title based on type
    getToastTitle(type) {
        const titles = {
            'success': 'Success',
            'error': 'Error',
            'warning': 'Warning',
            'info': 'Info'
        };
        return titles[type] || 'Notification';
    }

    // Expose toast methods globally for other modules to use
    getGlobalToastMethods() {
        return {
            showToast: this.showToastMessage.bind(this),
            initToastBar: this.initToastBar.bind(this),
            getToastTitle: this.getToastTitle.bind(this)
        };
    }

    // ==================== AUTHENTICATION SECTION METHODS ====================
    
    showVaultConfirmation() {
        this.showAuthSection = true;
        this.showLogoutSection = false;
        this.renderHome('home-container');
        this.attachHomeEventListeners();
        
        setTimeout(() => {
            const passwordInput = document.getElementById('vaultPassword');
            if (passwordInput) {
                passwordInput.focus();
            }
        }, 100);
    }
    
    hideVaultConfirmation() {
        this.showAuthSection = false;
        this.renderHome('home-container');
        this.attachHomeEventListeners();
    }
    
    showLogoutConfirmation() {
        this.showLogoutSection = true;
        this.showAuthSection = false;
        this.renderHome('home-container');
        this.attachHomeEventListeners();
        
        setTimeout(() => {
            const confirmInput = document.getElementById('logoutConfirmText');
            if (confirmInput) {
                confirmInput.focus();
            }
        }, 100);
    }
    
    hideLogoutConfirmation() {
        this.showLogoutSection = false;
        this.renderHome('home-container');
        this.attachHomeEventListeners();
    }
    
    async verifyPassword() {
        const passwordInput = document.getElementById('vaultPassword');
        const errorDiv = document.getElementById('vaultError');
        const verifyBtn = document.getElementById('verifyVault');
        
        const password = passwordInput?.value || '';
        
        if (!password) {
            if (errorDiv) {
                errorDiv.textContent = 'Please enter your account password';
                errorDiv.classList.remove('hidden');
            }
            return;
        }
        
        try {
            if (verifyBtn) {
                verifyBtn.disabled = true;
                verifyBtn.innerHTML = 'Verifying...';
            }
            
            const authModule = window.authModule;
            if (!authModule || !authModule.currentUser) {
                throw new Error('User not logged in');
            }
            
            const userEmail = authModule.currentUser.email;
            const encodedEmail = authModule.encodeEmail(userEmail);
            const masterDB = authModule.masterDB;
            
            const userSnapshot = await masterDB.ref(`users/${encodedEmail}`).once('value');
            
            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }
            
            const userData = userSnapshot.val();
            
            if (userData.password !== password) {
                throw new Error('Incorrect password. Please try again.');
            }
            
            this.secureVaultUnlocked = true;
            this.hideVaultConfirmation();
            
            if (this.pendingSecureModule) {
                this.navigateToModule(this.pendingSecureModule);
                this.pendingSecureModule = null;
            }
            
            this.showToast('Vault unlocked successfully!');
            
            if (this.currentPage === 'home') {
                this.renderHome('home-container');
                this.attachHomeEventListeners();
            }
            
        } catch (error) {
            console.error('Password verification error:', error);
            if (errorDiv) {
                errorDiv.textContent = error.message || 'Verification failed. Please try again.';
                errorDiv.classList.remove('hidden');
            }
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.focus();
                passwordInput.classList.add('shake-animation');
                setTimeout(() => {
                    passwordInput.classList.remove('shake-animation');
                }, 500);
            }
        } finally {
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = '<span class="material-icons">lock_open</span> Unlock';
            }
        }
    }
    
    async performLogout() {
        const confirmInput = document.getElementById('logoutConfirmText');
        const errorDiv = document.getElementById('logoutError');
        const logoutBtn = document.getElementById('confirmLogoutBtn');
        
        const confirmationText = confirmInput?.value || '';
        
        if (!confirmationText) {
            if (errorDiv) {
                errorDiv.textContent = 'Please type "LOGOUT" to confirm';
                errorDiv.classList.remove('hidden');
            }
            return;
        }
        
        if (confirmationText !== 'LOGOUT') {
            if (errorDiv) {
                errorDiv.textContent = 'Please type "LOGOUT" exactly to confirm logout';
                errorDiv.classList.remove('hidden');
            }
            if (confirmInput) {
                confirmInput.value = '';
                confirmInput.focus();
                confirmInput.classList.add('shake-animation');
                setTimeout(() => {
                    confirmInput.classList.remove('shake-animation');
                }, 500);
            }
            return;
        }
        
        try {
            if (logoutBtn) {
                logoutBtn.disabled = true;
                logoutBtn.innerHTML = 'Logging out...';
            }
            
            if (this.notificationListener && window.authModule && window.authModule.masterDB) {
                window.authModule.masterDB.ref('notifications').off('value', this.notificationListener);
                this.notificationListener = null;
            }
            
            this.lockSecureVault();
            this.currentUser = null;
            this.userData = null;
            this.currentNotification = null;
            this.hasUnread = false;
            
            localStorage.removeItem('currentUser');
            
            if (window.authModule && window.authModule.logout) {
                await window.authModule.logout();
            }
            
            this.hideLogoutConfirmation();
            this.showAuthSection = true;
            this.showToast('Logged out successfully!');
            this.redirectToLogin();
            
        } catch (error) {
            console.error('Logout error:', error);
            if (errorDiv) {
                errorDiv.textContent = error.message || 'Logout failed. Please try again.';
                errorDiv.classList.remove('hidden');
            }
        } finally {
            if (logoutBtn) {
                logoutBtn.disabled = false;
                logoutBtn.innerHTML = '<span class="material-icons">logout</span> Confirm Logout';
            }
        }
    }
    
    redirectToLogin() {
        window.dispatchEvent(new CustomEvent('authLogout'));
        
        if (window.authModule && window.authModule.showLogin) {
            window.authModule.showLogin();
        } else {
            window.location.reload();
        }
    }

    lockSecureVault() {
        this.secureVaultUnlocked = false;
        
        if (this.currentPage === 'home') {
            this.renderHome('home-container');
            this.attachHomeEventListeners();
        }
    }

    // ==================== USER DATA METHODS ====================
    async loadUserData() {
        try {
            if (window.authModule && window.authModule.isAuthenticated) {
                this.currentUser = window.authModule.currentUser;
                this.updateUserAvatar();
                return true;
            }
            const userDataStr = localStorage.getItem('currentUser');
            if (userDataStr) {
                this.currentUser = JSON.parse(userDataStr);
                this.updateUserAvatar();
                await this.loadAdditionalUserData();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading user data:', error);
            return false;
        }
    }

    async loadAdditionalUserData() {
        this.userData = this.currentUser;
    }

    updateUserAvatar() {
        const userAvatar = document.getElementById('userAvatar');
        const userNameShort = document.getElementById('userNameShort');
        
        if (this.currentUser && this.currentUser.name) {
            if (userAvatar) userAvatar.style.display = 'flex';
            if (userNameShort) {
                const initials = this.currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
                userNameShort.textContent = initials;
            }
        } else if (userAvatar) {
            userAvatar.style.display = 'none';
        }
    }

    // ==================== EVENT LISTENERS ====================
    setupEventListeners() {
        document.querySelectorAll('.navbar-menu .menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleMenuItemClick(item);
            });
        });

        const appLogo = document.getElementById('appLogo');
        if (appLogo) {
            appLogo.addEventListener('click', (e) => {
                e.preventDefault();
                const homeMenuItem = document.querySelector('.navbar-menu .menu-item[data-page="home"]');
                if (homeMenuItem) this.handleMenuItemClick(homeMenuItem);
                else this.showPage('home-page');
            });
        }

        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        window.addEventListener('authLogout', () => {
            this.lockSecureVault();
            this.currentUser = null;
            this.userData = null;
            this.currentNotification = null;
            this.hasUnread = false;
            this.updateUserAvatar();
        });
        
        window.addEventListener('authSuccess', (event) => {
            if (event.detail && event.detail.user) {
                this.currentUser = event.detail.user;
                this.updateUserAvatar();
                this.initNotifications();
                
                // Force home page to render after login
                setTimeout(() => {
                    // Show home page
                    this.showPage('home-page');
                    
                    // Set active menu item to home (if exists)
                    const homeMenuItem = document.querySelector('.navbar-menu .menu-item[data-page="home"]');
                    if (homeMenuItem) {
                        this.setActiveMenuItem(homeMenuItem);
                    } else {
                        // If no home menu item, just render home
                        this.renderHome('home-container');
                    }
                    
                    // Update URL hash
                    window.location.hash = 'home';
                }, 100);
            }
        });
    }

    handleMenuItemClick(item) {
        const page = item.getAttribute('data-page');
        if (page) {
            if (this.secureModules.includes(page)) {
                if (!this.secureVaultUnlocked) {
                    this.pendingSecureModule = page;
                    // Navigate to home page first to show the vault unlock section
                    this.showPage('home-page');
                    // Set active menu item to home
                    const homeMenuItem = document.querySelector('.navbar-menu .menu-item[data-page="home"]');
                    if (homeMenuItem) this.setActiveMenuItem(homeMenuItem);
                    // Show vault confirmation after a short delay to ensure home page is rendered
                    setTimeout(() => {
                        this.showVaultConfirmation();
                    }, 100);
                    return;
                }
            }
            
            this.setActiveMenuItem(item);
            this.showPage(`${page}-page`);
        }
    }

    setActiveMenuItem(activeItem) {
        document.querySelectorAll('.navbar-menu .menu-item').forEach(item => {
            item.classList.remove('active');
        });
        activeItem.classList.add('active');
    }

    // ==================== PAGE NAVIGATION ====================
    showPage(pageId) {
        document.querySelectorAll('.page-section').forEach(page => {
            page.classList.remove('active');
        });
        const activePage = document.getElementById(pageId);
        if (activePage) {
            activePage.classList.add('active');
            this.currentPage = pageId.replace('-page', '');
            setTimeout(() => this.initializePageModule(pageId), 10);
            this.updateBrowserHistory();
        }
    }

    initializePageModule(pageId) {
        switch(pageId) {
            case 'home-page':
                this.renderHome('home-container');
                break;
            case 'photos-page':
                if (typeof photosModule !== 'undefined') photosModule.render('photos-container');
                break;
            case 'notes-page':
                if (typeof notesModule !== 'undefined') notesModule.render('notes-container');
                break;
            case 'credentials-page':
                if (typeof credentialManager !== 'undefined') credentialManager.render('credentials-container');
                break;
            case 'emoji-art-page':
                if (typeof emojiArtModule !== 'undefined') emojiArtModule.render('emoji-art-container');
                break;
            case 'text-repeater-page':
                if (typeof textRepeaterModule !== 'undefined') textRepeaterModule.render('text-repeater-container');
                break;
            case 'settings-page':
                if (typeof settingsModule !== 'undefined') {
                    if (this.currentUser) settingsModule.setUserData(this.currentUser);
                    settingsModule.render('settings-container');
                }
                break;
            case 'share-page':
                if (typeof shareModule !== 'undefined') shareModule.render('share-container');
                break;
        }
    }

    updateBrowserHistory() {
        const state = { page: this.currentPage };
        const url = `#${this.currentPage}`;
        window.history.pushState(state, '', url);
    }

    updateActivePage() {
        const hash = window.location.hash.substring(1);
        const page = hash || 'home';
        const menuItem = document.querySelector(`.navbar-menu .menu-item[data-page="${page}"]`);
        if (menuItem) {
            this.setActiveMenuItem(menuItem);
            this.showPage(`${page}-page`);
        }
    }

    // ==================== HOME MODULE METHODS ====================
    renderHome(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = this.getHomeHTML();
        this.attachHomeEventListeners();
    }

    getHomeHTML() {
        const secureModules = this.modules.filter(m => m.category === 'secure');
        const generalModules = this.modules.filter(m => m.category === 'general');
        
        const showAuthSectionHTML = this.showAuthSection && !this.secureVaultUnlocked ? `
            <div class="authentication-section vault-confirmation">
                <div class="section-header secure">
                    <span class="material-icons">lock</span>
                    <h3>Secure Vault Access</h3>
                    <button class="close-btn" id="closeVault">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                
                <div class="section-body">
                    <p>Enter your account password to access secure modules</p>
                    <div class="form-group">
                        <label class="form-label">Account Password</label>
                        <div class="password-input-group">
                            <input type="password" id="vaultPassword" class="form-input" 
                                placeholder="Enter your account password" autocomplete="current-password">
                        </div>
                    </div>
                    <div id="vaultError" class="error-message hidden"></div>
                </div>
                <div class="section-actions">
                    <a id="showLogoutFromAuth" class="btn-link">Forgot Password?</a>
                    <div class="btn-group">
                        <button class="btn btn-secondary" id="cancelVault">Cancel</button>
                        <button class="btn btn-warning" id="verifyVault">
                            <i class="fas fa-lock-open"></i> Unlock
                        </button>
                    </div>
                </div>
            </div>
        ` : '';
        
        const showLogoutSectionHTML = this.showLogoutSection ? `
            <div class="logout-section vault-confirmation">
                <div class="section-header secure">
                    <span class="material-icons">warning</span>
                    <h3>Logout Confirmation</h3>
                    <button class="close-btn" id="closeLogoutSection">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                <div class="section-body">
                    <p>Type <strong>"LOGOUT"</strong> below to confirm you want to log out of your account.</p>
                    <div class="form-group">
                        <label class="form-label">Confirmation</label>
                        <div class="password-input-group">
                            <input type="text" id="logoutConfirmText" class="form-input" 
                                placeholder="Type LOGOUT to confirm" autocomplete="off">
                        </div>
                    </div>
                    <div id="logoutError" class="error-message hidden"></div>
                </div>
                <div class="section-actions">
                    <div class="btn-group">
                        <button class="btn btn-secondary" id="cancelLogoutSection">
                            Cancel
                        </button>
                        <button class="btn btn-warning" id="confirmLogoutBtn">
                            <i class="fas fa-right-from-bracket"></i> Confirm Logout
                        </button>
                    </div>
                </div>
            </div>
        ` : '';
        
        return `
            <div class="home-modern">
                <div class="welcome-section">
                    <div class="welcome-content">
                        <h1>Welcome back, ${this.currentUser?.name?.split(' ')[0] || 'User'}!</h1>
                        <p>Your secure digital vault is ready</p>
                    </div>
                    <div class="welcome-actions">
                        <button class="vault-toggle-btn ${this.secureVaultUnlocked ? 'unlocked' : 'locked'}" id="toggleVaultLock">
                            <span class="material-icons">
                                ${this.secureVaultUnlocked ? 'lock_open' : 'lock'}
                            </span>
                        </button>
                    </div>
                </div>

                ${showAuthSectionHTML}
                ${showLogoutSectionHTML}

                <div class="modules-section secure-section">
                    <div class="section-header secure">
                        <span class="material-icons">lock</span>
                        <h3>Secure Vault</h3>
                        <span class="section-badge">${this.secureVaultUnlocked ? 'Unlocked' : 'Locked - Need Password'}</span>
                    </div>
                    
                    <div class="modules-grid secure-grid">
                        ${secureModules.map(m => `
                            <div class="module-card secure-card" data-module="${m.id}" data-category="secure">
                                <div class="module-icon ${m.color}">
                                    <span class="material-icons">${this.secureVaultUnlocked ? m.icon : 'lock'}</span>
                                </div>
                                <div class="module-info">
                                    <div class="module-title">${m.name}</div>
                                    <div class="module-description">${this.secureVaultUnlocked ? m.description : 'Locked'}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="modules-section general-section">
                    <div class="section-header general">
                        <span class="material-icons">apps</span>
                        <h3>General Tools</h3>
                        <span class="section-badge">Always Accessible</span>
                    </div>
                    <div class="modules-grid general-grid">
                        ${generalModules.map(m => `
                            <div class="module-card general-card" data-module="${m.id}" data-category="general">
                                <div class="module-icon ${m.color}">
                                    <span class="material-icons">${m.icon}</span>
                                </div>
                                <div class="module-info">
                                    <div class="module-title">${m.name}</div>
                                    <div class="module-description">${m.description}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Footer Section with Quick Stats & Notifications -->
                <div class="home-footer-section">
                    <!-- Notification Section -->
                    <div class="notification-footer-section">
                        <div class="notification-footer-header" id="notificationFooterHeader">
                            <div class="notification-footer-title-section">
                                <span class="material-icons">notifications</span>
                                <h4>Latest Update</h4>
                                ${this.hasUnread ? '<span class="notification-footer-badge">New</span>' : ''}
                            </div>
                        </div>
                        <div class="notification-footer-content-panel" id="notificationFooterPanel">
                            ${this.getNotificationFooterHTML()}
                        </div>
                    </div>

                    <!-- APK Download Footer Section -->
                    <div class="apk-footer-section">
                        <div class="apk-footer-content">
                            <div class="apk-info">
                                <span class="material-icons">android</span>
                                <div class="apk-text">
                                    <h4>xDrive Mobile App</h4>
                                    <p>Secure sharing • End-to-end encryption • Self-destructing content</p>
                                </div>
                            </div>
                            <a href="https://xdrives.github.io/web/xDrive.apk" id="homeApkDownloadLink" class="apk-download-btn" download>
                                <span class="material-icons">download</span> Download
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    attachHomeEventListeners() {
        // Module card clicks
        document.querySelectorAll('.module-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.lock-overlay')) return;
                
                const moduleId = card.getAttribute('data-module');
                const category = card.getAttribute('data-category');
                
                if (category === 'secure' && !this.secureVaultUnlocked) {
                    this.pendingSecureModule = moduleId;
                    this.showVaultConfirmation();
                } else {
                    this.navigateToModule(moduleId);
                }
            });
        });
        
        // Toggle vault lock button
        const toggleBtn = document.getElementById('toggleVaultLock');
        if (toggleBtn) {
            const newToggleBtn = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);
            
            newToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.secureVaultUnlocked) {
                    this.lockSecureVault();
                } else {
                    this.showVaultConfirmation();
                }
            });
        }
        
        // Close vault button
        const closeVault = document.getElementById('closeVault');
        if (closeVault) {
            const newCloseBtn = closeVault.cloneNode(true);
            closeVault.parentNode.replaceChild(newCloseBtn, closeVault);
            newCloseBtn.addEventListener('click', () => {
                this.hideVaultConfirmation();
            });
        }
        
        // Cancel vault button
        const cancelVault = document.getElementById('cancelVault');
        if (cancelVault) {
            const newCancelBtn = cancelVault.cloneNode(true);
            cancelVault.parentNode.replaceChild(newCancelBtn, cancelVault);
            newCancelBtn.addEventListener('click', () => {
                this.hideVaultConfirmation();
            });
        }
        
        // Show logout from auth section
        const showLogoutFromAuth = document.getElementById('showLogoutFromAuth');
        if (showLogoutFromAuth) {
            const newLogoutBtn = showLogoutFromAuth.cloneNode(true);
            showLogoutFromAuth.parentNode.replaceChild(newLogoutBtn, showLogoutFromAuth);
            newLogoutBtn.addEventListener('click', () => {
                this.showLogoutConfirmation();
            });
        }
        
        // Close logout section
        const closeLogoutSection = document.getElementById('closeLogoutSection');
        if (closeLogoutSection) {
            const newCloseLogout = closeLogoutSection.cloneNode(true);
            closeLogoutSection.parentNode.replaceChild(newCloseLogout, closeLogoutSection);
            newCloseLogout.addEventListener('click', () => {
                this.hideLogoutConfirmation();
            });
        }
        
        // Cancel logout section
        const cancelLogoutSection = document.getElementById('cancelLogoutSection');
        if (cancelLogoutSection) {
            const newCancelLogout = cancelLogoutSection.cloneNode(true);
            cancelLogoutSection.parentNode.replaceChild(newCancelLogout, cancelLogoutSection);
            newCancelLogout.addEventListener('click', () => {
                this.hideLogoutConfirmation();
            });
        }
        
        // Confirm logout button
        const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
        if (confirmLogoutBtn) {
            const newConfirmBtn = confirmLogoutBtn.cloneNode(true);
            confirmLogoutBtn.parentNode.replaceChild(newConfirmBtn, confirmLogoutBtn);
            newConfirmBtn.addEventListener('click', () => {
                this.performLogout();
            });
        }
        
        // Verify vault button
        const verifyVault = document.getElementById('verifyVault');
        if (verifyVault) {
            const newVerifyBtn = verifyVault.cloneNode(true);
            verifyVault.parentNode.replaceChild(newVerifyBtn, verifyVault);
            newVerifyBtn.addEventListener('click', () => {
                this.verifyPassword();
            });
        }
        
        // Enter key on password input
        const passwordInput = document.getElementById('vaultPassword');
        if (passwordInput) {
            const newPasswordInput = passwordInput.cloneNode(true);
            passwordInput.parentNode.replaceChild(newPasswordInput, passwordInput);
            newPasswordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.verifyPassword();
                }
            });
        }
        
        // Enter key on logout confirm input
        const logoutConfirmInput = document.getElementById('logoutConfirmText');
        if (logoutConfirmInput) {
            const newLogoutInput = logoutConfirmInput.cloneNode(true);
            logoutConfirmInput.parentNode.replaceChild(newLogoutInput, logoutConfirmInput);
            newLogoutInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performLogout();
                }
            });
        }

        // APK Download Button Handler with tracking
        const apkDownloadBtn = document.getElementById('homeApkDownloadLink');
        if (apkDownloadBtn) {
            apkDownloadBtn.addEventListener('click', (e) => {
                this.showToastMessage('Downloading xDrive APK...', 'info');
                // You can add analytics tracking here if needed
            });
        }
    }

    navigateToModule(moduleId) {
        const isSecure = this.secureModules.includes(moduleId);
        
        if (isSecure && !this.secureVaultUnlocked) {
            this.pendingSecureModule = moduleId;
            this.showPage('home-page');
            setTimeout(() => {
                this.showVaultConfirmation();
            }, 100);
            return;
        }
        
        const menuItem = document.querySelector(`.navbar-menu .menu-item[data-page="${moduleId}"]`);
        if (menuItem) menuItem.click();
        else window.location.hash = moduleId;
        this.showToast(`Opening ${this.getModuleName(moduleId)}...`);
    }

    getModuleName(moduleId) {
        const module = this.modules.find(m => m.id === moduleId);
        return module ? module.name : moduleId.charAt(0).toUpperCase() + moduleId.slice(1);
    }

    showToast(message) {
        const existingToast = document.querySelector('.home-toast');
        if (existingToast) existingToast.remove();
        const toast = document.createElement('div');
        toast.className = 'home-toast';
        toast.innerHTML = `<span class="material-icons">info</span><span>${message}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 1700);
    }

    handleKeyboard(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
            e.preventDefault();
            const navbar = document.getElementById('topNavbar');
            if (navbar) {
                navbar.style.display = navbar.style.display === 'none' ? 'flex' : 'none';
                const mainContent = document.querySelector('.main-content');
                if (mainContent) mainContent.style.marginTop = navbar.style.display === 'none' ? '0' : '56px';
            }
        }
        
        if (e.key === 'Escape') {
            if (this.showLogoutSection) {
                this.hideLogoutConfirmation();
            } else if (this.showAuthSection && !this.secureVaultUnlocked) {
                this.hideVaultConfirmation();
            }
        }
    }
}

// ==================== INITIALIZE APP ====================
let xDrive;

document.addEventListener('DOMContentLoaded', function() {
    const checkAuthReady = setInterval(() => {
        if (window.authModule) {
            clearInterval(checkAuthReady);
            if (window.dataManager) window.dataManager.init(window.authModule);
            xDrive = new xDriveApp();
            window.xDrive = xDrive;
        }
    }, 100);
});

window.addEventListener('popstate', function(event) {
    if (event.state && event.state.page && window.xDrive) {
        window.xDrive.showPage(`${event.state.page}-page`);
        const menuItem = document.querySelector(`.navbar-menu .menu-item[data-page="${event.state.page}"]`);
        if (menuItem) window.xDrive.setActiveMenuItem(menuItem);
    }
});

// Global toast notification accessor for other modules
// This is separate from Firebase notifications (initNotifications, loadLatestNotification, etc.)
window.toastManager = {
    show: (message, type = 'info') => {
        if (window.xDrive && window.xDrive.showToastMessage) {
            window.xDrive.showToastMessage(message, type);
        }
    },
    init: () => {
        if (window.xDrive && window.xDrive.initToastBar) {
            window.xDrive.initToastBar();
        }
    },
    getTitle: (type) => {
        if (window.xDrive && window.xDrive.getToastTitle) {
            return window.xDrive.getToastTitle(type);
        }
        return 'Notification';
    }
};

// Initialize toast manager when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.toastManager.init();
    });
} else {
    window.toastManager.init();
}