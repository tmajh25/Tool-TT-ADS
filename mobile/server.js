const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');
const axios = require('axios');
const otplib = require('otplib');
const fs = require('fs');

let defaultCacheService = null;
let defaultSeleniumService = null;
try {
    defaultCacheService = require('../services/cacheService');
} catch (e) {}
try {
    defaultSeleniumService = require('../services/seleniumService');
} catch (e) {}

class MobileServer {
    constructor(options = {}) {
        this.port = options.port || 3888;
        this.cacheService = options.cacheService || defaultCacheService;
        this.seleniumService = options.seleniumService || defaultSeleniumService;
        this.loginJobs = new Map();
        this._cleanupTimer = setInterval(() => this._cleanupOldJobs(), 60000);
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();

        this.app = express();
        this.server = null;
        this.isRunning = false;
        this.accounts = [];
        this.dataPath = path.join(__dirname, 'data');
        this.accountsFile = path.join(this.dataPath, 'mobile_accounts.json');

        this._initDataFolder();
        this._loadLocalAccounts();
        this._setupMiddleware();
        this._setupRoutes();
    }

    _cleanupOldJobs() {
        const now = Date.now();
        for (const [jobId, job] of this.loginJobs.entries()) {
            if ((job.status === 'success' || job.status === 'error') && job.updatedAt && (now - job.updatedAt > 30000)) {
                this.loginJobs.delete(jobId);
            } else if (job.createdAt && (now - job.createdAt > 15 * 60 * 1000)) {
                this.loginJobs.delete(jobId);
            }
        }
    }


    _initDataFolder() {
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true });
        }
    }

    _loadLocalAccounts() {
        try {
            if (fs.existsSync(this.accountsFile)) {
                this.accounts = JSON.parse(fs.readFileSync(this.accountsFile, 'utf-8'));
            } else {
                this.accounts = [];
            }
        } catch (e) {
            console.error('Error loading mobile accounts:', e);
            this.accounts = [];
        }
    }

    _saveLocalAccounts() {
        try {
            fs.writeFileSync(this.accountsFile, JSON.stringify(this.accounts, null, 2), 'utf-8');
        } catch (e) {
            console.error('Error saving mobile accounts:', e);
        }
    }

    _setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Vô hiệu hóa cache hoàn toàn để F5 luôn tải code và giao diện mới nhất
        this.app.use((req, res, next) => {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            next();
        });

        // Serve static assets for Mobile PWA
        this.app.use(express.static(path.join(__dirname, 'public'), {
            etag: false,
            maxAge: 0
        }));
    }

    getLocalIPs() {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Chỉ lấy IPv4 nội bộ và không phải loopback
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push(iface.address);
                }
            }
        }
        return ips;
    }

    async getQRCodeDataURL(url) {
        try {
            return await qrcode.toDataURL(url, {
                width: 320,
                margin: 2,
                color: {
                    dark: '#0f172a',
                    light: '#ffffff'
                }
            });
        } catch (err) {
            console.error('QR code generation error:', err);
            return null;
        }
    }

    async verifyCookie(email) {
        if (!this.cacheService) return false;
        try {
            const cookies = await this.cacheService.loadCookies(email);
            if (!cookies || !Array.isArray(cookies) || cookies.length === 0) return false;

            const hasAuthCookie = cookies.some(c => 
                c.name.startsWith('sessionid') || 
                c.name.startsWith('sid_tt') || 
                c.name.startsWith('sso_user') ||
                c.name === 'passport_csrf_token'
            );
            if (!hasAuthCookie) return false;

            // Gọi API passport chính thức của TikTok Ads để kiểm tra tính hợp lệ của Cookie
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            const resp = await axios.get('https://ads.tiktok.com/passport/web/account/info/', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                    'Cookie': cookieStr,
                    'Referer': 'https://ads.tiktok.com/i18n/home',
                    'Accept': 'application/json, text/plain, */*'
                },
                timeout: 5000,
                validateStatus: () => true
            });

            if (resp.status === 200 && resp.data && resp.data.message === 'success' && resp.data.data && resp.data.data.user_id) {
                return true;
            }

            // Phiên đăng nhập đã hết hạn -> dọn dẹp driver cũ (nếu có)
            if (this.seleniumService && this.seleniumService.activeDrivers.has(email.toLowerCase())) {
                try {
                    const oldDriver = this.seleniumService.activeDrivers.get(email.toLowerCase());
                    await oldDriver.quit();
                } catch (e) {}
                this.seleniumService.activeDrivers.delete(email.toLowerCase());
            }
            return false;
        } catch (err) {
            return false;
        }
    }

    async findAccount(email) {
        if (!email) return null;
        const lowerEmail = email.toLowerCase();
        let acc = this.accounts.find(a => (a.email || '').toLowerCase() === lowerEmail);
        if (acc) return acc;

        // Nếu chưa có trong mobile_accounts.json, tìm trong cacheService của Tool PC
        if (this.cacheService) {
            try {
                const mailtmAccs = await this.cacheService.loadMailtmAccounts() || [];
                const outlookAccs = await this.cacheService.loadOutlookAccounts() || [];
                const matched = [...mailtmAccs, ...outlookAccs].find(a => ((a.email || a.address) || '').toLowerCase() === lowerEmail);
                if (matched) {
                    const newAcc = {
                        id: matched.email || matched.address || ('acc_' + Date.now()),
                        email: matched.email || matched.address,
                        password: matched.tiktokPass || matched.password || '',
                        secret: (matched.secret || matched.secretKey || '').replace(/\s+/g, '').toUpperCase(),
                        mailPass: matched.mailPass || matched.password || '',
                        mailType: matched.mailType || (matched.address ? 'mailtm' : 'outlook'),
                        status: matched.status || 'unknown',
                        businessCenters: matched.businessCenters || []
                    };
                    this.accounts.push(newAcc);
                    this._saveLocalAccounts();
                    return newAcc;
                }
            } catch (e) {
                console.error('Lỗi tìm tài khoản trong cacheService:', e);
            }
        }
        return null;
    }

    _setupRoutes() {
        // 0.0 Kiểm tra Cookie trước khi vào & tự động đăng nhập lại nếu hết hạn
        this.app.post('/api/tiktok/verify-session', async (req, res) => {
            const { email } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });

            const acc = await this.findAccount(email);
            if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });

            // 1. Kiểm tra cookie còn hạn không
            const isValid = await this.verifyCookie(email);
            if (isValid) {
                return res.json({ success: true, valid: true, message: 'Phiên đăng nhập còn hiệu lực' });
            }

            // 2. Cookie đã hết hạn -> kiểm tra khả năng tự động đăng nhập lại
            if (!this.seleniumService) {
                return res.json({ success: false, valid: false, message: 'Cookie đã hết hạn' });
            }

            if (!acc.password) {
                return res.json({
                    success: false,
                    valid: false,
                    needPassword: true,
                    message: 'Cookie đã hết hạn và chưa có mật khẩu để tự đăng nhập lại.'
                });
            }

            // 2. Khởi chạy đăng nhập lại ngầm (nếu chưa có tiến trình đang chạy)
            const jobId = email.toLowerCase();
            const existingJob = this.loginJobs.get(jobId);
            if (existingJob && existingJob.status === 'running') {
                return res.json({
                    success: true,
                    valid: false,
                    relogging: true,
                    alreadyRunning: true,
                    message: existingJob.progress || 'Đang tự động đăng nhập lại...'
                });
            }

            this.loginJobs.set(jobId, {
                status: 'running',
                progress: 'Cookie đã hết hạn, đang tự động đăng nhập lại...',
                error: null,
                businessCenters: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            (async () => {
                const progressCb = (msg) => {
                    const job = this.loginJobs.get(jobId);
                    if (job) {
                        job.progress = typeof msg === 'string' ? msg : 'Đang xử lý captcha...';
                        job.updatedAt = Date.now();
                    }
                };

                try {
                    const loginRes = await this.seleniumService.loginTikTokAds(
                        acc.email,
                        acc.password,
                        acc.mailPass || acc.password,
                        progressCb,
                        acc.secret || '',
                        true // skipCookieCheck vì đã kiểm tra cookie hết hạn trước đó
                    );

                    if (!loginRes || !loginRes.success) {
                        throw new Error((loginRes && loginRes.error) ? loginRes.error : 'Đăng nhập không thành công');
                    }

                    const accIdx = this.accounts.findIndex(a => a.email.toLowerCase() === acc.email.toLowerCase());
                    if (accIdx >= 0) {
                        this.accounts[accIdx].status = 'Active';
                        this._saveLocalAccounts();
                    }

                    this.loginJobs.set(jobId, {
                        status: 'success',
                        progress: 'Đăng nhập lại thành công!',
                        businessCenters: [],
                        updatedAt: Date.now()
                    });
                    setTimeout(() => {
                        this.loginJobs.delete(jobId);
                    }, 10000);
                } catch (err) {
                    this.loginJobs.set(jobId, {
                        status: 'error',
                        progress: 'Lỗi đăng nhập lại: ' + err.message,
                        error: err.message,
                        updatedAt: Date.now()
                    });
                    setTimeout(() => {
                        this.loginJobs.delete(jobId);
                    }, 10000);
                }
            })();

            res.json({
                success: true,
                valid: false,
                relogging: true,
                message: 'Cookie đã hết hạn, đang tự động đăng nhập lại...'
            });
        });

        // 0. Đăng nhập TikTok Ads trực tiếp
        this.app.post('/api/tiktok/login', async (req, res) => {
            const { email, password, mailPass, secret } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });

            const existingIndex = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
            const accItem = {
                id: 'acc_' + Date.now(),
                email: email.trim(),
                password: password || '',
                secret: (secret || '').replace(/\s+/g, '').toUpperCase(),
                mailPass: mailPass || password || '',
                mailType: email.includes('mail.tm') || email.endsWith('.tm') ? 'mailtm' : 'outlook',
                status: 'logging_in',
                businessCenters: []
            };
            if (existingIndex >= 0) {
                this.accounts[existingIndex] = { ...this.accounts[existingIndex], ...accItem };
            } else {
                this.accounts.push(accItem);
            }
            this._saveLocalAccounts();

            if (!this.seleniumService) {
                return res.json({
                    success: false,
                    message: 'Chưa kết nối Selenium Service trên Tool PC. Vui lòng mở app trên ToolTT để tự động khởi chạy trình duyệt đăng nhập.'
                });
            }

            const jobId = email.toLowerCase();
            const existingJob = this.loginJobs.get(jobId);
            if (existingJob && existingJob.status === 'running') {
                return res.json({
                    success: true,
                    message: 'Tiến trình đăng nhập đang được thực hiện...',
                    jobId,
                    alreadyRunning: true
                });
            }

            this.loginJobs.set(jobId, {
                status: 'running',
                progress: 'Đang mở trình duyệt...',
                error: null,
                businessCenters: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            // Chạy tiến trình đăng nhập Selenium ngầm
            (async () => {
                const progressCb = (msg) => {
                    const job = this.loginJobs.get(jobId);
                    if (job) {
                        job.progress = msg;
                        job.updatedAt = Date.now();
                    }
                };

                try {
                    const loginRes = await this.seleniumService.loginTikTokAds(
                        email,
                        password,
                        mailPass || password,
                        progressCb,
                        secret,
                        true // skipCookieCheck vì người dùng chủ động đăng nhập mới
                    );

                    if (!loginRes || !loginRes.success) {
                        throw new Error((loginRes && loginRes.error) ? loginRes.error : 'Đăng nhập không thành công');
                    }

                    const accIdx = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
                    if (accIdx >= 0) {
                        this.accounts[accIdx].status = 'Active';
                        this._saveLocalAccounts();
                    }

                    this.loginJobs.set(jobId, {
                        status: 'success',
                        progress: 'Đăng nhập thành công!',
                        businessCenters: [],
                        updatedAt: Date.now()
                    });
                    setTimeout(() => {
                        this.loginJobs.delete(jobId);
                    }, 10000);
                } catch (loginErr) {
                    this.loginJobs.set(jobId, {
                        status: 'error',
                        progress: 'Lỗi đăng nhập: ' + loginErr.message,
                        error: loginErr.message,
                        updatedAt: Date.now()
                    });
                    setTimeout(() => {
                        this.loginJobs.delete(jobId);
                    }, 10000);
                }
            })();

            res.json({ success: true, message: 'Đang tiến hành đăng nhập...', jobId });
        });

        this.app.get('/api/tiktok/login-status', (req, res) => {
            const email = (req.query.email || '').toLowerCase();
            const job = this.loginJobs.get(email);
            if (!job) {
                return res.json({ status: 'idle', progress: '' });
            }
            res.json(job);
        });

        // 0.1 Lấy ảnh Captcha hiện tại
        this.app.get('/api/tiktok/captcha', (req, res) => {
            const email = (req.query.email || '').toLowerCase();
            if (!this.seleniumService) return res.json({ hasCaptcha: false });
            const captcha = this.seleniumService.getCaptcha(email);
            if (captcha) {
                return res.json({ hasCaptcha: true, captcha });
            }
            res.json({ hasCaptcha: false });
        });

        // 0.2 Gửi thao tác giải Captcha từ điện thoại
        this.app.post('/api/tiktok/solve-captcha', async (req, res) => {
            const { email, clicks, slidePercent } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });
            if (!this.seleniumService) return res.status(500).json({ success: false, error: 'Selenium chưa kết nối' });

            try {
                let result = { success: false };
                if (Array.isArray(clicks) && clicks.length > 0) {
                    result = await this.seleniumService.solveCaptchaClicks(email, clicks);
                } else if (typeof slidePercent === 'number') {
                    result = await this.seleniumService.solveCaptchaSlide(email, slidePercent);
                }

                res.json(result);
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 0.3 Nhấn nút Confirm Captcha trên PC
        this.app.post('/api/tiktok/captcha-confirm', async (req, res) => {
            const { email } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });
            if (!this.seleniumService) return res.status(500).json({ success: false, error: 'Selenium chưa kết nối' });

            try {
                const result = await this.seleniumService.clickCaptchaConfirm(email);
                res.json(result);
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 0.4 Mở URL trực tiếp trên trình duyệt PC (Selenium)
        this.app.post('/api/tiktok/open-url', async (req, res) => {
            const { email, url } = req.body;
            if (!email || !url) return res.status(400).json({ success: false, error: 'Thiếu email hoặc url' });
            if (!this.seleniumService) return res.status(500).json({ success: false, error: 'Selenium chưa kết nối trên PC' });

            try {
                const result = await this.seleniumService.openUrl(email, url);
                res.json(result);
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });


        // 1. Health & Server Info

        this.app.get('/api/info', async (req, res) => {
            const ips = this.getLocalIPs();
            const primaryIP = ips.length > 0 ? ips[0] : '127.0.0.1';
            const serverUrl = `http://${primaryIP}:${this.port}`;
            const qrCode = await this.getQRCodeDataURL(serverUrl);

            res.json({
                success: true,
                status: 'online',
                port: this.port,
                ips,
                primaryUrl: serverUrl,
                localUrl: `http://localhost:${this.port}`,
                qrCode
            });
        });


        // 2. Danh sách tài khoản (Đồng bộ với ToolTT hoặc local)
        this.app.get('/api/accounts', async (req, res) => {
            try {
                let allAccounts = [...this.accounts];

                if (this.cacheService) {
                    try {
                        const mailtmAccs = await this.cacheService.loadMailtmAccounts() || [];
                        const outlookAccs = await this.cacheService.loadOutlookAccounts() || [];
                        
                        const externalAccs = [...mailtmAccs, ...outlookAccs].map(acc => ({
                            id: acc.email || acc.address || 'acc_' + Math.random().toString(36).substr(2, 8),
                            email: acc.email || acc.address,
                            password: acc.tiktokPass || acc.password || '',
                            secret: acc.secret || acc.secretKey || '',
                            mailType: acc.mailType || (acc.address ? 'mailtm' : 'outlook'),
                            mailPass: acc.mailPass || acc.password || '',
                            status: acc.status || 'unknown',
                            balance: acc.balance || null,
                            currency: acc.currency || 'USD',
                            note: acc.note || 'Đồng bộ từ Tool PC',
                            source: 'tooltt'
                        }));

                        const emailSet = new Set(allAccounts.map(a => (a.email || '').toLowerCase()));
                        for (const ext of externalAccs) {
                            if (ext.email && !emailSet.has(ext.email.toLowerCase())) {
                                allAccounts.push(ext);
                                emailSet.add(ext.email.toLowerCase());
                            }
                        }
                    } catch (e) {
                        console.error('Lỗi nạp từ cacheService:', e.message);
                    }
                }

                res.json({ success: true, accounts: allAccounts });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 3. Thêm / Import tài khoản từ di động
        this.app.post('/api/accounts/import', (req, res) => {
            try {
                const { rawText, accounts } = req.body;
                let addedCount = 0;

                if (Array.isArray(accounts)) {
                    accounts.forEach(acc => {
                        if (acc.email) {
                            const existingIndex = this.accounts.findIndex(a => a.email.toLowerCase() === acc.email.toLowerCase());
                            const newAcc = {
                                id: acc.id || 'mob_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                                email: acc.email.trim(),
                                password: acc.password || '',
                                secret: (acc.secret || '').replace(/\s+/g, '').toUpperCase(),
                                mailType: acc.mailType || (acc.email.includes('mail.tm') ? 'mailtm' : 'outlook'),
                                mailPass: acc.mailPass || acc.password || '',
                                status: acc.status || 'unknown',
                                balance: acc.balance || null,
                                currency: acc.currency || 'USD',
                                note: acc.note || '',
                                updatedAt: new Date().toISOString()
                            };
                            if (existingIndex >= 0) {
                                this.accounts[existingIndex] = { ...this.accounts[existingIndex], ...newAcc };
                            } else {
                                this.accounts.push(newAcc);
                                addedCount++;
                            }
                        }
                    });
                } else if (typeof rawText === 'string') {
                    const lines = rawText.split(/\r?\n/);
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        const parts = trimmed.split(/[|\t;,]/);
                        if (parts.length >= 1 && parts[0].includes('@')) {
                            const email = parts[0].trim();
                            const password = parts[1] ? parts[1].trim() : '';
                            const secret = parts[2] ? parts[2].trim().replace(/\s+/g, '').toUpperCase() : '';
                            const mailPass = parts[3] ? parts[3].trim() : password;

                            const existingIndex = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
                            const item = {
                                id: 'mob_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                                email,
                                password,
                                secret,
                                mailPass,
                                mailType: email.endsWith('.tm') || email.includes('mailtm') ? 'mailtm' : 'outlook',
                                status: 'unknown',
                                balance: null,
                                currency: 'USD',
                                note: '',
                                updatedAt: new Date().toISOString()
                            };
                            if (existingIndex >= 0) {
                                this.accounts[existingIndex] = { ...this.accounts[existingIndex], ...item };
                            } else {
                                this.accounts.push(item);
                                addedCount++;
                            }
                        }
                    }
                }

                this._saveLocalAccounts();
                res.json({ success: true, count: this.accounts.length, added: addedCount });
            } catch (e) {
                res.status(500).json({ success: false, error: e.message });
            }
        });

        // 4. Xóa tài khoản
        this.app.post('/api/accounts/delete', (req, res) => {
            const { email } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });
            this.accounts = this.accounts.filter(a => a.email.toLowerCase() !== email.toLowerCase());
            this._saveLocalAccounts();
            res.json({ success: true, count: this.accounts.length });
        });

        // 5. Sinh mã 2FA TOTP
        this.app.post('/api/tools/totp', (req, res) => {
            try {
                const { secret } = req.body;
                if (!secret) {
                    return res.status(400).json({ success: false, error: 'Chưa có secret key 2FA' });
                }
                const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
                const code = otplib.authenticator.generate(cleanSecret);
                const timeRemaining = 30 - Math.floor((Date.now() / 1000) % 30);
                res.json({ success: true, code, timeRemaining });
            } catch (err) {
                res.status(400).json({ success: false, error: 'Secret 2FA không hợp lệ: ' + err.message });
            }
        });

        // 6. Đọc thư OTP tự động từ Mail.tm hoặc Outlook
        this.app.post('/api/tools/mail-otp', async (req, res) => {
            const { email, mailPass, mailType } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });

            try {
                if (!mailType || mailType === 'mailtm' || email.includes('mail.tm') || email.endsWith('.tm')) {
                    const session = axios.create({ baseURL: 'https://api.mail.tm' });
                    let token = null;
                    
                    try {
                        const tokenResp = await session.post('/token', { address: email, password: mailPass }, { timeout: 7000 });
                        token = tokenResp.data.token;
                    } catch (tokenErr) {
                        return res.json({ success: false, error: 'Không đăng nhập được Mail.tm. Kiểm tra mật khẩu mail!' });
                    }

                    const msgsResp = await session.get('/messages', {
                        headers: { Authorization: `Bearer ${token}` },
                        params: { page: 1, itemsPerPage: 5 },
                        timeout: 7000
                    });

                    const msgs = msgsResp.data['hydra:member'] || [];
                    if (msgs.length === 0) {
                        return res.json({ success: false, message: 'Hòm thư hiện đang trống, chưa có thư mới' });
                    }

                    let foundCode = null;
                    let emailSubject = '';
                    let emailFrom = '';

                    for (const msg of msgs) {
                        const msgDetail = await session.get(`/messages/${msg.id}`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        const textData = msgDetail.data.text || '';
                        const introData = msgDetail.data.intro || '';
                        const htmlData = Array.isArray(msgDetail.data.html) ? msgDetail.data.html.join(' ') : (msgDetail.data.html || '');
                        const combinedContent = `${textData} ${introData} ${htmlData}`;
                        
                        const code = this.seleniumService && typeof this.seleniumService.extractTikTokCode === 'function'
                            ? this.seleniumService.extractTikTokCode(combinedContent)
                            : null;
                        if (code) {
                            foundCode = code;
                            emailSubject = msg.subject;
                            emailFrom = msg.from ? msg.from.address : '';
                            break;
                        }
                    }

                    if (foundCode) {
                        return res.json({
                            success: true,
                            code: foundCode,
                            subject: emailSubject,
                            from: emailFrom,
                            message: `Đã tìm thấy mã OTP: ${foundCode}`
                        });
                    } else {
                        return res.json({
                            success: false,
                            message: 'Đã nhận được thư nhưng chưa trích xuất được mã OTP 6 số từ nội dung.'
                        });
                    }
                } else {
                    return res.json({
                        success: false,
                        message: 'Tài khoản Outlook yêu cầu xác thực OAuth hoặc phiên đăng nhập.'
                    });
                }
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 7. Check thông tin nhanh TikTok Ads (Balance, Status, Advertisers)
        this.app.post('/api/tiktok/quick-check', async (req, res) => {
            const { email, cookie, proxy } = req.body;
            
            let targetCookie = cookie;
            if (!targetCookie && this.cacheService && email) {
                try {
                    const savedCookies = await this.cacheService.loadCookies(email);
                    if (savedCookies && Array.isArray(savedCookies)) {
                        targetCookie = savedCookies.map(c => `${c.name}=${c.value}`).join('; ');
                    }
                } catch (e) {}
            }

            if (!targetCookie) {
                return res.json({
                    success: false,
                    needLogin: true,
                    status: 'Chưa có Cookie',
                    message: 'Chưa có Cookie đăng nhập. Hãy bấm lưu Cookie hoặc đăng nhập 1 lần từ ToolTT PC để tự động sync Cookie sang Mobile.'
                });
            }

            try {
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                    'Cookie': targetCookie,
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://ads.tiktok.com/i18n/home'
                };

                const axiosConfig = {
                    headers,
                    timeout: 10000,
                    validateStatus: () => true
                };

                const userResp = await axios.get('https://ads.tiktok.com/api/v2/i18n/user/info/', axiosConfig);
                
                if (userResp.status !== 200 || !userResp.data || userResp.data.code !== 0) {
                    return res.json({
                        success: false,
                        status: 'Cookie hết hạn',
                        message: 'Cookie đăng nhập TikTok Ads đã hết hạn, vui lòng đăng nhập lại.'
                    });
                }

                const userData = userResp.data.data || {};
                const advertisers = userData.advertisers || userData.advertiser_list || [];

                let balance = '0.00';
                let currency = 'USD';
                let accountStatus = 'Active';
                let advName = userData.display_name || userData.email || email;

                if (advertisers.length > 0) {
                    const adv = advertisers[0];
                    advName = adv.advertiser_name || advName;
                    currency = adv.currency || currency;

                    try {
                        const balanceResp = await axios.get(`https://ads.tiktok.com/api/v2/i18n/wallet/fund/?advertiser_id=${adv.advertiser_id}`, axiosConfig);
                        if (balanceResp.data && balanceResp.data.data) {
                            balance = balanceResp.data.data.valid_cash_balance || balanceResp.data.data.balance || '0.00';
                        }
                    } catch (bErr) {}
                }

                const accIndex = this.accounts.findIndex(a => a.email.toLowerCase() === (email || '').toLowerCase());
                if (accIndex >= 0) {
                    this.accounts[accIndex].status = 'Active';
                    this.accounts[accIndex].balance = balance;
                    this.accounts[accIndex].currency = currency;
                    this.accounts[accIndex].lastChecked = new Date().toISOString();
                    this._saveLocalAccounts();
                }

                res.json({
                    success: true,
                    status: accountStatus,
                    name: advName,
                    balance: balance,
                    currency: currency,
                    advertisersCount: advertisers.length,
                    advertisers: advertisers.map(a => ({
                        id: a.advertiser_id,
                        name: a.advertiser_name,
                        status: a.status,
                        currency: a.currency
                    }))
                });

            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 7. Lấy danh sách Business Center (BC) của tài khoản (Tự động quét từ TikTok)
        this.app.post('/api/tiktok/bcs', async (req, res) => {
            const { email, cookie } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });

            const acc = await this.findAccount(email);
            const accIndex = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
            let currentBcs = acc && acc.businessCenters ? acc.businessCenters : [];

            const forceScan = req.query.force === 'true' || req.body.force === true;

            // Nếu đã có dữ liệu và không yêu cầu quét lại thì trả về ngay
            if (currentBcs.length > 0 && !forceScan) {
                return res.json({ success: true, businessCenters: currentBcs, source: 'cache' });
            }

            // TỰ ĐỘNG QUÉT BẰNG TRÌNH DUYỆT SELENIUM
            if (this.seleniumService) {
                try {
                    const scanRes = await this.seleniumService.scanAccountBCs(
                        email,
                        acc ? acc.password : '',
                        acc ? acc.secret : '',
                        acc ? (acc.mailPass || acc.password) : ''
                    );
                    if (scanRes && scanRes.success && Array.isArray(scanRes.businessCenters) && scanRes.businessCenters.length > 0) {
                        currentBcs = scanRes.businessCenters;
                        if (accIndex >= 0) {
                            this.accounts[accIndex].businessCenters = currentBcs;
                            this._saveLocalAccounts();
                        }
                        return res.json({ success: true, businessCenters: currentBcs, source: 'auto_scan' });
                    }
                } catch (scanErr) {
                    console.error('Lỗi scanAccountBCs:', scanErr.message);
                }
            }

            // Dự phòng: Tìm Cookie trong cacheService và gọi API trực tiếp
            let targetCookie = cookie;
            if (!targetCookie && this.cacheService) {
                try {
                    const savedCookies = await this.cacheService.loadCookies(email);
                    if (savedCookies && Array.isArray(savedCookies)) {
                        targetCookie = savedCookies.map(c => `${c.name}=${c.value}`).join('; ');
                    }
                } catch (e) {}
            }

            if (targetCookie) {
                try {
                    const headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                        'Cookie': targetCookie,
                        'Accept': 'application/json, text/plain, */*',
                        'Referer': 'https://ads.tiktok.com/i18n/home'
                    };

                    const resp = await axios.get('https://ads.tiktok.com/api/v2/i18n/user/info/', {
                        headers,
                        timeout: 9000,
                        validateStatus: () => true
                    });

                    if (resp.status === 200 && resp.data && resp.data.code === 0 && resp.data.data) {
                        const d = resp.data.data;
                        const rawBcs = d.business_centers || d.bc_list || d.org_list || [];
                        
                        if (rawBcs.length > 0) {
                            currentBcs = rawBcs.map(b => ({
                                id: b.bc_id || b.id || b.org_id,
                                name: b.bc_name || b.name || b.org_name || 'Business Center',
                                advCount: b.adv_cnt !== undefined ? b.adv_cnt : (b.adv_count || 0),
                                memberCount: b.member_cnt !== undefined ? b.member_cnt : (b.member_count || 0),
                                status: b.status || 'Active'
                            }));

                            if (accIndex >= 0) {
                                this.accounts[accIndex].businessCenters = currentBcs;
                                this._saveLocalAccounts();
                            }

                            return res.json({ success: true, businessCenters: currentBcs, source: 'live_api' });
                        }
                    }
                } catch (apiErr) {
                    console.error('Lỗi gọi TikTok user/info:', apiErr.message);
                }
            }

            // Trả về danh sách BC đã lưu (nếu có) hoặc thông báo
            res.json({
                success: true,
                businessCenters: currentBcs,
                hasCookie: !!targetCookie,
                message: currentBcs.length > 0 ? '' : 'Đã quét xong nhưng tài khoản chưa có Business Center nào, hoặc Cookie phiên đăng nhập đã hết hạn.'
            });
        });

        // 7.1 Thêm / Sửa thủ công Business Center cho tài khoản
        this.app.post('/api/tiktok/bcs/save', (req, res) => {
            const { email, businessCenters } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Thiếu email' });

            const accIndex = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
            if (accIndex >= 0) {
                this.accounts[accIndex].businessCenters = businessCenters || [];
                this._saveLocalAccounts();
                return res.json({ success: true, businessCenters: this.accounts[accIndex].businessCenters });
            }
            res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
        });

        // 7.2 Lưu / Cập nhật danh sách thành viên (Members) của Business Center
        this.app.post('/api/tiktok/bc/members', (req, res) => {
            const { email, bcId, members } = req.body;
            if (!email || !bcId) return res.status(400).json({ success: false, error: 'Thiếu email hoặc bcId' });

            const accIndex = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
            if (accIndex >= 0) {
                const bcs = this.accounts[accIndex].businessCenters || [];
                const bc = bcs.find(b => String(b.id) === String(bcId));
                if (bc) {
                    bc.members = members || [];
                    bc.memberCount = bc.members.length;
                    this._saveLocalAccounts();
                    return res.json({ success: true, members: bc.members, memberCount: bc.memberCount });
                }
                return res.status(404).json({ success: false, error: 'Không tìm thấy Business Center' });
            }
            res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
        });

        // 7.3 Quét trực tiếp nội dung Tab BC từ Chrome PC (vào tab nào quét tab đó)
        this.app.post('/api/tiktok/bc/scan-tab', async (req, res) => {
            const { email, bcId, tab } = req.body;
            if (!email || !bcId || !tab) {
                return res.status(400).json({ success: false, error: 'Thiếu thông tin (email, bcId, tab)' });
            }

            const accIndex = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
            const acc = accIndex >= 0 ? this.accounts[accIndex] : null;

            if (!this.seleniumService) {
                return res.status(500).json({ success: false, error: 'SeleniumService chưa sẵn sàng' });
            }

            try {
                const scanRes = await this.seleniumService.scanBCTab(
                    email,
                    bcId,
                    tab,
                    {
                        password: acc ? acc.password : '',
                        secret: acc ? acc.secret : '',
                        mailPass: acc ? (acc.mailPass || acc.password) : ''
                    }
                );

                if (scanRes && scanRes.success && scanRes.data) {
                    if (accIndex >= 0) {
                        const bcs = this.accounts[accIndex].businessCenters || [];
                        const bc = bcs.find(b => String(b.id) === String(bcId));
                        if (bc) {
                            if (tab === 'members' && Array.isArray(scanRes.data) && scanRes.data.length > 0) {
                                bc.members = scanRes.data;
                                bc.memberCount = bc.members.length;
                            } else if (tab === 'adv' && Array.isArray(scanRes.data) && scanRes.data.length > 0) {
                                bc.advAccounts = scanRes.data;
                                bc.advCount = bc.advAccounts.length;
                            } else if (tab === 'payment' && scanRes.data) {
                                bc.paymentInfo = scanRes.data;
                            }
                            this._saveLocalAccounts();
                        }
                    }
                    return res.json({ success: true, tab, data: scanRes.data });
                }

                return res.json({ success: false, error: (scanRes && scanRes.error) || 'Không quét được dữ liệu từ trang này' });
            } catch (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
        });



        // 8. Lấy danh sách chiến dịch (Campaigns)

        this.app.post('/api/tiktok/campaigns', async (req, res) => {
            const { email, advertiserId, cookie } = req.body;
            let targetCookie = cookie;
            if (!targetCookie && this.cacheService && email) {
                try {
                    const savedCookies = await this.cacheService.loadCookies(email);
                    if (savedCookies && Array.isArray(savedCookies)) {
                        targetCookie = savedCookies.map(c => `${c.name}=${c.value}`).join('; ');
                    }
                } catch (e) {}
            }

            if (!targetCookie) {
                return res.json({
                    success: false,
                    message: 'Cần có Cookie để truy vấn danh sách chiến dịch.'
                });
            }

            try {
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                    'Cookie': targetCookie,
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': `https://ads.tiktok.com/i18n/campaign?a_id=${advertiserId || ''}`
                };

                const url = `https://ads.tiktok.com/api/v2/i18n/campaign/list/?advertiser_id=${advertiserId || ''}&page=1&page_size=20`;
                const resp = await axios.get(url, { headers, timeout: 10000, validateStatus: () => true });

                if (resp.data && resp.data.data && resp.data.data.list) {
                    const campaigns = resp.data.data.list.map(c => ({
                        id: c.campaign_id,
                        name: c.campaign_name,
                        status: c.operation_status === 'ENABLE' || c.status === 'ACTIVE' ? 'ON' : 'OFF',
                        budget: c.budget,
                        budgetMode: c.budget_mode,
                        objective: c.objective_type,
                        todaySpend: c.today_stat ? c.today_stat.spend : '0.00'
                    }));

                    return res.json({ success: true, campaigns });
                }

                res.json({
                    success: true,
                    campaigns: []
                });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 9. Bật/Tắt chiến dịch nhanh
        this.app.post('/api/tiktok/toggle-campaign', async (req, res) => {
            const { email, campaignId, newStatus, advertiserId, cookie } = req.body;
            let targetCookie = cookie;
            if (!targetCookie && this.cacheService && email) {
                try {
                    const savedCookies = await this.cacheService.loadCookies(email);
                    if (savedCookies && Array.isArray(savedCookies)) {
                        targetCookie = savedCookies.map(c => `${c.name}=${c.value}`).join('; ');
                    }
                } catch (e) {}
            }

            try {
                if (targetCookie) {
                    const headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Cookie': targetCookie,
                        'Content-Type': 'application/json'
                    };
                    const payload = {
                        advertiser_id: advertiserId,
                        campaign_ids: [campaignId],
                        opt_status: newStatus === 'ON' ? 'ENABLE' : 'DISABLE'
                    };
                    await axios.post('https://ads.tiktok.com/api/v2/i18n/campaign/status/', payload, { headers, timeout: 8000, validateStatus: () => true });
                }

                res.json({
                    success: true,
                    campaignId,
                    status: newStatus,
                    message: `Đã ${newStatus === 'ON' ? 'BẬT' : 'TẮT'} chiến dịch thành công!`
                });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
    }

    start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, '0.0.0.0', () => {
                    this.isRunning = true;
                    const ips = this.getLocalIPs();
                    console.log(`[MobileServer] Đang chạy tại port ${this.port}`);
                    ips.forEach(ip => console.log(`  -> http://${ip}:${this.port}`));
                    resolve({
                        port: this.port,
                        ips
                    });
                });

                this.server.on('error', (err) => {
                    this.isRunning = false;
                    reject(err);
                });
            } catch (e) {
                this.isRunning = false;
                reject(e);
            }
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this._cleanupTimer) {
                clearInterval(this._cleanupTimer);
                this._cleanupTimer = null;
            }
            if (this.server) {
                this.server.close(() => {
                    this.isRunning = false;
                    console.log('[MobileServer] Đã dừng server.');
                    resolve(true);
                });
            } else {
                this.isRunning = false;
                resolve(true);
            }
        });
    }
}

// Cho phép chạy standalone từ terminal: node mobile/server.js
if (require.main === module) {
    const server = new MobileServer({ port: process.env.PORT || 3888 });
    server.start().then(info => {
        console.log('Mobile Server đã sẵn sàng. Hãy mở trên điện thoại cùng mạng Wi-Fi.');
    }).catch(err => {
        console.error('Không khởi động được server:', err);
    });
}

module.exports = MobileServer;
