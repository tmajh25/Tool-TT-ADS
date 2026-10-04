const fs = require('fs');
const path = require('path');
const os = require('os');
const electron = require('electron');
const axios = require('axios');

class CacheService {
    constructor() {
        let userDataPath = null;
        try {
            if (electron && electron.app && typeof electron.app.getPath === 'function') {
                userDataPath = electron.app.getPath('userData');
            }
        } catch (e) {}

        if (!userDataPath) {
            const baseDir = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
            userDataPath = path.join(baseDir, 'tooltt');
        }

        this.cacheFolder = path.join(userDataPath, 'ToolMMO_Data');
        if (!fs.existsSync(this.cacheFolder)) {
            fs.mkdirSync(this.cacheFolder, { recursive: true });
        }

        this.outlookCacheFile = path.join(this.cacheFolder, 'outlook_cache.json');
        this.mailtmCacheFile = path.join(this.cacheFolder, 'mailtm_cache.json');
        this.settingsFile = path.join(this.cacheFolder, 'settings.json');
    }

    // Helper gọi Cloudflare Worker API
    async _callCfWorker(pathname, data = {}) {
        try {
            const settings = this.loadSettings();
            if (!settings.cfSync || !settings.cfUrl) {
                return null;
            }
            const baseUrl = settings.cfUrl.replace(/\/+$/, '');
            const response = await axios.post(`${baseUrl}${pathname}`, data, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.cfKey || ''}`
                }
            });
            if (response.data && response.data.success) {
                return response.data;
            } else {
                console.error(`Cloudflare D1 error for ${pathname}:`, response.data ? response.data.error : 'No response data');
                return null;
            }
        } catch (e) {
            console.error(`Network error calling Cloudflare Worker for ${pathname}:`, e.message);
            return null;
        }
    }

    async saveOutlookAccounts(accounts) {
        try {
            fs.writeFileSync(this.outlookCacheFile, JSON.stringify(accounts, null, 4), 'utf-8');
        } catch (e) {
            console.error('Error saving Outlook accounts locally:', e);
        }

        await this._callCfWorker('/api/outlook/save', { accounts });
    }

    async loadOutlookAccounts() {
        const settings = this.loadSettings();
        if (settings.cfSync && settings.cfUrl) {
            const res = await this._callCfWorker('/api/outlook/load');
            if (res && res.data) {
                try {
                    fs.writeFileSync(this.outlookCacheFile, JSON.stringify(res.data, null, 4), 'utf-8');
                } catch (e) {
                    console.error('Error writing local cache for Outlook:', e);
                }
                return res.data;
            }
        }

        if (fs.existsSync(this.outlookCacheFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.outlookCacheFile, 'utf-8'));
            } catch (e) {
                console.error('Error loading Outlook accounts locally:', e);
                return [];
            }
        }
        return [];
    }

    async saveMailtmAccounts(accounts) {
        try {
            fs.writeFileSync(this.mailtmCacheFile, JSON.stringify(accounts, null, 4), 'utf-8');
        } catch (e) {
            console.error('Error saving Mailtm accounts locally:', e);
        }

        await this._callCfWorker('/api/mailtm/save', { accounts });
    }

    async loadMailtmAccounts() {
        const settings = this.loadSettings();
        if (settings.cfSync && settings.cfUrl) {
            const res = await this._callCfWorker('/api/mailtm/load');
            if (res && res.data) {
                try {
                    fs.writeFileSync(this.mailtmCacheFile, JSON.stringify(res.data, null, 4), 'utf-8');
                } catch (e) {
                    console.error('Error writing local cache for Mailtm:', e);
                }
                return res.data;
            }
        }

        if (fs.existsSync(this.mailtmCacheFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.mailtmCacheFile, 'utf-8'));
            } catch (e) {
                console.error('Error loading Mailtm accounts locally:', e);
                return [];
            }
        }
        return [];
    }

    saveSettings(settings) {
        try {
            fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 4), 'utf-8');
        } catch (e) {
            console.error('Error saving settings:', e);
        }
    }

    loadSettings() {
        if (fs.existsSync(this.settingsFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8'));
            } catch (e) {
                console.error('Error loading settings:', e);
                return {};
            }
        }
        return {};
    }

    async saveCookies(email, cookies) {
        try {
            const cookiesFolder = path.join(this.cacheFolder, 'cookies');
            if (!fs.existsSync(cookiesFolder)) {
                fs.mkdirSync(cookiesFolder, { recursive: true });
            }
            const safeEmail = email.replace(/[^a-zA-Z0-9@.]/g, '_');
            const cookieFile = path.join(cookiesFolder, `${safeEmail}.json`);
            fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 4), 'utf-8');
        } catch (e) {
            console.error('Error saving cookies locally:', e);
        }

        await this._callCfWorker('/api/cookies/save', { email, cookies });
    }

    async loadCookies(email) {
        const settings = this.loadSettings();
        if (settings.cfSync && settings.cfUrl) {
            const res = await this._callCfWorker('/api/cookies/load', { email });
            if (res && res.data) {
                try {
                    const cookiesFolder = path.join(this.cacheFolder, 'cookies');
                    if (!fs.existsSync(cookiesFolder)) {
                        fs.mkdirSync(cookiesFolder, { recursive: true });
                    }
                    const safeEmail = email.replace(/[^a-zA-Z0-9@.]/g, '_');
                    const cookieFile = path.join(cookiesFolder, `${safeEmail}.json`);
                    fs.writeFileSync(cookieFile, JSON.stringify(res.data, null, 4), 'utf-8');
                } catch (e) {
                    console.error('Error syncing cookies local cache:', e);
                }
                return res.data;
            }
        }

        try {
            const safeEmail = email.replace(/[^a-zA-Z0-9@.]/g, '_');
            const cookieFile = path.join(this.cacheFolder, 'cookies', `${safeEmail}.json`);
            if (fs.existsSync(cookieFile)) {
                return JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
            }
        } catch (e) {
            console.error('Error loading cookies locally:', e);
        }
        return null;
    }
}

module.exports = new CacheService();
