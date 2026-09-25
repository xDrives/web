// ==================== XDRIVE APP - FILE LIBRARY + NOTES + CREDS + SETTINGS ====================
class xDriveApp {
    constructor() {
        this.currentPage = 'home';
        this.currentUser = null;
        this.userData = null;

        // Notification properties
        this.currentNotification = null;
        this.hasUnread = false;
        this.notificationListener = null;

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
            const authManager = window.authDataManager;
            if (authManager && authManager.isLoggedIn && authManager.isLoggedIn()) {
                this.currentUser = authManager.getUser();
                await this.loadLatestNotification();
                this.setupNotificationListener();
            }
        } catch (error) {
            console.error('Error initializing notifications:', error);
        }
    }

    encodePhone(phone) {
        const cleaned = phone.replace(/[^\d+]/g, '');
        return cleaned.replace(/\./g, ',').replace(/@/g, '-at-');
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

            const encodedPhone = this.encodePhone(this.currentUser.phone);
            return recipients.includes(this.currentUser.phone) ||
                   recipients.includes(encodedPhone);
        }

        return false;
    }

    async loadLatestNotification() {
        try {
            const authManager = window.authDataManager;
            if (!authManager || !authManager.getDatabase() || !this.currentUser) return;

            const db = authManager.getDatabase();
            const snapshot = await db.ref('notifications').once('value');

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
        const authManager = window.authDataManager;
        if (!authManager || !authManager.getDatabase()) return;

        const db = authManager.getDatabase();

        if (this.notificationListener) {
            db.ref('notifications').off('value', this.notificationListener);
        }

        this.notificationListener = db.ref('notifications').on('value', (snapshot) => {
            if (!snapshot.exists()) {
                if (this.currentNotification !== null) {
                    this.currentNotification = null;
                    this.hasUnread = false;
                    if (this.currentPage === 'home') {
                        this.renderHome('home-container');
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

                if (this.currentPage === 'home') {
                    this.renderHome('home-container');
                }
            }
        });
    }

    async markNotificationAsRead() {
        if (this.currentNotification && !this.currentNotification.read) {
            this.currentNotification.read = true;
            this.hasUnread = false;

            const authManager = window.authDataManager;
            if (this.currentNotification.id &&
                !this.currentNotification.id.startsWith('demo_') &&
                authManager && authManager.getDatabase()) {
                await authManager.getDatabase().ref(`notifications/${this.currentNotification.id}/read`).set(true);
            }

            if (this.currentPage === 'home') {
                this.renderHome('home-container');
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

    // ==================== TOAST NOTIFICATION SYSTEM ====================
    showToastMessage(message, type = 'success') {
        const toastBar = document.getElementById('bottomNotificationBar');
        const toastIcon = document.getElementById('notificationIcon');
        const toastText = document.getElementById('notificationText');

        if (!toastBar || !toastText) return;

        if (this.toastTimeout) clearTimeout(this.toastTimeout);

        toastBar.classList.remove('notification-bar-exit');

        let iconName = 'info';
        let barClass = 'info';

        switch(type) {
            case 'success': iconName = 'check_circle'; barClass = 'success'; break;
            case 'error':   iconName = 'error';        barClass = 'error';   break;
            case 'warning': iconName = 'warning';      barClass = 'warning'; break;
            case 'info':    iconName = 'info';         barClass = 'info';    break;
            default:        iconName = 'info';         barClass = 'info';
        }

        if (toastIcon) toastIcon.textContent = iconName;
        toastText.textContent = message;

        toastBar.className = `bottom-notification-bar ${barClass}`;
        toastBar.style.display = 'flex';
        toastBar.classList.add('notification-bar-enter');

        this.toastTimeout = setTimeout(() => {
            toastBar.classList.remove('notification-bar-enter');
            toastBar.classList.add('notification-bar-exit');
            setTimeout(() => {
                if (toastBar) {
                    toastBar.style.display = 'none';
                    toastBar.classList.remove('notification-bar-exit');
                }
            }, 300);
        }, 3000);
    }

    initToastBar() {
        if (document.getElementById('bottomNotificationBar')) return;

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

    getToastTitle(type) {
        const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };
        return titles[type] || 'Notification';
    }

    getGlobalToastMethods() {
        return {
            showToast: this.showToastMessage.bind(this),
            initToastBar: this.initToastBar.bind(this),
            getToastTitle: this.getToastTitle.bind(this)
        };
    }

    // ==================== LOGOUT ====================
    async performLogout() {
        try {
            if (this.notificationListener && window.authDataManager && window.authDataManager.getDatabase()) {
                window.authDataManager.getDatabase().ref('notifications').off('value', this.notificationListener);
                this.notificationListener = null;
            }

            this.currentUser = null;
            this.userData = null;
            this.currentNotification = null;
            this.hasUnread = false;

            localStorage.removeItem('currentUser');

            if (window.authDataManager && window.authDataManager.logout) {
                await window.authDataManager.logout();
            }

            this.showToastMessage('Logged out successfully!');
            this.redirectToLogin();
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    redirectToLogin() {
        window.dispatchEvent(new CustomEvent('authLogout'));
        if (window.authDataManager && window.authDataManager.showAuthUI) {
            window.authDataManager.showAuthUI();
        } else {
            window.location.reload();
        }
    }

    // ==================== USER DATA ====================
    async loadUserData() {
        try {
            if (window.authDataManager && window.authDataManager.isAuthenticated) {
                this.currentUser = window.authDataManager.currentUser;
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
                const homeItem = document.querySelector('.navbar-menu .menu-item[data-page="home"]');
                if (homeItem) this.setActiveMenuItem(homeItem);
                this.showPage('home-page');
            });
        }

        window.addEventListener('authLogout', () => {
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

                setTimeout(() => {
                    const homeItem = document.querySelector('.navbar-menu .menu-item[data-page="home"]');
                    if (homeItem) this.setActiveMenuItem(homeItem);
                    this.showPage('home-page');
                    window.location.hash = 'home';
                }, 100);
            }
        });
    }

    handleMenuItemClick(item) {
        const page = item.getAttribute('data-page');
        if (page) {
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
                if (window.fileLibraryModule) {
                    window.fileLibraryModule.render('home-file-library-container');
                }
                break;
            case 'settings-page':
                if (typeof settingsModule !== 'undefined') {
                    if (this.currentUser) settingsModule.setUserData(this.currentUser);
                    settingsModule.render('settings-container');
                }
                break;
        }
    }

    updateBrowserHistory() {
        const state = { page: this.currentPage };
        window.history.pushState(state, '', `#${this.currentPage}`);
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

    // ==================== HOME (File Library) ====================
    renderHome(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = this.getHomeHTML();
        this.attachHomeEventListeners();
    }

    getHomeHTML() {
        return `
            <div class="home-modern">
                <div id="home-file-library-container"></div>
            </div>
        `;
    }

    attachHomeEventListeners() {
        // File Library renders itself
    }

    navigateToModule(moduleId) {
        const menuItem = document.querySelector(`.navbar-menu .menu-item[data-page="${moduleId}"]`);
        if (menuItem) menuItem.click();
        else window.location.hash = moduleId;
    }

    showToast(message) {
        this.showToastMessage(message, 'info');
    }
}

// ==================== INITIALIZE ====================
let xDrive;

document.addEventListener('DOMContentLoaded', function() {
    const checkAuthReady = setInterval(() => {
        if (window.authDataManager) {
            clearInterval(checkAuthReady);
            if (window.dataManager) window.dataManager.init(window.authDataManager);
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

// Global toast accessor
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.toastManager.init());
} else {
    window.toastManager.init();
}