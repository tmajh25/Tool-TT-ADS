const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Cache APIs
    loadOutlookAccounts: () => ipcRenderer.invoke('load-outlook-accounts'),
    saveOutlookAccounts: (accounts) => ipcRenderer.invoke('save-outlook-accounts', accounts),
    loadMailtmAccounts: () => ipcRenderer.invoke('load-mailtm-accounts'),
    saveMailtmAccounts: (accounts) => ipcRenderer.invoke('save-mailtm-accounts', accounts),
    
    // Selenium Automation APIs
    loginTikTokAds: (email, tiktokPass, mailPass) => ipcRenderer.send('login-tiktok-ads', { email, tiktokPass, mailPass }),
    loginOutlookBrowser: (email, password, secret) => ipcRenderer.send('login-outlook-browser', { email, password, secret }),
    toggleSmartPlus: (email, enabled) => ipcRenderer.invoke('toggle-smartplus', { email, enabled }),
    getActiveBrowsers: () => ipcRenderer.invoke('get-active-browsers'),
    autoAppealAccount: (email, password, secret, mailPass, reason) => ipcRenderer.send('auto-appeal-account', { email, password, secret, mailPass, reason }),
    onAutomationProgress: (callback) => ipcRenderer.on('automation-progress', (event, value) => callback(value)),

    // OAuth/Outlook APIs
    loginOAuth: (clientId, refreshToken) => ipcRenderer.invoke('login-oauth', { clientId, refreshToken }),
    fetchEmails: (accessToken) => ipcRenderer.invoke('fetch-emails', accessToken),
    generateTOTP: (secret) => ipcRenderer.invoke('generate-totp', secret),

    // Utility: file dialog and shell
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    openChromeDialog: () => ipcRenderer.invoke('open-chrome-dialog'),
    
    // Clipboard helper
    copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),

    // Settings APIs
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getStartup: () => ipcRenderer.invoke('get-startup'),
    setStartup: (enabled) => ipcRenderer.invoke('set-startup', enabled),

    // === REG TK APIs ===
    startReg: (config) => ipcRenderer.send('start-reg', config),
    stopReg: () => ipcRenderer.send('stop-reg'),
    exportRegResults: (data) => ipcRenderer.send('export-reg-results', data),
    onRegProgress: (callback) => ipcRenderer.on('reg-progress', (event, value) => callback(value)),
    onRegResult:   (callback) => ipcRenderer.on('reg-result',   (event, value) => callback(value)),
    onRegDone:     (callback) => ipcRenderer.on('reg-done',     ()             => callback()),

    // === MOBILE SERVER APIs ===
    getMobileServerInfo: () => ipcRenderer.invoke('get-mobile-server-info'),
    restartMobileServer: () => ipcRenderer.invoke('restart-mobile-server'),
});

