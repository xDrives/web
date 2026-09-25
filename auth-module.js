// ==============================================
// CONSOLIDATED AUTH & DATA MANAGER
// Single Firebase Database - admin-efcf4-default-rtdb.europe-west1.firebasedatabase.app
// App Lock = account password (required on every init)
// + Forgot Password with recovery codes
// ==============================================

class AuthDataManager {
    constructor() {
        this.DATABASE_URL = "https://admin-efcf4-default-rtdb.europe-west1.firebasedatabase.app/";

        this.app = null;
        this.db = null;

        // State
        this.isAuthenticated = false;
        this.currentUser = null;
        this.encodedPhone = null;

        // App Lock state
        this.isAppUnlocked = false;

        // Recovery flow state
        this.recoveryPhone = null;
        this.recoveryEncodedPhone = null;
        this.recoveryCode = null;
        this.recoveryCodeIndex = null;
        this.tempUserData = null;

        // DOM
        this.authContainer = null;

        this.TIMEOUT_DURATION = 30000;

        if (typeof PhoneValidator === 'undefined') {
            console.error('PhoneValidator not loaded. Include phone-validator.js first.');
        }

        this.init();
    }

    // ========== TIMEOUT HELPERS ==========
    withTimeout(promise, operationName = 'Operation') {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${this.TIMEOUT_DURATION/1000} seconds.`));
            }, this.TIMEOUT_DURATION);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
    }

    async firebaseOperation(promise, operationName) {
        try {
            return await this.withTimeout(promise, operationName);
        } catch (error) {
            if (error.message.includes('timed out')) {
                throw new Error(`Connection timeout. Please check your internet connection.`);
            }
            throw error;
        }
    }

    // ========== INITIALIZATION ==========
    init() {
        console.log('Initializing AuthDataManager...');
        try {
            this.app = firebase.initializeApp({ databaseURL: this.DATABASE_URL }, "mainApp");
            this.db = this.app.database();
            console.log('Firebase initialized with database:', this.DATABASE_URL);
        } catch (error) {
            console.error('Failed to initialize Firebase:', error);
        }
        this.checkAuthState();
    }

    // ========== AUTH STATE ==========
    async checkAuthState() {
        try {
            const savedUser = localStorage.getItem('currentUser');

            if (!savedUser) {
                this.showAuthUI('signin');
                return;
            }

            this.currentUser = JSON.parse(savedUser);
            this.isAuthenticated = true;
            this.encodedPhone = this.encodePhone(this.currentUser.phone);

            // Show App Lock immediately
            this.showAuthUI('applock');

            // Verify status in background
            this.verifyAccountStatusInBackground();

        } catch (error) {
            console.error('Error checking auth state:', error);
            this.showAuthUI('signin');
        }
    }

    async verifyAccountStatusInBackground() {
        try {
            const verifiedStatus = await this.firebaseOperation(
                this.verifyAccountStatusFromServer(),
                'Account status verification'
            );

            if (verifiedStatus === 'suspended') {
                console.warn('Account suspended, forcing logout');
                this.clearAuthData();
                this.showAuthUI('signin');
                this.showAuthError('signin-error', 'Your account has been suspended.');
                return;
            }

            if (verifiedStatus === 'deactivated') {
                const deactivationEnd = await this.getDeactivationEnd();

                if (deactivationEnd && Date.now() > deactivationEnd) {
                    await this.reactivateAccount();
                    this.currentUser.status = 'active';
                    localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                    return;
                }

                const remainingDays = deactivationEnd ?
                    Math.ceil((deactivationEnd - Date.now()) / (24 * 60 * 60 * 1000)) : 0;

                this.clearAuthData();
                this.showAuthUI('signin');
                this.showAuthError('signin-error',
                    `Account is deactivated. Try again in ${remainingDays} day(s).`);
                return;
            }

            if (verifiedStatus !== this.currentUser.status) {
                this.currentUser.status = verifiedStatus;
                localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            }

        } catch (error) {
            console.warn('Background status verification failed (offline?):', error);
        }
    }

    // ========== APP LOCK FORM CONTROL ==========
    // ========== APP LOCK RATE LIMIT ==========
    async getAppLockAttempts() {
        if (!this.encodedPhone) return { failedCount: 0, lockedUntil: 0 };
        try {
            const snap = await this.getRef(`users/${this.encodedPhone}/appLockAttempts`).once('value');
            const data = snap.exists() ? snap.val() : {};
            return {
                failedCount: data.failedCount || 0,
                lockedUntil: data.lockedUntil || 0
            };
        } catch (e) {
            return { failedCount: 0, lockedUntil: 0 };
        }
    }

    showLockedMessage(lockedUntil) {
        const input = document.getElementById('applock-unlock-code');
        const btn   = document.getElementById('applock-unlock-btn');
        const errEl = document.getElementById('applock-error');

        if (input) input.disabled = true;
        if (btn)   btn.disabled = true;

        const dt = new Date(lockedUntil);
        const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (errEl) {
            errEl.innerHTML = `<i class="fas fa-lock"></i> Too many failed attempts. Try again after <strong>${timeStr}</strong>.`;
            errEl.classList.remove('hidden');
        }
    }

    activateAppLockForm() {
        document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));

        const appLockForm = document.getElementById('applock-form');
        if (!appLockForm) { console.warn('App lock form not found in DOM'); return; }

        appLockForm.classList.add('active');

        const subtitleEl = document.getElementById('applock-subtitle');
        if (subtitleEl) {
            const name = this.currentUser?.name?.split(' ')[0] || 'User';
            subtitleEl.textContent = `Welcome back, ${name}`;
        }

        const input = document.getElementById('applock-unlock-code');
        if (input) { input.value = ''; input.disabled = false; }

        const btn = document.getElementById('applock-unlock-btn');
        if (btn) btn.disabled = false;

        document.getElementById('applock-error')?.classList.add('hidden');

        // Restore lockout UI if still active
        (async () => {
            const { lockedUntil } = await this.getAppLockAttempts();
            if (lockedUntil && Date.now() < lockedUntil) {
                this.showLockedMessage(lockedUntil);
            } else if (input) {
                setTimeout(() => input.focus(), 100);
            }
        })();
    }

    // ========== APP LOCK HANDLER ==========
    async handleAppLockUnlock() {
        const code = document.getElementById('applock-unlock-code')?.value?.trim() || '';
        const btn  = document.getElementById('applock-unlock-btn');

        if (!code) { this.showAppLockError('Please enter your account password'); return; }
        if (!this.encodedPhone) { this.showAppLockError('Session expired. Please sign in again.'); return; }

        // ⬇️ Immediate UI feedback — before any awaits
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        }
        const input = document.getElementById('applock-unlock-code');
        if (input) input.disabled = true;

        try {
            // Check lockout state
            const { failedCount, lockedUntil } = await this.getAppLockAttempts();

            if (lockedUntil && Date.now() < lockedUntil) {
                if (input) input.disabled = false;
                this.showLockedMessage(lockedUntil);
                return;
            }

            if (lockedUntil && Date.now() >= lockedUntil) {
                await this.getRef(`users/${this.encodedPhone}/appLockAttempts`).remove();
            }

            // Verify password
            const snap = await this.firebaseOperation(
                this.getRef(`users/${this.encodedPhone}/password`).once('value'),
                'Verifying password'
            );
            const storedPassword = snap.exists() ? snap.val() : null;

            if (!storedPassword || storedPassword !== code) {
                // ---- WRONG PASSWORD ----
                const newCount = failedCount + 1;

                if (newCount >= 3) {
                    const until = Date.now() + 60000;
                    await this.getRef(`users/${this.encodedPhone}/appLockAttempts`).set({
                        failedCount: newCount,
                        lockedUntil: until,
                        lastAttempt: firebase.database.ServerValue.TIMESTAMP
                    });
                    this.showLockedMessage(until);
                    return;
                }

                await this.getRef(`users/${this.encodedPhone}/appLockAttempts`).set({
                    failedCount: newCount,
                    lockedUntil: 0,
                    lastAttempt: firebase.database.ServerValue.TIMESTAMP
                });

                const remaining = 3 - newCount;
                this.showAppLockError(
                    `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                );

                if (input) {
                    input.disabled = false;
                    input.value = '';
                    input.classList.add('shake-animation');
                    setTimeout(() => input.classList.remove('shake-animation'), 500);
                    input.focus();
                }
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock';
                }
                return;
            }

            // ---- SUCCESS ----
            await this.getRef(`users/${this.encodedPhone}/appLockAttempts`).remove();
            this.isAppUnlocked = true;
            this.onAuthSuccess();

        } catch (err) {
            console.error('App lock error:', err);
            this.showAppLockError('Verification failed: ' + err.message);
            if (input) input.disabled = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock';
            }
        }
    }
    
    showAppLockError(message) {
        const el = document.getElementById('applock-error');
        if (el) { el.textContent = message; el.classList.remove('hidden'); }
    }

    // ========== DATABASE REFERENCES ==========
    getRef(path = '') {
        if (!this.db) { console.error('Database not initialized'); return null; }
        return this.db.ref(path);
    }

    getUserDataRef(path = '') {
        if (!this.encodedPhone) { console.error('No encoded phone available'); return null; }
        const fullPath = `userData/${this.encodedPhone}${path ? '/' + path : ''}`;
        return this.getRef(fullPath);
    }

    getUserProfileRef() {
        if (!this.encodedPhone) { console.error('No encoded phone available'); return null; }
        return this.getRef(`users/${this.encodedPhone}`);
    }

    getUserPhotosRef()   { return this.getUserDataRef('photos'); }
    getUserNotesRef()    { return this.getUserDataRef('notes'); }
    getUserFilesRef()    { return this.getUserDataRef('files'); }
    getUserStorageRef()  { return this.getUserDataRef('storage'); }

    // ========== DATA OPERATIONS ==========
    async saveUserData(path, data) {
        const ref = this.getUserDataRef(path);
        if (!ref) throw new Error('Cannot get user data reference');
        return await this.firebaseOperation(ref.update(data), 'Saving user data');
    }

    async getUserData(path = '') {
        const ref = this.getUserDataRef(path);
        if (!ref) throw new Error('Cannot get user data reference');
        const snapshot = await this.firebaseOperation(ref.once('value'), 'Fetching user data');
        return snapshot.exists() ? snapshot.val() : null;
    }

    async pushUserData(path, data) {
        const ref = this.getUserDataRef(path);
        if (!ref) throw new Error('Cannot get user data reference');
        return await this.firebaseOperation(ref.push(data), 'Adding user data');
    }

    async removeUserData(path) {
        const ref = this.getUserDataRef(path);
        if (!ref) throw new Error('Cannot get user data reference');
        return await this.firebaseOperation(ref.remove(), 'Removing user data');
    }

    // ========== VERIFICATION ==========
    async verifyAccountStatusFromServer() {
        if (!this.currentUser?.phone) throw new Error('No user data available');
        const snapshot = await this.firebaseOperation(
            this.getRef(`users/${this.encodedPhone}/status`).once('value'),
            'Verifying account status'
        );
        return snapshot.exists() ? snapshot.val() : (this.currentUser.status || 'active');
    }

    async getDeactivationEnd() {
        if (!this.encodedPhone) return null;
        const snapshot = await this.firebaseOperation(
            this.getRef(`users/${this.encodedPhone}/deactivationEnd`).once('value'),
            'Getting deactivation end'
        );
        return snapshot.exists() ? snapshot.val() : null;
    }

    async reactivateAccount() {
        const updateData = {
            status: 'active',
            deactivationStart: null,
            deactivationEnd: null,
            deactivationDuration: null,
            reactivatedAt: firebase.database.ServerValue.TIMESTAMP,
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        };
        await this.firebaseOperation(
            this.getRef(`users/${this.encodedPhone}`).update(updateData),
            'Reactivating account'
        );
        await this.firebaseOperation(
            this.getRef(`userActivity/${this.encodedPhone}/account_actions`).push({
                type: 'account_reactivated_auto',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                reason: 'cooldown_period_ended'
            }),
            'Logging reactivation'
        );
        return updateData;
    }

    // ========== DRIVE FOLDER (Phone Number Based) ==========
    getDriveUserId() {
        if (!this.currentUser || !this.currentUser.phone) return null;
        return this.encodePhone(this.currentUser.phone);
    }

    /**
     * Generates the Drive folder name from the user's phone number.
     * Strips all non-digit characters (keeps leading + if present).
     * Example: "+8801712345678" -> "8801712345678"
     */
    getDriveFolderName() {
        if (!this.currentUser || !this.currentUser.phone) return null;
        // Keep only digits (and optional leading +)
        return this.currentUser.phone.replace(/[^\d]/g, '');
    }

    /**
     * Saves Drive folder metadata to Firebase.
     * The folder name is the user's phone number (digits only).
     * No external API call — the folder is created client-side by the
     * Drive integration layer using the phone number as its name.
     */
    async saveDriveUserInfo() {
        if (!this.currentUser || !this.currentUser.phone) return null;
        const userId = this.getDriveUserId();
        const folderName = this.getDriveFolderName();
        if (!userId || !folderName) return null;

        try {
            const folderData = {
                driveFolderId: userId,          // phone-based identifier
                driveFolderName: folderName,    // <- user's phone number (digits)
                driveSetupDate: firebase.database.ServerValue.TIMESTAMP
            };

            await this.firebaseOperation(
                this.getUserProfileRef().update(folderData),
                'Saving Drive folder info'
            );

            console.log('Drive folder info saved:', folderData);
            return {
                success: true,
                userId: userId,
                folderId: userId,
                folderName: folderName
            };
        } catch (error) {
            console.error('Error saving Drive folder info:', error);
            return null;
        }
    }

    /**
     * Retrieves Drive folder info from Firebase (no external API).
     */
    async getDriveFolderInfo() {
        if (!this.currentUser || !this.currentUser.phone) return null;
        const userId = this.getDriveUserId();
        if (!userId) return null;

        try {
            const snapshot = await this.firebaseOperation(
                this.getUserProfileRef().once('value'),
                'Getting Drive folder info'
            );

            if (!snapshot.exists()) return null;

            const data = snapshot.val();
            if (!data.driveFolderName) return null;

            return {
                success: true,
                userId: userId,
                folderId: data.driveFolderId || userId,
                folderName: data.driveFolderName
            };
        } catch (error) {
            console.error('Error getting Drive folder info:', error);
            return null;
        }
    }

    // ========== AUTH HANDLERS ==========
    async handleSignup() {
        const formData = this.getFormData('signup');
        const { name, phone, password, confirm } = formData;

        this.clearAuthMessages();

        if (!name || !phone || !password || !confirm) {
            this.showAuthError('signup-error', 'Please fill in all required fields');
            return;
        }

        const phoneValidation = PhoneValidator.validatePhone(phone);
        if (!phoneValidation.valid) {
            this.showAuthError('signup-error', 'Please enter a valid Bangladesh phone number');
            return;
        }

        this.encodedPhone = this.encodePhone(phoneValidation.normalized);

        if (password !== confirm) {
            this.showAuthError('signup-error', 'Passwords do not match');
            return;
        }

        try {
            this.setButtonLoading('signup-btn', true, 'Creating account...');

            const masterSnapshot = await this.firebaseOperation(
                this.getRef(`users/${this.encodedPhone}`).once('value'),
                'Checking existing user'
            );

            if (masterSnapshot.exists()) {
                this.showAuthError('signup-error', 'Phone number already registered');
                this.setButtonLoading('signup-btn', false);
                return;
            }

            const recoveryCodes = this.generateRecoveryCodes(5);
            const deviceUid = 'dev-' + Math.random().toString(36).substring(2) + Date.now();

            const userData = {
                name: name,
                phone: phoneValidation.normalized,
                password: password,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                lastLogin: firebase.database.ServerValue.TIMESTAMP,
                status: 'active',
                role: 'user',
                deviceUid: deviceUid,
                recoveryCodes: recoveryCodes,
                recoveryCodesGenerated: firebase.database.ServerValue.TIMESTAMP,
                driveFolderName: phoneValidation.normalized.replace(/[^\d]/g, '')
            };

            await this.firebaseOperation(
                this.getRef(`users/${this.encodedPhone}`).set(userData),
                'Creating user account'
            );

            await this.firebaseOperation(
                this.getRef(`userData/${this.encodedPhone}`).set({
                    photos: {}, notes: {}, files: {},
                    storage: { used: 0, total: 0 },
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP
                }),
                'Initializing user data'
            );

            // Save drive folder info (phone-based)
            try {
                const driveResult = await this.saveDriveUserInfo();
                if (!driveResult) console.warn('Drive folder info save returned null');
            } catch (driveError) {
                console.warn('Drive folder info save failed:', driveError);
            }

            this.currentUser = userData;
            this.isAuthenticated = true;

            localStorage.setItem('currentUser', JSON.stringify(userData));
            localStorage.setItem('lastPhone', phoneValidation.normalized);

            this.downloadRecoveryCodes(recoveryCodes);
            this.setButtonLoading('signup-btn', false);

            this.isAppUnlocked = true;
            this.onAuthSuccess();

        } catch (error) {
            console.error('Signup error:', error);
            this.showAuthError('signup-error', 'Error creating account: ' + error.message);
            this.setButtonLoading('signup-btn', false);
        }
    }

    async handleSignin() {
        const formData = this.getFormData('signin');
        const { phone, password } = formData;

        this.clearAuthMessages();

        if (!phone || !password) {
            this.showAuthError('signin-error', 'Please enter phone number and password');
            return;
        }

        const phoneValidation = PhoneValidator.validatePhone(phone);
        if (!phoneValidation.valid) {
            this.showAuthError('signin-error', 'Please enter a valid Bangladesh phone number');
            return;
        }

        this.encodedPhone = this.encodePhone(phoneValidation.normalized);

        try {
            this.setButtonLoading('signin-btn', true, 'Signing in...');

            const masterSnapshot = await this.firebaseOperation(
                this.getRef(`users/${this.encodedPhone}`).once('value'),
                'User lookup'
            );

            if (!masterSnapshot.exists()) {
                this.setButtonLoading('signin-btn', false);
                this.showAuthError('signin-error', 'User not found');
                return;
            }

            const userData = masterSnapshot.val();

            if (userData.password !== password) {
                this.showAuthError('signin-error', 'Incorrect password');
                this.setButtonLoading('signin-btn', false);
                return;
            }

            if (userData.status === 'deactivated') {
                if (userData.deactivationEnd && Date.now() < userData.deactivationEnd) {
                    const remainingDays = Math.ceil((userData.deactivationEnd - Date.now()) / (24 * 60 * 60 * 1000));
                    this.showAuthError('signin-error', `Account deactivated. Try again in ${remainingDays} day(s).`);
                    this.setButtonLoading('signin-btn', false);
                    return;
                } else {
                    await this.reactivateAccount();
                }
            }

            if (userData.status === 'suspended') {
                this.showAuthError('signin-error', 'Your account has been suspended');
                this.setButtonLoading('signin-btn', false);
                return;
            }

            await this.firebaseOperation(
                this.getRef(`users/${this.encodedPhone}`).update({
                    lastLogin: firebase.database.ServerValue.TIMESTAMP,
                    loginCount: (userData.loginCount || 0) + 1
                }),
                'Updating last login'
            );

            this.currentUser = userData;
            this.isAuthenticated = true;

            localStorage.setItem('currentUser', JSON.stringify(userData));
            localStorage.setItem('lastPhone', phoneValidation.normalized);

            this.setButtonLoading('signin-btn', false);
            console.log('User signed in:', phone);

            this.isAppUnlocked = true;
            this.onAuthSuccess();

        } catch (error) {
            console.error('Signin error:', error);
            this.showAuthError('signin-error', 'Error signing in: ' + error.message);
            this.setButtonLoading('signin-btn', false);
        }
    }

    // ==============================================
    // FORGOT PASSWORD — RECOVERY FLOW
    // ==============================================
    showForgotPassword() {
        console.log('Showing forgot password flow...');

        // Hide all auth forms
        document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));

        // Show forgot password container
        const forgotContainer = document.getElementById('forgot-password-container');
        if (forgotContainer) forgotContainer.style.display = 'block';

        // Show step 1
        this.showRecoveryStep('step1-phone');

        this.clearAuthMessages();

        // Reset recovery state
        this.recoveryPhone = null;
        this.recoveryEncodedPhone = null;
        this.recoveryCode = null;
        this.recoveryCodeIndex = null;
        this.tempUserData = null;

        // Setup step listeners
        this.setupForgotPasswordStepListeners();
    }

    setupForgotPasswordStepListeners() {
        // Step 1: Verify phone
        const verifyPhoneBtn = document.getElementById('verify-phone-btn');
        if (verifyPhoneBtn) {
            verifyPhoneBtn.onclick = () => this.verifyPhoneForRecovery();
        }

        const recoveryPhone = document.getElementById('recovery-phone');
        if (recoveryPhone) {
            recoveryPhone.oninput = () => {
                PhoneValidator.updatePhoneValidation('recovery-phone', 'recovery-phone-status');
            };
            recoveryPhone.onkeypress = (e) => {
                if (e.key === 'Enter') this.verifyPhoneForRecovery();
            };
        }

        // Step 2: Verify recovery code
        const verifyCodeBtn = document.getElementById('verify-code-btn');
        if (verifyCodeBtn) {
            verifyCodeBtn.onclick = () => this.verifyRecoveryCode();
        }

        const recoveryCode = document.getElementById('recovery-code');
        if (recoveryCode) {
            recoveryCode.oninput = function() {
                this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            };
            recoveryCode.onkeypress = (e) => {
                if (e.key === 'Enter') this.verifyRecoveryCode();
            };
        }

        // Step 3: Reset password
        const resetPasswordBtn = document.getElementById('reset-password-btn');
        if (resetPasswordBtn) {
            resetPasswordBtn.onclick = () => this.resetPasswordWithCode();
        }

        // Password strength indicator
        const newPassword = document.getElementById('new-password');
        if (newPassword) {
            newPassword.oninput = () => this.updateAuthPasswordStrength(newPassword.value);
        }

        // Navigation
        const backToPhone = document.getElementById('back-to-phone');
        if (backToPhone) {
            backToPhone.onclick = () => this.showRecoveryStep('step1-phone');
        }

        const backToSignin = document.getElementById('back-to-signin-from-forgot');
        if (backToSignin) {
            backToSignin.onclick = () => this.showForm('signin');
        }

        const lostCodesLink = document.getElementById('lost-codes-link');
        if (lostCodesLink) {
            lostCodesLink.onclick = () => this.handleLostRecoveryCodes();
        }

        // Password visibility toggles inside forgot password
        document.querySelectorAll('#forgot-password-container .toggle-pass-modern').forEach(btn => {
            btn.onclick = () => {
                const input = document.getElementById(btn.getAttribute('data-target'));
                const icon = btn.querySelector('.material-icons');
                if (!input) return;
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.textContent = 'visibility';
                } else {
                    input.type = 'password';
                    icon.textContent = 'visibility_off';
                }
            };
        });
    }

    showRecoveryStep(stepId) {
        console.log('Showing recovery step:', stepId);

        // Hide all steps within forgot password container
        document.querySelectorAll('#forgot-password-container .auth-form').forEach(form => {
            form.classList.remove('active');
        });

        // Also hide the top-level sign-in / signup / applock forms
        document.querySelectorAll('.auth-card-modern > .auth-form').forEach(form => {
            form.classList.remove('active');
        });

        const stepToShow = document.getElementById(stepId);
        if (stepToShow) stepToShow.classList.add('active');

        this.clearRecoveryMessages();

        setTimeout(() => {
            let firstInput;
            if (stepId === 'step1-phone') firstInput = document.getElementById('recovery-phone');
            else if (stepId === 'step2-recovery-code') firstInput = document.getElementById('recovery-code');
            else if (stepId === 'step3-reset-password') firstInput = document.getElementById('new-password');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    clearRecoveryMessages() {
        ['recovery-phone-error', 'recovery-code-error', 'reset-error'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        ['recovery-code-success', 'reset-success'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    async verifyPhoneForRecovery() {
        const phone = document.getElementById('recovery-phone')?.value?.trim() || '';

        this.clearRecoveryMessages();

        if (!phone) {
            this.showAuthError('recovery-phone-error', 'Please enter your phone number');
            return;
        }

        const phoneValidation = PhoneValidator.validatePhone(phone);
        if (!phoneValidation.valid) {
            this.showAuthError('recovery-phone-error', 'Please enter a valid Bangladesh phone number');
            return;
        }
        const encodedPhone = this.encodePhone(phoneValidation.normalized);

        try {
            this.setButtonLoading('verify-phone-btn', true, 'Verifying...');

            const userSnapshot = await this.firebaseOperation(
                this.getRef(`users/${encodedPhone}`).once('value'),
                'Checking user existence'
            );

            if (!userSnapshot.exists()) {
                this.showAuthError('recovery-phone-error', 'No account found with this phone number');
                this.setButtonLoading('verify-phone-btn', false);
                return;
            }

            const userData = userSnapshot.val();

            if (!userData.recoveryCodes || userData.recoveryCodes.length === 0) {
                this.showAuthError('recovery-phone-error',
                    'No recovery codes found for this account. Please contact support.');
                this.setButtonLoading('verify-phone-btn', false);
                return;
            }

            const availableCodes = (Array.isArray(userData.recoveryCodes) ?
                userData.recoveryCodes : Object.values(userData.recoveryCodes))
                .filter(code => !code.used);

            if (availableCodes.length === 0) {
                this.showAuthError('recovery-phone-error',
                    'All recovery codes have been used. Please contact support.');
                this.setButtonLoading('verify-phone-btn', false);
                return;
            }

            this.recoveryPhone = phoneValidation.normalized;
            this.recoveryEncodedPhone = encodedPhone;

            this.setButtonLoading('verify-phone-btn', false);
            this.showRecoveryStep('step2-recovery-code');

        } catch (error) {
            console.error('Phone verification error:', error);
            this.showAuthError('recovery-phone-error', 'Error: ' + error.message);
            this.setButtonLoading('verify-phone-btn', false);
        }
    }

    async verifyRecoveryCode() {
        const codeInput = (document.getElementById('recovery-code')?.value || '').trim().toUpperCase();

        this.clearRecoveryMessages();

        if (!codeInput || codeInput.length !== 8) {
            this.showAuthError('recovery-code-error', 'Please enter a valid 8-character recovery code');
            return;
        }

        try {
            this.setButtonLoading('verify-code-btn', true, 'Verifying code...');

            const userSnapshot = await this.firebaseOperation(
                this.getRef(`users/${this.recoveryEncodedPhone}`).once('value'),
                'Fetching user data'
            );
            const userData = userSnapshot.val();

            const recoveryCodes = Array.isArray(userData.recoveryCodes) ?
                userData.recoveryCodes : Object.values(userData.recoveryCodes || {});

            const codeIndex = recoveryCodes.findIndex(c =>
                c.code === codeInput && !c.used
            );

            if (codeIndex === -1) {
                this.showAuthError('recovery-code-error',
                    'Invalid or already used recovery code. Please check and try again.');
                this.setButtonLoading('verify-code-btn', false);
                return;
            }

            // Mark as used (will commit on password reset)
            recoveryCodes[codeIndex].used = true;
            recoveryCodes[codeIndex].usedAt = firebase.database.ServerValue.TIMESTAMP;

            this.recoveryCode = codeInput;
            this.recoveryCodeIndex = codeIndex;
            this.tempUserData = { ...userData, recoveryCodes };

            this.showAuthSuccess('recovery-code-success', 'Recovery code verified successfully!');
            this.setButtonLoading('verify-code-btn', false);

            setTimeout(() => {
                this.showRecoveryStep('step3-reset-password');
            }, 1000);

        } catch (error) {
            console.error('Recovery code verification error:', error);
            this.showAuthError('recovery-code-error', 'Error: ' + error.message);
            this.setButtonLoading('verify-code-btn', false);
        }
    }

    async resetPasswordWithCode() {
        const newPassword = (document.getElementById('new-password')?.value || '').trim();
        const confirmPassword = (document.getElementById('confirm-new-password')?.value || '').trim();

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

            await this.firebaseOperation(
                this.getRef(`users/${this.recoveryEncodedPhone}`).update({
                    password: newPassword,
                    recoveryCodes: this.tempUserData.recoveryCodes,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP,
                    lastPasswordReset: firebase.database.ServerValue.TIMESTAMP
                }),
                'Updating password'
            );

            // Log the reset
            try {
                await this.firebaseOperation(
                    this.getRef(`userActivity/${this.recoveryEncodedPhone}/password_resets`).push({
                        usedRecoveryCode: this.recoveryCode,
                        resetAt: firebase.database.ServerValue.TIMESTAMP,
                        userAgent: navigator.userAgent.substring(0, 200)
                    }),
                    'Logging reset action'
                );
            } catch (e) { /* non-critical */ }

            this.showAuthSuccess('reset-success',
                'Password reset successfully! Redirecting to sign in...');

            this.setButtonLoading('reset-password-btn', false);

            // Remember the phone for autofill
            const phoneForFill = this.recoveryPhone;
            localStorage.setItem('lastPhone', phoneForFill);

            // Clear recovery state
            this.recoveryPhone = null;
            this.recoveryEncodedPhone = null;
            this.recoveryCode = null;
            this.recoveryCodeIndex = null;
            this.tempUserData = null;

            // Wait for success message to be visible
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Return to sign in form with phone pre-filled
            this.showForm('signin');

            setTimeout(() => {
                const signinPhoneInput = document.getElementById('signin-phone');
                if (signinPhoneInput) signinPhoneInput.value = phoneForFill;

                const signinPasswordInput = document.getElementById('signin-password');
                if (signinPasswordInput) signinPasswordInput.value = '';

                this.showAuthSuccess('signin-success',
                    'Password reset successful! Please sign in with your new password.');

                setTimeout(() => {
                    if (signinPasswordInput) signinPasswordInput.focus();
                }, 100);
            }, 100);

        } catch (error) {
            console.error('Password reset error:', error);
            this.showAuthError('reset-error', 'Error: ' + error.message);
            this.setButtonLoading('reset-password-btn', false);
        }
    }

    handleLostRecoveryCodes() {
        this.showAuthError('recovery-code-error',
            'If you have lost all recovery codes, please contact support with your account details for identity verification.');
    }

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

            if (strength === 1) { width = '25%'; text = 'Weak'; color = '#ef4444'; }
            else if (strength === 2) { width = '50%'; text = 'Fair'; color = '#f59e0b'; }
            else if (strength === 3) { width = '75%'; text = 'Good'; color = '#3b82f6'; }
            else if (strength >= 4) { width = '100%'; text = 'Strong'; color = '#10b981'; }
            else { width = '10%'; text = 'Too short'; color = '#ef4444'; }
        }

        strengthBar.style.width = width;
        strengthBar.style.backgroundColor = color;
        strengthText.textContent = text;
        strengthText.style.color = color;
    }

    // ========== RECOVERY CODES ==========
    generateRecoveryCodes(count = 5) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = Array(8).fill(0)
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

    downloadRecoveryCodes(codes) {
        const content = `xDrive Recovery Codes
Generated: ${new Date().toLocaleString()}

===========================================
IMPORTANT - SAVE THESE CODES
===========================================

Store this document securely. These codes are required for password recovery.

===========================================
RECOVERY CODES:
${codes.map((codeObj, index) => `${index + 1}. ${codeObj.code}`).join('\n')}
===========================================

How to use recovery codes:
- Each code can be used only once
- You will need one code to reset your password
- Store these codes securely
- Generate new codes from your account settings
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

    // ========== UTILITIES ==========
    encodePhone(phone) {
        return phone.replace(/[^\d+]/g, '').replace(/\./g, ',').replace(/@/g, '-at-');
    }

    validatePassword(password) { return password.length >= 6; }

    escapeHtml(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }

    getFormData(formType) {
        if (formType === 'signin') {
            return {
                phone: document.getElementById('signin-phone').value.trim(),
                password: document.getElementById('signin-password').value.trim()
            };
        } else if (formType === 'signup') {
            return {
                name: document.getElementById('signup-name').value.trim(),
                phone: document.getElementById('signup-phone').value.trim(),
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
            button.innerHTML = loadingText;
        } else {
            button.disabled = false;
            this.resetButton(buttonId);
        }
    }

    resetButton(buttonId) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        const labels = {
            'signin-btn': '<i class="fas fa-sign-in-alt"></i> Sign In',
            'signup-btn': '<i class="fas fa-user-plus"></i> Create Account',
            'verify-phone-btn': '<i class="fas fa-arrow-right"></i> Continue',
            'verify-code-btn': '<i class="fas fa-check-circle"></i> Verify Code',
            'reset-password-btn': '<i class="fas fa-rotate-left"></i> Reset Password'
        };
        button.innerHTML = labels[buttonId] || 'Submit';
        button.disabled = false;
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

    clearAuthMessages() {
        document.querySelectorAll('.alert.error, .alert.success').forEach(el => {
            el.classList.add('hidden');
        });
    }

    // ========== AUTH UI ==========
    showAuthUI(initialForm = 'signin') {
        console.log('Showing auth UI, initial form:', initialForm);

        const mainContent = document.querySelector('.main-content');
        const sidebar = document.querySelector('.sidebar');
        const sidebarToggle = document.querySelector('.sidebar-toggle-fixed');

        if (mainContent) mainContent.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        if (sidebarToggle) sidebarToggle.style.display = 'none';

        this.createAuthContainer();
        if (!this.authContainer) return;

        this.authContainer.style.display = 'flex';
        this.renderAuthUI();

        if (initialForm === 'applock') {
            this.activateAppLockForm();
        } else if (initialForm === 'signup') {
            this.showForm('signup');
        } else {
            this.showForm('signin');
        }
    }

    createAuthContainer() {
        if (!this.authContainer) {
            this.authContainer = document.createElement('div');
            this.authContainer.className = 'auth-overlay';
            this.authContainer.id = 'authOverlay';
            document.body.appendChild(this.authContainer);
        }
    }

    renderAuthUI() {
        this.authContainer.innerHTML = `
            <div class="auth-container">
                <div class="auth-header">
                    <div class="app-title">
                        <span class="material-icons" style="font-size: 24px;">health_and_safety</span>
                        <span>xDrive</span>
                    </div>
                    <p class="auth-subtitle">Secure Private Storage</p>
                </div>

                <div class="auth-card-modern">

                    <!-- ========== APP LOCK FORM ========== -->
                    <div id="applock-form" class="auth-form">
                        <div class="auth-form-header">
                            <h2>App Locked</h2>
                            <a id="applock-signout" class="back-link-modern">
                                <span class="material-icons">logout</span> Sign Out
                            </a>
                        </div>

                        <p id="applock-subtitle" class="applock-subtitle">Enter your account password to continue</p>

                        <div class="form-group">
                            <label class="form-label" for="applock-unlock-code">Account Password</label>
                            <div class="password-input-group">
                                <input type="password" id="applock-unlock-code" class="form-input"
                                    placeholder="Enter your account password"
                                    autocomplete="current-password">
                                <button type="button" class="toggle-pass-modern" data-target="applock-unlock-code">
                                    <span class="material-icons">visibility_off</span>
                                </button>
                            </div>
                        </div>

                        <div id="applock-error" class="alert error hidden"></div>

                        <div class="form-actions">
                            <button id="applock-unlock-btn" class="btn btn-primary">
                                <i class="fas fa-lock-open"></i> Unlock
                            </button>
                        </div>
                    </div>

                    <!-- ========== SIGN IN FORM ========== -->
                    <div id="signin-form" class="auth-form">
                        <div class="form-header">
                            <h2>Sign In</h2>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="signin-phone">Phone Number</label>
                            <input type="tel" id="signin-phone" class="form-input"
                                placeholder="Enter your phone number"
                                autocomplete="off"
                                autocorrect="off"
                                autocapitalize="off"
                                spellcheck="false"
                                name="signin-phone-no-autofill"
                                required>
                            <div id="signin-phone-status" class="phone-validator-status"></div>
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
                        <div id="signin-success" class="alert success hidden"></div>

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

                    <!-- ========== SIGN UP FORM ========== -->
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
                                <label class="form-label" for="signup-phone">Phone Number *</label>
                                <input type="tel" id="signup-phone" class="form-input"
                                    placeholder="Enter phone number">
                                <div id="signup-phone-status" class="phone-validator-status"></div>
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

                    <!-- ========== FORGOT PASSWORD CONTAINER ========== -->
                    <div id="forgot-password-container" style="display:none;">

                        <!-- Step 1: Phone Verification -->
                        <div id="step1-phone" class="auth-form">
                            <div class="auth-form-header">
                                <h2>Reset Password</h2>
                                <a id="back-to-signin-from-forgot" class="back-link-modern">
                                    <span class="material-icons">arrow_back</span> Back
                                </a>
                            </div>

                            <div class="info-card-modern">
                                <span class="material-icons">info</span>
                                <p>Enter your phone number to start the password recovery process.</p>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="recovery-phone">Phone Number</label>
                                <input type="tel" id="recovery-phone" class="form-input"
                                    placeholder="Enter your phone number" required>
                                <div id="recovery-phone-status" class="phone-validator-status"></div>
                            </div>

                            <div id="recovery-phone-error" class="alert error hidden"></div>

                            <div class="form-actions">
                                <button id="verify-phone-btn" class="btn btn-primary">
                                    <i class="fas fa-arrow-right"></i> Continue
                                </button>
                            </div>
                        </div>

                        <!-- Step 2: Recovery Code -->
                        <div id="step2-recovery-code" class="auth-form">
                            <div class="auth-form-header">
                                <h2>Enter Recovery Code</h2>
                                <a id="back-to-phone" class="back-link-modern">
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
                                    <input type="password" id="new-password" class="form-input"
                                        placeholder="Enter new password">
                                    <button type="button" class="toggle-pass-modern" data-target="new-password">
                                        <span class="material-icons">visibility_off</span>
                                    </button>
                                </div>
                                <div class="password-strength-container-modern">
                                    <div class="strength-bar-modern" id="authPasswordStrengthBar"></div>
                                    <div class="strength-text-modern" id="authPasswordStrengthText">Enter a password</div>
                                </div>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="confirm-new-password">Confirm New Password</label>
                                <div class="password-input-group">
                                    <input type="password" id="confirm-new-password" class="form-input"
                                        placeholder="Confirm new password">
                                    <button type="button" class="toggle-pass-modern" data-target="confirm-new-password">
                                        <span class="material-icons">visibility_off</span>
                                    </button>
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

        this.setupAuthEventListeners();
        this.autoFillPhone();
    }

    setupAuthEventListeners() {
        // Form navigation
        const showSignup = document.getElementById('show-signup');
        const showSignin = document.getElementById('show-signin');
        const showSigninArrow = document.getElementById('show-signin-arrow');

        if (showSignup) showSignup.addEventListener('click', () => this.showForm('signup'));
        if (showSignin) showSignin.addEventListener('click', () => this.showForm('signin'));
        if (showSigninArrow) showSigninArrow.addEventListener('click', () => this.showForm('signin'));

        // Forgot password link
        const forgotLink = document.getElementById('show-forgot-password');
        if (forgotLink) forgotLink.addEventListener('click', () => this.showForgotPassword());

        // App Lock sign-out link
        const appLockSignOut = document.getElementById('applock-signout');
        if (appLockSignOut) appLockSignOut.addEventListener('click', () => this.logout());

        // Password visibility toggles
        document.querySelectorAll('.toggle-pass-modern').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.getAttribute('data-target'));
                const icon = btn.querySelector('.material-icons');
                if (!input) return;
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.textContent = 'visibility';
                } else {
                    input.type = 'password';
                    icon.textContent = 'visibility_off';
                }
            });
        });

        // Buttons
        const signupBtn = document.getElementById('signup-btn');
        const signinBtn = document.getElementById('signin-btn');
        if (signupBtn) signupBtn.addEventListener('click', () => this.handleSignup());
        if (signinBtn) signinBtn.addEventListener('click', () => this.handleSignin());

        const unlockBtn = document.getElementById('applock-unlock-btn');
        if (unlockBtn) unlockBtn.addEventListener('click', () => this.handleAppLockUnlock());

        // Phone validation
        const signinPhone = document.getElementById('signin-phone');
        if (signinPhone) {
            signinPhone.addEventListener('input', () => {
                PhoneValidator.updatePhoneValidation('signin-phone', 'signin-phone-status');
                const phone = signinPhone.value.trim();
                const validation = PhoneValidator.validatePhone(phone);
                if (validation.valid) {
                    this.checkAndShowDeactivationStatus(validation.normalized);
                } else {
                    document.getElementById('deactivation-status')?.classList.add('hidden');
                }
            });
        }

        const signupPhone = document.getElementById('signup-phone');
        if (signupPhone) {
            signupPhone.addEventListener('input', () => {
                PhoneValidator.updatePhoneValidation('signup-phone', 'signup-phone-status');
            });
        }

        // Enter key support
        document.addEventListener('keypress', (e) => {
            if (e.key !== 'Enter') return;

            const signupForm = document.getElementById('signup-form');
            const signinForm = document.getElementById('signin-form');
            const appLockForm = document.getElementById('applock-form');
            const step1 = document.getElementById('step1-phone');
            const step2 = document.getElementById('step2-recovery-code');
            const step3 = document.getElementById('step3-reset-password');

            if (signupForm?.classList.contains('active')) this.handleSignup();
            else if (signinForm?.classList.contains('active')) this.handleSignin();
            else if (appLockForm?.classList.contains('active')) this.handleAppLockUnlock();
            else if (step1?.classList.contains('active')) this.verifyPhoneForRecovery();
            else if (step2?.classList.contains('active')) this.verifyRecoveryCode();
            else if (step3?.classList.contains('active')) this.resetPasswordWithCode();
        });
    }

    showForm(formType) {
        // Hide all top-level forms
        document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));

        // Hide forgot password container
        const forgotContainer = document.getElementById('forgot-password-container');
        if (forgotContainer) forgotContainer.style.display = 'none';

        // Show selected form
        const formToShow = document.getElementById(`${formType}-form`);
        if (formToShow) formToShow.classList.add('active');

        this.clearAuthMessages();
        document.getElementById('applock-error')?.classList.add('hidden');
    }

    autoFillPhone() {
        // Intentionally blank — do not auto-fill the phone number on sign in
    }

    async checkAndShowDeactivationStatus(phone) {
        if (!phone) return false;
        const validation = PhoneValidator.validatePhone(phone);
        if (!validation.valid) return false;
        const encodedPhone = this.encodePhone(validation.normalized);

        try {
            const snapshot = await this.firebaseOperation(
                this.getRef(`users/${encodedPhone}`).once('value'),
                'Checking deactivation status'
            );
            if (!snapshot.exists()) return false;
            const userData = snapshot.val();

            if (userData.status === 'deactivated' && userData.deactivationEnd) {
                const remainingMs = userData.deactivationEnd - Date.now();
                if (remainingMs > 0) {
                    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
                    const reactivationDate = new Date(userData.deactivationEnd).toLocaleDateString();

                    const statusEl = document.getElementById('deactivation-status');
                    const msgEl = document.getElementById('deactivation-message');
                    if (statusEl && msgEl) {
                        statusEl.classList.remove('hidden');
                        msgEl.textContent =
                            `Account deactivated for ${userData.deactivationDuration || 14} days. ` +
                            `Reactivated on ${reactivationDate} (${remainingDays} days remaining).`;
                    }
                    return true;
                }
            }
        } catch (error) {
            console.error('Error checking deactivation status:', error);
        }
        document.getElementById('deactivation-status')?.classList.add('hidden');
        return false;
    }

    // ========== SUCCESS HANDLER ==========
    onAuthSuccess() {
        if (this.authContainer) this.authContainer.style.display = 'none';

        const mainContent = document.querySelector('.main-content');
        const sidebar = document.querySelector('.sidebar');
        const sidebarToggle = document.querySelector('.sidebar-toggle-fixed');

        if (mainContent) mainContent.style.display = 'block';
        if (sidebar) sidebar.style.display = 'flex';
        if (sidebarToggle) sidebarToggle.style.display = 'flex';

        window.dispatchEvent(new CustomEvent('authSuccess', {
            detail: { user: this.currentUser, encodedPhone: this.encodedPhone }
        }));

        window.dispatchEvent(new CustomEvent('authReady', {
            detail: { user: this.currentUser, encodedPhone: this.encodedPhone }
        }));

        if (window.sidebarManager) {
            window.sidebarManager.loadUserData().then(() => {
                window.sidebarManager.updateUserProfile();
                window.sidebarManager.updateStorageInfo();
            });
        }

        if (window.settingsModule) {
            window.settingsModule.setUserData(this.currentUser);
            window.settingsModule.initFirebase();
        }
    }

    // ========== LOGOUT ==========
    logout() {
        console.log('Logging out...');

        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken');

        this.isAuthenticated = false;
        this.currentUser = null;
        this.encodedPhone = null;
        this.isAppUnlocked = false;

        this.showAuthUI('signin');

        window.dispatchEvent(new CustomEvent('authLogout'));
    }

    clearAuthData() {
        const itemsToRemove = ['currentUser', 'authToken', 'app_settings', 'user_preferences'];
        itemsToRemove.forEach(item => localStorage.removeItem(item));
        this.isAuthenticated = false;
        this.currentUser = null;
        this.encodedPhone = null;
    }

    // ========== GETTERS ==========
    isLoggedIn()         { return this.isAuthenticated && this.currentUser !== null; }
    getUser()            { return this.currentUser; }
    getDatabase()        { return this.db; }
    getEncodedPhone()    { return this.encodedPhone; }
}

// ==============================================
// SINGLE DATA MANAGER
// ==============================================
class DataManager {
    constructor() {
        this.authManager = null;
        this.initialized = false;
    }

    init(authManager) {
        if (!authManager) { console.error('DataManager: Auth manager not available'); return; }
        this.authManager = authManager;
        this.initialized = true;
        console.log('DataManager initialized');
    }

    getRef(path = '')         { return this.authManager?.getRef(path); }
    getUserDataRef(path = '') { return this.authManager?.getUserDataRef(path); }
    getUserProfileRef()       { return this.authManager?.getUserProfileRef(); }
    getUserPhotosRef()        { return this.authManager?.getUserPhotosRef(); }
    getUserNotesRef()         { return this.authManager?.getUserNotesRef(); }
    getUserFilesRef()         { return this.authManager?.getUserFilesRef(); }
    getUserStorageRef()       { return this.authManager?.getUserStorageRef(); }

    async saveUserData(path, data)     { return await this.authManager?.saveUserData(path, data); }
    async getUserData(path = '')       { return await this.authManager?.getUserData(path); }
    async pushUserData(path, data)     { return await this.authManager?.pushUserData(path, data); }
    async removeUserData(path)         { return await this.authManager?.removeUserData(path); }

    isAuthenticated()       { return this.initialized && this.authManager?.isLoggedIn(); }
    getCurrentUser()        { return this.authManager?.getUser(); }
    getEncodedPhone()       { return this.authManager?.getEncodedPhone(); }
    getDriveUserId()        { return this.authManager?.getDriveUserId(); }
    async getDriveFolderInfo() { return await this.authManager?.getDriveFolderInfo(); }
}

// ==============================================
// GLOBAL INSTANCES
// ==============================================
let authDataManager;
const dataManager = new DataManager();
window.dataManager = dataManager;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing AuthDataManager...');
    authDataManager = new AuthDataManager();
    window.authDataManager = authDataManager;

    dataManager.init(authDataManager);

    window.addEventListener('authLogoutRequest', function() {
        if (authDataManager) authDataManager.logout();
    });

    window.addEventListener('authSuccess', function() {
        if (window.sidebarManager) window.sidebarManager.resetSidebar();
    });
});