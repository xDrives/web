// data-manager.js - Central data management for all modules
class DataManager {
    constructor() {
        this.authModule = null;
        this.currentUser = null;
        this.masterDB = null;
        this.homeDB = null;
        this.encodedPhone = null;
        this.initialized = false;
    }

    // Initialize with auth module
    init(authModule) {
        if (!authModule) {
            console.error('DataManager: Auth module not available');
            return;
        }

        this.authModule = authModule;
        this.currentUser = authModule.currentUser;
        this.masterDB = authModule.getMasterDB();
        
        if (this.currentUser?.phone) {
            this.encodedPhone = authModule.encodePhone(this.currentUser.phone);
        }
        
        this.initialized = true;
        console.log('DataManager initialized');
    }

    // Get user's home database instance
    getHomeDatabase() {
        if (!this.initialized || !this.authModule) {
            console.error('DataManager not initialized');
            return null;
        }
        
        return this.authModule.getHomeDatabaseInstance();
    }

    // Get all user databases
    getUserDatabases() {
        if (!this.initialized || !this.authModule) {
            console.error('DataManager not initialized');
            return [];
        }
        
        return this.authModule.getUserDatabases();
    }

    // Get user data reference in home database
    getUserDataRef(path = '') {
        const homeDb = this.getHomeDatabase();
        if (!homeDb || !this.encodedPhone) {
            console.error('Cannot get user data ref: missing database or encoded phone');
            return null;
        }

        const fullPath = `userData/${this.encodedPhone}${path ? '/' + path : ''}`;
        return homeDb.db.ref(fullPath);
    }

    // Get master database reference
    getMasterRef(path = '') {
        if (!this.masterDB) {
            console.error('Master database not available');
            return null;
        }
        
        return this.masterDB.ref(path);
    }

    // Encode phone (same as auth module)
    encodePhone(phone) {
        return phone.replace(/[^\d+]/g, '').replace(/\./g, ',').replace(/@/g, '-at-');
    }

    // Check if user is authenticated
    isAuthenticated() {
        return this.initialized && this.authModule?.isLoggedIn();
    }

    // Update current user data
    updateCurrentUser(userData) {
        this.currentUser = userData;
        if (userData?.phone) {
            this.encodedPhone = this.encodePhone(userData.phone);
        }
    }
}

// Global instance
const dataManager = new DataManager();
window.dataManager = dataManager;