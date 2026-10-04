const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// Import các dịch vụ backend
const cacheService = require('./services/cacheService');
const seleniumService = require('./services/seleniumService');
const outlookService = require('./services/outlookService');
const regService = require('./services/regService');
const mobileServerService = require('./services/mobileServerService');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1300,
        height: 880,
        title: "ToolTT (Pro Electron UI)",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Mở file index.html
    mainWindow.loadFile('index.html');
    
    // Tắt thanh Menu mặc định cho giao diện chuyên nghiệp
    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(async () => {
    createWindow();

    // Khởi động Mobile Server để điện thoại có thể truy cập qua Wi-Fi
    try {
        await mobileServerService.init();
    } catch (e) {
        console.error('Không khởi động được Mobile Server:', e);
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', async function () {
    await mobileServerService.stop();
    if (process.platform !== 'darwin') app.quit();
});


// =========================================================================
// HỆ THỐNG XỬ LÝ IPC (IPC MAIN)
// =========================================================================

// 1. Quản lý lưu trữ tài khoản (Cache)
ipcMain.handle('load-outlook-accounts', async () => {
    return await cacheService.loadOutlookAccounts();
});

ipcMain.handle('save-outlook-accounts', async (event, accounts) => {
    await cacheService.saveOutlookAccounts(accounts);
    return true;
});

ipcMain.handle('load-mailtm-accounts', async () => {
    return await cacheService.loadMailtmAccounts();
});

ipcMain.handle('save-mailtm-accounts', async (event, accounts) => {
    await cacheService.saveMailtmAccounts(accounts);
    return true;
});

// 2. Tự động hóa trình duyệt (Selenium)
ipcMain.on('login-tiktok-ads', async (event, { email, tiktokPass, mailPass }) => {
    const progressCallback = (msg) => {
        if (mainWindow) {
            mainWindow.webContents.send('automation-progress', msg);
        }
    };
    await seleniumService.loginTikTokAds(email, tiktokPass, mailPass, progressCallback);
});

ipcMain.handle('toggle-smartplus', async (event, { email, enabled }) => {
    return await seleniumService.toggleSmartPlus(email, enabled);
});

ipcMain.on('login-outlook-browser', async (event, { email, password, secret }) => {
    const progressCallback = (msg) => {
        if (mainWindow) {
            mainWindow.webContents.send('automation-progress', msg);
        }
    };
    await seleniumService.loginOutlookBrowser(email, password, secret, progressCallback);
});

const otplib = require('otplib');

// 3. Microsoft OAuth & Outlook Email APIs
ipcMain.handle('login-oauth', async (event, { clientId, refreshToken }) => {
    return await outlookService.loginOAuth(clientId, refreshToken);
});

ipcMain.handle('fetch-emails', async (event, accessToken) => {
    return await outlookService.fetchEmails(accessToken);
});

ipcMain.handle('generate-totp', (event, secret) => {
    try {
        const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
        return otplib.authenticator.generate(cleanSecret);
    } catch (e) {
        return 'Lỗi';
    }
});

// 4. Mở tệp tin hệ thống (Native File Dialog)
ipcMain.handle('open-file-dialog', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });
    if (filePaths && filePaths.length > 0) {
        try {
            return fs.readFileSync(filePaths[0], 'utf-8');
        } catch (e) {
            console.error('Error reading file:', e);
        }
    }
    return null;
});

ipcMain.handle('open-chrome-dialog', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Chrome Executable', extensions: ['exe'] }]
    });
    if (filePaths && filePaths.length > 0) {
        return filePaths[0];
    }
    return null;
});

// 5. Copy vào clipboard hệ thống
ipcMain.on('copy-to-clipboard', (event, text) => {
    if (text) {
        clipboard.writeText(text);
    }
});

// 6. Quản lý cài đặt (Settings)
ipcMain.handle('load-settings', () => {
    return cacheService.loadSettings();
});

ipcMain.handle('save-settings', (event, settings) => {
    cacheService.saveSettings(settings);
    return true;
});

// 7. Khởi động cùng hệ thống (Auto-start)
ipcMain.handle('get-startup', () => {
    try {
        return app.getLoginItemSettings().openAtLogin;
    } catch (e) {
        console.error('Error getting login item settings:', e);
        return false;
    }
});

ipcMain.handle('set-startup', (event, enabled) => {
    try {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            path: app.getPath('exe')
        });
        return true;
    } catch (e) {
        console.error('Error setting login item settings:', e);
        return false;
    }
});

// =========================================================================
// REG TK HANDLERS
// =========================================================================

ipcMain.on('start-reg', async (event, config) => {
    const send = (channel, value) => { if (mainWindow) mainWindow.webContents.send(channel, value); };

    const progressCallback = (msg)    => send('reg-progress', msg);
    const resultCallback   = (result) => send('reg-result', result);

    try {
        await regService.runRegistration(config, progressCallback, resultCallback);
    } catch (err) {
        send('reg-progress', `❌ Lỗi toàn cục: ${err.message}`);
    } finally {
        send('reg-done');
    }
});

ipcMain.on('stop-reg', () => {
    regService.stop();
});

ipcMain.on('export-reg-results', async (event, data) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: 'reg_results.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });
    if (filePath) {
        fs.writeFileSync(filePath, data, 'utf-8');
        if (mainWindow) mainWindow.webContents.send('reg-progress', `✅ Đã xuất file: ${filePath}`);
    }
});

// =========================================================================
// MOBILE SERVER HANDLERS
// =========================================================================

ipcMain.handle('get-mobile-server-info', async () => {
    return await mobileServerService.getInfo();
});

ipcMain.handle('restart-mobile-server', async () => {
    return await mobileServerService.restart();
});

