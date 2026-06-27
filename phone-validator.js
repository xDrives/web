// ==============================================
// PHONE VALIDATOR - REUSABLE MODULE
// ==============================================

const PhoneValidator = {
    /**
     * Normalize a phone number to Bangladesh format (11 digits starting with 01)
     * @param {string} phone - Raw phone input
     * @returns {string} Normalized phone number (or raw if invalid)
     */
    normalizePhone(phone) {
        let raw = phone.replace(/\D/g, '');
        if (raw.startsWith('880')) {
            raw = raw.slice(3);
        }
        if (raw.length === 10 && raw.startsWith('1')) {
            raw = '0' + raw;
        }
        if (raw.length === 11 && raw.startsWith('01')) {
            return raw;
        }
        return raw;
    },

    /**
     * Validate a Bangladesh phone number (11 digits, starts with 01, third digit 3–9)
     * @param {string} phone - Raw phone input
     * @returns {Object} { valid: boolean, reason: string, normalized: string }
     */
    validatePhone(phone) {
        // Reject any alphabetic characters
        if (/[a-zA-Z]/.test(phone)) {
            return { valid: false, reason: 'No alphabets allowed', normalized: phone };
        }

        const normalized = this.normalizePhone(phone);
        if (normalized.length !== 11) {
            return { valid: false, reason: 'Must be 11 digits', normalized };
        }
        if (!normalized.startsWith('01')) {
            return { valid: false, reason: 'Must start with 01', normalized };
        }
        const third = normalized[2];
        if (!third || !/[3-9]/.test(third)) {
            return { valid: false, reason: 'Third digit must be 3–9', normalized };
        }
        return { valid: true, reason: 'Valid Bangladesh number', normalized };
    },

    /**
     * Update a DOM element with real‑time validation feedback.
     * @param {string} inputId - ID of the input element
     * @param {string} statusId - ID of the status element
     */
    updatePhoneValidation(inputId, statusId) {
        const input = document.getElementById(inputId);
        const statusEl = document.getElementById(statusId);
        if (!input || !statusEl) return;

        const phone = input.value.trim();
        if (!phone) {
            statusEl.innerHTML = '';
            statusEl.className = 'phone-validator-status';
            return;
        }

        const result = this.validatePhone(phone);
        if (result.valid) {
            statusEl.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i> Valid Bangladesh number';
            statusEl.className = 'phone-validator-status valid';
        } else {
            statusEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i> ' + result.reason;
            statusEl.className = 'phone-validator-status invalid';
        }
    }
};

// Expose globally
window.PhoneValidator = PhoneValidator;