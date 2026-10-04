// services/smartplusHelper.js
// Logic Bypass TikTok Smart+ Campaign tích hợp trực tiếp vào Tool
// Tự động gắn script CDP và đồng bộ cờ opt-out trên tất cả các tab

class SmartPlusHelper {
    constructor() {
        this.activeWatchers = new Map();
    }

    getInjectionScript(enabled = true) {
        return `
(() => {
    "use strict";
    window.__ttSmartPlusBypassEnabled = ${enabled ? 'true' : 'false'};

    const TIEN_TO = "user_skip_1mn_preference_";
    const GIA_TRI_MAC_DINH = { app: true, lead: true, sales: true, hasRectifiedSession: true };

    try {
        if (!window.__origStorageGetItem) {
            window.__origStorageGetItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function(key) {
                if (window.__ttSmartPlusBypassEnabled !== false && typeof key === 'string' && key.startsWith(TIEN_TO)) {
                    try {
                        const raw = window.__origStorageGetItem.apply(this, arguments);
                        let cu = {};
                        if (raw) { try { cu = JSON.parse(raw); } catch (e) {} }
                        return JSON.stringify({ ...cu, ...GIA_TRI_MAC_DINH });
                    } catch (e) {
                        return JSON.stringify(GIA_TRI_MAC_DINH);
                    }
                }
                return window.__origStorageGetItem.apply(this, arguments);
            };
        }
    } catch (e) {}

    try {
        if (!window.__origStorageSetItem) {
            window.__origStorageSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, val) {
                if (window.__ttSmartPlusBypassEnabled !== false && typeof key === 'string' && key.startsWith(TIEN_TO)) {
                    try {
                        let parsed = {};
                        if (typeof val === 'string') { try { parsed = JSON.parse(val); } catch (e) {} }
                        const hopNhat = JSON.stringify({ ...parsed, ...GIA_TRI_MAC_DINH });
                        return window.__origStorageSetItem.call(this, key, hopNhat);
                    } catch (e) {}
                }
                return window.__origStorageSetItem.apply(this, arguments);
            };
        }
    } catch (e) {}

    function layTatCaIds() {
        const ids = new Set();
        try {
            const sp = new URLSearchParams(location.search);
            ['aadvid', 'adv_id', 'advertiser_id', 'org_id'].forEach(k => {
                const v = sp.get(k);
                if (v && /^\\d{6,}$/.test(v)) ids.add(v);
            });

            if (location.hash && location.hash.includes("?")) {
                const hp = new URLSearchParams(location.hash.split("?")[1]);
                ['aadvid', 'adv_id', 'advertiser_id', 'org_id'].forEach(k => {
                    const v = hp.get(k);
                    if (v && /^\\d{6,}$/.test(v)) ids.add(v);
                });
            }

            const matchPath = location.pathname.match(/\\b(7\\d{18,19}|\\d{16,20})\\b/g);
            if (matchPath) matchPath.forEach(id => ids.add(id));

            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(TIEN_TO)) {
                    const id = k.replace(TIEN_TO, "");
                    if (id && /^\\d{6,}$/.test(id)) ids.add(id);
                }
            }
        } catch (e) {}
        return Array.from(ids);
    }

    function apDung(bat) {
        try {
            const ids = layTatCaIds();
            ids.forEach(id => {
                const key = TIEN_TO + id;
                let cu = {};
                try {
                    const raw = sessionStorage.getItem(key);
                    if (raw) cu = JSON.parse(raw);
                } catch (e) {}

                if (!bat) {
                    const moi = { ...cu };
                    delete moi.app;
                    delete moi.lead;
                    delete moi.sales;
                    sessionStorage.setItem(key, JSON.stringify(moi));
                } else {
                    sessionStorage.setItem(key, JSON.stringify({ ...cu, ...GIA_TRI_MAC_DINH }));
                }
            });
        } catch (e) {}
    }

    apDung(window.__ttSmartPlusBypassEnabled);
    if (!window.__ttSmartPlusInterval) {
        window.__ttSmartPlusInterval = setInterval(() => apDung(window.__ttSmartPlusBypassEnabled), 400);
        addEventListener("popstate", () => apDung(window.__ttSmartPlusBypassEnabled));
        addEventListener("pageshow", () => apDung(window.__ttSmartPlusBypassEnabled));
    }

    window.__setTTSmartPlusBypass = (enable) => {
        window.__ttSmartPlusBypassEnabled = !!enable;
        apDung(window.__ttSmartPlusBypassEnabled);
        return { success: true, enabled: window.__ttSmartPlusBypassEnabled };
    };
})();
`;
    }

    startWatcher(driverKey, driver, isEnabled = true) {
        if (!driver || !driverKey) return;
        this.stopWatcher(driverKey);

        const key = driverKey.toLowerCase();
        const attachedHandles = new Set();
        const watcher = {
            attachedHandles,
            interval: null,
            isSyncing: false
        };

        const syncTabs = async () => {
            if (watcher.isSyncing || driver._isBusy) return;
            watcher.isSyncing = true;
            try {
                const handles = await driver.getAllWindowHandles();
                for (const h of Array.from(attachedHandles)) {
                    if (!handles.includes(h)) attachedHandles.delete(h);
                }

                // Chỉ xử lý các tab MỚI chưa được gắn script, tránh chuyển tab liên tục
                const newHandles = handles.filter(h => !attachedHandles.has(h));
                if (newHandles.length === 0) {
                    return;
                }

                const currentHandle = await driver.getWindowHandle().catch(() => null);

                for (const h of newHandles) {
                    try {
                        await driver.switchTo().window(h);
                        await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
                            source: this.getInjectionScript(isEnabled)
                        });
                        attachedHandles.add(h);

                        const url = await driver.getCurrentUrl();
                        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                            await driver.executeScript(this.getInjectionScript(isEnabled));
                        }
                    } catch (tabErr) {}
                }

                if (currentHandle && handles.includes(currentHandle)) {
                    await driver.switchTo().window(currentHandle).catch(() => {});
                }
            } catch (err) {
                if (err && err.message && (
                    err.message.includes('no such session') ||
                    err.message.includes('invalid session id') ||
                    err.message.includes('disconnected') ||
                    err.message.includes('not reachable')
                )) {
                    this.stopWatcher(key);
                }
            } finally {
                watcher.isSyncing = false;
            }
        };

        syncTabs();
        watcher.interval = setInterval(syncTabs, 1200);
        this.activeWatchers.set(key, watcher);
    }

    stopWatcher(driverKey) {
        if (!driverKey) return;
        const key = driverKey.toLowerCase();
        const watcher = this.activeWatchers.get(key);
        if (watcher) {
            if (watcher.interval) clearInterval(watcher.interval);
            this.activeWatchers.delete(key);
        }
    }

    async syncAllTabs(driver, isEnabled = true) {
        if (!driver) return { success: false, error: 'Driver không tồn tại' };
        try {
            const handles = await driver.getAllWindowHandles();
            const currentHandle = await driver.getWindowHandle().catch(() => null);

            for (const h of handles) {
                try {
                    await driver.switchTo().window(h);
                    await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
                        source: this.getInjectionScript(isEnabled)
                    });
                    await driver.executeScript(this.getInjectionScript(isEnabled));
                } catch (e) {}
            }

            if (currentHandle && handles.includes(currentHandle)) {
                await driver.switchTo().window(currentHandle).catch(() => {});
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

module.exports = new SmartPlusHelper();
