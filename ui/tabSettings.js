// ui/tabSettings.js — Tab Cấu hình Hệ thống

class TabSettings {
    constructor() {
        // DOM elements
        this.proxyInput = document.getElementById('settings-proxy');
        this.headlessCheckbox = document.getElementById('settings-headless');
        this.themeSelect = document.getElementById('settings-theme');
        this.startupCheckbox = document.getElementById('settings-startup');
        this.cfSyncCheckbox = document.getElementById('settings-cf-sync');
        this.cfUrlInput = document.getElementById('settings-cf-url');
        this.cfKeyInput = document.getElementById('settings-cf-key');
    }

    async init() {
        await this.loadSettings();
    }

    async loadSettings() {
        try {
            const settings = await window.electronAPI.loadSettings() || {};
            this.proxyInput.value = settings.proxy || '';
            this.headlessCheckbox.checked = !!settings.headless;
            this.themeSelect.value = settings.theme || 'dark';
            if (this.cfSyncCheckbox) this.cfSyncCheckbox.checked = !!settings.cfSync;
            if (this.cfUrlInput) this.cfUrlInput.value = settings.cfUrl || '';
            if (this.cfKeyInput) this.cfKeyInput.value = settings.cfKey || '';
            
            // Đọc cấu hình khởi động từ hệ thống qua IPC
            if (window.electronAPI.getStartup) {
                const isStartupEnabled = await window.electronAPI.getStartup();
                this.startupCheckbox.checked = !!isStartupEnabled;
            }

            // Đồng bộ theme khi mở ứng dụng
            if (window.themeManager) {
                window.themeManager.setTheme(settings.theme || 'dark');
            }
        } catch (e) {
            console.error('Lỗi khi tải cài đặt:', e);
        }
    }

    previewTheme(theme) {
        if (window.themeManager) {
            window.themeManager.setTheme(theme);
        }
    }

    async saveSettings() {
        const settings = {
            proxy: this.proxyInput.value.trim(),
            headless: this.headlessCheckbox.checked,
            theme: this.themeSelect.value,
            cfSync: this.cfSyncCheckbox ? this.cfSyncCheckbox.checked : false,
            cfUrl: this.cfUrlInput ? this.cfUrlInput.value.trim() : '',
            cfKey: this.cfKeyInput ? this.cfKeyInput.value.trim() : ''
        };

        try {
            // Lưu cài đặt chung
            const success = await window.electronAPI.saveSettings(settings);
            
            // Lưu cài đặt khởi động cùng hệ thống
            let startupSuccess = true;
            if (window.electronAPI.setStartup) {
                startupSuccess = await window.electronAPI.setStartup(this.startupCheckbox.checked);
            }

            if (success && startupSuccess) {
                showToast('✅ Đã lưu cấu hình hệ thống thành công!');
            } else {
                showToast('❌ Gặp lỗi khi lưu một số cấu hình.');
            }
        } catch (e) {
            showToast('❌ Lỗi lưu cài đặt: ' + e.message);
        }
    }
}

window.tabSettings = new TabSettings();
