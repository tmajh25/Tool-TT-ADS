// Theme Manager for Dark / Light mode switching
class ThemeManager {
    constructor() {
        this.currentTheme = 'dark';
        this.init();
    }

    async init() {
        try {
            // Tải cấu hình theme từ settings lưu trữ
            const settings = await window.electronAPI.loadSettings() || {};
            const theme = settings.theme || 'dark';
            this.setTheme(theme);
        } catch (e) {
            // Mặc định luôn là dark theme cyber
            document.documentElement.classList.add('dark');
            this.currentTheme = 'dark';
        }
    }

    setTheme(theme) {
        if (theme === 'light') {
            document.documentElement.classList.remove('dark');
            this.currentTheme = 'light';
        } else {
            document.documentElement.classList.add('dark');
            this.currentTheme = 'dark';
        }
    }

    toggleTheme() {
        const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.setTheme(nextTheme);
        return nextTheme;
    }
}

window.themeManager = new ThemeManager();
