// Enhanced Settings Module with Email Change Functionality
class SettingsModule {
    // ========== 1. CONSTRUCTOR & PROPERTIES ==========
    constructor() {
        this.currentSection = 'profile';
        this.userData = null;
        this.encodedEmail = null;
    }

    // ========== 2. INITIALIZATION ==========
    async initSettings() {
        try {
            const authModule = window.authModule;
            
            if (authModule && authModule.isAuthenticated) {
                this.userData = authModule.currentUser;
                this.encodedEmail = this.encodeEmail(this.userData.email);
                this.masterDB = authModule.masterDB;
                
                console.log('Settings module initialized with auth module data');
            } else {
                this.loadUserDataFromStorage();
                
                if (authModule && authModule.masterDB) {
                    this.masterDB = authModule.masterDB;
                } else {
                    const masterDBConfig = localStorage.getItem('masterDBConfig');
                    if (masterDBConfig) {
                        const config = JSON.parse(masterDBConfig);
                        try {
                            const masterApp = firebase.initializeApp(
                                { databaseURL: config.databaseURL }, 
                                "settingsMaster"
                            );
                            this.masterDB = masterApp.database();
                        } catch (error) {
                            this.masterDB = firebase.apps[0]?.database();
                        }
                    }
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error initializing settings module:', error);
            return false;
        }
    }

    // Add helper method to ensure navbar shows correct active state
    ensureNavbarActiveState() {
        if (window.xDrive && window.xDrive.currentPage) {
            const activePage = window.xDrive.currentPage;
            const menuItem = document.querySelector(`.navbar-menu .menu-item[data-page="${activePage}"]`);
            if (menuItem && window.xDrive.setActiveMenuItem) {
                window.xDrive.setActiveMenuItem(menuItem);
            }
        }
    }

    // ========== 3. PASSWORD STRENGTH UTILITIES ==========
    updatePasswordStrength(password) {
        if (!password) {
            return { strength: 0, text: 'None', color: 'var(--danger)', width: '0%' };
        }
        
        let strength = 0;
        
        if (password.length >= 4) strength += 20;
        if (password.length >= 6) strength += 20;
        if (password.length >= 8) strength += 20;
        
        if (/[a-z]/.test(password)) strength += 10;
        if (/[A-Z]/.test(password)) strength += 10;
        if (/\d/.test(password)) strength += 10;
        if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strength += 10;
        
        strength = Math.min(strength, 100);
        
        let text, color;
        if (strength < 30) {
            text = 'Weak';
            color = 'var(--danger)';
        } else if (strength < 70) {
            text = 'Fair';
            color = 'var(--warning)';
        } else {
            text = 'Strong';
            color = 'var(--success)';
        }
        
        return { strength, text, color, width: `${strength}%` };
    }

    checkPasswordStrength(password) {
        const hasEnoughLength = password.length >= 8;
        const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
        
        const strengthScore = [hasEnoughLength, hasMixedCase, hasNumbers, hasSpecial].filter(Boolean).length;
        return strengthScore >= 3;
    }

    setupPasswordVisibilityToggles(container) {
        const toggleButtons = container.querySelectorAll('.toggle-password-btn, .toggle-password-visibility');
        
        toggleButtons.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const targetId = newBtn.getAttribute('data-target');
                let input = targetId ? document.getElementById(targetId) : null;
                
                if (!input) {
                    input = newBtn.closest('.password-input-group')?.querySelector('input');
                    if (!input) {
                        input = newBtn.parentElement?.querySelector('input');
                    }
                }
                
                if (input) {
                    const icon = newBtn.querySelector('.material-icons');
                    if (input.type === 'password') {
                        input.type = 'text';
                        if (icon) icon.textContent = 'visibility_off';
                    } else {
                        input.type = 'password';
                        if (icon) icon.textContent = 'visibility';
                    }
                }
            });
        });
    }

    // Set user data
    setUserData(userData) {
        this.userData = userData;
        if (userData?.email && window.dataManager) {
            this.encodedEmail = window.dataManager.encodeEmail(userData.email);
        }
        console.log('User data set in settings module');
    }

    // ========== 4. LOAD USER DATA FROM STORAGE ==========
    loadUserDataFromStorage() {
        try {
            const userDataStr = localStorage.getItem('currentUser');
            if (userDataStr) {
                this.userData = JSON.parse(userDataStr);
                if (this.userData?.email) {
                    this.encodedEmail = this.encodeEmail(this.userData.email);
                    this.userHomeDatabaseUrl = this.userData.homeDatabaseUrl || 
                                            localStorage.getItem('userHomeDatabaseUrl');
                    this.userHomeDatabase = this.extractDbNameFromUrl(this.userHomeDatabaseUrl);
                }
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    // ========== 5. INITIALIZE DATABASE ==========
    async initFirebase() {
        try {
            console.log('Initializing Firebase for Settings Module...');
            
            if (window.dataManager && window.dataManager.isAuthenticated()) {
                this.currentUser = window.dataManager.currentUser;
                this.encodedEmail = window.dataManager.encodedEmail;
                
                if (window.authModule && window.authModule.isLoggedIn()) {
                    const authUser = window.authModule.getUser();
                    this.userHomeDatabaseUrl = authUser.homeDatabaseUrl || 
                                            localStorage.getItem('userHomeDatabaseUrl');
                    
                    if (this.userHomeDatabaseUrl) {
                        this.userHomeDatabase = this.extractDbNameFromUrl(this.userHomeDatabaseUrl);
                    }
                }
                
                console.log('Settings module initialized via DataManager');
                return;
            }
            
            this.loadUserDataFromStorage();
            
            const masterDBConfig = localStorage.getItem('masterDBConfig');
            if (masterDBConfig && !this.masterDB) {
                const config = JSON.parse(masterDBConfig);
                try {
                    const masterApp = firebase.initializeApp(
                        { databaseURL: config.databaseURL }, 
                        "settingsMaster"
                    );
                    this.masterDB = masterApp.database();
                } catch (error) {
                    this.masterDB = firebase.apps[0]?.database();
                }
            }
            
        } catch (error) {
            console.error('Error initializing Firebase in settings:', error);
        }
    }

    async fetchDbApps() {
        try {
            const snapshot = await this.masterDB.ref('databases').get();
            const configsObj = snapshot.exists() ? snapshot.val() : {};
            const configs = Object.values(configsObj);

            this.dbApps = [];

            for (let i = 0; i < configs.length; i++) {
                const cfg = configs[i];
                if (!cfg.active) continue;

                try {
                    const app = firebase.initializeApp({ databaseURL: cfg.url }, "settingsApp" + i);
                    const db = app.database();

                    const healthCheck = db.ref('users').limitToFirst(1).get();
                    const timeout = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), 3000)
                    );

                    await Promise.race([healthCheck, timeout]);

                    this.dbApps.push({ app, db, limit: cfg.limit, url: cfg.url });
                } catch (err) {
                    console.warn(`Skipping unreachable DB: ${cfg.url}`);
                }
            }
        } catch (error) {
            console.error("Error fetching DB configs:", error);
        }
    }

    // Get user's home database instance
    getUserHomeDatabase() {
        if (!this.userHomeDatabaseUrl) return null;
        
        const homeDb = this.dbApps.find(db => db.url === this.userHomeDatabaseUrl);
        if (homeDb) return homeDb;
        
        return this.dbApps.find(db => db.app.name === this.userHomeDatabase);
    }

    getDeviceInfo() {
        return {
            platform: navigator.platform,
            language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}`
        };
    }

    // Helper method to get client IP
    async getClientIP() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        } catch (error) {
            return 'unknown';
        }
    }

    // ========== 6. UI RENDERING ==========
    async render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Settings container not found:', containerId);
            return;
        }

        console.log('Rendering enhanced settings module');
        
        try {
            await this.initSettings();
            
            if (!this.userData) {
                this.loadUserDataFromStorage();
            }
            
            container.innerHTML = this.getSettingsHTML();
            this.setupSettingsEventListeners();
            this.showSection(this.currentSection);
            this.populateFormData();
            this.initializeCustomDropdowns();

            document.addEventListener('click', function(e) {
                const logoutOption = e.target.closest('#logoutOption');
                if (logoutOption) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (window.settingsModule && typeof window.settingsModule.showLogoutConfirmation === 'function') {
                        window.settingsModule.showLogoutConfirmation();
                    } else {
                        if (confirm('Are you sure you want to logout?')) {
                            if (window.authModule && typeof window.authModule.logout === 'function') {
                                window.authModule.logout();
                            } else {
                                localStorage.clear();
                                window.location.reload();
                            }
                        }
                    }
                }
            });

            console.log('Settings module rendered successfully');
        } catch (error) {
            console.error('Error rendering settings module:', error);
        }
    }

    getSettingsHTML() {
        const userName = this.userData?.name || 'User';
        const userEmail = this.userData?.email || 'user@example.com';
        const accountCreated = this.userData?.createdAt ? 
            new Date(this.userData.createdAt).toLocaleDateString() : 'N/A';
        const lastLogin = this.userData?.lastLogin ? 
            new Date(this.userData.lastLogin).toLocaleString() : 'N/A';
        
        const dbDisplay = this.userHomeDatabaseUrl ? 
                        this.extractDbNameFromUrl(this.userHomeDatabaseUrl) : 
                        (this.userHomeDatabase || 'Default');
        
        return `
            <div class="settings-container">
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <span class="material-icons">settings</span>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Account Settings</div>
                        <div class="module-description">Manage your account and email information</div>
                    </div>
                </div> 

                <div class="settings-grid">
                    <div class="settings-sidebar">
                        <div class="settings-nav-item active" data-section="profile">
                            <span class="material-icons settings-nav-icon">person</span>
                            <span class="settings-nav-text">Profile</span>
                        </div>
                        <div class="settings-nav-item" data-section="email">
                            <span class="material-icons settings-nav-icon">email</span>
                            <span class="settings-nav-text">Email</span>
                        </div>
                        <div class="settings-nav-item" data-section="security">
                            <span class="material-icons settings-nav-icon">lock</span>
                            <span class="settings-nav-text">Password</span>
                        </div>
                        <div class="settings-nav-item" data-section="recovery">
                            <span class="material-icons settings-nav-icon">vpn_key</span>
                            <span class="settings-nav-text">Recovery Codes</span>
                        </div>
                        <div class="settings-nav-item danger" data-section="danger">
                            <span class="material-icons settings-nav-icon">warning</span>
                            <span class="settings-nav-text">Danger Zone</span>
                        </div>
                    </div>

                    <div class="settings-content">
                        <div class="settings-message success" id="settingsSuccess" style="display: none;">
                            <span class="material-icons">check_circle</span>
                            <span id="successMessage"></span>
                        </div>
                        
                        <div class="settings-message error" id="settingsError" style="display: none;">
                            <span class="material-icons">error</span>
                            <span id="errorMessage"></span>
                        </div>

                        <!-- Profile Section -->
                        <div class="settings-section active" id="profile-section">
                            <div class="section-header">
                                <h2>Profile Information</h2>
                                <p>Update your personal details</p>
                            </div>

                            <div class="account-stats" id="accountStats">
                                <span class="material-icons">${this.getStatusIcon(this.userData?.status)}</span>
                                <div class="account-stat-info">
                                    <h3>Account Status</h3>
                                    <p class="status-${this.userData?.status || 'active'}">
                                        ${this.getStatusText(this.userData?.status || 'active')}
                                    </p>
                                </div>
                            </div>

                            <div class="settings-card">
                                <form class="settings-form" id="profileForm">
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="fullName">Full Name *</label>
                                            <input type="text" id="fullName" class="form-input" 
                                                value="${userName}" required>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="currentEmail">Current Email</label>
                                            <input type="email" id="currentEmail" class="form-input" 
                                                value="${userEmail}" readonly>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="phone">Phone Number</label>
                                            <input type="tel" id="phone" class="form-input" 
                                                value="${this.formatPhoneNumber(this.userData?.phone || '')}"
                                                placeholder="123 456-7890">
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label">Account Created</label>
                                            <div class="readonly-field">${accountCreated}</div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label">Last Login</label>
                                            <div class="readonly-field">${lastLogin}</div>
                                        </div>
                                    </div>
                                    <div class="form-actions">
                                        <button type="submit" class="btn btn-primary" id="saveProfileBtn">
                                            Save Profile Changes
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <!-- Email Change Section -->
                        <div class="settings-section" id="email-section">
                            <div class="section-header">
                                <h2>Change Email Address</h2>
                                <p>Update your account email address</p>
                            </div>

                            <div class="settings-card">
                                <form class="settings-form" id="emailForm">
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="currentEmailVerify">Current Email</label>
                                            <input type="email" id="currentEmailVerify" class="form-input" 
                                                value="${userEmail}" readonly>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="newEmail">New Email Address *</label>
                                            <input type="email" id="newEmail" class="form-input" 
                                                required placeholder="Enter your new email address">
                                            <div class="form-help">We'll send a verification email to this address</div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="confirmNewEmail">Confirm New Email *</label>
                                            <input type="email" id="confirmNewEmail" class="form-input" 
                                                required placeholder="Re-enter new email address">
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="passwordForEmail">Current Password *</label>
                                            <div class="password-input-group">
                                                <input type="password" id="passwordForEmail" class="form-input" 
                                                    required placeholder="Enter your current password">
                                                <button type="button" class="toggle-password-btn" 
                                                        data-target="passwordForEmail">
                                                    <span class="material-icons">visibility</span>
                                                </button>
                                            </div>
                                            <div class="form-help">For security, please verify your identity</div>
                                        </div>
                                    </div>
                                    <div class="form-actions">
                                        <button type="submit" class="btn btn-primary" id="changeEmailBtn">
                                            Change Email Address
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="cancelEmailBtn">
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            </div>

                            <div class="settings-card info">
                                <div class="info-header">
                                    <span class="material-icons">info</span>
                                    <h3>Important Security Notice</h3>
                                </div>
                                <div class="info-content">
                                    <p>Important Information</p>
                                    <ul>
                                        <li>Changing your email will update your login credentials</li>
                                        <li>You'll be prompted for password when opening the app after inactivity</li>
                                        <li>Your account data will remain unchanged</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Security/Password Section -->
                        <div class="settings-section" id="security-section">
                            <div class="section-header">
                                <h2>Change Password</h2>
                                <p>Update your account password</p>
                            </div>
                            <div class="settings-card">
                                <form class="settings-form" id="passwordForm">
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="currentPassword">Current Password</label>
                                            <div class="password-input-group">
                                                <input type="password" id="currentPassword" 
                                                    class="form-input" required 
                                                    placeholder="Enter your current password">
                                                <button type="button" class="toggle-password-btn" 
                                                        data-target="currentPassword">
                                                    <span class="material-icons">visibility</span>
                                                </button>
                                            </div>
                                            <div class="form-help">You must enter your current password to make changes</div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="newPassword">New Password</label>
                                            <div class="password-input-group">
                                                <input type="password" id="newPassword" 
                                                    class="form-input" required 
                                                    placeholder="Enter new password (min 6 characters)">
                                                <button type="button" class="toggle-password-btn" 
                                                        data-target="newPassword">
                                                    <span class="material-icons">visibility</span>
                                                </button>
                                            </div>
                                            <div class="form-help">Enter a password</div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="confirmPassword">Confirm New Password</label>
                                            <div class="password-input-group">
                                                <input type="password" id="confirmPassword" 
                                                    class="form-input" required 
                                                    placeholder="Re-enter new password">
                                                <button type="button" class="toggle-password-btn" 
                                                        data-target="confirmPassword">
                                                    <span class="material-icons">visibility</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="form-actions">
                                        <button type="submit" class="btn btn-primary" id="changePasswordBtn">
                                            Change Password
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="cancelPasswordBtn">
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            </div>

                            <div class="settings-card info">
                                <div class="info-header">
                                    <span class="material-icons">info</span>
                                    <h3>Important Security Notice</h3>
                                </div>
                                <div class="info-content">
                                    <p>Password Requirements</p>
                                    <ul>
                                        <li>Must be at least 6 characters long</li>
                                        <li>For security, use a strong password</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Recovery Codes Section -->
                        <div class="settings-section" id="recovery-section">
                            <div class="section-header">
                                <h2>Recovery Codes</h2>
                                <p>Manage your account recovery codes</p>
                            </div>

                            <div class="settings-card">
                                <div class="recovery-stats" id="recoveryStats"></div>

                                <div class="recovery-actions">
                                    <button type="button" class="btn btn-primary" id="viewCodesBtn">
                                        <i class="fas fa-eye"></i> View
                                    </button>
                                    <button type="button" class="btn btn-warning" id="generateCodesBtn">
                                        <i class="fas fa-gears"></i> Generate
                                    </button>
                                    <button type="button" class="btn btn-success" id="downloadCodesBtn">
                                        <i class="fas fa-download"></i> Download
                                    </button>
                                </div>
                            </div>

                            <div class="settings-card danger" id="recoveryCodesDisplay" style="display: none;">
                                <div class="codes-display-header">
                                    <span class="material-icons">lock</span>
                                    <h3>Your Recovery Codes</h3>
                                    <p id="codesStatus">Loading...</p>
                                </div>
                                
                                <div class="rec-codes-container" id="codesContainer"></div>
                                
                                <div class="codes-actions">
                                    <button type="button" class="btn btn-primary" id="copyAllCodesBtn">
                                        <i class="fas fa-copy"></i> Copy All
                                    </button>
                                    <button type="button" class="btn btn-secondary" id="hideCodesBtn">
                                        <i class="fas fa-eye-slash"></i> Hide Codes
                                    </button>
                                </div>
                                
                                <div class="codes-warning">
                                    <span class="material-icons">warning</span>
                                    <p>Keep these codes in a secure place. Each code can be used only once.</p>
                                </div>
                            </div>

                            <div class="danger-confirmation danger-confirmation-warning" id="generateCodesConfirmation" style="display: none;">
                                <div class="confirmation-header">
                                    <span class="material-icons">warning</span>
                                    <h3>Generate New Recovery Codes</h3>
                                </div>
                                <div class="confirmation-content">
                                    <p><strong>Warning:</strong> Generating new codes will invalidate all existing recovery codes.</p>
                                    <p>Any unused recovery codes will no longer work for password reset.</p>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="generateConfirmPassword">Current Password *</label>
                                            <input type="password" id="generateConfirmPassword" class="form-input" 
                                                placeholder="Enter your current password to confirm" required>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="generateConfirmText">Confirm</label>
                                            <input type="text" id="generateConfirmText" class="form-input" 
                                                placeholder="GENERATE" required>
                                            <div class="form-help">Type "GENERATE" to confirm *</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="confirmation-actions">
                                    <button type="button" class="btn btn-warning" id="confirmGenerateBtn">
                                        Generate New Codes
                                    </button>
                                    <button type="button" class="btn btn-secondary" id="cancelGenerateBtn">
                                        Cancel
                                    </button>
                                </div>
                            </div>

                            <div class="settings-card warning">
                                <div class="warning-header">
                                    <span class="material-icons">warning</span>
                                    <h3>Important Security Notice</h3>
                                </div>
                                <div class="warning-content">
                                    <p>Recovery codes are your backup access method if you forget your password.</p>
                                    <ul>
                                        <li>Store codes securely (password manager, encrypted file)</li>
                                        <li>Never share recovery codes with anyone</li>
                                        <li>Generating new codes invalidates all previous codes</li>
                                        <li>You need one unused code to reset your password</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Danger Zone Section -->
                        <div class="settings-section" id="danger-section">
                            <div class="section-header">
                                <h2 class="danger-title">Danger Zone</h2>
                                <p class="danger-subtitle">Irreversible actions - proceed with caution</p>
                            </div>

                            <div class="settings-card danger">
                                <div class="danger-option" id="logoutOption" data-action="logout">
                                    <div class="danger-info">
                                        <span class="material-icons warning">logout</span>
                                        <div>
                                            <h4>Logout Account</h4>
                                            <p>Sign out from this device and return to the login screen</p>
                                        </div>
                                    </div>
                                    <span class="action-indicator material-icons">chevron_right</span>
                                </div>

                                <div class="danger-option" id="deactivateOption" data-action="deactivate">
                                    <div class="danger-info">
                                        <span class="material-icons warning">pause_circle</span>
                                        <div>
                                            <h4>Deactivate Account</h4>
                                            <p>Temporarily disable your account. You can reactivate it later by contacting support.</p>
                                        </div>
                                    </div>
                                    <span class="action-indicator material-icons">chevron_right</span>
                                </div>

                                <div class="danger-option" id="deleteOption" data-action="delete">
                                    <div class="danger-info">
                                        <span class="material-icons danger">delete_forever</span>
                                        <div>
                                            <h4>Permanently Delete Account</h4>
                                            <p>Completely remove your account and all associated data. This cannot be undone.</p>
                                        </div>
                                    </div>
                                    <span class="action-indicator material-icons">chevron_right</span>
                                </div>
                            </div>

                            <div class="danger-confirmation danger-confirmation-warning" id="logoutConfirmation" style="display: none;">
                                <div class="confirmation-header">
                                    <span class="material-icons">logout</span>
                                    <h3>Confirm Logout</h3>
                                </div>
                                <div class="confirmation-content">
                                    <p>Are you sure you want to logout? You will need to sign in again to access your account.</p>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="logoutConfirmText">Confirm</label>
                                            <input type="text" id="logoutConfirmText" class="form-input" 
                                                placeholder="LOGOUT" required>
                                            <div class="form-help">Type "LOGOUT" to confirm *</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="confirmation-actions">
                                    <button type="button" class="btn btn-warning" id="confirmLogoutBtn">
                                        <i class="fas fa-right-from-bracket"></i> Logout
                                    </button>
                                    <button type="button" class="btn btn-secondary" id="cancelLogoutBtn">
                                        Cancel
                                    </button>
                                </div>
                            </div>

                            <div class="danger-confirmation danger-confirmation-warning" id="deactivateConfirmation" style="display: none;">
                                <div class="confirmation-header">
                                    <span class="material-icons">pause_circle</span>
                                    <h3>Deactivate Account with Cooldown Period</h3>
                                </div>
                                <div class="confirmation-content">
                                    <p>Your account will be temporarily disabled for a selected period.</p>
                                    <p><strong>During this period:</strong></p>
                                    <ul class="cool-down-details">
                                        <li>You will be immediately logged out</li>
                                        <li>You cannot log in until the cooldown period ends</li>
                                        <li>Your data will be preserved</li>
                                        <li>Account will automatically reactivate after the selected period</li>
                                        <li>You can contact support to reactivate earlier</li>
                                    </ul>
                                    <div class="cool-down-duration">
                                        <h4>Select Deactivation Duration:</h4>
                                        <div class="duration-options">
                                            <button type="button" class="duration-btn ${this.userData?.deactivationDuration === 14 ? 'active' : ''}" data-days="14">
                                                14 Days
                                            </button>
                                            <button type="button" class="duration-btn ${this.userData?.deactivationDuration === 30 ? 'active' : ''}" data-days="30">
                                                30 Days
                                            </button>
                                        </div>
                                        <input type="hidden" id="deactivateDuration" value="14">
                                    </div>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="deactivatePassword">Current Password *</label>
                                            <input type="password" id="deactivatePassword" class="form-input" 
                                                placeholder="Enter your current password to confirm" required>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="deactivateConfirmText">Confirm</label>
                                            <input type="text" id="deactivateConfirmText" class="form-input" 
                                                placeholder="DEACTIVATE" required>
                                            <div class="form-help">Type "DEACTIVATE" to confirm *</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="confirmation-actions">
                                    <button type="button" class="btn btn-warning" id="confirmDeactivateBtn">
                                        <i class="fas fa-ban"></i> Deactivate
                                    </button>
                                    <button type="button" class="btn btn-secondary" id="cancelDeactivateBtn">
                                        Cancel
                                    </button>
                                </div>
                            </div>

                            <div class="danger-confirmation danger-confirmation-danger" id="deleteConfirmation" style="display: none;">
                                <div class="confirmation-header">
                                    <span class="material-icons">error</span>
                                    <h3>Confirm Permanent Account Deletion</h3>
                                </div>
                                <div class="confirmation-content">
                                    <p>This action <strong>cannot be undone</strong>. All your data will be permanently deleted.</p>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="deletePassword">Current Password *</label>
                                            <input type="password" id="deletePassword" class="form-input" 
                                                placeholder="Enter your current password to confirm" required>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="deleteConfirmationText">Confirm</label>
                                            <input type="text" id="deleteConfirmationText" class="form-input" 
                                                placeholder="DELETE MY ACCOUNT" required>
                                            <div class="form-help">Type "DELETE MY ACCOUNT" to confirm *</div>
                                        </div>
                                    </div>
                                    <div class="form-group checkbox-group">
                                        <input type="checkbox" id="deleteAgreement" required>
                                        <label for="deleteAgreement">
                                            I understand that:
                                            <ul class="agreement-list">
                                                <li>This action is permanent and cannot be reversed</li>
                                                <li>All my data will be permanently deleted</li>
                                                <li>I will lose access to all my files, photos, and notes</li>
                                                <li>I cannot recover my account after deletion</li>
                                            </ul>
                                        </label>
                                    </div>
                                </div>
                                <div class="confirmation-actions">
                                    <button type="button" class="btn btn-danger" id="confirmDeleteBtn">
                                        <i class="fas fa-trash"></i> Delete
                                    </button>
                                    <button type="button" class="btn btn-secondary" id="cancelDeleteBtn">
                                        Cancel
                                    </button>
                                </div>
                            </div>

                            <div class="settings-card warning">
                                <div class="warning-header">
                                    <span class="material-icons">warning</span>
                                    <h3>Important Security Notice</h3>
                                </div>
                                <div class="warning-content">
                                    <p><strong>Important:</strong> These actions are permanent and cannot be reversed.</p>
                                    <p>Before taking any action, please:</p>
                                    <ul>
                                        <li>Make sure you have saved any important information</li>
                                        <li>Consider deactivating your account instead of deleting it</li>
                                        <li>Understand that support cannot recover deleted accounts</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ========== 7. SECTION MANAGEMENT ==========
    showSection(section) {
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-section="${section}"]`)?.classList.add('active');

        document.querySelectorAll('.settings-section').forEach(sectionEl => {
            sectionEl.classList.remove('active');
        });
        document.getElementById(`${section}-section`)?.classList.add('active');

        this.currentSection = section;
        
        if (section !== 'security') {
            this.resetPasswordForm();
        }
        if (section !== 'email') {
            this.resetEmailForm();
        }
        
        if (section === 'recovery') {
            this.loadRecoveryCodes();
        }
    }

    // ========== 8. FORM HANDLING ==========
    async handleProfileSave(e) {
        e.preventDefault();
        
        if (!this.checkAccountStatus()) {
            return;
        }
        
        const authModule = window.authModule;
        if (!authModule || !authModule.masterDB) {
            this.showError('Authentication module not available. Please refresh the page.');
            return;
        }

        const fullName = document.getElementById('fullName').value.trim();
        const phone = document.getElementById('phone').value.replace(/\D/g, '');

        if (!fullName) {
            this.showError('Full name is required.');
            return;
        }

        try {
            this.showLoading('saveProfileBtn', 'Saving...');
            this.hideMessages();

            const updateData = {
                name: fullName,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            };

            if (phone && phone.length === 11) {
                updateData.phone = phone;
            } else if (phone && phone.length > 0) {
                this.showError('Phone number must be 11 digits');
                return;
            }

            const encodedEmail = this.encodeEmail(this.userData.email);
            
            await authModule.masterDB.ref(`users/${encodedEmail}`).update(updateData);

            this.userData = { ...this.userData, ...updateData };
            localStorage.setItem('currentUser', JSON.stringify(this.userData));

            if (authModule.currentUser) {
                Object.assign(authModule.currentUser, updateData);
            }

            if (window.sidebarManager) {
                window.sidebarManager.updateUserProfile();
            }

            this.showSuccess('Profile updated successfully!');

        } catch (error) {
            console.error('Profile update error:', error);
            this.showError('Failed to update profile. Please try again.');
        } finally {
            this.hideLoading('saveProfileBtn', 'Save Profile Changes');
        }
    }

    async handlePasswordChange(e) {
        e.preventDefault();

        if (!this.checkAccountStatus()) {
            return;
        }
        
        const authModule = window.authModule;
        if (!authModule || !authModule.masterDB) {
            this.showError('Authentication module not available. Please refresh the page.');
            return;
        }

        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            this.showError('Please fill in all password fields.');
            return;
        }

        if (newPassword.length < 6) {
            this.showError('New password must be at least 6 characters.');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showError('New passwords do not match.');
            return;
        }

        if (currentPassword === newPassword) {
            this.showError('New password must be different from current password.');
            return;
        }

        try {
            this.showLoading('changePasswordBtn', 'Verifying...');
            this.hideMessages();

            const encodedEmail = this.encodeEmail(this.userData.email);
            
            const userRef = authModule.masterDB.ref(`users/${encodedEmail}`);
            const userSnapshot = await userRef.once('value');
            
            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }

            const userData = userSnapshot.val();
            
            if (userData.password !== currentPassword) {
                throw new Error('Current password is incorrect');
            }

            this.showLoading('changePasswordBtn', 'Updating...');
            
            const updateData = {
                password: newPassword,
                passwordUpdatedAt: firebase.database.ServerValue.TIMESTAMP,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            };

            await userRef.update(updateData);

            this.userData.password = newPassword;
            this.userData.passwordUpdatedAt = Date.now();
            this.userData.updatedAt = Date.now();
            
            localStorage.setItem('currentUser', JSON.stringify(this.userData));

            if (authModule.currentUser) {
                authModule.currentUser.password = newPassword;
                authModule.currentUser.passwordUpdatedAt = Date.now();
                authModule.currentUser.updatedAt = Date.now();
            }

            await this.logPasswordChange(encodedEmail);

            this.showSuccess('Password changed successfully!');
            this.resetPasswordForm();

            setTimeout(() => {
                this.showSection('profile');
            }, 1500);

        } catch (error) {
            console.error('Password change error:', error);
            this.showError(error.message || 'Failed to change password. Please try again.');
        } finally {
            this.hideLoading('changePasswordBtn', 'Change Password');
        }
    }

    async handleEmailChange(e) {
        e.preventDefault();

        if (!this.checkAccountStatus()) {
            return;
        }
        
        const authModule = window.authModule;
        if (!authModule || !authModule.masterDB) {
            this.showError('Authentication module not available. Please refresh the page.');
            return;
        }

        const newEmail = document.getElementById('newEmail').value.trim().toLowerCase();
        const confirmNewEmail = document.getElementById('confirmNewEmail').value.trim().toLowerCase();
        const password = document.getElementById('passwordForEmail').value;

        if (!newEmail || !confirmNewEmail || !password) {
            this.showError('Please fill in all required fields.');
            return;
        }

        if (!this.validateEmail(newEmail)) {
            this.showError('Please enter a valid email address.');
            return;
        }

        if (newEmail !== confirmNewEmail) {
            this.showError('Email addresses do not match.');
            return;
        }

        if (newEmail === this.userData.email) {
            this.showError('New email must be different from current email.');
            return;
        }

        try {
            this.showLoading('changeEmailBtn', 'Verifying...');
            this.hideMessages();

            const currentEncodedEmail = this.encodeEmail(this.userData.email);
            
            const userRef = authModule.masterDB.ref(`users/${currentEncodedEmail}`);
            const userSnapshot = await userRef.once('value');
            
            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }

            const userData = userSnapshot.val();
            
            if (userData.password !== password) {
                throw new Error('Current password is incorrect');
            }

            const newEncodedEmail = this.encodeEmail(newEmail);
            const existingUserSnapshot = await authModule.masterDB
                .ref(`users/${newEncodedEmail}`).once('value');
            
            if (existingUserSnapshot.exists()) {
                throw new Error('This email is already registered with another account');
            }

            this.showLoading('changeEmailBtn', 'Updating email...');
            
            const updatedUserData = {
                ...userData,
                email: newEmail,
                emailUpdatedAt: firebase.database.ServerValue.TIMESTAMP,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            };

            await authModule.masterDB.ref(`users/${newEncodedEmail}`).set(updatedUserData);
            
            await userRef.remove();

            try {
                const homeDatabase = authModule.getHomeDatabaseInstance();
                if (homeDatabase && homeDatabase.db) {
                    const homeUserRef = homeDatabase.db.ref(`userData/${currentEncodedEmail}`);
                    const homeUserSnapshot = await homeUserRef.once('value');
                    
                    if (homeUserSnapshot.exists()) {
                        await homeDatabase.db.ref(`userData/${newEncodedEmail}`).set(homeUserSnapshot.val());
                        await homeUserRef.remove();
                    }
                }
            } catch (dbError) {
                console.error('Error migrating user data in home database:', dbError);
            }

            this.userData = updatedUserData;
            this.encodedEmail = newEncodedEmail;
            
            if (authModule.currentUser) {
                Object.assign(authModule.currentUser, updatedUserData);
            }
            
            localStorage.setItem('currentUser', JSON.stringify(this.userData));
            localStorage.setItem('lastEmail', newEmail);
            
            const homeDbUrl = localStorage.getItem('userHomeDatabaseUrl');
            if (homeDbUrl) {
                localStorage.setItem('userHomeDatabaseUrl', homeDbUrl);
            }

            if (window.sidebarManager) {
                window.sidebarManager.updateUserProfile();
            }

            await this.logEmailChange(currentEncodedEmail, newEmail);

            this.showSuccess('Email changed successfully! You will now use the new email for login.');
            this.resetEmailForm();

            setTimeout(() => {
                this.showSection('profile');
                this.populateFormData();
            }, 1500);

        } catch (error) {
            console.error('Email change error:', error);
            this.showError(error.message || 'Failed to change email. Please try again.');
        } finally {
            this.hideLoading('changeEmailBtn', 'Change Email Address');
        }
    }

    populateFormData() {
        if (!this.userData) return;

        const currentEmail = this.userData.email;
        
        const profileEmailInput = document.getElementById('currentEmail');
        if (profileEmailInput) {
            profileEmailInput.value = currentEmail || '';
        }
        
        const verifyEmailInput = document.getElementById('currentEmailVerify');
        if (verifyEmailInput) {
            verifyEmailInput.value = currentEmail || '';
        }
    }

    resetEmailForm() {
        const form = document.getElementById('emailForm');
        if (form) {
            form.reset();
            const currentEmailInput = document.getElementById('currentEmailVerify');
            if (currentEmailInput && this.userData) {
                currentEmailInput.value = this.userData.email || '';
            }
        }
    }

    resetPasswordForm() {
        const form = document.getElementById('passwordForm');
        if (form) {
            form.reset();
        }
    }

    // ========== 9. RECOVERY CODES ==========
    async viewRecoveryCodes() {
        try {
            if (!this.userData?.recoveryCodes) {
                this.showError('No recovery codes found for your account.');
                return;
            }

            this.hideGenerateConfirmation();
            
            document.getElementById('recoveryCodesDisplay').style.display = 'block';
            
            const usedCount = this.userData.recoveryCodes.filter(code => code.used).length;
            const availableCount = this.userData.recoveryCodes.length - usedCount;
            
            document.getElementById('codesStatus').textContent = 
                `${availableCount} codes available, ${usedCount} used`;
            
            const codesContainer = document.getElementById('codesContainer');
            codesContainer.innerHTML = this.userData.recoveryCodes.map((codeObj, index) => `
                <div class="rec-code-item ${codeObj.used ? 'used' : ''}">
                    <span class="rec-code-number">${index + 1}.</span>
                    <span class="rec-code-value">${codeObj.code}</span>
                    ${!codeObj.used ? `
                        <button class="copy-single-btn" data-code="${codeObj.code}">
                            <span class="material-icons">content_copy</span>
                        </button>
                    ` : `
                        <span class="material-icons used-icon">block</span>
                    `}
                </div>
            `).join('');
            
            this.attachCopyCodeEventListeners();
            
            document.getElementById('recoveryCodesDisplay').scrollIntoView({ behavior: 'smooth' });
            
        } catch (error) {
            console.error('Error viewing recovery codes:', error);
            this.showError('Failed to load recovery codes.');
        }
    }

    attachCopyCodeEventListeners() {
        const copyButtons = document.querySelectorAll('.copy-single-btn');
        copyButtons.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const code = newBtn.getAttribute('data-code');
                if (code) {
                    await this.copySingleRecoveryCode(code);
                }
            });
        });
    }

    async copySingleRecoveryCode(code) {
        try {
            await navigator.clipboard.writeText(code);
            this.showSuccess('Recovery code copied to clipboard!');
            
            const btn = document.querySelector(`.copy-single-btn[data-code="${code}"]`);
            if (btn) {
                const originalIcon = btn.innerHTML;
                btn.innerHTML = '<span class="material-icons">check</span>';
                setTimeout(() => {
                    btn.innerHTML = originalIcon;
                }, 1500);
            }
        } catch (error) {
            console.error('Error copying code:', error);
            this.showError('Failed to copy code. Please try again.');
        }
    }

    async copyAllRecoveryCodes() {
        try {
            if (!this.userData?.recoveryCodes) {
                this.showError('No recovery codes to copy.');
                return;
            }
            
            const availableCodes = this.userData.recoveryCodes
                .filter(codeObj => !codeObj.used)
                .map(codeObj => codeObj.code);
            
            if (availableCodes.length === 0) {
                this.showError('No available recovery codes to copy.');
                return;
            }
            
            const allCodes = availableCodes.join('\n');
            await navigator.clipboard.writeText(allCodes);
            this.showSuccess(`${availableCodes.length} recovery codes copied to clipboard!`);
            
            const copyAllBtn = document.getElementById('copyAllCodesBtn');
            if (copyAllBtn) {
                const originalText = copyAllBtn.innerHTML;
                copyAllBtn.innerHTML = '<span class="material-icons">check</span> Copied!';
                setTimeout(() => {
                    copyAllBtn.innerHTML = originalText;
                }, 1500);
            }
            
        } catch (error) {
            console.error('Error copying codes:', error);
            this.showError('Failed to copy recovery codes.');
        }
    }

    hideRecoveryCodes() {
        document.getElementById('recoveryCodesDisplay').style.display = 'none';
        const codesContainer = document.getElementById('codesContainer');
        if (codesContainer) {
            codesContainer.innerHTML = '';
        }
    }

    async downloadRecoveryCodes() {
        try {
            if (!this.userData?.recoveryCodes) {
                this.showError('No recovery codes to download.');
                return;
            }
            
            const availableCodes = this.userData.recoveryCodes.filter(code => !code.used);
            const usedCodes = this.userData.recoveryCodes.filter(code => code.used);
            
            const content = `xDrive Recovery Codes
                Generated: ${new Date().toLocaleString()}

                ===========================================
                AVAILABLE CODES (${availableCodes.length} codes)
                ===========================================
                ${availableCodes.map((code, index) => `${(index + 1).toString().padStart(2)}. ${code.code}`).join('\n')}

                ${usedCodes.length > 0 ? `
                ===========================================
                USED CODES (${usedCodes.length} codes)
                ===========================================
                ${usedCodes.map((code, index) => `${(index + 1).toString().padStart(2)}. ${code.code} (Used on ${code.usedAt ? new Date(code.usedAt).toLocaleDateString() : 'Unknown date'})`).join('\n')}
                ` : ''}

                ===========================================
                INSTRUCTIONS
                ===========================================
                - Each code can be used only once
                - You will need one code to reset your password
                - Generate new codes from settings if you lose these
                - Never share your recovery codes with anyone
                - Keep these codes in a secure place
                `;
            
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `xdrive-recovery-codes-${new Date().toISOString().split('T')[0]}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showSuccess('Recovery codes downloaded successfully!');
            
        } catch (error) {
            console.error('Error downloading recovery codes:', error);
            this.showError('Failed to download recovery codes.');
        }
    }

    async loadRecoveryCodes() {
        try {
            const authModule = window.authModule;
            if (authModule && authModule.isLoggedIn()) {
                const encodedEmail = this.encodeEmail(this.userData.email);
                const snapshot = await authModule.masterDB.ref(`users/${encodedEmail}/recoveryCodes`).once('value');
                
                if (snapshot.exists()) {
                    this.userData.recoveryCodes = snapshot.val();
                    localStorage.setItem('currentUser', JSON.stringify(this.userData));
                }
            }
            
            this.updateRecoveryStats();
            
        } catch (error) {
            console.error('Error loading recovery codes:', error);
        }
    }

    updateRecoveryStats() {
        const recoveryStats = document.getElementById('recoveryStats');
        if (!recoveryStats || !this.userData?.recoveryCodes) return;
        
        const totalCodes = this.userData.recoveryCodes.length;
        const usedCodes = this.userData.recoveryCodes.filter(code => code.used).length;
        const availableCodes = totalCodes - usedCodes;
        const lastGenerated = this.userData.recoveryCodesGenerated ? 
            new Date(this.userData.recoveryCodesGenerated).toLocaleDateString() : 'Never';
        
        recoveryStats.innerHTML = `
            <div class="recovery-stat-card">
                <div class="stat-number">${availableCodes}</div>
                <div class="stat-label">Available Codes</div>
            </div>
            <div class="recovery-stat-card">
                <div class="stat-number">${usedCodes}</div>
                <div class="stat-label">Used Codes</div>
            </div>
            <div class="recovery-stat-card">
                <div class="stat-number">${lastGenerated}</div>
                <div class="stat-label">Last Generated</div>
            </div>
        `;
    }

    showGenerateConfirmation() {
        this.hideRecoveryCodes();
        document.getElementById('generateCodesConfirmation').style.display = 'block';
    }

    hideGenerateConfirmation() {
        document.getElementById('generateCodesConfirmation').style.display = 'none';
        document.getElementById('generateConfirmPassword').value = '';
        document.getElementById('generateConfirmText').value = '';
    }

    async confirmGenerateCodes() {
        const password = document.getElementById('generateConfirmPassword').value;
        const confirmationText = document.getElementById('generateConfirmText').value;

        if (!password) {
            this.showError('Please enter your current password.');
            return;
        }

        if (confirmationText !== 'GENERATE') {
            this.showError('Please type "GENERATE" exactly as shown to confirm.');
            return;
        }

        try {
            this.showLoading('confirmGenerateBtn', 'Verifying...');
            
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) {
                throw new Error('Authentication module not available');
            }
            
            const encodedEmail = this.encodeEmail(this.userData.email);
            const userRef = authModule.masterDB.ref(`users/${encodedEmail}`);
            const userSnapshot = await userRef.once('value');
            
            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }

            const userData = userSnapshot.val();
            
            if (userData.password !== password) {
                throw new Error('Current password is incorrect');
            }
            
            const recoveryCodes = authModule.generateRecoveryCodes(5);
            
            this.showLoading('confirmGenerateBtn', 'Generating...');
            await authModule.masterDB.ref(`users/${encodedEmail}`).update({
                recoveryCodes: recoveryCodes,
                recoveryCodesGenerated: firebase.database.ServerValue.TIMESTAMP,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            this.userData.recoveryCodes = recoveryCodes;
            this.userData.recoveryCodesGenerated = Date.now();
            localStorage.setItem('currentUser', JSON.stringify(this.userData));
            
            if (authModule.currentUser) {
                authModule.currentUser.recoveryCodes = recoveryCodes;
                authModule.currentUser.recoveryCodesGenerated = Date.now();
            }
            
            this.hideGenerateConfirmation();
            this.showSuccess('New recovery codes generated successfully!');
            
            setTimeout(() => {
                this.viewRecoveryCodes();
            }, 500);
            
            this.updateRecoveryStats();
            
        } catch (error) {
            console.error('Error generating recovery codes:', error);
            this.showError(error.message || 'Failed to generate new recovery codes.');
        } finally {
            this.hideLoading('confirmGenerateBtn', 'Generate New Codes');
        }
    }

    // ========== 10. DANGER ZONE ==========
    showLogoutConfirmation() {
        this.hideDeactivateConfirmation();
        this.hideDeleteConfirmation();
        
        const logoutConfirmation = document.getElementById('logoutConfirmation');
        if (logoutConfirmation) {
            logoutConfirmation.style.display = 'block';
            
            const confirmInput = document.getElementById('logoutConfirmText');
            if (confirmInput) {
                confirmInput.value = '';
                confirmInput.focus();
            }
        }
    }

    hideLogoutConfirmation() {
        const logoutConfirmation = document.getElementById('logoutConfirmation');
        if (logoutConfirmation) {
            logoutConfirmation.style.display = 'none';
        }
        const confirmInput = document.getElementById('logoutConfirmText');
        if (confirmInput) {
            confirmInput.value = '';
        }
    }

    async confirmLogout() {
        const confirmText = document.getElementById('logoutConfirmText')?.value || '';
        
        if (confirmText !== 'LOGOUT') {
            this.showError('Please type "LOGOUT" exactly as shown to confirm.');
            return;
        }
        
        try {
            this.showLoading('confirmLogoutBtn', 'Logging out...');
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            if (window.authModule && typeof window.authModule.logout === 'function') {
                window.authModule.logout();
            } else {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
            }
            
        } catch (error) {
            console.error('Logout error:', error);
            this.showError('Failed to logout. Please try again.');
            this.hideLoading('confirmLogoutBtn', 'Logout');
        }
    }

    showDeactivateConfirmation() {
        this.hideDeleteConfirmation();
        this.hideLogoutConfirmation();
        
        const deactivateConfirmation = document.getElementById('deactivateConfirmation');
        if (deactivateConfirmation) {
            deactivateConfirmation.style.display = 'block';
            
            const durationBtns = deactivateConfirmation.querySelectorAll('.duration-btn');
            const savedDuration = this.userData?.deactivationDuration || 14;
            
            durationBtns.forEach(btn => {
                const days = parseInt(btn.getAttribute('data-days'));
                if (days === savedDuration) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
                
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                
                newBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const selectedDays = newBtn.getAttribute('data-days');
                    
                    deactivateConfirmation.querySelectorAll('.duration-btn').forEach(b => {
                        b.classList.remove('active');
                    });
                    newBtn.classList.add('active');
                    
                    const durationInput = document.getElementById('deactivateDuration');
                    if (durationInput) {
                        durationInput.value = selectedDays;
                    }
                });
            });
        }
        
        const passwordInput = document.getElementById('deactivatePassword');
        const confirmInput = document.getElementById('deactivateConfirmText');
        if (passwordInput) passwordInput.value = '';
        if (confirmInput) confirmInput.value = '';
    }

    hideDeactivateConfirmation() {
        document.getElementById('deactivateConfirmation').style.display = 'none';
        document.getElementById('deactivatePassword').value = '';
        document.getElementById('deactivateConfirmText').value = '';
    }

    async deactivateAccount() {
        const password = document.getElementById('deactivatePassword').value;
        const confirmationText = document.getElementById('deactivateConfirmText').value;
        
        const durationElement = document.getElementById('deactivateDuration');
        const durationDays = durationElement ? parseInt(durationElement.value) : 14;
        
        if (!password) {
            this.showError('Please enter your current password.');
            return;
        }
        
        if (confirmationText !== 'DEACTIVATE') {
            this.showError('Please type "DEACTIVATE" exactly as shown to confirm.');
            return;
        }
        
        if (isNaN(durationDays) || (durationDays !== 14 && durationDays !== 30)) {
            this.showError('Please select a valid deactivation duration.');
            return;
        }
        
        try {
            this.showLoading('confirmDeactivateBtn', 'Verifying...');
            
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) {
                throw new Error('Authentication module not available');
            }
            
            const encodedEmail = this.encodeEmail(this.userData.email);
            
            const userRef = authModule.masterDB.ref(`users/${encodedEmail}`);
            const userSnapshot = await userRef.once('value');
            
            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }
            
            const userData = userSnapshot.val();
            
            if (userData.password !== password) {
                throw new Error('Current password is incorrect');
            }
            
            const deactivationEnd = Date.now() + (durationDays * 24 * 60 * 60 * 1000);
            
            this.showLoading('confirmDeactivateBtn', 'Deactivating...');
            
            const updateData = {
                status: 'deactivated',
                deactivationStart: firebase.database.ServerValue.TIMESTAMP,
                deactivationEnd: deactivationEnd,
                deactivationDuration: durationDays,
                lastActive: firebase.database.ServerValue.TIMESTAMP
            };
            
            await userRef.update(updateData);
            
            await this.logDeactivation(encodedEmail, durationDays);
            
            this.userData.status = 'deactivated';
            this.userData.deactivationStart = Date.now();
            this.userData.deactivationEnd = deactivationEnd;
            this.userData.deactivationDuration = durationDays;
            localStorage.setItem('currentUser', JSON.stringify(this.userData));
            
            this.showSuccess(`Account deactivated for ${durationDays} days! You will be logged out in 3 seconds...`);
            
            setTimeout(() => {
                if (window.authModule) {
                    window.authModule.logout();
                }
            }, 3000);
            
        } catch (error) {
            console.error('Account deactivation error:', error);
            this.showError(error.message || 'Failed to deactivate account. Please try again.');
        } finally {
            this.hideLoading('confirmDeactivateBtn', 'Deactivate Account');
        }
    }

    showDeleteConfirmation() {
        this.hideDeactivateConfirmation();
        this.hideLogoutConfirmation();
        document.getElementById('deleteConfirmation').style.display = 'block';
    }

    hideDeleteConfirmation() {
        document.getElementById('deleteConfirmation').style.display = 'none';
        document.getElementById('deletePassword').value = '';
        document.getElementById('deleteConfirmationText').value = '';
        document.getElementById('deleteAgreement').checked = false;
    }

    async deleteAccount() {
        const password = document.getElementById('deletePassword').value;
        const confirmationText = document.getElementById('deleteConfirmationText').value;
        const agreement = document.getElementById('deleteAgreement').checked;

        if (!password) {
            this.showError('Please enter your current password.');
            return;
        }

        if (confirmationText !== 'DELETE MY ACCOUNT') {
            this.showError('Please type "DELETE MY ACCOUNT" exactly as shown to confirm.');
            return;
        }

        if (!agreement) {
            this.showError('You must agree to the terms to delete your account.');
            return;
        }

        try {
            this.showLoading('confirmDeleteBtn', 'Verifying...');
            
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) {
                throw new Error('Authentication module not available');
            }

            const encodedEmail = this.encodeEmail(this.userData.email);
            
            const userRef = authModule.masterDB.ref(`users/${encodedEmail}`);
            const userSnapshot = await userRef.once('value');
            
            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }

            const userData = userSnapshot.val();
            
            if (userData.password !== password) {
                throw new Error('Password is incorrect');
            }

            this.showLoading('confirmDeleteBtn', 'Deleting Account...');
            
            await this.logDeletion(encodedEmail);
            
            await userRef.remove();
            
            const homeDb = authModule.getHomeDatabaseInstance();
            if (homeDb && homeDb.db) {
                try {
                    await homeDb.db.ref(`userData/${encodedEmail}`).remove();
                } catch (error) {
                    console.error('Error deleting from home database:', error);
                }
            }
            
            localStorage.clear();
            sessionStorage.clear();
            
            this.showSuccess('Account deleted successfully. You will be redirected...');
            
            setTimeout(() => {
                if (window.authModule) {
                    window.authModule.logout();
                }
            }, 2000);
            
        } catch (error) {
            console.error('Account deletion error:', error);
            this.showError(error.message || 'Failed to delete account. Please try again.');
            this.hideLoading('confirmDeleteBtn', 'Permanently Delete Account');
        }
    }

    // ========== 11. LOGGING ==========
    async logPasswordChange(encodedEmail) {
        try {
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) return;

            const activityData = {
                type: 'password_changed',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 100),
                device: this.getDeviceInfo()
            };

            await authModule.masterDB.ref(`userActivity/${encodedEmail}/password_changes`)
                .push(activityData);
                
        } catch (error) {
            console.error('Error logging password change:', error);
        }
    }

    async logEmailChange(oldEncodedEmail, newEmail) {
        try {
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) return;

            const activityData = {
                type: 'email_changed',
                oldEmail: this.userData.email,
                newEmail: newEmail,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 100)
            };

            await authModule.masterDB.ref(`userActivity/${oldEncodedEmail}/email_changes`)
                .push(activityData);
                
            const newEncodedEmail = this.encodeEmail(newEmail);
            await authModule.masterDB.ref(`userActivity/${newEncodedEmail}/email_changes`)
                .push({
                    ...activityData,
                    migratedFrom: oldEncodedEmail
                });
                
        } catch (error) {
            console.error('Error logging email change:', error);
        }
    }

    async logDeactivation(encodedEmail, durationDays) {
        try {
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) return;
            
            const logData = {
                type: 'account_deactivated',
                durationDays: durationDays,
                deactivatedUntil: Date.now() + (durationDays * 24 * 60 * 60 * 1000),
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 200),
                ip: await this.getClientIP()
            };
            
            await authModule.masterDB.ref(`userActivity/${encodedEmail}/account_actions`)
                .push(logData);
            
            await authModule.masterDB.ref('adminLogs/accountDeactivations')
                .push({
                    email: this.userData.email,
                    encodedEmail: encodedEmail,
                    durationDays: durationDays,
                    timestamp: firebase.database.ServerValue.TIMESTAMP,
                    deactivatedUntil: Date.now() + (durationDays * 24 * 60 * 60 * 1000)
                });
            
        } catch (error) {
            console.error('Error logging deactivation:', error);
        }
    }

    async logDeletion(encodedEmail) {
        try {
            const authModule = window.authModule;
            if (!authModule || !authModule.masterDB) return;

            const logData = {
                type: 'account_deleted',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 200),
                ip: await this.getClientIP()
            };

            await authModule.masterDB.ref(`userActivity/${encodedEmail}/account_actions`)
                .push(logData);

            await authModule.masterDB.ref('adminLogs/accountDeletions')
                .push({
                    email: this.userData.email,
                    encodedEmail: encodedEmail,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });

        } catch (error) {
            console.error('Error logging deletion:', error);
        }
    }

    // ========== 12. UTILITY METHODS ==========
    validateEmail(email) {
        if (window.authModule && typeof window.authModule.validateEmail === 'function') {
            return window.authModule.validateEmail(email);
        }
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    formatPhoneNumber(phone) {
        if (!phone) return '';
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 11) {
            return `${digits.substring(0, 3)} ${digits.substring(3, 6)}-${digits.substring(6)}`;
        }
        return phone;
    }

    getStatusIcon(status) {
        switch(status) {
            case 'active': return 'verified';
            case 'pending': return 'schedule';
            case 'suspended': return 'block';
            case 'deactivated': return 'pause_circle';
            default: return 'help';
        }
    }

    getStatusText(status) {
        switch(status) {
            case 'active': return 'Active';
            case 'pending': return 'Pending Approval';
            case 'suspended': return 'Suspended';
            case 'deactivated': return 'Deactivated';
            default: return status;
        }
    }

    extractDbNameFromUrl(url) {
        if (!url) return 'Default';
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.split('.')[0] || 'Database';
        } catch {
            return url.substring(0, 20) + '...';
        }
    }

    encodeEmail(email) {
        if (!email) return '';
        return email.replace(/\./g, ',').replace(/@/g, '-at-');
    }

    // ========== 13. UI HELPERS ==========
    showLoading(buttonId, text) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = true;
            button.innerHTML = `<span class="loading-spinner"></span> ${text}`;
        }
    }

    hideLoading(buttonId, text) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = false;
            button.textContent = text;
        }
    }

    showSuccess(message) {
        const successEl = document.getElementById('settingsSuccess');
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
        const errorEl = document.getElementById('settingsError');
        const messageEl = document.getElementById('errorMessage');
        if (errorEl && messageEl) {
            messageEl.textContent = message;
            errorEl.style.display = 'flex';
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 5000);
        }
    }

    hideMessages() {
        const successEl = document.getElementById('settingsSuccess');
        const errorEl = document.getElementById('settingsError');
        if (successEl) successEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
    }

    showTemporaryMessage(message, type = 'info', duration = 3000) {
        let msgContainer = document.getElementById('temporaryMessage');
        if (!msgContainer) {
            msgContainer = document.createElement('div');
            msgContainer.id = 'temporaryMessage';
            msgContainer.className = 'temporary-message';
            document.body.appendChild(msgContainer);
        }
        
        msgContainer.textContent = message;
        msgContainer.className = `temporary-message ${type}`;
        msgContainer.style.display = 'block';
        
        setTimeout(() => {
            msgContainer.style.display = 'none';
        }, duration);
    }

    // ========== 14. EVENT LISTENERS ==========
    setupSettingsEventListeners() {
        console.log('Setting up enhanced settings event listeners...');
        
        try {
            document.addEventListener('click', (e) => {
                const navItem = e.target.closest('.settings-nav-item');
                if (navItem) {
                    const section = navItem.getAttribute('data-section');
                    this.showSection(section);
                }
            });

            const profileForm = document.getElementById('profileForm');
            if (profileForm) {
                profileForm.removeEventListener('submit', this.handleProfileSave);
                profileForm.addEventListener('submit', (e) => this.handleProfileSave(e));
            }

            const emailForm = document.getElementById('emailForm');
            if (emailForm) {
                emailForm.removeEventListener('submit', this.handleEmailChange);
                emailForm.addEventListener('submit', (e) => this.handleEmailChange(e));
            }

            const passwordForm = document.getElementById('passwordForm');
            if (passwordForm) {
                passwordForm.removeEventListener('submit', this.handlePasswordChange);
                passwordForm.addEventListener('submit', (e) => this.handlePasswordChange(e));
            }

            const logoutOption = document.getElementById('logoutOption');
            const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
            const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
            
            if (logoutOption) {
                logoutOption.removeEventListener('click', this.boundShowLogoutConfirmation);
                this.boundShowLogoutConfirmation = () => this.showLogoutConfirmation();
                logoutOption.addEventListener('click', this.boundShowLogoutConfirmation);
            }
            
            if (confirmLogoutBtn) {
                confirmLogoutBtn.removeEventListener('click', this.boundConfirmLogout);
                this.boundConfirmLogout = () => this.confirmLogout();
                confirmLogoutBtn.addEventListener('click', this.boundConfirmLogout);
            }
            
            if (cancelLogoutBtn) {
                cancelLogoutBtn.removeEventListener('click', this.boundHideLogoutConfirmation);
                this.boundHideLogoutConfirmation = () => this.hideLogoutConfirmation();
                cancelLogoutBtn.addEventListener('click', this.boundHideLogoutConfirmation);
            }

            document.addEventListener('click', (e) => {
                const toggleBtn = e.target.closest('.toggle-password-btn');
                if (toggleBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetId = toggleBtn.getAttribute('data-target');
                    this.togglePasswordVisibility(targetId, toggleBtn);
                }
            });

            const viewCodesBtn = document.getElementById('viewCodesBtn');
            const generateCodesBtn = document.getElementById('generateCodesBtn');
            const downloadCodesBtn = document.getElementById('downloadCodesBtn');
            const copyAllCodesBtn = document.getElementById('copyAllCodesBtn');
            const hideCodesBtn = document.getElementById('hideCodesBtn');
            const confirmGenerateBtn = document.getElementById('confirmGenerateBtn');
            const cancelGenerateBtn = document.getElementById('cancelGenerateBtn');

            if (viewCodesBtn) viewCodesBtn.addEventListener('click', () => this.viewRecoveryCodes());
            if (generateCodesBtn) generateCodesBtn.addEventListener('click', () => this.showGenerateConfirmation());
            if (downloadCodesBtn) downloadCodesBtn.addEventListener('click', () => this.downloadRecoveryCodes());
            if (copyAllCodesBtn) copyAllCodesBtn.addEventListener('click', () => this.copyAllRecoveryCodes());
            if (hideCodesBtn) hideCodesBtn.addEventListener('click', () => this.hideRecoveryCodes());
            if (confirmGenerateBtn) confirmGenerateBtn.addEventListener('click', () => this.confirmGenerateCodes());
            if (cancelGenerateBtn) cancelGenerateBtn.addEventListener('click', () => this.hideGenerateConfirmation());

            const deactivateOption = document.getElementById('deactivateOption');
            const deleteOption = document.getElementById('deleteOption');
            const confirmDeactivateBtn = document.getElementById('confirmDeactivateBtn');
            const cancelDeactivateBtn = document.getElementById('cancelDeactivateBtn');
            const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
            const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

            if (deactivateOption) deactivateOption.addEventListener('click', () => this.showDeactivateConfirmation());
            if (deleteOption) deleteOption.addEventListener('click', () => this.showDeleteConfirmation());
            if (confirmDeactivateBtn) confirmDeactivateBtn.addEventListener('click', () => this.deactivateAccount());
            if (cancelDeactivateBtn) cancelDeactivateBtn.addEventListener('click', () => this.hideDeactivateConfirmation());
            if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', () => this.deleteAccount());
            if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => this.hideDeleteConfirmation());

            const durationBtns = document.querySelectorAll('.duration-btn');
            durationBtns.forEach(btn => {
                btn.removeEventListener('click', this.handleDurationSelect);
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const days = btn.getAttribute('data-days');
                    if (days) {
                        document.querySelectorAll('.duration-btn').forEach(b => {
                            b.classList.remove('active');
                        });
                        btn.classList.add('active');
                        const durationInput = document.getElementById('deactivateDuration');
                        if (durationInput) {
                            durationInput.value = days;
                        }
                        console.log(`Deactivation duration set to ${days} days`);
                    }
                });
            });

            console.log('Enhanced settings event listeners setup complete');
        } catch (error) {
            console.error('Error setting up settings event listeners:', error);
        }
    }

    togglePasswordVisibility(inputId, button) {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        const icon = button.querySelector('.material-icons');
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) icon.textContent = 'visibility_off';
        } else {
            input.type = 'password';
            if (icon) icon.textContent = 'visibility';
        }
    }

    initializeCustomDropdowns() {
        // Custom dropdown initialization if needed
    }

    handleLogout() {
        if (window.authModule && typeof window.authModule.logout === 'function') {
            window.authModule.logout();
        } else {
            localStorage.clear();
            location.reload();
        }
    }

    checkAccountStatus() {
        if (!this.userData) return false;
        
        const blockedStatuses = ['suspended', 'deactivated', 'pending'];
        
        if (blockedStatuses.includes(this.userData.status)) {
            let message = '';
            switch(this.userData.status) {
                case 'suspended':
                    message = 'Your account is suspended. Please contact support.';
                    break;
                case 'deactivated':
                    message = 'Your account is deactivated. Please contact support to reactivate.';
                    break;
                case 'pending':
                    message = 'Your account is pending approval.';
                    break;
            }
            
            this.showError(message);
            return false;
        }
        
        return true;
    }

    executeLogout() {
        window.dispatchEvent(new CustomEvent('authLogoutRequest'));
        if (window.authModule) {
            window.authModule.logout();
        }
        this.currentUser = null;
        this.userData = null;
        console.log('Logout initiated');
    }
}

// Initialize settings module
const settingsModule = new SettingsModule();
window.settingsModule = settingsModule;

// Listen for auth ready event
window.addEventListener('authReady', function(event) {
    console.log('Auth ready, initializing settings module');
    settingsModule.initSettings();
});

// Also listen for auth success event
window.addEventListener('authSuccess', function(event) {
    console.log('Auth success, updating settings module');
    settingsModule.initSettings();
});