// ui/tabMobile.js — Tab Quản lý & Kết nối Mobile App

class TabMobile {
    constructor() {
        this.statusBadge = document.getElementById('mobile-status-badge');
        this.statusText = document.getElementById('mobile-status-text');
        this.qrImage = document.getElementById('mobile-qr-image');
        this.urlDisplay = document.getElementById('mobile-url-display');
        this.ipListContainer = document.getElementById('mobile-ip-list');
    }

    async init() {
        await this.loadServerInfo();
    }

    async loadServerInfo() {
        try {
            if (!window.electronAPI || !window.electronAPI.getMobileServerInfo) {
                return;
            }

            const info = await window.electronAPI.getMobileServerInfo();
            if (info && info.isRunning) {
                if (this.statusBadge) {
                    this.statusBadge.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
                }
                if (this.statusText) {
                    this.statusText.textContent = `Đang chạy (Port ${info.port})`;
                    this.statusText.className = 'text-xs font-bold text-emerald-400';
                }

                if (this.qrImage && info.qrCode) {
                    this.qrImage.src = info.qrCode;
                }

                if (this.urlDisplay) {
                    this.urlDisplay.value = info.primaryUrl || info.localUrl;
                }

                if (this.ipListContainer && Array.isArray(info.ips)) {
                    this.ipListContainer.innerHTML = info.ips.map(ip => `
                        <div class="flex items-center justify-between bg-slate-900/60 p-2.5 rounded-lg border border-cyber-border mb-2 text-xs">
                            <span class="text-slate-300 font-mono">http://${ip}:${info.port}</span>
                            <button onclick="window.tabMobile.copyUrl('http://${ip}:${info.port}')" class="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-[11px] font-semibold transition">
                                Sao chép
                            </button>
                        </div>
                    `).join('');
                }
            } else {
                if (this.statusBadge) {
                    this.statusBadge.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                }
                if (this.statusText) {
                    this.statusText.textContent = 'Server đang tắt';
                    this.statusText.className = 'text-xs font-bold text-red-400';
                }
            }
        } catch (e) {
            console.error('Lỗi khi tải thông tin mobile server:', e);
        }
    }

    copyUrl(customUrl) {
        const url = customUrl || (this.urlDisplay ? this.urlDisplay.value : '');
        if (url) {
            if (window.electronAPI && window.electronAPI.copyToClipboard) {
                window.electronAPI.copyToClipboard(url);
            } else {
                navigator.clipboard.writeText(url);
            }
            if (typeof showToast === 'function') {
                showToast('📋 Đã sao chép liên kết Mobile: ' + url);
            }
        }
    }

    async restartServer() {
        if (typeof showToast === 'function') {
            showToast('🔄 Đang khởi động lại Mobile Server...');
        }
        try {
            if (window.electronAPI && window.electronAPI.restartMobileServer) {
                await window.electronAPI.restartMobileServer();
                await this.loadServerInfo();
                if (typeof showToast === 'function') {
                    showToast('✅ Mobile Server đã khởi động lại!');
                }
            }
        } catch (e) {
            if (typeof showToast === 'function') {
                showToast('❌ Lỗi khởi động server: ' + e.message);
            }
        }
    }

    openInBrowser() {
        const url = this.urlDisplay ? this.urlDisplay.value : 'http://localhost:3888';
        window.open(url, '_blank');
    }
}

window.tabMobile = new TabMobile();
