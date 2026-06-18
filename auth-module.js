// ==============================================
// AUTHENTICATION MODULE - INTEGRATED INTO INDEX.HTML
// ==============================================

class AuthModule {
    constructor() {
        // Firebase configuration
        this.masterConfig = { 
            databaseURL: "https://pribox-apps-default-rtdb.europe-west1.firebasedatabase.app/" 
        };
        
        this.masterApp = null;
        this.masterDB = null;
        this.dbApps = [];
        
        // State
        this.isAuthenticated = false;
        this.currentUser = null;
        this.userHomeDatabase = null;
        
        // DOM elements for auth UI (will be created dynamically)
        this.authContainer = null;
        this.authForms = null;
        
        // Add timeout configuration
        this.TIMEOUT_DURATION = 30000; // 30 seconds
        
        this.init();
    }
    
    // Utility method to add timeout to promises
    withTimeout(promise, operationName = 'Operation') {
        let timeoutId;
        
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${this.TIMEOUT_DURATION/1000} seconds. Please check your internet connection and try again.`));
            }, this.TIMEOUT_DURATION);
        });
        
        return Promise.race([promise, timeoutPromise]).finally(() => {
            clearTimeout(timeoutId);
        });
    }
    
    // Wrapper for Firebase operations with timeout
    async firebaseOperation(promise, operationName) {
        try {
            return await this.withTimeout(promise, operationName);
        } catch (error) {
            if (error.message.includes('timed out')) {
                console.error(`${operationName} timeout:`, error);
                throw new Error(`Connection timeout. Please check your internet connection and try again.`);
            }
            throw error;
        }
    }
    
    init() {
        // Initialize Firebase
        this.masterApp = firebase.initializeApp(this.masterConfig, "masterApp");
        this.masterDB = this.masterApp.database();
        
        // Check authentication state
        this.checkAuthState();
    }
    
    async checkAuthState() {
        try {
            // Try to get user from localStorage first
            const savedUser = localStorage.getItem('currentUser');
            const savedMasterDB = localStorage.getItem('masterDBConfig');
            const savedHomeDBUrl = localStorage.getItem('userHomeDatabaseUrl');
            
            if (savedUser && savedMasterDB) {
                this.currentUser = JSON.parse(savedUser);
                this.isAuthenticated = true;
                
                // VERIFY ACCOUNT STATUS FROM SERVER with timeout
                try {
                    const verifiedStatus = await this.firebaseOperation(
                        this.verifyAccountStatusFromServer(),
                        'Account status verification'
                    );
                    
                    // Check if account is in a blocked state
                    if (verifiedStatus === 'suspended' || verifiedStatus === 'deactivated') {
                        console.warn(`Account is ${verifiedStatus}, forcing logout`);
                        
                        // For deactivated accounts, check if cooldown period has ended
                        if (verifiedStatus === 'deactivated') {
                            const deactivationEnd = await this.getDeactivationEnd();
                            if (deactivationEnd && Date.now() > deactivationEnd) {
                                // Cooldown period has ended, reactivate account
                                await this.reactivateAccount();
                                console.log('Account reactivated after cooldown period');
                            } else {
                                // Still in cooldown period
                                const remainingDays = deactivationEnd ? 
                                    Math.ceil((deactivationEnd - Date.now()) / (24 * 60 * 60 * 1000)) : 0;
                                
                                // Clear auth data but keep email
                                const lastEmail = localStorage.getItem('lastEmail');
                                this.clearAuthData();
                                
                                // Show auth UI with cooldown message
                                this.showAuthUI();
                                
                                if (remainingDays > 0) {
                                    this.showAuthError('signin-error', 
                                        `Account is deactivated. Please try again in ${remainingDays} day(s).`);
                                } else {
                                    this.showAuthError('signin-error', 
                                        'Your account has been deactivated. Please contact support.');
                                }
                                
                                return;
                            }
                        } else if (verifiedStatus === 'suspended') {
                            // Clear auth data but keep email
                            const lastEmail = localStorage.getItem('lastEmail');
                            this.clearAuthData();
                            
                            // Show auth UI with message
                            this.showAuthUI();
                            this.showAuthError('signin-error', 'Your account has been suspended. Please contact support.');
                            return;
                        }
                    }
                    
                    // Update local status if it changed
                    if (verifiedStatus !== this.currentUser.status) {
                        console.log(`Account status updated from ${this.currentUser.status} to ${verifiedStatus}`);
                        this.currentUser.status = verifiedStatus;
                        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                    }
                    
                } catch (error) {
                    console.error('Error verifying account status:', error);
                    
                    // For network errors, use local status but show warning
                    console.warn('Could not verify account status from server, using local status');
                    
                    // Check local status for blocked accounts
                    if (this.currentUser.status === 'suspended' || this.currentUser.status === 'deactivated') {
                        console.warn(`Account is locally marked as ${this.currentUser.status}, forcing logout`);
                        
                        // Clear auth data but keep email
                        const lastEmail = localStorage.getItem('lastEmail');
                        this.clearAuthData();
                        
                        this.showAuthUI();
                        
                        if (this.currentUser.status === 'suspended') {
                            this.showAuthError('signin-error', 'Your account has been suspended. Please contact support.');
                        } else {
                            this.showAuthError('signin-error', 'Your account has been deactivated. Please contact support to reactivate.');
                        }
                        
                        return;
                    }
                }
                
                // Restore database references with timeout
                await this.firebaseOperation(
                    this.loadDatabaseAppsFromStorage(),
                    'Loading database apps'
                );
                
                // Set home database URL
                if (savedHomeDBUrl) {
                    this.userHomeDatabase = savedHomeDBUrl;
                } else if (this.currentUser.homeDatabaseUrl) {
                    this.userHomeDatabase = this.currentUser.homeDatabaseUrl;
                    localStorage.setItem('userHomeDatabaseUrl', this.userHomeDatabase);
                }
                
                // Verify home database connection with timeout
                await this.firebaseOperation(
                    this.initializeHomeDatabase(),
                    'Home database connection'
                );
                
                console.log('User restored from localStorage:', this.currentUser.email);
                console.log('Home database URL:', this.userHomeDatabase);
                
                this.onAuthSuccess();
                return;
            }
            
            // If no saved user, show auth UI
            this.showAuthUI();
            
        } catch (error) {
            console.error('Error checking auth state:', error);
            this.showAuthUI();
        }
    }

    async checkAndShowDeactivationStatus(email) {
        try {
            if (!email) return;
            
            const encodedEmail = this.encodeEmail(email);
            const snapshot = await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).once('value'),
                'Checking deactivation status'
            );
            
            if (!snapshot.exists()) return;
            
            const userData = snapshot.val();
            
            if (userData.status === 'deactivated' && userData.deactivationEnd) {
                const remainingMs = userData.deactivationEnd - Date.now();
                
                if (remainingMs > 0) {
                    const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
                    const reactivationDate = new Date(userData.deactivationEnd).toLocaleDateString();
                    
                    document.getElementById('deactivation-status').classList.remove('hidden');
                    document.getElementById('deactivation-message').textContent = 
                        `Your account is deactivated for ${userData.deactivationDuration || 14} days. ` +
                        `Will be automatically reactivated on ${reactivationDate} ` +
                        `(${remainingDays} day(s) remaining).`;
                    
                    return true;
                }
            }
        } catch (error) {
            console.error('Error checking deactivation status:', error);
        }
        
        document.getElementById('deactivation-status').classList.add('hidden');
        return false;
    }

    // Call this when auto-filling email or email input changes
    autoFillEmail() {
        const rememberedEmail = localStorage.getItem('lastEmail');
        const signinEmailInput = document.getElementById('signin-email');
        
        if (rememberedEmail && signinEmailInput) {
            signinEmailInput.value = rememberedEmail;
            // Check deactivation status for this email
            this.checkAndShowDeactivationStatus(rememberedEmail);
        }
    }


    async getDeactivationEnd() {
        if (!this.currentUser || !this.currentUser.email) return null;
        
        const encodedEmail = this.encodeEmail(this.currentUser.email);
        
        // Fetch deactivation end timestamp from master database with timeout
        const snapshot = await this.firebaseOperation(
            this.masterDB.ref(`users/${encodedEmail}/deactivationEnd`).once('value'),
            'Getting deactivation end'
        );
        
        if (snapshot.exists()) {
            return snapshot.val();
        }
        
        return null;
    }

    async reactivateAccount(userData, encodedEmail) {
        const updateData = {
            status: 'active',
            deactivationStart: null,
            deactivationEnd: null,
            deactivationDuration: null,
            reactivatedAt: firebase.database.ServerValue.TIMESTAMP,
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await this.firebaseOperation(
            this.masterDB.ref('users/' + encodedEmail).update(updateData),
            'Reactivating account'
        );
        
        // Log reactivation
        await this.firebaseOperation(
            this.masterDB.ref(`userActivity/${encodedEmail}/account_actions`).push({
                type: 'account_reactivated_auto',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                reason: 'cooldown_period_ended'
            }),
            'Logging reactivation'
        );
        
        return { ...userData, ...updateData };
    }

    clearAuthData() {
        const itemsToRemove = [
            'currentUser',
            'masterDBConfig',
            'availableDBs',
            'userHomeDatabaseUrl',
            'credentials',
            'app_settings',
            'user_preferences'
        ];
        
        itemsToRemove.forEach(item => {
            localStorage.removeItem(item);
        });
        
        // Clear all module data
        this.clearAllModuleData();
    }

    // Add this method to the AuthModule class
    async verifyAccountStatusFromServer() {
        if (!this.currentUser || !this.currentUser.email) {
            throw new Error('No user data available for status verification');
        }
        
        const encodedEmail = this.encodeEmail(this.currentUser.email);
        
        // Fetch current status from master database with timeout
        const snapshot = await this.firebaseOperation(
            this.masterDB.ref(`users/${encodedEmail}/status`).once('value'),
            'Verifying account status'
        );
        
        if (snapshot.exists()) {
            return snapshot.val();
        }
        
        // If status not found in database, return local status
        return this.currentUser.status || 'active';
    }

    // Get home database instance by URL
    getHomeDatabaseInstance() {
        if (!this.userHomeDatabase) {
            return null;
        }
        
        // Find by URL (primary) or by app name (fallback)
        const homeDb = this.dbApps.find(db => 
            db.url === this.userHomeDatabase || 
            db.app.name === this.userHomeDatabase
        );
        
        return homeDb;
    }

    // Get database by URL
    getDatabaseByUrl(url) {
        return this.dbApps.find(db => db.url === url);
    }

    // Get database by app name
    getDatabaseByName(name) {
        return this.dbApps.find(db => db.app.name === name);
    }

    // Get current user's encoded email
    getEncodedEmail() {
        if (!this.currentUser?.email) return null;
        return this.encodeEmail(this.currentUser.email);
    }

    // Notify all modules that auth is ready
    notifyAuthReady() {
        window.dispatchEvent(new CustomEvent('authReady', {
            detail: {
                user: this.currentUser,
                homeDatabaseUrl: this.userHomeDatabase,
                encodedEmail: this.encodeEmail(this.currentUser.email)
            }
        }));
    }

    // Get all user's databases (home database + any others)
    getUserDatabases() {
        return this.dbApps;
    }

    // Get master database
    getMasterDB() {
        return this.masterDB;
    }
    
    async loadDatabaseAppsFromStorage() {
        try {
            const availableDBs = localStorage.getItem('availableDBs');
            if (availableDBs && !this.dbApps.length) {
                const dbInfos = JSON.parse(availableDBs);
                
                for (const dbInfo of dbInfos) {
                    try {
                        // Check if app already exists
                        let app;
                        const existingApp = firebase.apps.find(a => a.name === dbInfo.name);
                        
                        if (existingApp) {
                            app = existingApp;
                        } else {
                            app = firebase.initializeApp(
                                { databaseURL: dbInfo.url }, 
                                dbInfo.name
                            );
                        }
                        
                        const db = app.database();
                        this.dbApps.push({ 
                            app, 
                            db, 
                            limit: dbInfo.limit,
                            url: dbInfo.url,
                            name: dbInfo.name 
                        });
                        
                    } catch (err) {
                        console.warn(`Failed to initialize DB from storage: ${dbInfo.url}`, err);
                    }
                }
                
                console.log(`Loaded ${this.dbApps.length} database apps from storage`);
            }
        } catch (error) {
            console.error('Error loading database apps from storage:', error);
        }
    }
    
    showAuthUI() {
        console.log('Showing auth UI...');
        
        // Hide main content
        const mainContent = document.querySelector('.main-content');
        const sidebar = document.querySelector('.sidebar');
        const sidebarToggle = document.querySelector('.sidebar-toggle-fixed');
        
        if (mainContent) mainContent.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        if (sidebarToggle) sidebarToggle.style.display = 'none';
        
        // Create and show auth container
        this.createAuthContainer();
        
        // Make sure auth container is visible
        if (this.authContainer) {
            this.authContainer.style.display = 'flex';
            this.renderAuthUI();
        }
    }
        
    createAuthContainer() {
        // Create auth container if it doesn't exist
        if (!this.authContainer) {
            this.authContainer = document.createElement('div');
            this.authContainer.className = 'auth-overlay';
            this.authContainer.id = 'authOverlay';
            document.body.appendChild(this.authContainer);
        }
    }
    
    // ==============================================
    // REDESIGNED AUTHENTICATION UI
    // ==============================================

    renderAuthUI() {
        this.authContainer.innerHTML = `
            <div class="auth-container">
                <!-- App Logo/Title - Compact -->
                <div class="auth-header">
                    <div class="app-title">
                        <span class="material-icons" style="font-size: 24px;">health_and_safety</span> 
                        <span>xDrive</span>
                    </div>
                    <p class="auth-subtitle">Secure Private Storage</p>
                </div>
                
                <!-- Authentication Card - Modern Compact Design -->
                <div class="auth-card-modern">
                    <!-- Sign In Form -->
                    <div id="signin-form" class="auth-form active">
                        <div class="form-header">
                            <h2>Sign In</h2>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" for="signin-email">Email</label>
                            <input type="email" id="signin-email" class="form-input" 
                                placeholder="Enter your email" required>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" for="signin-password">Password</label>
                            <div class="password-input-group">
                                <input type="password" id="signin-password" class="form-input" 
                                    placeholder="Enter your password">
                                <button type="button" class="toggle-pass-modern" data-target="signin-password">
                                    <span class="material-icons">visibility_off</span>
                                </button>
                            </div>
                        </div>
                        
                        <div id="signin-error" class="alert error hidden"></div>
                        
                        <!-- Deactivation Status Banner -->
                        <div id="deactivation-status" class="alert warning hidden">
                            <span class="material-icons">timer</span>
                            <div>
                                <strong>Account Deactivated</strong>
                                <p id="deactivation-message"></p>
                            </div>
                        </div>
                        
                        <div class="form-actions">
                            <button id="signin-btn" class="btn btn-primary">
                                <i class="fas fa-sign-in-alt"></i> Sign In
                            </button>
                        </div>
                        
                        <div class="auth-links-modern">
                            <a id="show-forgot-password" class="auth-link-modern">Forgot Password?</a>
                            <a id="show-signup" class="auth-link-modern">Create Account</a>
                        </div>
                    </div>
                    
                    <!-- Sign Up Form -->
                    <div id="signup-form" class="auth-form">
                        <div class="auth-form-header">
                            <h2>Create Account</h2>
                            <a id="show-signin-arrow" class="back-link-modern">
                                <span class="material-icons">arrow_back</span> Back
                            </a>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label" for="signup-name">Full Name *</label>
                                <input type="text" id="signup-name" class="form-input" 
                                    placeholder="Enter your full name">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="signup-email">Email *</label>
                                <input type="email" id="signup-email" class="form-input" 
                                    placeholder="Enter your email">
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="signup-password">Password</label>
                                <div class="password-input-group">
                                    <input type="text" id="signup-password" class="form-input" 
                                        placeholder="Enter password">
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="signup-confirm">Confirm Password</label>
                                <div class="password-input-group">
                                    <input type="text" id="signup-confirm" class="form-input" 
                                        placeholder="Confirm password">
                                </div>
                            </div>
                        </div>
                        
                        <div id="signup-error" class="alert error hidden"></div>
                        <div id="signup-success" class="alert success hidden"></div>
                        
                        <div class="form-actions">
                            <button id="signup-btn" class="btn btn-primary">
                                <i class="fas fa-user-plus"></i> Create Account
                            </button>
                        </div>
                        
                        <div class="auth-footer-modern">
                            Already have an account? <a id="show-signin" class="auth-link-modern">Sign In</a>
                        </div>
                    </div>

                    <!-- Forgot Password Form -->
                    <div id="forgot-password-container" style="display: none;">
                        <!-- Step 1: Email Verification -->
                        <div id="step1-email" class="auth-form active">
                            <div class="auth-form-header">
                                <h2>Reset Password</h2>
                                <a id="back-to-signin-from-forgot" class="back-link-modern">
                                    <span class="material-icons">arrow_back</span> Back
                                </a>
                            </div>
                            
                            <div class="info-card-modern">
                                <span class="material-icons">info</span>
                                <p>Enter your email to start the password recovery process.</p>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="recovery-email">Email Address</label>
                                <input type="email" id="recovery-email" class="form-input" 
                                    placeholder="Enter your email" required>
                            </div>
                            
                            <div id="recovery-email-error" class="alert error hidden"></div>
                            
                            <div class="form-actions">
                                <button id="verify-email-btn" class="btn btn-primary">
                                    <i class="fas fa-arrow-right"></i> Continue
                                </button>
                            </div>
                        </div>
                        
                        <!-- Step 2: Recovery Code Verification -->
                        <div id="step2-recovery-code" class="auth-form">
                            <div class="auth-form-header">
                                <h2>Enter Recovery Code</h2>
                                <a id="back-to-email" class="back-link-modern">
                                    <span class="material-icons">arrow_back</span> Back
                                </a>
                            </div>
                            
                            <div class="info-card-modern">
                                <span class="material-icons">info</span>
                                <p>Enter one of your recovery codes. Each code can be used only once.</p>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="recovery-code">Recovery Code</label>
                                <input type="text" id="recovery-code" class="form-input code-input" 
                                    placeholder="XXXXXXXX" maxlength="8" 
                                    style="text-transform: uppercase; font-family: monospace;">
                                <div class="form-help-modern">8 characters (letters and numbers, no spaces)</div>
                            </div>
                            
                            <div id="recovery-code-error" class="alert error hidden"></div>
                            <div id="recovery-code-success" class="alert success hidden"></div>
                            
                            <div class="form-actions">
                                <button id="verify-code-btn" class="btn btn-primary">
                                    <i class="fas fa-check-circle"></i> Verify Code
                                </button>
                            </div>
                            
                            <!-- Lost Codes Link -->
                            <div class="recovery-warning-modern">
                                <a id="lost-codes-link" class="auth-link-modern warning-link">
                                    Lost all recovery codes?
                                </a>
                            </div>
                        </div>
                        
                        <!-- Step 3: New Password -->
                        <div id="step3-reset-password" class="auth-form">
                            <div class="auth-form-header">
                                <h2>Set New Password</h2>
                            </div>
                            
                            <div class="password-info-card-modern">
                                <span class="material-icons">info</span>
                                <div>
                                    <h4>Password Requirements</h4>
                                    <p>• Must be at least 6 characters long</p>
                                    <p>• Use a strong, unique password</p>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="new-password">New Password</label>
                                <div class="password-input-group">
                                    <input type="text" id="new-password" class="form-input" 
                                        placeholder="Enter new password">
                                </div>
                                <!-- Password Strength Indicator -->
                                <div class="password-strength-container-modern">
                                    <div class="strength-bar-modern" id="authPasswordStrengthBar"></div>
                                    <div class="strength-text-modern" id="authPasswordStrengthText">Enter a password</div>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label" for="confirm-new-password">Confirm New Password</label>
                                <div class="password-input-group">
                                    <input type="text" id="confirm-new-password" class="form-input" 
                                        placeholder="Confirm new password">
                                </div>
                            </div>
                            
                            <div id="reset-error" class="alert error hidden"></div>
                            <div id="reset-success" class="alert success hidden"></div>
                            
                            <div class="form-actions">
                                <button id="reset-password-btn" class="btn btn-primary">
                                    <i class="fas fa-rotate-left"></i> Reset Password
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Setup event listeners
        this.setupAuthEventListeners();
        
        // Auto-fill remembered email if any
        this.autoFillEmail();
    }
    
    setupAuthEventListeners() {
        // Form toggles
        document.getElementById('show-signup').addEventListener('click', () => this.showForm('signup'));
        document.getElementById('show-signin').addEventListener('click', () => this.showForm('signin'));
        document.getElementById('show-signin-arrow').addEventListener('click', () => this.showForm('signin'));
        
        // Back to signin from forgot password
        const backToSigninFromForgot = document.getElementById('back-to-signin-from-forgot');
        if (backToSigninFromForgot) {
            backToSigninFromForgot.addEventListener('click', () => this.showForm('signin'));
        }
        
        // Forgot password link
        const forgotPasswordLink = document.getElementById('show-forgot-password');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', () => this.showForgotPassword());
        }
        
        // Password visibility toggles
        document.querySelectorAll('.toggle-pass-modern').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const input = document.getElementById(btn.getAttribute('data-target'));
                const icon = btn.querySelector('.material-icons');
                
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.textContent = 'visibility';
                    btn.style.color = 'var(--accent)';
                } else {
                    input.type = 'password';
                    icon.textContent = 'visibility_off';
                    btn.style.color = 'var(--text-secondary)';
                }
            });
        });
        
        // Sign up button
        document.getElementById('signup-btn').addEventListener('click', () => this.handleSignup());
        
        // Sign in button
        document.getElementById('signin-btn').addEventListener('click', () => this.handleSignin());
        
        // Email input for deactivation check
        const signinEmailInput = document.getElementById('signin-email');
        if (signinEmailInput) {
            signinEmailInput.addEventListener('input', (e) => {
                const email = e.target.value.trim();
                if (this.validateEmail(email)) {
                    this.checkAndShowDeactivationStatus(email);
                }
            });
        }
        
        // Enter key support
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (document.getElementById('signup-form').classList.contains('active')) {
                    this.handleSignup();
                } else if (document.getElementById('signin-form').classList.contains('active')) {
                    this.handleSignin();
                } else if (document.getElementById('step1-email')?.classList.contains('active')) {
                    this.verifyEmailForRecovery();
                } else if (document.getElementById('step2-recovery-code')?.classList.contains('active')) {
                    this.verifyRecoveryCode();
                } else if (document.getElementById('step3-reset-password')?.classList.contains('active')) {
                    this.resetPasswordWithCode();
                }
            }
        });
    }

    showForgotPassword() {
        console.log('Showing forgot password flow...');
        
        // Hide all auth forms
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        
        // Show forgot password container
        const forgotContainer = document.getElementById('forgot-password-container');
        if (forgotContainer) {
            forgotContainer.style.display = 'block';
        }
        
        // Show step 1 by default
        this.showRecoveryStep('step1-email');
        
        this.clearAuthMessages();
        
        // Setup event listeners for the forgot password steps
        this.setupForgotPasswordStepListeners();
    }

    setupForgotPasswordStepListeners() {
        console.log('Setting up forgot password step listeners');
        
        // Step 1: Email verification
        const verifyEmailBtn = document.getElementById('verify-email-btn');
        if (verifyEmailBtn) {
            // Remove any existing listeners to prevent duplicates
            verifyEmailBtn.removeEventListener('click', this.boundVerifyEmail);
            this.boundVerifyEmail = () => this.verifyEmailForRecovery();
            verifyEmailBtn.addEventListener('click', this.boundVerifyEmail);
        }
        
        const recoveryEmail = document.getElementById('recovery-email');
        if (recoveryEmail) {
            recoveryEmail.removeEventListener('keypress', this.boundRecoveryEmailKeypress);
            this.boundRecoveryEmailKeypress = (e) => {
                if (e.key === 'Enter') this.verifyEmailForRecovery();
            };
            recoveryEmail.addEventListener('keypress', this.boundRecoveryEmailKeypress);
        }
        
        // Step 2: Recovery code verification
        const verifyCodeBtn = document.getElementById('verify-code-btn');
        if (verifyCodeBtn) {
            verifyCodeBtn.removeEventListener('click', this.boundVerifyCode);
            this.boundVerifyCode = () => this.verifyRecoveryCode();
            verifyCodeBtn.addEventListener('click', this.boundVerifyCode);
        }
        
        const recoveryCode = document.getElementById('recovery-code');
        if (recoveryCode) {
            recoveryCode.removeEventListener('keypress', this.boundRecoveryCodeKeypress);
            this.boundRecoveryCodeKeypress = (e) => {
                if (e.key === 'Enter') this.verifyRecoveryCode();
            };
            recoveryCode.addEventListener('keypress', this.boundRecoveryCodeKeypress);
            
            // Uppercase formatting
            recoveryCode.removeEventListener('input', this.boundRecoveryCodeInput);
            this.boundRecoveryCodeInput = function() {
                this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            };
            recoveryCode.addEventListener('input', this.boundRecoveryCodeInput);
        }
        
        // Step 3: Password reset
        const resetPasswordBtn = document.getElementById('reset-password-btn');
        if (resetPasswordBtn) {
            resetPasswordBtn.removeEventListener('click', this.boundResetPassword);
            this.boundResetPassword = () => this.resetPasswordWithCode();
            resetPasswordBtn.addEventListener('click', this.boundResetPassword);
        }
        
        // Navigation buttons
        const backToEmail = document.getElementById('back-to-email');
        if (backToEmail) {
            backToEmail.removeEventListener('click', this.boundBackToEmail);
            this.boundBackToEmail = () => this.showRecoveryStep('step1-email');
            backToEmail.addEventListener('click', this.boundBackToEmail);
        }
        
        const lostCodesLink = document.getElementById('lost-codes-link');
        if (lostCodesLink) {
            lostCodesLink.removeEventListener('click', this.boundLostCodes);
            this.boundLostCodes = () => this.handleLostRecoveryCodes();
            lostCodesLink.addEventListener('click', this.boundLostCodes);
        }
        
        // Password visibility toggles in forgot password
        document.querySelectorAll('#forgot-password-container .toggle-pass-modern').forEach(btn => {
            btn.removeEventListener('click', this.boundTogglePass);
            this.boundTogglePass = (e) => {
                const input = document.getElementById(btn.getAttribute('data-target'));
                const icon = btn.querySelector('.material-icons');
                
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.textContent = 'visibility';
                    btn.style.color = 'var(--accent)';
                } else {
                    input.type = 'password';
                    icon.textContent = 'visibility_off';
                    btn.style.color = 'var(--text-secondary)';
                }
            };
            btn.addEventListener('click', this.boundTogglePass);
        });
    }

    showForm(formType) {
        // Hide all forms
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        
        // Hide forgot password container if visible
        const forgotContainer = document.getElementById('forgot-password-container');
        if (forgotContainer) {
            forgotContainer.style.display = 'none';
        }
        
        // Show selected form
        const formToShow = document.getElementById(`${formType}-form`);
        if (formToShow) {
            formToShow.classList.add('active');
        }
        
        this.clearAuthMessages(true);
        
        // Focus on first input
        setTimeout(() => {
            let firstInput;
            if (formType === 'signup') {
                firstInput = document.getElementById('signup-name');
            } else if (formType === 'signin') {
                firstInput = document.getElementById('signin-email');
            }
            if (firstInput) firstInput.focus();
        }, 100);
    }
    
    clearAuthMessages(keepSuccess = false) {
        const errors = document.querySelectorAll('.alert.error');
        errors.forEach(error => error.classList.add('hidden'));
        
        if (!keepSuccess) {
            const success = document.querySelectorAll('.alert.success');
            success.forEach(success => success.classList.add('hidden'));
        }
    }
    
    togglePassword(icon) {
        const inputId = icon.getAttribute('data-target');
        const input = document.getElementById(inputId);

        if (input.type === 'password') {
            input.type = 'text';
            icon.textContent = 'visibility';
            icon.style.color = 'var(--primary)';
        } else {
            input.type = 'password';
            icon.textContent = 'visibility_off';
            icon.style.color = 'var(--text-secondary)';
        }
    }

    
    // ==============================================
    // UTILITY FUNCTIONS
    // ==============================================
    
    encodeEmail(email) {
        return email.replace(/\./g, ',').replace(/@/g, '-at-');
    }
    
    validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    
    validatePassword(password) {
        return password.length >= 6;
    }
    
    getFormData(formType) {
        if (formType === 'signin') {
            return {
                email: document.getElementById('signin-email').value.trim(),
                password: document.getElementById('signin-password').value.trim()
            };
        } else if (formType === 'signup') {
            return {
                name: document.getElementById('signup-name').value.trim(),
                email: document.getElementById('signup-email').value.trim(),
                phone: '',
                password: document.getElementById('signup-password').value.trim(),
                confirm: document.getElementById('signup-confirm').value.trim()
            };
        }
        return null;
    }
    
    setButtonLoading(buttonId, isLoading, loadingText = 'Loading...') {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        if (isLoading) {
            button.disabled = true;
            button.innerHTML = `${loadingText}`;
            
            // Auto-reset after TIMEOUT_DURATION (30 seconds) as a safety measure
            setTimeout(() => {
                if (button.disabled) {
                    this.resetButton(buttonId);
                    const errorElement = this.getErrorElementForButton(buttonId);
                    if (errorElement) {
                        this.showAuthError(errorElement.id, 
                            'Operation timed out. Please check your connection and try again.');
                    }
                }
            }, this.TIMEOUT_DURATION + 1000); // Add 1 second buffer
        } else {
            button.disabled = false;
            this.resetButton(buttonId);
        }
    }
    
    resetButton(buttonId) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        if (buttonId === 'signin-btn') {
            button.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        } else if (buttonId === 'signup-btn') {
            button.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
        } else if (buttonId === 'verify-email-btn') {
            button.innerHTML = '<i class="fas fa-arrow-right"></i> Continue';
        } else if (buttonId === 'verify-code-btn') {
            button.innerHTML = '<i class="fas fa-check-circle"></i> Verify Code';
        } else if (buttonId === 'reset-password-btn') {
            button.innerHTML = '<i class="fas fa-rotate-left"></i> Reset Password';
        } else if (buttonId === 'forgot-submit-btn') {
            button.innerHTML = 'Send Reset Instructions';
        }
        button.disabled = false;
    }
    
    getErrorElementForButton(buttonId) {
        switch(buttonId) {
            case 'signin-btn': return document.getElementById('signin-error');
            case 'signup-btn': return document.getElementById('signup-error');
            case 'verify-email-btn': return document.getElementById('recovery-email-error');
            case 'verify-code-btn': return document.getElementById('recovery-code-error');
            case 'reset-password-btn': return document.getElementById('reset-error');
            case 'forgot-submit-btn': return document.getElementById('forgot-error');
            default: return null;
        }
    }
    
    showAuthError(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            element.classList.remove('hidden');
        }
    }
    
    showAuthSuccess(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            element.classList.remove('hidden');
        }
    }
    
    // ==============================================
    // DATABASE MANAGEMENT
    // ==============================================
    
    async fetchDbApps() {
        try {
            const snapshot = await this.firebaseOperation(
                this.masterDB.ref('databases').get(),
                'Fetching database configurations'
            );
            const configsObj = snapshot.exists() ? snapshot.val() : {};
            const configs = Object.values(configsObj);

            this.dbApps = [];

            for (let i = 0; i < configs.length; i++) {
                const cfg = configs[i];

                // Skip if flagged inactive
                if (!cfg.active) {
                    console.warn(`Skipping inactive DB (flag): ${cfg.url}`);
                    continue;
                }

                try {
                    const app = firebase.initializeApp({ databaseURL: cfg.url }, "app" + i);
                    const db = app.database();

                    // Health check with 3s timeout
                    const healthCheck = db.ref('users').limitToFirst(1).get();
                    const timeout = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), 3000)
                    );

                    await Promise.race([healthCheck, timeout]);

                    this.dbApps.push({ app, db, limit: cfg.limit, url: cfg.url });
                } catch (err) {
                    console.warn(`Skipping unreachable DB: ${cfg.url}`, err.message);
                }
            }

            if (this.dbApps.length === 0) {
                console.error("No active DB found!");
                return [];
            }
            
            return this.dbApps;
        } catch (error) {
            console.error("Error fetching DB configs:", error);
            return [];
        }
    }
    
    async findAvailableDatabase(availableDbs, encodedEmail) {
        for (const dbObj of availableDbs) {
            const snapshot = await this.firebaseOperation(
                dbObj.db.ref('userData').once('value'),
                'Checking database availability'
            );
            const count = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;

            if (count < dbObj.limit) {
                try {
                    // Create empty userData node for the new user
                    await this.firebaseOperation(
                        dbObj.db.ref(`userData/${encodedEmail}`).set({
                            photos: {},
                            notes: {},
                            files: {},
                            storage: {
                                used: 0,
                                total: 0
                            },
                            createdAt: firebase.database.ServerValue.TIMESTAMP,
                            updatedAt: firebase.database.ServerValue.TIMESTAMP
                        }),
                        'Creating user data'
                    );
                    
                    // Return actual database URL, not just app name
                    return { 
                        name: dbObj.app.name, 
                        url: dbObj.url,  // Store the actual URL
                        limit: dbObj.limit 
                    };
                } catch (error) {
                    console.error(`Error creating userData in ${dbObj.app.name}:`, error);
                    continue;
                }
            }
        }
        return null;
    }


    // ==============================================
    // RECOVERY CODE SYSTEM
    // ==============================================

    generateRecoveryCodes(count = 5) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            // Generate 8-digit alphanumeric code
            const code = Array(8)
                .fill(0)
                .map(() => Math.random().toString(36).charAt(2))
                .join('')
                .toUpperCase()
                .replace(/O|I|0|1/g, () => 
                    Math.random().toString(36).charAt(2).toUpperCase()
                );
            
            codes.push({
                code: code,
                used: false,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                expiresAt: null // Never expires until used
            });
        }
        return codes;
    }

    // Only download - no print
    downloadRecoveryCodes(codes) {
        const content = `xDrive Recovery Codes
        Generated: ${new Date().toLocaleString()}

        ===========================================
        IMPORTANT - SAVE THESE CODES                
        ===========================================

        Store this document securely. These codes are required for password recovery.
        If you lose these codes, you may lose access to your account.

        ===========================================
        RECOVERY CODES:
        ${codes.map((codeObj, index) => `${index + 1}. ${codeObj.code}`).join('\n')}
        ===========================================

        How to use recovery codes:
        - Each code can be used only once
        - You will need one code to reset your password
        - Store these codes securely (password manager, safe, encrypted file)
        - Generate new codes from your account settings if you lose these
        - Never share your recovery codes with anyone

        ===========================================

        Keep this file safe!`;
                
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xdrive-recovery-codes-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ==============================================
    // AUTHENTICATION HANDLERS
    // ==============================================
    
    async handleSignup() {
        const formData = this.getFormData('signup');
        const { name, email, phone, password, confirm } = formData;
        
        // Clear previous messages
        this.clearAuthMessages();
        
        // Basic validation
        if (!name || !email || !password || !confirm) {
            this.showAuthError('signup-error', 'Please fill in all required fields');
            return;
        }
        
        if (!this.validateEmail(email)) {
            this.showAuthError('signup-error', 'Please enter a valid email address');
            return;
        }

        if (!this.validatePassword(password)) {
            this.showAuthError('signup-error', 'Password must be at least 6 characters');
            return;
        }
        
        if (password !== confirm) {
            this.showAuthError('signup-error', 'Passwords do not match');
            return;
        }
        
        try {
            this.setButtonLoading('signup-btn', true, 'Creating account...');
            
            const encodedEmail = this.encodeEmail(email);
            const formattedPhone = phone.replace(/\D/g, '');
            
            // Check if user already exists with timeout
            const masterSnapshot = await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).once('value'),
                'Checking existing user'
            );
            
            if (masterSnapshot.exists()) {
                this.showAuthError('signup-error', 'Email already registered');
                this.setButtonLoading('signup-btn', false);
                return;
            }
            
            // Generate recovery codes
            const recoveryCodes = this.generateRecoveryCodes(5);
            
            // Load database list for userData storage with timeout
            const availableDbs = await this.firebaseOperation(
                this.fetchDbApps(),
                'Loading databases'
            );
            
            if (availableDbs.length === 0) {
                this.showAuthError('signup-error', 'Service temporarily unavailable');
                this.setButtonLoading('signup-btn', false);
                return;
            }

            // Generate device UID
            const deviceUid = 'dev-' + Math.random().toString(36).substring(2) + Date.now();

            // Prepare user data
            const userData = {
                name: name,
                email: email,
                phone: formattedPhone,
                password: password,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                lastLogin: firebase.database.ServerValue.TIMESTAMP,
                status: 'active',
                role: 'user',
                deviceUid: deviceUid,
                recoveryCodes: recoveryCodes,
                recoveryCodesGenerated: firebase.database.ServerValue.TIMESTAMP
            };
            
            // Find available database for userData with timeout
            let homeDatabaseInfo = await this.firebaseOperation(
                this.findAvailableDatabase(availableDbs, encodedEmail),
                'Finding available database'
            );
            
            if (!homeDatabaseInfo) {
                this.showAuthError('signup-error', "All databases are currently full");
                this.setButtonLoading('signup-btn', false);
                return;
            }
            
            // Store the ACTUAL DATABASE URL
            userData.homeDatabaseUrl = homeDatabaseInfo.url;
            userData.homeDatabaseName = homeDatabaseInfo.name;
            
            // Create user in master database WITH RECOVERY CODES
            await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).set(userData),
                'Creating user account'
            );
            
            console.log(`Account created with home DB URL: ${homeDatabaseInfo.url}`);
            console.log(`Recovery codes generated for user`);
            
            // Update instance properties
            this.currentUser = userData;
            this.isAuthenticated = true;
            this.userHomeDatabase = homeDatabaseInfo.url;
            
            // Save user data and database info to localStorage
            localStorage.setItem('currentUser', JSON.stringify(userData));
            localStorage.setItem('lastEmail', email);
            this.saveDatabaseConfigsToStorage();
            localStorage.setItem('userHomeDatabaseUrl', homeDatabaseInfo.url);
            
            // Show success message
            this.showAuthSuccess('signup-success', 'Account created successfully! Downloading recovery codes...');
            this.setButtonLoading('signup-btn', false);

            // Download recovery codes (no print)
            this.downloadRecoveryCodes(recoveryCodes);
            
            // Proceed to main app
            this.onAuthSuccess();
            
        } catch (error) {
            console.error('Signup error:', error);
            
            // Check if it's a timeout error
            if (error.message.includes('timed out') || error.message.includes('Connection timeout')) {
                this.showAuthError('signup-error', 
                    'Connection timeout. Please check your internet connection and try again.');
            } else {
                this.showAuthError('signup-error', 'Error creating account: ' + error.message);
            }
            
            this.setButtonLoading('signup-btn', false);
        }
    }

    
    async handleSignin() {
        const formData = this.getFormData('signin');
        const { email, password } = formData;
        
        // Clear previous errors
        this.clearAuthMessages();
        
        // Basic validation
        if (!email || !password) {
            this.showAuthError('signin-error', 'Please enter email and password');
            return;
        }
        
        if (!this.validateEmail(email)) {
            this.showAuthError('signin-error', 'Please enter a valid email address');
            return;
        }
        
        try {
            this.setButtonLoading('signin-btn', true, 'Signing in...');
            
            const encodedEmail = this.encodeEmail(email);
            
            // Look up user in master database with timeout
            const masterSnapshot = await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).once('value'),
                'User lookup'
            );

            if (!masterSnapshot.exists()) {
                // User not found - switch to signup form with email pre-filled
                this.setButtonLoading('signin-btn', false);
                
                // Show error briefly
                this.showAuthError('signin-error', 'User not found. Redirecting to sign up...');
                
                // Wait a moment for user to see the message
                setTimeout(() => {
                    // Switch to signup form
                    this.showForm('signup');
                    
                    // Pre-fill the email in signup form
                    const signupEmailInput = document.getElementById('signup-email');
                    if (signupEmailInput) {
                        signupEmailInput.value = email;
                    }
                    
                    // Focus on name field or keep email field focused
                    const signupNameInput = document.getElementById('signup-name');
                    if (signupNameInput) {
                        signupNameInput.focus();
                    }
                }, 1500); // 1.5 second delay to show the message
                
                return;
            }

            const userData = masterSnapshot.val();

            // Check password
            if (userData.password !== password) {
                this.showAuthError('signin-error', 'Incorrect password');
                this.setButtonLoading('signin-btn', false);
                return;
            }

            // CHECK DEACTIVATION STATUS WITH COOLDOWN
            if (userData.status === 'deactivated') {
                // Check if deactivation period has ended
                if (userData.deactivationEnd && Date.now() < userData.deactivationEnd) {
                    // Still in cooldown period
                    const remainingMs = userData.deactivationEnd - Date.now();
                    const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
                    
                    this.showAuthError('signin-error', 
                        `Your account is deactivated. Please try again in ${remainingDays} day(s).`);
                    this.setButtonLoading('signin-btn', false);
                    return;
                } else {
                    // Cooldown period has ended, auto-reactivate
                    await this.reactivateAccount(userData, encodedEmail);
                    console.log('Account auto-reactivated after cooldown period');
                }
            }

            // Check other statuses
            if (userData.status === 'suspended') {
                this.showAuthError('signin-error', 'Your account has been suspended');
                this.setButtonLoading('signin-btn', false);
                return;
            }

            if (userData.status === 'pending') {
                this.showAuthError('signin-error', 'Account pending approval');
                this.setButtonLoading('signin-btn', false);
                return;
            }

            // Fetch available databases with timeout
            await this.firebaseOperation(
                this.refreshDatabaseApps(),
                'Loading databases'
            );
            
            // Verify if home database URL exists and is valid
            let homeDatabaseUrl = userData.homeDatabaseUrl;
            let homeDatabaseValid = false;
            
            if (homeDatabaseUrl) {
                // Check if the URL exists in our loaded databases
                const homeDb = this.dbApps.find(db => db.url === homeDatabaseUrl);
                if (homeDb) {
                    homeDatabaseValid = true;
                    this.userHomeDatabase = homeDatabaseUrl;
                }
            }
            
            // If home database URL is not valid or doesn't exist, find a new one
            if (!homeDatabaseValid) {
                console.warn('Home database URL not found or invalid, finding available database...');
                
                // Find available database for this user with timeout
                const availableDb = await this.firebaseOperation(
                    this.findAvailableDatabase(this.dbApps, encodedEmail),
                    'Finding available database'
                );
                
                if (!availableDb) {
                    this.showAuthError('signin-error', 'No available databases found');
                    this.setButtonLoading('signin-btn', false);
                    return;
                }
                
                // Update user's home database URL in master DB
                homeDatabaseUrl = availableDb.url;
                await this.firebaseOperation(
                    this.masterDB.ref('users/' + encodedEmail).update({
                        homeDatabaseUrl: availableDb.url,
                        homeDatabaseName: availableDb.name,
                        updatedAt: firebase.database.ServerValue.TIMESTAMP
                    }),
                    'Updating home database'
                );
                
                userData.homeDatabaseUrl = availableDb.url;
                userData.homeDatabaseName = availableDb.name;
                this.userHomeDatabase = availableDb.url;
                
                console.log(`Updated user's home database URL to: ${availableDb.url}`);
            }

            // Update last login
            await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).update({
                    lastLogin: firebase.database.ServerValue.TIMESTAMP,
                    loginCount: (userData.loginCount || 0) + 1
                }),
                'Updating last login'
            );
            
            // Set authentication state
            this.currentUser = userData;
            this.isAuthenticated = true;
            
            // Save to localStorage
            localStorage.setItem('currentUser', JSON.stringify(userData));
            localStorage.setItem('lastEmail', email);
            
            // Save database configurations to localStorage
            this.saveDatabaseConfigsToStorage();
            
            // Save home database URL separately
            if (this.userHomeDatabase) {
                localStorage.setItem('userHomeDatabaseUrl', this.userHomeDatabase);
            }
            
            // Initialize the home database connection with timeout
            await this.firebaseOperation(
                this.initializeHomeDatabase(),
                'Home database connection'
            );
            
            console.log(`User signed in: ${email}`);
            console.log('Home database URL:', this.userHomeDatabase);
            
            // Success - show main app
            this.onAuthSuccess();
            
        } catch (error) {
            console.error('Signin error:', error);
            
            // Check if it's a timeout error
            if (error.message.includes('timed out') || error.message.includes('Connection timeout')) {
                this.showAuthError('signin-error', 
                    'Connection timeout. Please check your internet connection and try again.');
            } else {
                this.showAuthError('signin-error', 'Error signing in: ' + error.message);
            }
            
            this.setButtonLoading('signin-btn', false);
        }
    }


    async initializeHomeDatabase() {
        try {
            if (!this.userHomeDatabase || !this.currentUser) {
                console.error('Cannot initialize home database: Missing user data');
                return null;
            }
            
            // Find the home database by URL (not by app name)
            const homeDb = this.dbApps.find(db => db.url === this.userHomeDatabase);
            
            if (!homeDb) {
                console.error(`Home database URL "${this.userHomeDatabase}" not found in loaded apps`);
                
                // Try to initialize it
                try {
                    // Create app name from URL hash
                    const appName = `home_${this.hashCode(this.userHomeDatabase)}`;
                    const app = firebase.initializeApp(
                        { databaseURL: this.userHomeDatabase }, 
                        appName
                    );
                    
                    const db = app.database();
                    const dbEntry = { 
                        app, 
                        db, 
                        url: this.userHomeDatabase,
                        name: appName
                    };
                    
                    this.dbApps.push(dbEntry);
                    homeDb = dbEntry;
                    
                    console.log(`Home database initialized: ${this.userHomeDatabase}`);
                } catch (error) {
                    console.error(`Failed to initialize home database: ${this.userHomeDatabase}`, error);
                    return null;
                }
            }
            
            // Ensure user data exists in home database
            const encodedEmail = this.encodeEmail(this.currentUser.email);
            
            if (homeDb) {
                const userDataSnapshot = await this.firebaseOperation(
                    homeDb.db.ref(`userData/${encodedEmail}`).once('value'),
                    'Checking user data'
                );
                
                if (!userDataSnapshot.exists()) {
                    // Create user data entry
                    await this.firebaseOperation(
                        homeDb.db.ref(`userData/${encodedEmail}`).set({
                            photos: {},
                            notes: {},
                            files: {},
                            storage: {
                                used: 0,
                                total: 0
                            },
                            createdAt: firebase.database.ServerValue.TIMESTAMP,
                            updatedAt: firebase.database.ServerValue.TIMESTAMP
                        }),
                        'Creating user data'
                    );
                    
                    console.log('User data created in home database');
                }
            }
            
            return homeDb;
            
        } catch (error) {
            console.error('Error initializing home database:', error);
            return null;
        }
    }
    
    saveDatabaseConfigsToStorage() {
        try {
            // Save master database config to localStorage
            const masterDBConfig = {
                databaseURL: this.masterConfig.databaseURL,
                appName: "masterApp",
                timestamp: Date.now()
            };
            
            localStorage.setItem('masterDBConfig', JSON.stringify(masterDBConfig));
            
            // Save available database apps info
            const dbAppsInfo = this.dbApps.map(db => ({
                name: db.name,
                url: db.url,
                limit: db.limit || 100,
                active: true
            }));
            
            localStorage.setItem('availableDBs', JSON.stringify(dbAppsInfo));
            
            console.log(`Saved ${dbAppsInfo.length} database configurations to localStorage`);
            
        } catch (error) {
            console.error('Error saving database configs to storage:', error);
        }
    }

    // Add a helper method to ensure home database is always available
    ensureHomeDatabase() {
        if (!this.userHomeDatabase && this.currentUser) {
            this.userHomeDatabase = this.currentUser.homeDatabase;
            if (this.userHomeDatabase) {
                localStorage.setItem('userHomeDatabase', this.userHomeDatabase);
            }
        }
        return this.userHomeDatabase;
    }

    onAuthSuccess() {
        // Hide auth UI
        if (this.authContainer) {
            this.authContainer.style.display = 'none';
        }
        
        // Show main app
        const mainContent = document.querySelector('.main-content');
        const sidebar = document.querySelector('.sidebar');
        const sidebarToggle = document.querySelector('.sidebar-toggle-fixed');
        
        if (mainContent) mainContent.style.display = 'block';
        if (sidebar) sidebar.style.display = 'flex';
        if (sidebarToggle) sidebarToggle.style.display = 'flex';
        
        // Dispatch auth success event with database info
        window.dispatchEvent(new CustomEvent('authSuccess', {
            detail: { 
                user: this.currentUser,
                homeDatabase: this.userHomeDatabase,
                masterDBConfig: JSON.parse(localStorage.getItem('masterDBConfig') || '{}')
            }
        }));
        
        // Also dispatch authReady for modules that listen to it
        window.dispatchEvent(new CustomEvent('authReady', {
            detail: {
                user: this.currentUser,
                homeDatabaseUrl: this.userHomeDatabase,
                encodedEmail: this.encodeEmail(this.currentUser.email)
            }
        }));
        
        // Initialize sidebar manager if it exists
        if (window.sidebarManager) {
            // Reload user data in sidebar
            window.sidebarManager.loadUserData().then(() => {
                window.sidebarManager.updateUserProfile();
                window.sidebarManager.updateStorageInfo();
            });
        }
        
        // Initialize settings module if it exists
        if (window.settingsModule) {
            window.settingsModule.setUserData(this.currentUser);
            window.settingsModule.initFirebase();
        }
    }
    
    
    isLoggedIn() {
        return this.isAuthenticated && this.currentUser !== null;
    }
    
    getUser() {
        return this.currentUser;
    }
    
    getHomeDatabase() {
        return this.userHomeDatabase;
    }
    
    getMasterDB() {
        return this.masterDB;
    }

    async refreshDatabaseApps() {
        try {
            console.log('Refreshing database apps...');
            
            // Fetch database configurations from master DB with timeout
            const snapshot = await this.firebaseOperation(
                this.masterDB.ref('databases').get(),
                'Fetching database configurations'
            );
            const configsObj = snapshot.exists() ? snapshot.val() : {};
            
            // Clear existing apps
            this.dbApps = [];
            
            // Initialize database apps
            let appIndex = 0;
            for (const key in configsObj) {
                const cfg = configsObj[key];
                
                // Skip inactive databases
                if (!cfg.active) {
                    console.log(`Skipping inactive DB: ${cfg.url}`);
                    continue;
                }
                
                try {
                    // Check if app already exists for this URL
                    const existingApp = firebase.apps.find(app => {
                        return app.options && app.options.databaseURL === cfg.url;
                    });
                    
                    let app;
                    let appName;
                    
                    if (existingApp) {
                        app = existingApp;
                        appName = existingApp.name;
                    } else {
                        // Create unique app name based on URL
                        appName = `db_${this.hashCode(cfg.url)}`;
                        app = firebase.initializeApp(
                            { databaseURL: cfg.url }, 
                            appName
                        );
                    }
                    
                    const db = app.database();
                    
                    // Health check with timeout
                    const healthCheck = new Promise((resolve) => {
                        db.ref('.info/connected').once('value', (snapshot) => {
                            resolve(snapshot.val() === true);
                        });
                    });
                    
                    const timeout = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error("Timeout")), 3000)
                    );
                    
                    await Promise.race([healthCheck, timeout]);
                    
                    this.dbApps.push({ 
                        app, 
                        db, 
                        limit: cfg.limit, 
                        url: cfg.url,
                        name: appName,
                        configKey: key
                    });
                    
                    console.log(`Database loaded: ${cfg.url} (app: ${appName})`);
                    appIndex++;
                    
                } catch (err) {
                    console.warn(`Failed to initialize database: ${cfg.url}`, err.message);
                }
            }
            
            console.log(`Total database apps loaded: ${this.dbApps.length}`);
            
            // Save to localStorage for future use
            this.saveDatabaseConfigsToStorage();
            
            return this.dbApps;
            
        } catch (error) {
            console.error('Error refreshing database apps:', error);
            throw error;
        }
    }

    // Helper method to create hash from URL
    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    // ==============================================
    // MODULE DATA CLEARING UTILITY
    // ==============================================

    clearAllModuleData() {
        console.log('Clearing all module local data...');
        
        // Clear Photos module data
        if (window.photosModule && typeof window.photosModule.clearLocalData === 'function') {
            window.photosModule.clearLocalData();
        } else {
            console.log('Photos module not available for clearing');
        }
        
        // Clear Notes module data
        if (window.notesModule && typeof window.notesModule.clearLocalData === 'function') {
            window.notesModule.clearLocalData();
        } else {
            console.log('Notes module not available for clearing');
        }
        
        // Clear Credential Manager data
        if (window.credentialManager && typeof window.credentialManager.clearLocalData === 'function') {
            window.credentialManager.clearLocalData();
        } else {
            console.log('Credential manager not available for clearing');
        }
        
        // Clear Files module data (if exists)
        if (window.fileManagerModule && typeof window.fileManagerModule.clearLocalData === 'function') {
            window.fileManagerModule.clearLocalData();
        } else {
            console.log('Files module not available for clearing');
        }
        
        // Clear Contacts module data (if exists)
        if (window.contactsModule && typeof window.contactsModule.clearLocalData === 'function') {
            window.contactsModule.clearLocalData();
        } else {
            console.log('Contacts module not available for clearing');
        }
        
        // Clear any other module-specific localStorage items
        const moduleKeys = Object.keys(localStorage).filter(key => 
            key.includes('module') || 
            key.includes('Module') || 
            key.includes('_data') || 
            key.includes('-data')
        );
        
        moduleKeys.forEach(key => {
            console.log('Removing module key:', key);
            localStorage.removeItem(key);
        });
        
        console.log('All module local data cleared');
    }

    // Then update the logout() method to use it:
    logout() {
        console.log('Logging out...');
        
        // Clear user data but keep email for convenience
        const lastEmail = localStorage.getItem('lastEmail');
        
        // Clear all authentication-related items
        const itemsToRemove = [
            'currentUser',
            'masterDBConfig',
            'availableDBs',
            'userHomeDatabase',
            'userHomeDatabaseUrl',
            'credentials',
            'app_settings',
            'user_preferences'
        ];
        
        itemsToRemove.forEach(item => {
            localStorage.removeItem(item);
        });
        
        // Clear all module data
        this.clearAllModuleData();
        
        // Restore last email if exists
        if (lastEmail) {
            localStorage.setItem('lastEmail', lastEmail);
        }
        
        // Reset state
        this.isAuthenticated = false;
        this.currentUser = null;
        this.userHomeDatabase = null;
        this.dbApps = [];
        
        // Clear any Firebase app instances (except masterApp for auth)
        firebase.apps.forEach(app => {
            if (app.name !== 'masterApp') {
                try {
                    app.delete();
                } catch (error) {
                    console.warn('Error deleting Firebase app:', error);
                }
            }
        });
        
        // IMPORTANT FIX: Show auth UI properly
        this.showAuthUI();
        
        // Dispatch logout event
        window.dispatchEvent(new CustomEvent('authLogout'));
        
        console.log('User logged out successfully');
    }

    // ==============================================
    // UPDATED AUTHENTICATION MODULE WITH FORGOT PASSWORD
    // ==============================================

    async handleForgotPassword() {
        // Create forgot password form with recovery code verification
        this.authContainer.innerHTML = `
            <div class="auth-container">
                <div class="auth-header">
                    <h1 class="app-title">
                        <span class="material-icons" style="font-size: 32px;">health_and_safety</span> 
                        xDrive
                    </h1>
                    <p class="auth-subtitle">Password Recovery</p>
                </div>
                
                <div class="auth-card">
                    <!-- Step 1: Email Verification -->
                    <div id="step1-email" class="auth-form active">
                        <div class="form-header">
                            <h2>Step 1: Verify Your Email</h2>
                        </div>
                        
                        <div class="form-description">
                            <p>Enter your email address to start the password recovery process.</p>
                        </div>
                        
                        <div class="form-group floating">
                            <input type="email" id="recovery-email" placeholder=" " required>
                            <label for="recovery-email">Email Address</label>
                        </div>
                        
                        <div id="recovery-email-error" class="alert error hidden"></div>
                        
                        <div class="form-actions">
                            <button id="verify-email-btn" class="btn btn-primary">
                                <i class="fas fa-arrow-right"></i> Continue
                            </button>
                        </div>
                        
                        <div class="auth-footer">
                            Remember your password? <a id="back-to-signin" class="auth-link">Sign In</a>
                        </div>
                    </div>
                    
                    <!-- Step 2: Recovery Code Verification -->
                    <div id="step2-recovery-code" class="auth-form">
                        <div class="form-header">
                            <h2>Step 2: Enter Recovery Code</h2>
                            <a id="back-to-email" class="back-link">
                                <span class="material-icons">keyboard_arrow_left</span> Back
                            </a>
                        </div>
                        
                        <div class="form-description">
                            <p>Enter one of your recovery codes. Each code can be used only once.</p>
                            <p class="hint">Code format: 8 characters (letters and numbers, no spaces)</p>
                        </div>
                        
                        <div class="form-group floating">
                            <input type="text" id="recovery-code" placeholder=" " 
                                   pattern="[A-Z0-9]{8}" 
                                   maxlength="8" 
                                   style="text-transform: uppercase">
                            <label for="recovery-code">Recovery Code</label>
                        </div>
                        
                        <div id="recovery-code-error" class="alert error hidden"></div>
                        <div id="recovery-code-success" class="alert success hidden"></div>
                        
                        <div class="form-actions">
                            <button id="verify-code-btn" class="btn btn-primary">
                                <i class="fas fa-check-circle"></i> Verify Code
                            </button>
                        </div>
                        
                        <div class="auth-options">
                            <a id="lost-codes-link" class="auth-link">Lost all recovery codes?</a>
                        </div>
                    </div>
                    
                    <!-- Step 3: Reset Password -->
                    <div id="step3-reset-password" class="auth-form">
                        <div class="form-header">
                            <h2>Step 3: Set New Password</h2>
                        </div>
                        
                        <div class="form-group floating">
                            <input type="password" id="new-password" placeholder=" ">
                            <label for="new-password">New Password</label>
                            <span class="material-icons toggle-pass" data-target="new-password">visibility_off</span>
                        </div>
                        
                        <div class="form-group floating">
                            <input type="password" id="confirm-new-password" placeholder=" ">
                            <label for="confirm-new-password">Confirm New Password</label>
                            <span class="material-icons toggle-pass" data-target="confirm-new-password">visibility_off</span>
                        </div>
                        
                        <div id="reset-error" class="alert error hidden"></div>
                        <div id="reset-success" class="alert success hidden"></div>
                        
                        <div class="form-actions">
                            <button id="reset-password-btn" class="btn btn-primary">
                                <i class="fas fa-rotate-left"></i> Reset Password
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Setup event listeners
        this.setupRecoveryProcessListeners();
    }

    setupRecoveryProcessListeners() {
        // Step 1: Email verification
        document.getElementById('verify-email-btn').addEventListener('click', () => this.verifyEmailForRecovery());
        document.getElementById('recovery-email').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verifyEmailForRecovery();
        });
        
        // Step 2: Recovery code verification
        document.getElementById('verify-code-btn').addEventListener('click', () => this.verifyRecoveryCode());
        document.getElementById('recovery-code').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verifyRecoveryCode();
        });
        
        // Step 3: Password reset
        document.getElementById('reset-password-btn').addEventListener('click', () => this.resetPasswordWithCode());
        
        // Navigation
        document.getElementById('back-to-email').addEventListener('click', () => this.showRecoveryStep('step1-email'));
        document.getElementById('back-to-signin').addEventListener('click', () => this.showForm('signin'));
        document.getElementById('lost-codes-link').addEventListener('click', () => this.handleLostRecoveryCodes());
        
        // Password visibility toggles
        document.querySelectorAll('.toggle-pass').forEach(icon => {
            icon.addEventListener('click', (e) => this.togglePassword(e.target));
        });
        
        // Uppercase input for recovery code
        const recoveryCodeInput = document.getElementById('recovery-code');
        if (recoveryCodeInput) {
            recoveryCodeInput.addEventListener('input', function() {
                this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            });
        }
    }

    showRecoveryStep(stepId) {
        console.log('Showing recovery step:', stepId);
        
        // Hide all steps in forgot password container
        document.querySelectorAll('#forgot-password-container .auth-form').forEach(form => {
            form.classList.remove('active');
        });
        
        // Show selected step
        const stepToShow = document.getElementById(stepId);
        if (stepToShow) {
            stepToShow.classList.add('active');
        }
        
        // Clear messages
        this.clearRecoveryMessages();
        
        // Focus on first input of the step
        setTimeout(() => {
            let firstInput;
            if (stepId === 'step1-email') {
                firstInput = document.getElementById('recovery-email');
            } else if (stepId === 'step2-recovery-code') {
                firstInput = document.getElementById('recovery-code');
            } else if (stepId === 'step3-reset-password') {
                firstInput = document.getElementById('new-password');
            }
            if (firstInput) firstInput.focus();
        }, 100);
    }

    clearRecoveryMessages() {
        const errorIds = ['recovery-email-error', 'recovery-code-error', 'reset-error'];
        errorIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        
        const successIds = ['recovery-code-success', 'reset-success'];
        successIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    async verifyEmailForRecovery() {
        const email = document.getElementById('recovery-email').value.trim();
        
        this.clearRecoveryMessages();
        
        if (!email) {
            this.showAuthError('recovery-email-error', 'Please enter your email address');
            return;
        }
        
        if (!this.validateEmail(email)) {
            this.showAuthError('recovery-email-error', 'Please enter a valid email address');
            return;
        }
        
        try {
            this.setButtonLoading('verify-email-btn', true, 'Verifying...');
            
            const encodedEmail = this.encodeEmail(email);
            
            // Check if user exists with timeout
            const userSnapshot = await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).once('value'),
                'Checking user existence'
            );
            
            if (!userSnapshot.exists()) {
                this.showAuthError('recovery-email-error', 'No account found with this email');
                this.setButtonLoading('verify-email-btn', false);
                return;
            }
            
            const userData = userSnapshot.val();
            
            // Check if user has recovery codes
            if (!userData.recoveryCodes || userData.recoveryCodes.length === 0) {
                this.showAuthError('recovery-email-error', 
                    'No recovery codes found for this account. Please contact support.');
                this.setButtonLoading('verify-email-btn', false);
                return;
            }
            
            // Check if any recovery codes are still available
            const availableCodes = userData.recoveryCodes.filter(code => !code.used);
            if (availableCodes.length === 0) {
                this.showAuthError('recovery-email-error', 
                    'All recovery codes have been used. Please generate new codes or contact support.');
                this.setButtonLoading('verify-email-btn', false);
                return;
            }
            
            // Store email for next steps
            this.recoveryEmail = email;
            this.recoveryEncodedEmail = encodedEmail;
            
            // Show success and move to next step
            this.setButtonLoading('verify-email-btn', false);
            this.showRecoveryStep('step2-recovery-code');
            
        } catch (error) {
            console.error('Email verification error:', error);
            
            // Check if it's a timeout error
            if (error.message.includes('timed out') || error.message.includes('Connection timeout')) {
                this.showAuthError('recovery-email-error', 
                    'Connection timeout. Please check your internet connection and try again.');
            } else {
                this.showAuthError('recovery-email-error', 'Error: ' + error.message);
            }
            
            this.setButtonLoading('verify-email-btn', false);
        }
    }

    async verifyRecoveryCode() {
        const codeInput = document.getElementById('recovery-code').value.trim().toUpperCase();
        
        this.clearRecoveryMessages();
        
        if (!codeInput || codeInput.length !== 8) {
            this.showAuthError('recovery-code-error', 'Please enter a valid 8-character recovery code');
            return;
        }
        
        try {
            this.setButtonLoading('verify-code-btn', true, 'Verifying code...');
            
            // Fetch user data again with timeout
            const userSnapshot = await this.firebaseOperation(
                this.masterDB.ref('users/' + this.recoveryEncodedEmail).once('value'),
                'Fetching user data'
            );
            const userData = userSnapshot.val();
            
            // Find the matching recovery code
            const recoveryCodes = userData.recoveryCodes || [];
            const codeIndex = recoveryCodes.findIndex(c => 
                c.code === codeInput && !c.used
            );
            
            if (codeIndex === -1) {
                this.showAuthError('recovery-code-error', 
                    'Invalid or already used recovery code. Please check and try again.');
                this.setButtonLoading('verify-code-btn', false);
                return;
            }
            
            // Mark code as used (temporarily - will be saved after password reset)
            recoveryCodes[codeIndex].used = true;
            recoveryCodes[codeIndex].usedAt = firebase.database.ServerValue.TIMESTAMP;
            
            // Store for password reset step
            this.recoveryCode = codeInput;
            this.recoveryCodeIndex = codeIndex;
            this.tempUserData = { ...userData, recoveryCodes };
            
            // Show success and move to password reset
            this.showAuthSuccess('recovery-code-success', 'Recovery code verified successfully!');
            this.setButtonLoading('verify-code-btn', false);
            
            setTimeout(() => {
                this.showRecoveryStep('step3-reset-password');
            }, 1000);
            
        } catch (error) {
            console.error('Recovery code verification error:', error);
            
            // Check if it's a timeout error
            if (error.message.includes('timed out') || error.message.includes('Connection timeout')) {
                this.showAuthError('recovery-code-error', 
                    'Connection timeout. Please check your internet connection and try again.');
            } else {
                this.showAuthError('recovery-code-error', 'Error: ' + error.message);
            }
            
            this.setButtonLoading('verify-code-btn', false);
        }
    }

    async resetPasswordWithCode() {
        const newPassword = document.getElementById('new-password').value.trim();
        const confirmPassword = document.getElementById('confirm-new-password').value.trim();
        
        this.clearRecoveryMessages();
        
        if (!newPassword || !confirmPassword) {
            this.showAuthError('reset-error', 'Please enter and confirm your new password');
            return;
        }
        
        if (!this.validatePassword(newPassword)) {
            this.showAuthError('reset-error', 'Password must be at least 6 characters');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            this.showAuthError('reset-error', 'Passwords do not match');
            return;
        }
        
        try {
            this.setButtonLoading('reset-password-btn', true, 'Resetting password...');
            
            // Update password and mark recovery code as used
            await this.firebaseOperation(
                this.masterDB.ref('users/' + this.recoveryEncodedEmail).update({
                    password: newPassword,
                    recoveryCodes: this.tempUserData.recoveryCodes,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP,
                    lastPasswordReset: firebase.database.ServerValue.TIMESTAMP
                }),
                'Updating password'
            );
            
            // Log the reset action
            await this.firebaseOperation(
                this.masterDB.ref('userLogs/passwordResets').push({
                    email: this.recoveryEmail,
                    encodedEmail: this.recoveryEncodedEmail,
                    usedRecoveryCode: this.recoveryCode,
                    resetAt: firebase.database.ServerValue.TIMESTAMP,
                    ipAddress: await this.getClientIP(),
                    userAgent: navigator.userAgent.substring(0, 200)
                }),
                'Logging reset action'
            );
            
            // Show success message
            this.showAuthSuccess('reset-success', 
                'Password reset successfully! Redirecting to sign in...');
            
            this.setButtonLoading('reset-password-btn', false);
            
            // Save email for auto-fill
            localStorage.setItem('lastEmail', this.recoveryEmail);
            
            // Clear temporary data
            this.recoveryEmail = null;
            this.recoveryEncodedEmail = null;
            this.recoveryCode = null;
            this.recoveryCodeIndex = null;
            this.tempUserData = null;
            
            // Wait for success message to be visible
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // IMPORTANT: Re-render the entire auth UI to show sign in form
            this.renderAuthUI();
            
            // Auto-fill email in sign in form
            setTimeout(() => {
                const signinEmailInput = document.getElementById('signin-email');
                if (signinEmailInput && this.recoveryEmail) {
                    signinEmailInput.value = this.recoveryEmail;
                }
                
                // Clear password field
                const signinPasswordInput = document.getElementById('signin-password');
                if (signinPasswordInput) {
                    signinPasswordInput.value = '';
                }
                
                // Show success message in sign in form
                this.showAuthSuccess('signin-success', 
                    'Password reset successful! Please sign in with your new password.');
                
                // Focus on password field
                setTimeout(() => {
                    if (signinPasswordInput) signinPasswordInput.focus();
                }, 100);
                
            }, 100);
            
        } catch (error) {
            console.error('Password reset error:', error);
            
            // Check if it's a timeout error
            if (error.message.includes('timed out') || error.message.includes('Connection timeout')) {
                this.showAuthError('reset-error', 
                    'Connection timeout. Please check your internet connection and try again.');
            } else {
                this.showAuthError('reset-error', 'Error: ' + error.message);
            }
            
            this.setButtonLoading('reset-password-btn', false);
        }
    }

    async handleLostRecoveryCodes() {
        // Show message about contacting support
        this.showAuthError('recovery-code-error', 
            'If you have lost all recovery codes, please contact support at support@xDrive.example.com ' +
            'with your account details for identity verification.');
        
        // Optional: Implement account recovery via support with additional verification
        // This could include:
        // 1. Security questions (if user set them up)
        // 2. Phone verification via SMS
        // 3. Email verification with admin approval
        // 4. Document verification for sensitive accounts
    }


    setupForgotPasswordListeners() {
        // Back to sign in links
        document.getElementById('show-signin-from-forgot').addEventListener('click', () => this.showForm('signin'));
        document.getElementById('show-signin-from-forgot-footer').addEventListener('click', () => this.showForm('signin'));
        
        // Submit button
        document.getElementById('forgot-submit-btn').addEventListener('click', () => this.submitForgotPassword());
        
        // Password strength indicator for new password
        const newPasswordInput = document.getElementById('new-password');
        if (newPasswordInput) {
            newPasswordInput.removeEventListener('input', this.boundPasswordStrength);
            this.boundPasswordStrength = (e) => this.updateAuthPasswordStrength(e.target.value);
            newPasswordInput.addEventListener('input', this.boundPasswordStrength);
        }

        // Enter key support
        document.getElementById('forgot-email').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitForgotPassword();
            }
        });
    }

    async submitForgotPassword() {
        const email = document.getElementById('forgot-email').value.trim();
        
        // Clear messages
        this.clearAuthMessages();
        
        if (!email) {
            this.showAuthError('forgot-error', 'Please enter your email address');
            return;
        }
        
        if (!this.validateEmail(email)) {
            this.showAuthError('forgot-error', 'Please enter a valid email address');
            return;
        }
        
        try {
            this.setButtonLoading('forgot-submit-btn', true, 'Processing...');
            
            const encodedEmail = this.encodeEmail(email);
            
            // Check if user exists with timeout
            const userSnapshot = await this.firebaseOperation(
                this.masterDB.ref('users/' + encodedEmail).once('value'),
                'Checking user existence'
            );
            
            if (!userSnapshot.exists()) {
                this.showAuthError('forgot-error', 'No account found with this email');
                this.setButtonLoading('forgot-submit-btn', false);
                return;
            }
            
            // Create password reset request
            const requestData = {
                email: email,
                encodedEmail: encodedEmail,
                requestedAt: firebase.database.ServerValue.TIMESTAMP,
                ipAddress: await this.getClientIP(),
                userAgent: navigator.userAgent.substring(0, 200),
                status: 'pending',
                token: this.generateResetToken(),
                expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours from now
            };
            
            // Store in master database under userRequests
            await this.firebaseOperation(
                this.masterDB.ref('userRequests/passwordReset/' + encodedEmail).set(requestData),
                'Creating reset request'
            );
            
            // Also store under requests by token for easy lookup
            await this.firebaseOperation(
                this.masterDB.ref('resetTokens/' + requestData.token).set({
                    email: email,
                    encodedEmail: encodedEmail,
                    requestedAt: requestData.requestedAt,
                    status: 'pending'
                }),
                'Storing reset token'
            );
            
            // Show success message
            this.showAuthSuccess('forgot-success', 
                'Password reset instructions have been sent to your email. ' +
                'Check your inbox and follow the link to reset your password.');
            
            this.setButtonLoading('forgot-submit-btn', false);
            
            // Clear email field
            document.getElementById('forgot-email').value = '';
            
            // Optional: Simulate sending email (in real app, you'd integrate with email service)
            console.log('Password reset requested for:', email);
            console.log('Reset token:', requestData.token);
            console.log('Request data saved to database');
            
            // In a real application, you would:
            // 1. Send an email with reset link containing the token
            // 2. The link would point to: yourdomain.com/reset-password.html?token=TOKEN_HERE
            // 3. Create a reset-password.html page that validates the token and allows password reset
            
        } catch (error) {
            console.error('Forgot password error:', error);
            
            // Check if it's a timeout error
            if (error.message.includes('timed out') || error.message.includes('Connection timeout')) {
                this.showAuthError('forgot-error', 
                    'Connection timeout. Please check your internet connection and try again.');
            } else {
                this.showAuthError('forgot-error', 'Error processing request: ' + error.message);
            }
            
            this.setButtonLoading('forgot-submit-btn', false);
        }
    }

    // Add this utility method to generate reset token
    generateResetToken() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < 32; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    // Add method to get client IP (simplified version)
    async getClientIP() {
        try {
            // Try to get IP from external service with timeout
            const response = await this.firebaseOperation(
                fetch('https://api.ipify.org?format=json'),
                'Getting IP address'
            );
            const data = await response.json();
            return data.ip;
        } catch (error) {
            console.warn('Could not get client IP:', error);
            return 'unknown';
        }
    }

    // Add to AuthModule class
    updateAuthPasswordStrength(password) {
        const strengthBar = document.getElementById('authPasswordStrengthBar');
        const strengthText = document.getElementById('authPasswordStrengthText');
        
        if (!strengthBar || !strengthText) return;

        let strength = 0;
        let width = '0%';
        let color = 'var(--border)';
        let text = 'Enter a password';
        
        if (password.length > 0) {
            if (password.length >= 6) strength += 1;
            if (/[A-Z]/.test(password)) strength += 1;
            if (/[0-9]/.test(password)) strength += 1;
            if (/[^A-Za-z0-9]/.test(password)) strength += 1;
            
            if (strength === 1) {
                width = '25%';
                text = 'Weak';
                color = '#ef4444';
            } else if (strength === 2) {
                width = '50%';
                text = 'Fair';
                color = '#f59e0b';
            } else if (strength === 3) {
                width = '75%';
                text = 'Good';
                color = '#3b82f6';
            } else if (strength >= 4) {
                width = '100%';
                text = 'Strong';
                color = '#10b981';
            } else {
                width = '10%';
                text = 'Too short';
                color = '#ef4444';
            }
        }
        
        strengthBar.style.width = width;
        strengthBar.style.backgroundColor = color;
        strengthText.textContent = text;
        strengthText.style.color = color;
    }

}

// Initialize auth module
let authModule;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing Auth Module...');
    authModule = new AuthModule();
    window.authModule = authModule;
    
    // Listen for logout events from sidebar
    window.addEventListener('authLogoutRequest', function() {
        if (authModule) {
            authModule.logout();
        }
    });

    // Listen for auth success to reset sidebar if needed
    window.addEventListener('authSuccess', function() {
        if (window.sidebarManager) {
            window.sidebarManager.resetSidebar();
        }
    });
});