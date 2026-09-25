// Enhanced Settings Module - Adapted for AuthDataManager (single database)
class SettingsModule {
    // ========== 1. CONSTRUCTOR & PROPERTIES ==========
    constructor() {
        this.currentSection = 'profile';
        this.userData = null;
        this.encodedPhone = null;
        this.handlePasswordChange = this.handlePasswordChange.bind(this);
    }

    // ========== 2. INITIALIZATION ==========
    async initSettings() {
        try {
            const authManager = window.authDataManager;

            if (authManager && authManager.isLoggedIn && authManager.isLoggedIn()) {
                this.userData = authManager.getUser();
                this.encodedPhone = authManager.getEncodedPhone();
                console.log('Settings module initialized via authDataManager');
                return true;
            }

            // Fallback: read from localStorage
            this.loadUserDataFromStorage();
            return !!this.userData;
        } catch (error) {
            console.error('Error initializing settings module:', error);
            return false;
        }
    }

    // Helper: get the DB reference (single database now)
    getDB() {
        if (window.authDataManager && window.authDataManager.getDatabase) {
            return window.authDataManager.getDatabase();
        }
        return null;
    }

    // Helper: get ref to a path
    getRef(path = '') {
        if (window.authDataManager && window.authDataManager.getRef) {
            return window.authDataManager.getRef(path);
        }
        return null;
    }

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
        if (strength < 30) { text = 'Weak'; color = 'var(--danger)'; }
        else if (strength < 70) { text = 'Fair'; color = 'var(--warning)'; }
        else { text = 'Strong'; color = 'var(--success)'; }

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
                    if (!input) input = newBtn.parentElement?.querySelector('input');
                }
                if (input) {
                    const icon = newBtn.querySelector('.fas');
                    if (icon) {
                        if (input.type === 'password') {
                            input.type = 'text';
                            icon.classList.remove('fa-eye');
                            icon.classList.add('fa-eye-slash');
                        } else {
                            input.type = 'password';
                            icon.classList.remove('fa-eye-slash');
                            icon.classList.add('fa-eye');
                        }
                    }
                }
            });
        });
    }

    setUserData(userData) {
        this.userData = userData;
        if (userData?.phone) {
            this.encodedPhone = this.encodePhone(userData.phone);
        }
        console.log('User data set in settings module');
    }

    // ========== 4. LOAD USER DATA FROM STORAGE ==========
    loadUserDataFromStorage() {
        try {
            const userDataStr = localStorage.getItem('currentUser');
            if (userDataStr) {
                this.userData = JSON.parse(userDataStr);
                if (this.userData?.phone) {
                    this.encodedPhone = this.encodePhone(this.userData.phone);
                }
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    // ========== 5. INITIALIZE DATABASE ==========
    // No-op in single-database architecture; kept for compatibility
    async initFirebase() {
        console.log('Settings module using authDataManager single database');
    }

    // Legacy multi-DB methods — kept as no-ops to avoid breaking calls
    async fetchDbApps() {
        this.dbApps = [];
    }

    getUserHomeDatabase() {
        return null;
    }

    getDeviceInfo() {
        return {
            platform: navigator.platform,
            language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}`
        };
    }

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

            console.log('Settings module rendered successfully');
        } catch (error) {
            console.error('Error rendering settings module:', error);
        }
    }

    getSettingsHTML() {
        const userName = this.userData?.name || 'User';
        const userPhone = this.userData?.phone || 'Not set';
        const accountCreated = this.userData?.createdAt ?
            new Date(this.userData.createdAt).toLocaleDateString() : 'N/A';
        const lastLogin = this.userData?.lastLogin ?
            new Date(this.userData.lastLogin).toLocaleString() : 'N/A';

        return `
            <div class="settings-container">
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <i class="fas fa-cog"></i>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Account Settings</div>
                        <div class="module-description">Manage your account and phone number information</div>
                    </div>
                </div>
                <div class="settings-grid">
                    <div class="settings-sidebar">
                        <div class="settings-nav-item active" data-section="profile">
                            <i class="fas fa-user settings-nav-icon"></i>
                            <span class="settings-nav-text">Profile</span>
                        </div>
                        <div class="settings-nav-item" data-section="security">
                            <i class="fas fa-lock settings-nav-icon"></i>
                            <span class="settings-nav-text">Password</span>
                        </div>
                        <div class="settings-nav-item" data-section="recovery">
                            <i class="fas fa-key settings-nav-icon"></i>
                            <span class="settings-nav-text">Recovery Codes</span>
                        </div>
                        <div class="settings-nav-item danger" data-section="danger">
                            <i class="fas fa-exclamation-triangle settings-nav-icon"></i>
                            <span class="settings-nav-text">Danger Zone</span>
                        </div>
                    </div>
                    <div class="settings-content">
                        <div class="settings-message success" id="settingsSuccess" style="display: none;">
                            <i class="fas fa-check-circle"></i>
                            <span id="successMessage"></span>
                        </div>
                        <div class="settings-message error" id="settingsError" style="display: none;">
                            <i class="fas fa-exclamation-circle"></i>
                            <span id="errorMessage"></span>
                        </div>

                        <!-- Profile Section -->
                        <div class="settings-section active" id="profile-section">
                            <div class="section-card">
                                <div class="section-card-header">
                                    <div class="section-card-title">
                                        <i class="fas fa-user"></i>
                                        <span>Profile Information</span>
                                    </div>
                                    <div class="section-card-badge">
                                        <i class="fas fa-edit"></i>
                                        Update your personal details
                                    </div>
                                </div>
                                <div class="section-card-content" id="profileForm">
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="fullName">Full Name *</label>
                                            <input type="text" id="fullName" class="form-input"
                                                value="${userName}" required>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="currentPhone">Current Phone</label>
                                            <input type="tel" id="currentPhone" class="form-input"
                                                value="${userPhone}" readonly>
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
                                </div>
                            </div>
                        </div>

                        <!-- Security/Password Section -->
                        <div class="settings-section" id="security-section">
                            <div class="section-card">
                                <div class="section-card-header">
                                    <div class="section-card-title">
                                        <i class="fas fa-lock"></i>
                                        <span>Update Password</span>
                                    </div>
                                    <div class="section-card-badge">
                                        <i class="fas fa-shield-alt"></i>
                                        Required
                                    </div>
                                </div>
                                <form class="section-card-content" id="passwordForm">
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="currentPassword">Current Password</label>
                                            <div class="password-input-group">
                                                <input type="password" id="currentPassword"
                                                    class="form-input" required
                                                    placeholder="Enter your current password">
                                                <button type="button" class="toggle-password-btn"
                                                        data-target="currentPassword">
                                                    <i class="fas fa-eye"></i>
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
                                                    <i class="fas fa-eye"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="confirmPassword">Confirm New Password</label>
                                            <div class="password-input-group">
                                                <input type="password" id="confirmPassword"
                                                    class="form-input" required
                                                    placeholder="Re-enter new password">
                                                <button type="button" class="toggle-password-btn"
                                                        data-target="confirmPassword">
                                                    <i class="fas fa-eye"></i>
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
                            <div class="info">
                                <div class="info-header">
                                    <i class="fas fa-info-circle"></i>
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
                            <div class="section-card">
                                <div class="section-card-header">
                                    <div class="section-card-title">
                                        <i class="fas fa-key"></i>
                                        <span>Recovery Codes</span>
                                    </div>
                                    <div class="section-card-badge">
                                        <i class="fas fa-archive"></i>
                                        Backup
                                    </div>
                                </div>
                                <div class="recovery-stats" id="recoveryStats"></div>

                                <div class="section-option recovery-option" id="viewCodesRow" data-action="view">
                                    <div class="section-option-info">
                                        <div class="section-option-icon">
                                            <i class="fas fa-eye"></i>
                                        </div>
                                        <div>
                                            <div class="section-option-label">View Recovery Codes</div>
                                            <div class="section-option-desc">View your available recovery codes</div>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-right action-indicator"></i>
                                </div>

                                <div class="section-option-container recovery-codes-container" id="recoveryCodesDisplay" style="display: none;">
                                    <div class="codes-display-header">
                                        <i class="fas fa-lock"></i>
                                        <h3>Your Recovery Codes</h3>
                                        <p id="codesStatus">Loading...</p>
                                    </div>
                                    <div class="rec-codes-container" id="codesContainer"></div>
                                    <div class="form-help">Keep these codes in a secure place. Each code can be used only once.</div>
                                    <div class="codes-actions">
                                        <button type="button" class="btn btn-primary" id="copyAllCodesBtn">
                                            <i class="fas fa-copy"></i> Copy All
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="hideCodesBtn">
                                            <i class="fas fa-eye-slash"></i> Hide Codes
                                        </button>
                                    </div>
                                </div>

                                <div class="section-divider"></div>

                                <div class="section-option recovery-option" id="generateCodesRow" data-action="generate">
                                    <div class="section-option-info">
                                        <div class="section-option-icon">
                                            <i class="fas fa-sync-alt"></i>
                                        </div>
                                        <div>
                                            <div class="section-option-label">Generate New Codes</div>
                                            <div class="section-option-desc">Generate a new set of recovery codes (invalidates old ones)</div>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-right action-indicator"></i>
                                </div>

                                <div class="section-option-container recovery-confirmation-container" id="generateCodesConfirmation" style="display: none;">
                                    <div class="confirmation-content">
                                        <p><strong>Warning:</strong></p>
                                        <ul class="section-card-li">
                                            <li>Generating new codes will invalidate all existing recovery codes.</li>
                                            <li>Any unused recovery codes will no longer work for password reset.</li>
                                        </ul>
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

                                <div class="section-divider"></div>

                                <div class="section-option recovery-option" id="downloadCodesRow" data-action="download">
                                    <div class="section-option-info">
                                        <div class="section-option-icon">
                                            <i class="fas fa-download"></i>
                                        </div>
                                        <div>
                                            <div class="section-option-label">Download Codes</div>
                                            <div class="section-option-desc">Download your recovery codes as a text file</div>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-right action-indicator"></i>
                                </div>
                            </div>
                            <div class="info">
                                <div class="info-header">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <h3>Important Security Notice</h3>
                                </div>
                                <div class="info-content">
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
                            <div class="section-card" style="border: 1px solid rgba(185, 45, 45, 0.4);">
                                <div class="section-card-header" style="background: rgba(220, 38, 38, 0.08); border-bottom-color: rgba(185, 45, 45, 0.4);">
                                    <div class="section-card-title">
                                        <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                                        <span style="color: var(--danger);">Danger Zone</span>
                                    </div>
                                    <div class="section-card-badge" style="background: rgba(220, 38, 38, 0.15); color: var(--danger);">
                                        <i class="fas fa-exclamation-circle"></i>
                                        Irreversible
                                    </div>
                                </div>

                                <div class="section-option danger-option" id="logoutOption" data-action="logout">
                                    <div class="section-option-info">
                                        <div class="section-option-icon" style="background: rgba(220, 38, 38, 0.15);">
                                            <i class="fas fa-sign-out-alt warning" style="color: var(--danger);"></i>
                                        </div>
                                        <div>
                                            <div class="section-option-label">Logout Account</div>
                                            <div class="section-option-desc">Sign out from this device and return to the login screen</div>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-right action-indicator"></i>
                                </div>

                                <div class="section-option-container danger-confirmation-container" id="logoutConfirmation" style="display: none;">
                                    <p>Are you sure you want to logout? You will need to sign in again to access your account.</p>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="logoutConfirmText">Confirm</label>
                                            <input type="text" id="logoutConfirmText" class="form-input" placeholder="LOGOUT" required>
                                            <div class="form-help">Type "LOGOUT" to confirm *</div>
                                        </div>
                                    </div>
                                    <div class="confirmation-actions">
                                        <button type="button" class="btn btn-danger" id="confirmLogoutBtn">
                                            <i class="fas fa-sign-out-alt"></i> Logout
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="cancelLogoutBtn">Cancel</button>
                                    </div>
                                </div>

                                <div class="section-divider"></div>

                                <div class="section-option danger-option" id="deactivateOption" data-action="deactivate">
                                    <div class="section-option-info">
                                        <div class="section-option-icon" style="background: rgba(220, 38, 38, 0.15);">
                                            <i class="fas fa-pause-circle warning" style="color: var(--danger);"></i>
                                        </div>
                                        <div>
                                            <div class="section-option-label">Deactivate Account</div>
                                            <div class="section-option-desc">Temporarily disable your account. You can reactivate it later by contacting support.</div>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-right action-indicator"></i>
                                </div>

                                <div class="section-option-container danger-confirmation-container" id="deactivateConfirmation" style="display: none;">
                                    <p><strong>During this period:</strong></p>
                                    <ul class="section-card-li">
                                        <li>You will be immediately logged out</li>
                                        <li>You cannot log in until the cooldown period ends</li>
                                        <li>Account will automatically reactivate after the selected period</li>
                                    </ul>
                                    <div class="cool-down-duration">
                                        <h4>Select Deactivation Duration:</h4>
                                        <div class="duration-options">
                                            <button type="button" class="btn duration-btn ${this.userData?.deactivationDuration === 14 ? 'active' : ''}" data-days="14">14 Days</button>
                                            <button type="button" class="btn duration-btn ${this.userData?.deactivationDuration === 30 ? 'active' : ''}" data-days="30">30 Days</button>
                                        </div>
                                        <input type="hidden" id="deactivateDuration" value="14">
                                    </div>
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="deactivatePassword">Current Password *</label>
                                            <input type="password" id="deactivatePassword" class="form-input" placeholder="Enter your current password to confirm" required>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="deactivateConfirmText">Confirm</label>
                                            <input type="text" id="deactivateConfirmText" class="form-input" placeholder="DEACTIVATE" required>
                                            <div class="form-help">Type "DEACTIVATE" to confirm *</div>
                                        </div>
                                    </div>
                                    <div class="confirmation-actions">
                                        <button type="button" class="btn btn-danger" id="confirmDeactivateBtn">
                                            <i class="fas fa-ban"></i> Deactivate
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="cancelDeactivateBtn">Cancel</button>
                                    </div>
                                </div>

                                <div class="section-divider"></div>

                                <div class="section-option danger-option" id="deleteOption" data-action="delete">
                                    <div class="section-option-info">
                                        <div class="section-option-icon" style="background: rgba(220, 38, 38, 0.15);">
                                            <i class="fas fa-trash-alt danger" style="color: var(--danger);"></i>
                                        </div>
                                        <div>
                                            <div class="section-option-label">Permanently Delete Account</div>
                                            <div class="section-option-desc">Completely remove your account and all associated data. This cannot be undone.</div>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-right action-indicator"></i>
                                </div>

                                <div class="section-option-container danger-confirmation-container" id="deleteConfirmation" style="display: none;">
                                    <div class="form-row">
                                        <div class="form-group">
                                            <label class="form-label" for="deletePassword">Current Password *</label>
                                            <input type="password" id="deletePassword" class="form-input" placeholder="Enter your current password to confirm" required>
                                            <div class="form-help"><p>This action <strong>cannot be undone</strong>. All your data will be permanently deleted.</p></div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label" for="deleteConfirmationText">Confirm</label>
                                            <input type="text" id="deleteConfirmationText" class="form-input" placeholder="DELETE MY ACCOUNT" required>
                                            <div class="form-help">Type "DELETE MY ACCOUNT" to confirm *</div>
                                        </div>
                                    </div>
                                    <div class="form-group checkbox-group">
                                        <input type="checkbox" id="deleteAgreement" required>
                                        <label for="deleteAgreement">
                                            <p><strong> I understand that:</strong></p>
                                            <ul class="section-card-li">
                                                <li>This action is permanent and cannot be reversed</li>
                                                <li>I will lose access to all my files, photos, and notes</li>
                                                <li>I cannot recover my account after deletion</li>
                                            </ul>
                                        </label>
                                    </div>
                                    <div class="confirmation-actions">
                                        <button type="button" class="btn btn-danger" id="confirmDeleteBtn">
                                            <i class="fas fa-trash"></i> Delete
                                        </button>
                                        <button type="button" class="btn btn-secondary" id="cancelDeleteBtn">Cancel</button>
                                    </div>
                                </div>
                            </div>
                            <div class="info">
                                <div class="info-header">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <h3>Important Security Notice</h3>
                                </div>
                                <div class="info-content">
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

        if (section === 'recovery') {
            this.loadRecoveryCodes();
        }
    }

    // ========== 8. FORM HANDLING ==========
    async handleProfileSave(e) {
        e.preventDefault();

        if (!this.checkAccountStatus()) return;

        const db = this.getDB();
        if (!db) {
            this.showError('Database not available. Please refresh the page.');
            return;
        }

        const fullName = document.getElementById('fullName').value.trim();

        if (!fullName) {
            this.showError('Full name is required.');
            return;
        }

        try {
            this.showLoading('saveProfileBtn', 'Saving...');
            this.hideMessages();

            const encodedPhone = this.getEncodedPhone();

            const updateData = {
                name: fullName,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            };

            await db.ref(`users/${encodedPhone}`).update(updateData);

            // Update local state
            this.userData.name = fullName;
            this.userData.updatedAt = Date.now();
            localStorage.setItem('currentUser', JSON.stringify(this.userData));

            if (window.authDataManager && window.authDataManager.currentUser) {
                window.authDataManager.currentUser.name = fullName;
            }

            if (window.sidebarManager) {
                window.sidebarManager.updateUserProfile();
            }

            // Refresh the rendered name/initials in the app header
            if (window.xDrive && window.xDrive.updateUserAvatar) {
                window.xDrive.updateUserAvatar();
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
        console.log('handlePasswordChange called');

        if (!this.checkAccountStatus()) return;

        const db = this.getDB();
        if (!db) {
            this.showError('Database not available. Please refresh the page.');
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

            const encodedPhone = this.getEncodedPhone();
            console.log('Encoded phone for password change:', encodedPhone);

            const userRef = db.ref(`users/${encodedPhone}`);
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

            // Update local user data
            this.userData.password = newPassword;
            this.userData.passwordUpdatedAt = Date.now();
            this.userData.updatedAt = Date.now();
            localStorage.setItem('currentUser', JSON.stringify(this.userData));

            if (window.authDataManager && window.authDataManager.currentUser) {
                window.authDataManager.currentUser.password = newPassword;
                window.authDataManager.currentUser.passwordUpdatedAt = Date.now();
                window.authDataManager.currentUser.updatedAt = Date.now();
            }

            await this.logPasswordChange(encodedPhone);

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

    populateFormData() {
        if (!this.userData) return;
        const currentPhone = this.userData.phone;

        const profilePhoneInput = document.getElementById('currentPhone');
        if (profilePhoneInput) profilePhoneInput.value = currentPhone || '';
    }

    resetPasswordForm() {
        const form = document.getElementById('passwordForm');
        if (form) form.reset();
    }

    // ========== 9. RECOVERY CODES ==========
    async viewRecoveryCodes() {
        try {
            if (!this.userData?.recoveryCodes) {
                // Try to fetch fresh
                await this.loadRecoveryCodes();
            }

            if (!this.userData?.recoveryCodes) {
                this.showError('No recovery codes found for your account.');
                return;
            }

            this.hideGenerateConfirmation();

            document.getElementById('recoveryCodesDisplay').style.display = 'block';

            const codes = Array.isArray(this.userData.recoveryCodes)
                ? this.userData.recoveryCodes
                : Object.values(this.userData.recoveryCodes);

            const usedCount = codes.filter(code => code.used).length;
            const availableCount = codes.length - usedCount;

            document.getElementById('codesStatus').textContent =
                `${availableCount} codes available, ${usedCount} used`;

            const codesContainer = document.getElementById('codesContainer');
            codesContainer.innerHTML = codes.map((codeObj, index) => `
                <div class="rec-code-item ${codeObj.used ? 'used' : ''}">
                    <span class="rec-code-number">${index + 1}.</span>
                    <span class="rec-code-value">${codeObj.code}</span>
                    ${!codeObj.used ? `
                        <button class="copy-single-btn" data-code="${codeObj.code}">
                            <i class="fas fa-copy"></i>
                        </button>
                    ` : `
                        <i class="fas fa-ban used-icon"></i>
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
                if (code) await this.copySingleRecoveryCode(code);
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
                btn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { btn.innerHTML = originalIcon; }, 1500);
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

            const codes = Array.isArray(this.userData.recoveryCodes)
                ? this.userData.recoveryCodes
                : Object.values(this.userData.recoveryCodes);

            const availableCodes = codes.filter(c => !c.used).map(c => c.code);

            if (availableCodes.length === 0) {
                this.showError('No available recovery codes to copy.');
                return;
            }

            await navigator.clipboard.writeText(availableCodes.join('\n'));
            this.showSuccess(`${availableCodes.length} recovery codes copied to clipboard!`);

            const copyAllBtn = document.getElementById('copyAllCodesBtn');
            if (copyAllBtn) {
                const originalIcon = copyAllBtn.innerHTML;
                copyAllBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { copyAllBtn.innerHTML = originalIcon; }, 1500);
            }
        } catch (error) {
            console.error('Error copying codes:', error);
            this.showError('Failed to copy recovery codes.');
        }
    }

    hideRecoveryCodes() {
        document.getElementById('recoveryCodesDisplay').style.display = 'none';
        const codesContainer = document.getElementById('codesContainer');
        if (codesContainer) codesContainer.innerHTML = '';
    }

    async downloadRecoveryCodes() {
        try {
            if (!this.userData?.recoveryCodes) {
                this.showError('No recovery codes to download.');
                return;
            }

            const codes = Array.isArray(this.userData.recoveryCodes)
                ? this.userData.recoveryCodes
                : Object.values(this.userData.recoveryCodes);

            const availableCodes = codes.filter(c => !c.used);
            const usedCodes = codes.filter(c => c.used);

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
            const db = this.getDB();
            if (!db || !this.userData) return;

            const encodedPhone = this.getEncodedPhone();
            const snapshot = await db.ref(`users/${encodedPhone}/recoveryCodes`).once('value');

            if (snapshot.exists()) {
                this.userData.recoveryCodes = snapshot.val();
                localStorage.setItem('currentUser', JSON.stringify(this.userData));
            }

            this.updateRecoveryStats();
        } catch (error) {
            console.error('Error loading recovery codes:', error);
        }
    }

    updateRecoveryStats() {
        const recoveryStats = document.getElementById('recoveryStats');
        if (!recoveryStats || !this.userData?.recoveryCodes) return;

        const codes = Array.isArray(this.userData.recoveryCodes)
            ? this.userData.recoveryCodes
            : Object.values(this.userData.recoveryCodes);

        const totalCodes = codes.length;
        const usedCodes = codes.filter(c => c.used).length;
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
        const el = document.getElementById('generateCodesConfirmation');
        if (el) el.style.display = 'none';
        const pw = document.getElementById('generateConfirmPassword');
        const txt = document.getElementById('generateConfirmText');
        if (pw) pw.value = '';
        if (txt) txt.value = '';
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

            const db = this.getDB();
            if (!db) throw new Error('Database not available');

            const encodedPhone = this.getEncodedPhone();
            const userRef = db.ref(`users/${encodedPhone}`);
            const userSnapshot = await userRef.once('value');

            if (!userSnapshot.exists()) {
                throw new Error('User account not found');
            }

            const userData = userSnapshot.val();

            if (userData.password !== password) {
                throw new Error('Current password is incorrect');
            }

            const authManager = window.authDataManager;
            const recoveryCodes = authManager && authManager.generateRecoveryCodes
                ? authManager.generateRecoveryCodes(5)
                : this._generateRecoveryCodesFallback(5);

            this.showLoading('confirmGenerateBtn', 'Generating...');

            await userRef.update({
                recoveryCodes: recoveryCodes,
                recoveryCodesGenerated: firebase.database.ServerValue.TIMESTAMP,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });

            this.userData.recoveryCodes = recoveryCodes;
            this.userData.recoveryCodesGenerated = Date.now();
            localStorage.setItem('currentUser', JSON.stringify(this.userData));

            if (window.authDataManager && window.authDataManager.currentUser) {
                window.authDataManager.currentUser.recoveryCodes = recoveryCodes;
                window.authDataManager.currentUser.recoveryCodesGenerated = Date.now();
            }

            this.hideGenerateConfirmation();
            this.showSuccess('New recovery codes generated successfully!');

            setTimeout(() => { this.viewRecoveryCodes(); }, 500);
            this.updateRecoveryStats();

        } catch (error) {
            console.error('Error generating recovery codes:', error);
            this.showError(error.message || 'Failed to generate new recovery codes.');
        } finally {
            this.hideLoading('confirmGenerateBtn', 'Generate New Codes');
        }
    }

    // Fallback if authDataManager method is missing
    _generateRecoveryCodesFallback(count = 5) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = Array(8)
                .fill(0)
                .map(() => Math.random().toString(36).charAt(2))
                .join('')
                .toUpperCase()
                .replace(/O|I|0|1/g, () => Math.random().toString(36).charAt(2).toUpperCase());

            codes.push({
                code: code,
                used: false,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                expiresAt: null
            });
        }
        return codes;
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
        if (logoutConfirmation) logoutConfirmation.style.display = 'none';
        const confirmInput = document.getElementById('logoutConfirmText');
        if (confirmInput) confirmInput.value = '';
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

            if (window.authDataManager && typeof window.authDataManager.logout === 'function') {
                window.authDataManager.logout();
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
                if (days === savedDuration) btn.classList.add('active');
                else btn.classList.remove('active');

                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);

                newBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const selectedDays = newBtn.getAttribute('data-days');
                    deactivateConfirmation.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
                    newBtn.classList.add('active');
                    const durationInput = document.getElementById('deactivateDuration');
                    if (durationInput) durationInput.value = selectedDays;
                });
            });
        }

        const passwordInput = document.getElementById('deactivatePassword');
        const confirmInput = document.getElementById('deactivateConfirmText');
        if (passwordInput) passwordInput.value = '';
        if (confirmInput) confirmInput.value = '';
    }

    hideDeactivateConfirmation() {
        const el = document.getElementById('deactivateConfirmation');
        if (el) el.style.display = 'none';
        const pw = document.getElementById('deactivatePassword');
        const txt = document.getElementById('deactivateConfirmText');
        if (pw) pw.value = '';
        if (txt) txt.value = '';
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

            const db = this.getDB();
            if (!db) throw new Error('Database not available');

            const encodedPhone = this.getEncodedPhone();
            const userRef = db.ref(`users/${encodedPhone}`);
            const userSnapshot = await userRef.once('value');

            if (!userSnapshot.exists()) throw new Error('User account not found');

            const userData = userSnapshot.val();
            if (userData.password !== password) throw new Error('Current password is incorrect');

            const deactivationEnd = Date.now() + (durationDays * 24 * 60 * 60 * 1000);

            this.showLoading('confirmDeactivateBtn', 'Deactivating...');

            await userRef.update({
                status: 'deactivated',
                deactivationStart: firebase.database.ServerValue.TIMESTAMP,
                deactivationEnd: deactivationEnd,
                deactivationDuration: durationDays,
                lastActive: firebase.database.ServerValue.TIMESTAMP
            });

            await this.logDeactivation(encodedPhone, durationDays);

            this.userData.status = 'deactivated';
            this.userData.deactivationStart = Date.now();
            this.userData.deactivationEnd = deactivationEnd;
            this.userData.deactivationDuration = durationDays;
            localStorage.setItem('currentUser', JSON.stringify(this.userData));

            this.showSuccess(`Account deactivated for ${durationDays} days! You will be logged out in 3 seconds...`);

            setTimeout(() => {
                if (window.authDataManager) window.authDataManager.logout();
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
        const el = document.getElementById('deleteConfirmation');
        if (el) el.style.display = 'none';
        const pw = document.getElementById('deletePassword');
        const txt = document.getElementById('deleteConfirmationText');
        const ag = document.getElementById('deleteAgreement');
        if (pw) pw.value = '';
        if (txt) txt.value = '';
        if (ag) ag.checked = false;
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

            const db = this.getDB();
            if (!db) throw new Error('Database not available');

            const encodedPhone = this.getEncodedPhone();
            const userRef = db.ref(`users/${encodedPhone}`);
            const userSnapshot = await userRef.once('value');

            if (!userSnapshot.exists()) throw new Error('User account not found');

            const userData = userSnapshot.val();
            if (userData.password !== password) throw new Error('Password is incorrect');

            this.showLoading('confirmDeleteBtn', 'Deleting Account...');

            await this.logDeletion(encodedPhone);

            // Delete both nodes
            await userRef.remove();
            await db.ref(`userData/${encodedPhone}`).remove();

            localStorage.clear();
            sessionStorage.clear();

            this.showSuccess('Account deleted successfully. You will be redirected...');

            setTimeout(() => {
                if (window.authDataManager) window.authDataManager.logout();
            }, 2000);

        } catch (error) {
            console.error('Account deletion error:', error);
            this.showError(error.message || 'Failed to delete account. Please try again.');
            this.hideLoading('confirmDeleteBtn', 'Permanently Delete Account');
        }
    }

    // ========== 11. LOGGING ==========
    async logPasswordChange(encodedPhone) {
        try {
            const db = this.getDB();
            if (!db) return;

            await db.ref(`userActivity/${encodedPhone}/password_changes`).push({
                type: 'password_changed',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 100),
                device: this.getDeviceInfo()
            });
        } catch (error) {
            console.error('Error logging password change:', error);
        }
    }

    async logDeactivation(encodedPhone, durationDays) {
        try {
            const db = this.getDB();
            if (!db) return;

            await db.ref(`userActivity/${encodedPhone}/account_actions`).push({
                type: 'account_deactivated',
                durationDays: durationDays,
                deactivatedUntil: Date.now() + (durationDays * 24 * 60 * 60 * 1000),
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 200),
                ip: await this.getClientIP()
            });

            await db.ref('adminLogs/accountDeactivations').push({
                phone: this.userData.phone,
                encodedPhone: encodedPhone,
                durationDays: durationDays,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                deactivatedUntil: Date.now() + (durationDays * 24 * 60 * 60 * 1000)
            });
        } catch (error) {
            console.error('Error logging deactivation:', error);
        }
    }

    async logDeletion(encodedPhone) {
        try {
            const db = this.getDB();
            if (!db) return;

            await db.ref(`userActivity/${encodedPhone}/account_actions`).push({
                type: 'account_deleted',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userAgent: navigator.userAgent.substring(0, 200),
                ip: await this.getClientIP()
            });

            await db.ref('adminLogs/accountDeletions').push({
                phone: this.userData.phone,
                encodedPhone: encodedPhone,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        } catch (error) {
            console.error('Error logging deletion:', error);
        }
    }

    // ========== 12. UTILITY METHODS ==========
    extractDbNameFromUrl(url) {
        if (!url) return 'Default';
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.split('.')[0] || 'Database';
        } catch {
            return url.substring(0, 20) + '...';
        }
    }

    encodePhone(phone) {
        if (!phone) return '';
        const cleaned = phone.replace(/[^\d+]/g, '');
        return cleaned.replace(/\./g, ',').replace(/@/g, '-at-');
    }

    // ========== 13. UI HELPERS ==========
    showLoading(buttonId, text) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = true;
            button.innerHTML = `${text}`;
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
            setTimeout(() => { successEl.style.display = 'none'; }, 3000);
        }
    }

    showError(message) {
        const errorEl = document.getElementById('settingsError');
        const messageEl = document.getElementById('errorMessage');
        if (errorEl && messageEl) {
            messageEl.textContent = message;
            errorEl.style.display = 'flex';
            setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
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
        setTimeout(() => { msgContainer.style.display = 'none'; }, duration);
    }

    // ========== 14. EVENT LISTENERS ==========
    setupSettingsEventListeners() {
        console.log('Setting up enhanced settings event listeners...');

        try {
            // Navigation
            document.addEventListener('click', (e) => {
                const navItem = e.target.closest('.settings-nav-item');
                if (navItem) {
                    const section = navItem.getAttribute('data-section');
                    this.showSection(section);
                }
            });

            // Profile Form
            const profileForm = document.getElementById('profileForm');
            if (profileForm) {
                profileForm.removeEventListener('submit', this.handleProfileSave);
                profileForm.addEventListener('submit', (e) => this.handleProfileSave(e));
            }

            // Password Form
            const passwordForm = document.getElementById('passwordForm');
            if (passwordForm) {
                passwordForm.removeEventListener('submit', this.handlePasswordChange);
                passwordForm.addEventListener('submit', this.handlePasswordChange);
            }

            // Password toggles
            document.addEventListener('click', (e) => {
                const toggleBtn = e.target.closest('.toggle-password-btn');
                if (toggleBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetId = toggleBtn.getAttribute('data-target');
                    this.togglePasswordVisibility(targetId, toggleBtn);
                }
            });

            // Cancel password button
            const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
            if (cancelPasswordBtn) {
                cancelPasswordBtn.onclick = () => this.resetPasswordForm();
            }

            // Recovery — View codes
            const viewCodesRow = document.getElementById('viewCodesRow');
            if (viewCodesRow) {
                viewCodesRow.onclick = () => {
                    const genConf = document.getElementById('generateCodesConfirmation');
                    if (genConf) genConf.style.display = 'none';
                    const codesDisplay = document.getElementById('recoveryCodesDisplay');
                    if (codesDisplay.style.display === 'none') this.viewRecoveryCodes();
                    else codesDisplay.style.display = 'none';
                };
            }

            // Recovery — Generate codes
            const generateCodesRow = document.getElementById('generateCodesRow');
            if (generateCodesRow) {
                generateCodesRow.onclick = () => {
                    const codesDisplay = document.getElementById('recoveryCodesDisplay');
                    if (codesDisplay) codesDisplay.style.display = 'none';
                    const genConf = document.getElementById('generateCodesConfirmation');
                    if (genConf.style.display === 'none') this.showGenerateConfirmation();
                    else genConf.style.display = 'none';
                };
            }

            // Recovery — Download codes
            const downloadCodesRow = document.getElementById('downloadCodesRow');
            if (downloadCodesRow) downloadCodesRow.onclick = () => this.downloadRecoveryCodes();

            // Recovery — Cancel generate
            const cancelGenerate = document.getElementById('cancelGenerateBtn');
            if (cancelGenerate) cancelGenerate.onclick = () => this.hideGenerateConfirmation();

            // Recovery — Confirm generate
            const confirmGenerate = document.getElementById('confirmGenerateBtn');
            if (confirmGenerate) confirmGenerate.onclick = () => this.confirmGenerateCodes();

            // Recovery — Hide codes
            const hideCodes = document.getElementById('hideCodesBtn');
            if (hideCodes) hideCodes.onclick = () => this.hideRecoveryCodes();

            // Recovery — Copy all
            const copyAll = document.getElementById('copyAllCodesBtn');
            if (copyAll) copyAll.onclick = () => this.copyAllRecoveryCodes();

            // Danger — toggle confirmation panels
            document.querySelectorAll('.danger-option').forEach(option => {
                option.onclick = () => {
                    const action = option.dataset.action;
                    document.querySelectorAll('.danger-confirmation-container').forEach(container => {
                        container.style.display = 'none';
                    });
                    const targetContainer = document.getElementById(`${action}Confirmation`);
                    if (targetContainer) {
                        targetContainer.style.display = 'block';
                        targetContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                };
            });

            // Danger — Cancel buttons
            const cancelLogout = document.getElementById('cancelLogoutBtn');
            if (cancelLogout) cancelLogout.onclick = () => {
                document.getElementById('logoutConfirmation').style.display = 'none';
            };

            const cancelDeactivate = document.getElementById('cancelDeactivateBtn');
            if (cancelDeactivate) cancelDeactivate.onclick = () => {
                document.getElementById('deactivateConfirmation').style.display = 'none';
            };

            const cancelDelete = document.getElementById('cancelDeleteBtn');
            if (cancelDelete) cancelDelete.onclick = () => {
                document.getElementById('deleteConfirmation').style.display = 'none';
            };

            // Danger — Confirm buttons
            const confirmLogout = document.getElementById('confirmLogoutBtn');
            if (confirmLogout) confirmLogout.onclick = () => this.confirmLogout();

            const confirmDeactivate = document.getElementById('confirmDeactivateBtn');
            if (confirmDeactivate) confirmDeactivate.onclick = () => this.deactivateAccount();

            const confirmDelete = document.getElementById('confirmDeleteBtn');
            if (confirmDelete) confirmDelete.onclick = () => this.deleteAccount();

            // Deactivation duration buttons
            document.querySelectorAll('.duration-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    const days = btn.getAttribute('data-days');
                    if (days) {
                        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const durationInput = document.getElementById('deactivateDuration');
                        if (durationInput) durationInput.value = days;
                    }
                };
            });

            console.log('Enhanced settings event listeners setup complete');
        } catch (error) {
            console.error('Error setting up settings event listeners:', error);
        }
    }

    togglePasswordVisibility(inputId, button) {
        const input = document.getElementById(inputId);
        if (!input) return;

        const icon = button.querySelector('.fas');
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
        } else {
            input.type = 'password';
            if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
        }
    }

    initializeCustomDropdowns() {
        // No-op
    }

    handleLogout() {
        if (window.authDataManager && typeof window.authDataManager.logout === 'function') {
            window.authDataManager.logout();
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
            switch (this.userData.status) {
                case 'suspended': message = 'Your account is suspended. Please contact support.'; break;
                case 'deactivated': message = 'Your account is deactivated. Please contact support to reactivate.'; break;
                case 'pending': message = 'Your account is pending approval.'; break;
            }
            this.showError(message);
            return false;
        }

        return true;
    }

    executeLogout() {
        window.dispatchEvent(new CustomEvent('authLogoutRequest'));
        if (window.authDataManager) window.authDataManager.logout();
        this.userData = null;
        console.log('Logout initiated');
    }

    // ========== 15. NORMALIZED PHONE ENCODING ==========
    getEncodedPhone() {
        if (this.encodedPhone) return this.encodedPhone;

        if (!this.userData || !this.userData.phone) {
            throw new Error('User phone not available');
        }

        let normalized = this.userData.phone;

        if (typeof PhoneValidator !== 'undefined') {
            const validation = PhoneValidator.validatePhone(this.userData.phone);
            if (validation.valid) {
                normalized = validation.normalized;
            } else {
                console.warn('PhoneValidator rejected phone:', validation.reason);
            }
        }

        // Update stored phone if it changed
        if (this.userData.phone !== normalized) {
            console.log(`Normalizing phone: ${this.userData.phone} → ${normalized}`);
            this.userData.phone = normalized;
            localStorage.setItem('currentUser', JSON.stringify(this.userData));
            if (window.authDataManager && window.authDataManager.currentUser) {
                window.authDataManager.currentUser.phone = normalized;
                window.authDataManager.encodedPhone = this.encodePhone(normalized);
            }
        }

        this.encodedPhone = this.encodePhone(normalized);
        return this.encodedPhone;
    }
}

// Initialize settings module
const settingsModule = new SettingsModule();
window.settingsModule = settingsModule;

// Listen for auth ready/success — settings will pick up the new user data
window.addEventListener('authReady', () => {
    console.log('Auth ready, initializing settings module');
    settingsModule.initSettings();
});

window.addEventListener('authSuccess', () => {
    console.log('Auth success, updating settings module');
    settingsModule.initSettings();
});