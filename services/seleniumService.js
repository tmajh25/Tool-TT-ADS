const path = require('path');
const fs = require('fs');

// Point Selenium Manager to the unpacked folder in packaged Electron app
if (process.resourcesPath) {
    const platform = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'macos' : 'linux');
    const binaryName = process.platform === 'win32' ? 'selenium-manager.exe' : 'selenium-manager';
    const unpackedPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'selenium-webdriver',
        'bin',
        platform,
        binaryName
    );
    if (fs.existsSync(unpackedPath)) {
        process.env.SE_MANAGER_PATH = unpackedPath;
    }
}

const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const axios = require('axios');
const otplib = require('otplib');
const cacheService = require('./cacheService');
const smartplusHelper = require('./smartplusHelper');

class SeleniumService {
    constructor() {
        this.activeDrivers = new Map();
        this.activeCaptchas = new Map();
    }

    getSmartPlusExtensionPath() {
        const devPath = path.join(__dirname, '..', 'extensions', 'Bypass-tiktok-smartplus-ext');
        if (fs.existsSync(devPath)) return devPath;

        if (process.resourcesPath) {
            const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', 'Bypass-tiktok-smartplus-ext');
            if (fs.existsSync(unpackedPath)) return unpackedPath;

            const resPath = path.join(process.resourcesPath, 'extensions', 'Bypass-tiktok-smartplus-ext');
            if (fs.existsSync(resPath)) return resPath;
        }
        return null;
    }

    getCaptcha(email) {
        return this.activeCaptchas.get((email || '').toLowerCase()) || null;
    }

    async getActiveBrowsers() {
        const active = [];
        for (const [email, driver] of Array.from(this.activeDrivers.entries())) {
            try {
                await Promise.race([
                    driver.getTitle(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
                ]);
                active.push(email);
            } catch (e) {
                if (e.message && (
                    e.message.includes('no such session') ||
                    e.message.includes('invalid session id') ||
                    e.message.includes('disconnected') ||
                    e.message.includes('not reachable') ||
                    e.message.includes('target frame detached')
                )) {
                    this.activeDrivers.delete(email);
                } else if (e.message === 'timeout') {
                    active.push(email);
                }
            }
        }
        return active;
    }

    async solveCaptchaClicks(email, clicks) {
        const driver = this.activeDrivers.get((email || '').toLowerCase());
        if (!driver) return { success: false, error: 'Không tìm thấy phiên trình duyệt đang chạy' };

        try {
            // Ưu tiên tìm đúng thẻ ảnh captcha mà user nhìn thấy trên điện thoại (bỏ qua logo nhỏ)
            const imgCandidates = await driver.findElements(By.css(
                'img.cap-rounded-lg, img[class*="cap-rounded"], .captcha-verify-container img[src^="data:image"], #captcha-verify-image, img.captcha_verify_img--slide, img[class*="captcha_verify_img"], .captcha-verify-container img, .TUXModal img'
            ));
            let targetCaptchaEl = null;
            for (const img of imgCandidates) {
                if (await img.isDisplayed()) {
                    const rect = await img.getRect();
                    if (rect.width >= 150 && rect.height >= 80) {
                        targetCaptchaEl = img;
                        break;
                    }
                }
            }

            if (!targetCaptchaEl) {
                const captchaContainers = await driver.findElements(By.css('.captcha-verify-container, .captcha_verify_container, .TUXModal, div[class*="captcha-verify"], div[class*="captcha_verify"], .secsdk-captcha-drag-wrapper, div[class*="verify"]'));
                for (const cel of captchaContainers) {
                    if (await cel.isDisplayed()) {
                        targetCaptchaEl = cel;
                        break;
                    }
                }
            }

            if (!targetCaptchaEl) return { success: false, error: 'Không tìm thấy khung Captcha trên màn hình' };

            const rect = await targetCaptchaEl.getRect();

            // Click vào từng tọa độ (Selenium tính offset từ tâm của element)
            for (const pt of clicks) {
                const offsetX = Math.round(pt.x - rect.width / 2);
                const offsetY = Math.round(pt.y - rect.height / 2);
                await driver.actions({ async: true })
                    .move({ origin: targetCaptchaEl, x: offsetX, y: offsetY })
                    .click()
                    .perform();
                await new Promise(r => setTimeout(r, 400));
            }

            // Chờ TikTok ghi nhận 2 điểm và kích hoạt nút Confirm
            await new Promise(r => setTimeout(r, 800));
            return await this.clickCaptchaConfirm(email);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async clickCaptchaConfirm(email) {
        const driver = this.activeDrivers.get((email || '').toLowerCase());
        if (!driver) return { success: false, error: 'Không tìm thấy phiên trình duyệt' };

        try {
            // Chờ nút Confirm sáng lên (bỏ trạng thái disabled) tối đa 2.5 giây
            let targetBtn = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                const btns = await driver.findElements(By.css(
                    'button.TUXButton--primary, .captcha-verify-container button.TUXButton--primary, .captcha-verify-container button, button[type="submit"]'
                ));
                for (const b of btns) {
                    if (await b.isDisplayed()) {
                        const cls = (await b.getAttribute('class')) || '';
                        const txt = ((await b.getText()) || '').toLowerCase();
                        if (txt.includes('confirm') || txt.includes('xác nhận') || cls.includes('primary')) {
                            targetBtn = b;
                            if (!cls.includes('disabled')) {
                                break;
                            }
                        }
                    }
                }
                if (targetBtn) {
                    const cls = (await targetBtn.getAttribute('class')) || '';
                    if (!cls.includes('disabled')) break;
                }
                await new Promise(r => setTimeout(r, 250));
            }

            if (targetBtn) {
                // Click bằng native hardware action
                await driver.actions({ async: true }).move({ origin: targetBtn }).click().perform();
                // Backup bằng click JS trực tiếp
                try {
                    await driver.executeScript("arguments[0].click();", targetBtn);
                } catch (e) {}
                return { success: true };
            }

            return { success: false, error: 'Chưa tìm thấy nút Confirm đã kích hoạt' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async solveCaptchaSlide(email, slidePercent) {
        const driver = this.activeDrivers.get((email || '').toLowerCase());
        if (!driver) return { success: false, error: 'Không tìm thấy phiên trình duyệt' };

        try {
            const sliderBtns = await driver.findElements(By.css('.secsdk-captcha-drag-icon, div[class*="drag-btn"], .captcha_drag_button'));
            if (sliderBtns.length > 0) {
                const sliderBtn = sliderBtns[0];
                const slideWidth = 300 * (slidePercent / 100);
                await driver.actions({ async: true })
                    .dragAndDrop(sliderBtn, { x: Math.round(slideWidth), y: 0 })
                    .perform();
                return { success: true };
            }
            return { success: false, error: 'Không tìm thấy thanh kéo trượt' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async openUrl(email, url) {
        const driver = this.activeDrivers.get((email || '').toLowerCase());
        if (!driver) return { success: false, error: 'Không tìm thấy phiên trình duyệt PC đang mở cho tài khoản này' };

        try {
            await driver.get(url);
            return { success: true, message: 'Đã mở liên kết trên trình duyệt PC' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async toggleSmartPlus(email, enabled) {
        let driver = this.activeDrivers.get((email || '').toLowerCase());
        if (!driver && this.activeDrivers.size > 0) {
            for (let [dEmail, d] of this.activeDrivers.entries()) {
                try {
                    await d.getTitle();
                    driver = d;
                    break;
                } catch (e) {
                    this.activeDrivers.delete(dEmail);
                }
            }
        }
        if (!driver) return { success: false, error: 'Không tìm thấy phiên trình duyệt đang mở' };

        try {
            const script = smartplusHelper.getInjectionScript(enabled);
            await driver.executeScript(`
                ${script}
                if (typeof window.__setTTSmartPlusBypass === 'function') {
                    return window.__setTTSmartPlusBypass(${enabled ? 'true' : 'false'});
                }
                return { success: true, enabled: ${enabled ? 'true' : 'false'} };
            `);
            return { success: true, enabled };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    extractTikTokCode(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Loại bỏ HTML tags
        const cleanText = text.replace(/<[^>]*>/g, ' ');

        // 1. Tìm theo ngữ cảnh rõ ràng trước
        const contextPatterns = [
            /(?:verification code|verification|mã xác minh|mã xác thực|code is|code:|mã:)\s*[:：\-]?\s*([A-Za-z0-9]{6})\b/i,
            /\b([A-Za-z0-9]{6})\b(?:\s+is your verification code|\s+là mã xác minh)/i,
            /【TikTok】[^\n\r]*?\b([A-Za-z0-9]{6})\b/i,
            /\[TikTok\][^\n\r]*?\b([A-Za-z0-9]{6})\b/i
        ];

        for (const pattern of contextPatterns) {
            const match = cleanText.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].toUpperCase();
                if (candidate !== 'TIKTOK' && candidate !== 'VERIFY') {
                    return candidate;
                }
            }
        }

        // 2. Danh sách từ tiếng Anh / thương hiệu 6 ký tự hay xuất hiện trong email TikTok
        const EXCLUDED_WORDS = new Set([
            'TIKTOK', 'BUSINESS', 'VERIFY', 'ONLINE', 'SYSTEM', 'UPDATE',
            'MEMBER', 'FAILED', 'CENTER', 'REPORT', 'MANAGE', 'THANKS',
            'POLICY', 'CREATE', 'GLOBAL', 'PLEASE', 'FOLLOW', 'ACCOUN',
            'LOGINT', 'NOTICE', 'SECURE', 'DEVICE', 'BROWSE', 'WINDOW',
            'CHROME', 'CLIENT', 'SERVER', 'SAFETY', 'STATUS', 'CHANGE',
            'ACCESS', 'ACTION', 'MOBILE', 'NUMBER', 'SUBMIT', 'CANCEL',
            'CODING', 'SEARCH', 'DOMAIN', 'ACTIVE', 'DELETE', 'REVIEW'
        ]);

        // 3. Quét tất cả cụm 6 ký tự gồm chữ và số
        const allMatches = cleanText.match(/\b[A-Za-z0-9]{6}\b/g) || [];
        
        // Ưu tiên mã có chứa số (như VAE97H hoặc 123456)
        for (const token of allMatches) {
            const upper = token.toUpperCase();
            if (EXCLUDED_WORDS.has(upper)) continue;
            if (/\d/.test(upper)) {
                return upper;
            }
        }

        // Fallback: chọn token hợp lệ đầu tiên không nằm trong blacklist
        for (const token of allMatches) {
            const upper = token.toUpperCase();
            if (!EXCLUDED_WORDS.has(upper)) {
                return upper;
            }
        }

        return null;
    }

    async getMailtmCode(email, mailPass, ignoreIds = [], progressCallback) {
        try {
            progressCallback("📩 Đang đăng nhập Mail.tm để lấy mã xác thực...");
            const session = axios.create({ baseURL: 'https://api.mail.tm' });
            
            let token = null;
            // Thử login lấy token
            for (let i = 0; i < 3; i++) {
                try {
                    const resp = await session.post('/token', { address: email, password: mailPass }, { timeout: 5000 });
                    if (resp.data && resp.data.token) {
                        token = resp.data.token;
                        break;
                    }
                } catch (e) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (!token) {
                progressCallback("❌ Lỗi: Không đăng nhập được Mail.tm để đọc thư!");
                return null;
            }

            const headers = { Authorization: `Bearer ${token}` };
            progressCallback("⏳ Đang đợi thư xác minh mới từ TikTok Ads...");

            // Thử quét hộp thư trong 60 giây
            for (let attempt = 1; attempt <= 30; attempt++) {
                try {
                    const msgsResp = await session.get('/messages', { headers, params: { page: 1, itemsPerPage: 10 } });
                    const msgs = msgsResp.data['hydra:member'] || [];
                    
                    // Lọc ra các thư mới không nằm trong danh sách cũ ignoreIds
                    const newMsgs = msgs.filter(m => !ignoreIds.includes(m.id));
                    
                    if (newMsgs.length > 0) {
                        const latestMsg = newMsgs[0];
                        const msgContent = await session.get(`/messages/${latestMsg.id}`, { headers });
                        const textData = msgContent.data.text || '';
                        const introData = msgContent.data.intro || '';
                        const htmlData = Array.isArray(msgContent.data.html) ? msgContent.data.html.join(' ') : (msgContent.data.html || '');
                        const combinedContent = `${textData} ${introData} ${htmlData}`;
                        
                        // Trích xuất mã xác minh TikTok (hỗ trợ cả chữ số lẫn chữ cái, ví dụ VAE97H)
                        const code = this.extractTikTokCode(combinedContent);
                        if (code) {
                            progressCallback(`🎯 Đã tìm thấy Mã: ${code}`);
                            return code;
                        }
                    }
                } catch (e) {
                    console.error("Attempt failed: ", e);
                }
                progressCallback(`📩 Đang check mail lấy code... (${attempt})`);
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            console.error("Error in getMailtmCode: ", e);
        }
        return null;
    }


    async loginTikTokAds(email, tiktokPass, mailPass, progressCallback, secret = '', skipCookieCheck = false) {
        let driver;

        try {
            // Lấy danh sách ID thư hiện tại để tránh nhận nhầm thư OTP cũ
            const ignoreIds = [];
            try {
                progressCallback("📧 Đang nạp danh sách thư cũ để lọc...");
                const session = axios.create({ baseURL: 'https://api.mail.tm' });
                let token = null;
                for (let i = 0; i < 3; i++) {
                    try {
                        const tokenResp = await session.post('/token', { address: email, password: mailPass }, { timeout: 5000 });
                        if (tokenResp.data && tokenResp.data.token) {
                            token = tokenResp.data.token;
                            break;
                        }
                    } catch (e) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
                if (token) {
                    const msgsResp = await session.get('/messages', { 
                        headers: { Authorization: `Bearer ${token}` }, 
                        params: { page: 1, itemsPerPage: 30 } 
                    });
                    const msgs = msgsResp.data['hydra:member'] || [];
                    msgs.forEach(m => ignoreIds.push(m.id));
                }
            } catch (e) {
                console.error("Lỗi lấy ignoreIds ban đầu:", e);
            }

            const settings = cacheService.loadSettings();
            progressCallback("🚀 Đang khởi động Chrome điều khiển...");
            
            const options = new chrome.Options();
            options.addArguments('--disable-gpu');
            options.addArguments('--no-sandbox');
            options.addArguments('--disable-notifications');
            options.excludeSwitches('enable-logging');

            const extPath = this.getSmartPlusExtensionPath();
            if (extPath) {
                progressCallback("Đã nạp tiện ích Bypass TikTok Smart+...");
                options.addArguments(`--disable-extensions-except=${extPath}`);
                options.addArguments(`--load-extension=${extPath}`);
            }
            
            if (settings.headless) {
                options.addArguments('--headless=new');
            }
            if (settings.chromePath) {
                options.setBinaryPath(settings.chromePath);
            }
            if (settings.proxy) {
                options.addArguments(`--proxy-server=${settings.proxy}`);
            }
            
            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();
            
            this.activeDrivers.set(email.toLowerCase(), driver);
            await driver.manage().window().maximize();

            // Tự động tiêm Bypass Smart+ qua CDP nếu được bật
            if (settings.bypassSmartPlus !== false) {
                try {
                    await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
                        source: smartplusHelper.getInjectionScript(true)
                    });
                    progressCallback("Đã kích hoạt tính năng Bypass TikTok Smart+...");
                } catch (e) {
                    console.error("Lỗi tiêm CDP Bypass:", e);
                }
            }

            // Luôn truy cập thẳng trang đăng nhập chính thức để điền thông tin
            progressCallback("🚀 Đang truy cập trang đăng nhập TikTok Ads...");
            await driver.get('https://ads.tiktok.com/i18n/login');
            try { await driver.manage().deleteAllCookies(); } catch (e) {}
            
            // --- GIAI ĐOẠN 1: ĐIỀN EMAIL & PASSWORD ---
            progressCallback("✍️ Đang nhập Email và Mật khẩu...");
            
            // Chờ và nhập Email
            const emailInput = await driver.wait(
                until.elementLocated(By.xpath("//input[@name='email' or @type='text' or contains(@placeholder, 'Email')]")), 
                15000
            );
            await emailInput.clear();
            await emailInput.sendKeys(email);
            await new Promise(r => setTimeout(r, 500));
            
            // Nhập Pass
            const passInput = await driver.findElement(By.xpath("//input[@type='password']"));
            await passInput.clear();
            await passInput.sendKeys(tiktokPass);
            await new Promise(r => setTimeout(r, 500));
            
            // Click Submit (Ưu tiên button.login-btn để tránh bấm nhầm "Log in with TikTok")
            let loginBtn;
            try {
                loginBtn = await driver.findElement(By.css('button.login-btn'));
            } catch (e) {
                loginBtn = await driver.findElement(By.xpath("//button[contains(@class, 'login-btn') or (not(contains(text(), 'with')) and (contains(text(), 'Log in') or contains(text(), 'Đăng nhập')))]"));
            }
            await driver.executeScript("arguments[0].click();", loginBtn);
            progressCallback("✅ Đã gửi lệnh đăng nhập, đang chờ Captcha xuất hiện...");

            // --- GIAI ĐOẠN 2: CHỜ MÃ VÀ NHẬP TỰ ĐỘNG ---
            let enteredCode = false;
            for (let i = 0; i < 120; i++) {
                let isCaptchaVisible = false;
                try {
                    // 1. Kiểm tra xuất hiện Captcha để chụp ảnh gửi về điện thoại
                    try {
                        const imgCandidates = await driver.findElements(By.css(
                            'img.cap-rounded-lg, img[class*="cap-rounded"], .captcha-verify-container img[src^="data:image"], #captcha-verify-image, img.captcha_verify_img--slide, img[class*="captcha_verify_img"], .captcha-verify-container img, .TUXModal img'
                        ));
                        let targetCaptchaEl = null;

                        for (const img of imgCandidates) {
                            if (await img.isDisplayed()) {
                                const rect = await img.getRect();
                                if (rect.width >= 150 && rect.height >= 80) {
                                    isCaptchaVisible = true;
                                    targetCaptchaEl = img;
                                    break;
                                }
                            }
                        }

                        // Nếu không tìm thấy ảnh riêng lẻ thì mới dùng container
                        if (!targetCaptchaEl) {
                            const captchaContainers = await driver.findElements(By.css('.captcha-verify-container, .captcha_verify_container, .TUXModal, div[class*="captcha-verify"], div[class*="captcha_verify"], .secsdk-captcha-drag-wrapper, div[class*="verify"]'));
                            for (const cel of captchaContainers) {
                                if (await cel.isDisplayed()) {
                                    isCaptchaVisible = true;
                                    targetCaptchaEl = cel;
                                    break;
                                }
                            }
                        }

                        if (isCaptchaVisible && targetCaptchaEl) {
                            const existing = this.activeCaptchas.get(email.toLowerCase());
                            let imgSrc = '';
                            try {
                                imgSrc = await targetCaptchaEl.getAttribute('src') || '';
                            } catch (e) {}

                            // CHỈ CHỤP ẢNH KHI CHƯA CÓ HOẶC KHI TIKTOK THAY ĐỔI ẢNH (Không đổi liên tục)
                            if (!existing || (imgSrc && existing.imgSrc && existing.imgSrc !== imgSrc)) {
                                const rect = await targetCaptchaEl.getRect();
                                let base64 = '';
                                if (!imgSrc || !imgSrc.startsWith('data:image')) {
                                    try {
                                        base64 = await targetCaptchaEl.takeScreenshot();
                                    } catch (ssErr) {
                                        base64 = await driver.takeScreenshot();
                                    }
                                }
                                
                                const finalImage = (imgSrc && imgSrc.startsWith('data:image')) ? imgSrc : ('data:image/png;base64,' + base64);
                                const captchaData = {
                                    id: 'cap_' + Date.now(),
                                    imgSrc: imgSrc || 'static',
                                    type: 'captcha',
                                    image: finalImage,
                                    width: rect.width || 340,
                                    height: rect.height || 212,
                                    message: 'Chạm vào 2 hình giống nhau'
                                };
                                this.activeCaptchas.set(email.toLowerCase(), captchaData);
                                progressCallback(captchaData);
                            }
                        }
                    } catch (cErr) {}

                    // Nếu có Captcha đang mở trên màn hình, DỪNG LẠI và CHỜ người dùng giải trên điện thoại
                    if (isCaptchaVisible) {
                        progressCallback("🧩 Vui lòng giải Captcha trên màn hình điện thoại...");
                        await new Promise(r => setTimeout(r, 1500));
                        continue;
                    } else if (this.activeCaptchas.has(email.toLowerCase())) {
                        this.activeCaptchas.delete(email.toLowerCase());
                    }

                    // 2. Check nếu đã đăng nhập thành công (URL đã rời khỏi trang login và có cookie phiên)
                    const currentUrl = await driver.getCurrentUrl();
                    const isSuccessPage = (currentUrl.includes('i18n/home') || currentUrl.includes('business.tiktok.com')) && 
                                          !currentUrl.includes('/login');
                    if (isSuccessPage) {
                        let savedCookies = [];
                        try {
                            savedCookies = await driver.manage().getCookies();
                        } catch (e) {}

                        const hasSession = savedCookies.some(c => 
                            c.name.startsWith('sessionid') || c.name.startsWith('sid_tt') || c.name.startsWith('sso_user')
                        );

                        if (hasSession) {
                            this.activeCaptchas.delete(email.toLowerCase());
                            progressCallback("✅ Đăng nhập TikTok Ads thành công!");
                            await cacheService.saveCookies(email, savedCookies);
                            progressCallback("💾 Đã ghi nhớ Cookie đăng nhập!");
                            return { success: true, cookies: savedCookies };
                        }
                    }

                    // 3. XỬ LÝ 2FA / MÃ XÁC THỰC (CHỈ KHI ĐÃ VƯỢT QUA CAPTCHA)
                    // Chuyển sang xác thực Email nếu đang hiển thị hình thức khác
                    try {
                        const switchBtns = await driver.findElements(By.xpath("//*[contains(text(), 'Switch to') or contains(text(), 'thực bằng email') or contains(text(), 'Email')]"));
                        for (let btn of switchBtns) {
                            if (await btn.isDisplayed() && (await btn.getText()).toLowerCase().includes('email')) {
                                await driver.executeScript("arguments[0].click();", btn);
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        }
                    } catch (e) {}

                    // Nhấn "Gửi mã" / "Send Code" nếu có nút gửi
                    try {
                        const sendBtns = await driver.findElements(By.xpath("//*[contains(text(), 'Send code') or contains(text(), 'Gửi mã') or contains(text(), 'Resend')]"));
                        for (let btn of sendBtns) {
                            if (await btn.isDisplayed() && await btn.isEnabled()) {
                                const btnClass = (await btn.getAttribute('class')) || '';
                                if (!btnClass.includes('disabled')) {
                                    await driver.executeScript("arguments[0].click();", btn);
                                    progressCallback("📧 Đã bấm nút gửi mã xác minh Email!");
                                    await new Promise(r => setTimeout(r, 5000));
                                }
                            }
                        }
                    } catch (e) {}

                    // Tìm các ô nhập mã xác nhận (chỉ khớp các ô mã xác minh thực sự)
                    const inputs = await driver.findElements(By.css(
                        "input[placeholder*='code' i], input[placeholder*='mã' i], input.ac-sendcode-input__input, input[class*='verification']"
                    ));
                    const visibleInputs = [];
                    for (let inp of inputs) {
                        if (await inp.isDisplayed()) visibleInputs.push(inp);
                    }
                    if (visibleInputs.length > 0 && !enteredCode) {
                        let code = null;

                        // Kiểm tra xem trang có đang yêu cầu mã xác thực Email hay TOTP
                        let isEmailChallenge = false;
                        let isTotpChallenge = false;
                        try {
                            const bodyEl = await driver.findElement(By.tagName('body'));
                            const bodyText = (await bodyEl.getText()).toLowerCase();
                            if (bodyText.includes('email') || bodyText.includes('thư') || bodyText.includes('gửi lại') || bodyText.includes('resend')) {
                                isEmailChallenge = true;
                            }
                            if (bodyText.includes('authenticator') || bodyText.includes('ứng dụng xác thực') || bodyText.includes('google')) {
                                isTotpChallenge = true;
                            }
                        } catch (e) {}

                        // 1. Nếu là xác minh Email hoặc có mật khẩu Mail.tm và không phải là yêu cầu thuần Authenticator
                        if ((isEmailChallenge || !isTotpChallenge || !secret) && mailPass) {
                            code = await this.getMailtmCode(email, mailPass, ignoreIds, progressCallback);
                        }

                        // 2. Nếu chưa có mã và có secret TOTP: thử tạo mã TOTP
                        if (!code && secret) {
                            try {
                                const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
                                code = otplib.authenticator.generate(cleanSecret);
                                progressCallback(`🔑 Đang thử điền mã 2FA TOTP: ${code}`);
                            } catch (e) {}
                        }

                        // 3. Fallback: Nếu vẫn chưa có mã mà mailPass có nhưng chưa thử
                        if (!code && mailPass && !isEmailChallenge) {
                            code = await this.getMailtmCode(email, mailPass, ignoreIds, progressCallback);
                        }

                        if (code) {
                            if (visibleInputs.length >= 6) {
                                progressCallback(`🔢 Đang điền 6 ô mã xác nhận: ${code}`);
                                for (let idx = 0; idx < 6; idx++) {
                                    const char = code[idx];
                                    try {
                                        await visibleInputs[idx].click();
                                        await visibleInputs[idx].clear();
                                    } catch (e) {}
                                    await visibleInputs[idx].sendKeys(char);
                                    await driver.executeScript(`
                                        const el = arguments[0];
                                        const val = arguments[1];
                                        if (el) {
                                            const proto = window.HTMLInputElement.prototype;
                                            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                            if (nativeSetter) {
                                                nativeSetter.call(el, val);
                                            } else {
                                                el.value = val;
                                            }
                                            el.dispatchEvent(new Event('input', { bubbles: true }));
                                            el.dispatchEvent(new Event('change', { bubbles: true }));
                                        }
                                    `, visibleInputs[idx], char);
                                    await new Promise(r => setTimeout(r, 100));
                                }
                                enteredCode = true;
                            } else if (visibleInputs.length === 1) {
                                progressCallback(`🔤 Đang điền mã vào ô xác nhận: ${code}`);
                                try {
                                    await visibleInputs[0].click();
                                    await visibleInputs[0].clear();
                                } catch (e) {}
                                await visibleInputs[0].sendKeys(code);
                                await driver.executeScript(`
                                    const el = arguments[0];
                                    const val = arguments[1];
                                    if (el) {
                                        const proto = window.HTMLInputElement.prototype;
                                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                        if (nativeSetter) {
                                            nativeSetter.call(el, val);
                                        } else {
                                            el.value = val;
                                        }
                                        el.dispatchEvent(new Event('input', { bubbles: true }));
                                        el.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                `, visibleInputs[0], code);
                                enteredCode = true;
                            }

                            await new Promise(r => setTimeout(r, 500));
                            // Nhấn xác nhận đăng nhập sau khi điền code
                            const confirmBtns = await driver.findElements(By.xpath("//button[@type='submit' or contains(text(), 'Log in') or contains(text(), 'Confirm') or contains(text(), 'Xác nhận')]"));
                            for (let cbtn of confirmBtns) {
                                if (await cbtn.isDisplayed()) {
                                    await driver.executeScript("arguments[0].click();", cbtn);
                                    progressCallback("⏳ Đang đợi xử lý đăng nhập...");
                                    break;
                                }
                            }
                            await new Promise(r => setTimeout(r, 3000));
                        }
                    }
                } catch (e) {
                    console.error("Loop error: ", e);
                    // Nếu trình duyệt bị đóng tay, dừng lặp tránh spam lỗi
                    if (e.message && (e.message.includes("no such session") || e.message.includes("invalid session id") || e.message.includes("disconnected"))) {
                        progressCallback("⚠️ Trình duyệt đã bị đóng hoặc mất kết nối.");
                        break;
                    }
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            progressCallback("❌ Hết thời gian chờ đăng nhập (Timeout).");
            return { success: false, error: 'Hết thời gian chờ đăng nhập (Timeout)' };
        } catch (e) {
            progressCallback(`❌ Lỗi: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async loginOutlookBrowser(email, password, secret, progressCallback) {
        let driver;
        try {
            const settings = cacheService.loadSettings();
            progressCallback("🚀 Đang mở trình duyệt điều khiển Outlook...");
            
            const options = new chrome.Options();
            options.addArguments('--disable-gpu');
            options.addArguments('--no-sandbox');
            options.excludeSwitches('enable-logging');
            
            const extPath = this.getSmartPlusExtensionPath();
            if (extPath) {
                options.addArguments(`--disable-extensions-except=${extPath}`);
                options.addArguments(`--load-extension=${extPath}`);
            }

            if (settings.headless) {
                options.addArguments('--headless=new');
            }
            if (settings.chromePath) {
                options.setBinaryPath(settings.chromePath);
            }
            if (settings.proxy) {
                options.addArguments(`--proxy-server=${settings.proxy}`);
            }
            
            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();
            
            this.activeDrivers.set(email.toLowerCase(), driver);
            await driver.manage().window().maximize();

            // Tự động tiêm Bypass Smart+ qua CDP nếu được bật
            if (settings.bypassSmartPlus !== false) {
                try {
                    await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
                        source: smartplusHelper.getInjectionScript(true)
                    });
                } catch (e) {
                    console.error("Lỗi tiêm CDP Bypass:", e);
                }
            }
            
            progressCallback("🚀 Truy cập trang đăng nhập Microsoft live...");
            await driver.get('https://login.live.com/login.srf');
            
            await new Promise(r => setTimeout(r, 1500));
            
            // Nhập Email
            progressCallback("✍️ Nhập Email...");
            const emailInput = await driver.findElement(By.name('loginfmt'));
            await emailInput.sendKeys(email);
            await driver.findElement(By.id('idSIButton9')).click();
            
            await new Promise(r => setTimeout(r, 1500));
            
            // Nhập Pass
            progressCallback("✍️ Nhập Mật khẩu...");
            const passInput = await driver.findElement(By.name('passwd'));
            await passInput.sendKeys(password);
            await new Promise(r => setTimeout(r, 500));
            await driver.findElement(By.id('idSIButton9')).click();
            
            // Nhập 2FA nếu có
            if (secret) {
                try {
                    progressCallback("🔑 Đang tạo mã 2FA xác thực...");
                    const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
                    const code = otplib.authenticator.generate(cleanSecret);
                    progressCallback(`🔑 Mã 2FA tự động của bạn là: ${code}`);
                } catch (e) {
                    progressCallback("❌ Không sinh được mã 2FA!");
                }
            }

            progressCallback("✅ Đã mở trình duyệt đăng nhập Outlook thành công! Hãy tự hoàn tất các bước tiếp theo trên trình duyệt.");
        } catch (e) {
            progressCallback(`❌ Lỗi: ${e.message}`);
        }
    }

    async fetchBusinessCentersFromDriver(driver) {
        try {
            // Đợi TikTok Ads tải xong Vue components và hiển thị danh sách thẻ (tối đa 15s)
            try {
                await driver.wait(until.elementLocated(By.css('.selection-item, .bc-card, [class*="account-info"]')), 15000);
            } catch (waitErr) {}

            await new Promise(r => setTimeout(r, 1000));

            const result = await driver.executeScript(() => {
                const isSelectPage = window.location.href.includes('business.tiktok.com/select');
                const items = Array.from(document.querySelectorAll('.selection-item, .bc-card'));
                const results = [];
                for (const item of items) {
                    const text = item.innerText || '';
                    const isBc = isSelectPage || 
                                 item.querySelector('.bc-card, [class*="bc-card"]') || 
                                 item.innerHTML.includes('icon-peoples') || 
                                 item.innerHTML.includes('icon-eabc');
                    if (!isBc) continue;

                    const idMatch = text.match(/ID[:\s]+(\d{15,22})/i) || text.match(/\b(7\d{18,19})\b/);
                    if (!idMatch) continue;
                    const id = idMatch[1];
                    if (results.some(x => x.id === id)) continue;

                    let name = '';
                    const ellipsisSpan = item.querySelector('.selection-basic-info__header__name .text-ellipsis span');
                    if (ellipsisSpan && ellipsisSpan.innerText.trim()) {
                        name = ellipsisSpan.innerText.trim();
                    }
                    if (!name) {
                        const ellipsisEl = item.querySelector('.selection-basic-info__header__name .text-ellipsis');
                        if (ellipsisEl && ellipsisEl.innerText.trim()) {
                            name = ellipsisEl.innerText.trim();
                        }
                    }
                    if (!name) {
                        const headerNameEl = item.querySelector('.selection-basic-info__header__name');
                        if (headerNameEl) {
                            const clone = headerNameEl.cloneNode(true);
                            clone.querySelectorAll('.bui-popper, [class*="popper"], [class*="tooltip"]').forEach(p => p.remove());
                            name = clone.innerText.trim();
                        }
                    }

                    let advCount = 0;
                    let memberCount = 1;
                    const countItems = item.querySelectorAll('.selection-basic-info__count__item');
                    for (const ci of countItems) {
                        const html = ci.innerHTML || '';
                        const textEl = ci.querySelector('.selection-basic-info__count__item__text') || ci;
                        const val = parseInt((textEl.innerText || '').trim()) || 0;
                        if (html.includes('icon-ad')) {
                            advCount = val;
                        } else if (html.includes('icon-peoples')) {
                            memberCount = val;
                        }
                    }

                    const imgEl = item.querySelector('img.avatar, .avatar-container img');
                    const avatar = imgEl ? imgEl.src : '';

                    results.push({
                        id,
                        name: name || ('Business Center ' + id.slice(-4)),
                        advCount,
                        memberCount,
                        avatar,
                        status: 'Active'
                    });
                }
                return results;
            });

            return result || [];
        } catch (e) {
            console.error('Lỗi fetchBusinessCentersFromDriver:', e.message);
            return [];
        }
    }

    async scanAccountBCs(email, password = '', secret = '', mailPass = '') {
        const lowerEmail = (email || '').toLowerCase();
        let driver = this.activeDrivers.get(lowerEmail);
        let createdDriver = false;

        try {
            if (!driver) {
                const savedCookies = await cacheService.loadCookies(email);
                if (!savedCookies || savedCookies.length === 0) {
                    if (password) {
                        const loginRes = await this.loginTikTokAds(email, password, mailPass || password, () => {}, secret);
                        if (loginRes && loginRes.businessCenters && loginRes.businessCenters.length > 0) {
                            return { success: true, businessCenters: loginRes.businessCenters };
                        }
                    }
                    return { success: false, error: 'Chưa có phiên đăng nhập hoặc Cookie cho tài khoản này.' };
                }

                const options = new chrome.Options();
                options.addArguments(
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-notifications',
                    '--disable-blink-features=AutomationControlled',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
                );
                options.excludeSwitches('enable-automation', 'enable-logging');

                const extPath = this.getSmartPlusExtensionPath();
                if (extPath) {
                    options.addArguments(`--disable-extensions-except=${extPath}`);
                    options.addArguments(`--load-extension=${extPath}`);
                }

                const settings = cacheService.loadSettings();
                if (settings.headless) options.addArguments('--headless=new');
                if (settings.chromePath) options.setBinaryPath(settings.chromePath);
                if (settings.proxy) options.addArguments(`--proxy-server=${settings.proxy}`);

                driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
                if (settings.bypassSmartPlus !== false) {
                    try {
                        await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
                            source: smartplusHelper.getInjectionScript(true)
                        });
                    } catch (e) {}
                }
                createdDriver = true;

                await driver.get('https://ads.tiktok.com/i18n/login');
                await driver.manage().deleteAllCookies();
                for (let c of savedCookies) {
                    try {
                        await driver.manage().addCookie({
                            name: c.name,
                            value: c.value,
                            path: c.path || '/',
                            domain: c.domain
                        });
                    } catch (e) {}
                }
            }

            await driver.get('https://business.tiktok.com/select');
            await new Promise(r => setTimeout(r, 4000));
            const currentUrl = await driver.getCurrentUrl();
            if (!currentUrl.includes('business.tiktok.com') && !currentUrl.includes('select') && !currentUrl.includes('i18n/home')) {
                if (createdDriver) {
                    await driver.quit();
                }
                if (password) {
                    const loginRes = await this.loginTikTokAds(email, password, mailPass || password, () => {}, secret);
                    if (loginRes && loginRes.businessCenters && loginRes.businessCenters.length > 0) {
                        return { success: true, businessCenters: loginRes.businessCenters };
                    }
                }
                return { success: false, error: 'Cookie đã hết hạn, cần đăng nhập lại.' };
            }

            const bcs = await this.fetchBusinessCentersFromDriver(driver);

            if (createdDriver) {
                // Giữ driver trong activeDrivers để các tab BC có thể quét liên tục
                this.activeDrivers.set(lowerEmail, driver);
            }

            return { success: true, businessCenters: bcs };
        } catch (e) {
            if (createdDriver && driver) {
                try { await driver.quit(); } catch (qe) {}
                this.activeDrivers.delete(lowerEmail);
            }
            return { success: false, error: e.message };
        }
    }

    async fetchMembersFromDriver(driver) {
        try {
            await driver.wait(until.elementLocated(By.css('table, .bui-table, [class*="table"]')), 8000).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            const members = await driver.executeScript(() => {
                const rows = Array.from(document.querySelectorAll('tbody tr, .bui-table-row, [role="row"]'));
                const results = [];
                for (const row of rows) {
                    const text = row.innerText || '';
                    if (!text.trim() || text.includes('Username') && text.includes('Status')) continue;

                    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    const email = emailMatch ? emailMatch[1] : '';

                    const userEl = row.querySelector('.member-user-cell, [class*="user"], strong, b, td:first-child');
                    let username = '';
                    if (userEl) {
                        username = userEl.innerText.trim().split('\n')[0];
                    }
                    if (!username && email) {
                        username = email.split('@')[0];
                    }
                    if (!username) continue;

                    let role = 'Admin';
                    if (text.toLowerCase().includes('finance manager') || text.toLowerCase().includes('quản lý tài chính')) {
                        role = 'Admin,Finance manager';
                    } else if (text.toLowerCase().includes('standard') || text.toLowerCase().includes('tiêu chuẩn')) {
                        role = 'Standard';
                    } else if (text.toLowerCase().includes('admin')) {
                        role = 'Admin';
                    }

                    const status = (text.toLowerCase().includes('suspended') || text.toLowerCase().includes('đình chỉ')) ? 'Suspended' : 'Active';

                    const assetsMatch = text.match(/(Assigned accounts \(\d+\)[^\n]*)/i) || text.match(/(\d+\s*tài khoản[^\n]*)/i);
                    const assignedAssets = assetsMatch ? assetsMatch[1] : 'Assigned accounts (1) Assigned assets (0)';

                    results.push({
                        username,
                        status,
                        email: email || `${username}@tiktok.user`,
                        role,
                        assignedAssets
                    });
                }
                return results;
            });
            return members || [];
        } catch (e) {
            console.error('Lỗi fetchMembersFromDriver:', e.message);
            return [];
        }
    }

    async fetchAdvAccountsFromDriver(driver) {
        try {
            await driver.wait(until.elementLocated(By.css('table, .bui-table, [class*="table"]')), 8000).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            const accounts = await driver.executeScript(() => {
                const rows = Array.from(document.querySelectorAll('tbody tr, .bui-table-row, [role="row"]'));
                const results = [];
                for (const row of rows) {
                    const text = row.innerText || '';
                    if (text.includes('Account name') && text.includes('Status')) continue;

                    const idMatch = text.match(/ID[:\s]+(\d{15,22})/i) || text.match(/\b(7\d{18,19})\b/) || text.match(/\b(\d{16,20})\b/);
                    if (!idMatch) continue;
                    const id = idMatch[1];
                    if (results.some(x => x.id === id)) continue;

                    const cells = Array.from(row.querySelectorAll('td, .bui-table-cell'));
                    let name = '';
                    if (cells.length > 0) {
                        const cellText = cells[0].innerText || '';
                        name = cellText.split('\n')[0].replace(/ID[:\s].*/i, '').trim();
                    }
                    if (!name) {
                        const nameEl = row.querySelector('[class*="name"], .text-ellipsis, strong, b');
                        name = nameEl ? nameEl.innerText.trim().split('\n')[0] : ('Account ' + id.slice(-4));
                    }

                    const isSuspended = text.toLowerCase().includes('suspended') || text.toLowerCase().includes('đình chỉ');
                    const isApproved = text.toLowerCase().includes('approved') || text.toLowerCase().includes('phê duyệt') || text.toLowerCase().includes('hoạt động');
                    const status = isSuspended ? 'Suspended' : (isApproved ? 'Approved' : 'Approved');

                    let owner = '';
                    if (cells.length >= 3) {
                        owner = cells[2].innerText.trim();
                    }

                    let linkedAssets = '0 assets';
                    if (cells.length >= 4) {
                        const assetCellText = cells[3].innerText.trim();
                        if (assetCellText) linkedAssets = assetCellText.split('\n')[0];
                    }

                    let membersCount = 1;
                    if (cells.length >= 5) {
                        const mVal = parseInt(cells[4].innerText.trim());
                        if (!isNaN(mVal) && mVal > 0) membersCount = mVal;
                    }

                    results.push({
                        id,
                        name: name || ('TKQC ' + id.slice(-4)),
                        status,
                        owner,
                        linkedAssets,
                        membersCount
                    });
                }
                return results;
            });
            return accounts || [];
        } catch (e) {
            console.error('Lỗi fetchAdvAccountsFromDriver:', e.message);
            return [];
        }
    }

    async fetchPaymentFromDriver(driver) {
        try {
            await driver.wait(until.elementLocated(By.css('[class*="payment"], [class*="balance"], [class*="fund"], table, body')), 8000).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            const paymentData = await driver.executeScript(() => {
                const bodyText = document.body.innerText || '';

                // 1. Tìm Portfolio ID
                let portfolioId = '';
                const pIdMatch = bodyText.match(/ID[:\s]+(\d{15,22})/i) || bodyText.match(/Payment Portfolio[^\n]*\n*.*ID[:\s]*(\d{15,22})/i);
                if (pIdMatch) portfolioId = pIdMatch[1];

                // 2. Tìm Available cash balance và đơn vị tiền tệ từ DOM (USD, VND, EUR, BRL, THB, IDR, PHP, SGD, JPY, CAD, AUD...)
                let balance = '';
                let currency = '';

                // Cách 1: Tìm node có text "Available cash balance" rồi tìm card chứa số tiền
                const allEls = Array.from(document.querySelectorAll('*'));
                const cashHeader = allEls.find(el => 
                    el.children.length === 0 && 
                    el.innerText && 
                    el.innerText.trim().toLowerCase() === 'available cash balance'
                );

                if (cashHeader) {
                    const card = cashHeader.closest('div[class*="card"], div[class*="box"], div[class*="item"], section') || 
                                 cashHeader.parentElement?.parentElement?.parentElement || 
                                 cashHeader.parentElement?.parentElement;
                    if (card) {
                        const cardText = card.innerText || '';
                        const cardMatch = cardText.match(/([\d,]+(?:\.\d+)?)\s*([A-Z]{3})/);
                        if (cardMatch) {
                            balance = cardMatch[1].trim();
                            currency = cardMatch[2].trim().toUpperCase();
                        }
                    }
                }

                // Cách 2: Tìm theo pattern "Total: ... [A-Z]{3}"
                if (!balance) {
                    const totalMatch = bodyText.match(/Total:\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})/i) ||
                                       bodyText.match(/Total[^\n]*\n*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})/i);
                    if (totalMatch) {
                        balance = totalMatch[1].trim();
                        currency = totalMatch[2].trim().toUpperCase();
                    }
                }

                // Cách 3: Regex chung từ bodyText dưới "Available cash balance"
                if (!balance) {
                    const generalMatch = bodyText.match(/Available cash balance[^\n]*\n*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})/i);
                    if (generalMatch) {
                        balance = generalMatch[1].trim();
                        currency = generalMatch[2].trim().toUpperCase();
                    }
                }

                // Cách 4: Quét bất kỳ số tiền kèm currency code hợp lệ (USD, VND, EUR, BRL, THB, IDR, PHP, GBP, SGD, JPY, ...)
                if (!balance) {
                    const anyMatch = bodyText.match(/([\d,]+(?:\.\d{2})?)\s*(USD|VND|EUR|GBP|CAD|AUD|SGD|MYR|THB|PHP|IDR|BRL|MXN|JPY|KRW|TRY|AED|SAR)/i);
                    if (anyMatch) {
                        balance = anyMatch[1].trim();
                        currency = anyMatch[2].trim().toUpperCase();
                    }
                }

                // 3. Tìm số lượng Payment methods
                let paymentMethodsCount = 1;
                const methodsCountMatch = bodyText.match(/Payment methods[^\n]*\n*(\d+)/i);
                if (methodsCountMatch) {
                    paymentMethodsCount = parseInt(methodsCountMatch[1]) || 1;
                }

                // 4. Quét danh sách tài khoản trong bảng Total ad credit balance bên dưới
                const rows = Array.from(document.querySelectorAll('tbody tr, .bui-table-row, [role="row"]'));
                const adCreditAccounts = [];
                for (const row of rows) {
                    const rowText = row.innerText || '';
                    if (!rowText.trim() || rowText.includes('Total ad credit balance') || rowText.includes('Account status')) continue;

                    const idMatch = rowText.match(/ID[:\s]+(\d{15,22})/i) || rowText.match(/\b(7\d{18,19})\b/);
                    if (!idMatch) continue;
                    const id = idMatch[1];
                    if (adCreditAccounts.some(x => x.id === id)) continue;

                    const cells = Array.from(row.querySelectorAll('td, .bui-table-cell'));
                    let name = '';
                    if (cells.length > 0) {
                        name = cells[0].innerText.split('\n')[0].replace(/ID[:\s].*/i, '').trim();
                    }
                    if (!name) {
                        const nameEl = row.querySelector('[class*="name"], strong, b');
                        name = nameEl ? nameEl.innerText.trim().split('\n')[0] : ('Account ' + id.slice(-4));
                    }

                    const isSuspended = rowText.toLowerCase().includes('suspended') || rowText.toLowerCase().includes('đình chỉ');
                    const status = isSuspended ? 'Suspended' : 'Approved';

                    const creditMatch = rowText.match(/([\d,.]+\s*(?:USD|VND|EUR|GBP|THB|IDR|BRL|[A-Z]{3}))/i);
                    const creditBalance = creditMatch ? creditMatch[1] : (currency ? `0.00 ${currency}` : '0.00 USD');

                    adCreditAccounts.push({
                        id,
                        name,
                        status,
                        creditBalance,
                        threshold: '-',
                        budgetManager: 'Unlimited'
                    });
                }

                return {
                    portfolioId: portfolioId || '',
                    balance: balance || '0.00',
                    currency: currency || 'USD',
                    totalDisplay: balance ? `${balance} ${currency}` : '0.00 USD',
                    paymentMethodsCount,
                    status: 'Active',
                    adCreditAccounts
                };
            });
            return paymentData;
        } catch (e) {
            console.error('Lỗi fetchPaymentFromDriver:', e.message);
            return null;
        }
    }

    async scanBCTab(email, bcId, tab, credentials = {}) {
        const lowerEmail = (email || '').toLowerCase();
        let driver = this.activeDrivers.get(lowerEmail);

        if (driver) {
            try {
                await driver.getTitle();
            } catch (e) {
                this.activeDrivers.delete(lowerEmail);
                driver = null;
            }
        }

        // TÌM BẤT KỲ DRIVER NÀO ĐANG CHẠY TRÊN HỆ THỐNG
        if (!driver && this.activeDrivers.size > 0) {
            for (let [dEmail, d] of this.activeDrivers.entries()) {
                try {
                    await d.getTitle();
                    driver = d;
                    this.activeDrivers.set(lowerEmail, driver);
                    break;
                } catch (e) {
                    this.activeDrivers.delete(dEmail);
                }
            }
        }

        if (!driver) {
            const savedCookies = await cacheService.loadCookies(email);
            if (!savedCookies || savedCookies.length === 0) {
                if (credentials.password) {
                    const loginRes = await this.loginTikTokAds(email, credentials.password, credentials.mailPass || credentials.password, () => {}, credentials.secret);
                    driver = this.activeDrivers.get(lowerEmail);
                    if (!driver) {
                        return { success: false, error: 'Không khởi động được phiên đăng nhập cho tài khoản này.' };
                    }
                } else {
                    return { success: false, error: 'Chưa có phiên đăng nhập hoặc Cookie cho tài khoản này.' };
                }
            } else {
                const options = new chrome.Options();
                options.addArguments(
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-notifications',
                    '--disable-blink-features=AutomationControlled',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
                );
                options.excludeSwitches('enable-automation', 'enable-logging');

                const extPath = this.getSmartPlusExtensionPath();
                if (extPath) {
                    options.addArguments(`--disable-extensions-except=${extPath}`);
                    options.addArguments(`--load-extension=${extPath}`);
                }

                const settings = cacheService.loadSettings();
                if (settings.headless) options.addArguments('--headless=new');
                if (settings.chromePath) options.setBinaryPath(settings.chromePath);
                if (settings.proxy) options.addArguments(`--proxy-server=${settings.proxy}`);

                driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
                if (settings.bypassSmartPlus !== false) {
                    try {
                        await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
                            source: smartplusHelper.getInjectionScript(true)
                        });
                    } catch (e) {}
                }
                this.activeDrivers.set(lowerEmail, driver);

                await driver.get('https://ads.tiktok.com/i18n/login');
                await driver.manage().deleteAllCookies();
                for (let c of savedCookies) {
                    try {
                        await driver.manage().addCookie({
                            name: c.name,
                            value: c.value,
                            path: c.path || '/',
                            domain: c.domain
                        });
                    } catch (e) {}
                }
            }
        }

        let targetUrl = '';
        if (tab === 'members') {
            targetUrl = `https://business.tiktok.com/manage/users/members?org_id=${bcId}`;
        } else if (tab === 'adv') {
            targetUrl = `https://business.tiktok.com/manage/accounts/adv?org_id=${bcId}`;
        } else if (tab === 'payment') {
            targetUrl = `https://business.tiktok.com/manage/payment/v2?org_id=${bcId}`;
        } else {
            targetUrl = `https://business.tiktok.com/manage/accounts/adv?org_id=${bcId}`;
        }

        try {
            const currentUrl = await driver.getCurrentUrl();
            if (!currentUrl.includes(targetUrl.replace('https://', ''))) {
                await driver.get(targetUrl);
                await new Promise(r => setTimeout(r, 2500));
            }

            let data = null;
            if (tab === 'members') {
                data = await this.fetchMembersFromDriver(driver);
            } else if (tab === 'adv') {
                data = await this.fetchAdvAccountsFromDriver(driver);
            } else if (tab === 'payment') {
                data = await this.fetchPaymentFromDriver(driver);
            }

            return { success: true, tab, data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

module.exports = new SeleniumService();
