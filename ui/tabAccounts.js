// Tab Accounts Manager - Unified Mail.tm & Outlook Management
class TabAccounts {
    constructor() {
        this.mailtmAccounts = [];
        this.outlookAccounts = [];
        this.currentFilter = 'all'; // 'all', 'mailtm', 'outlook'
        this.selectedAccount = null; // { type: 'mailtm'|'outlook', originalIndex: number }

        this.messages = [];
        this.selectedMessageId = null;
        this.currentToken = null; // Mail.tm
        this.accessToken = null;  // Outlook
        this.inboxInterval = null;
        this.smartPlusEnabled = true;

        // DOM Elements
        this.listContainer = document.getElementById('accounts-list');
        this.countLabel = document.getElementById('accounts-count');
        this.quickPasteInput = document.getElementById('acc-quick-paste');

        // Filter buttons
        this.filterAllBtn = document.getElementById('filter-all');
        this.filterMailtmBtn = document.getElementById('filter-mailtm');
        this.filterOutlookBtn = document.getElementById('filter-outlook');

        // Info Fields
        this.infoField1 = document.getElementById('acc-info-field1');
        this.infoField2 = document.getElementById('acc-info-field2');
        this.infoField3 = document.getElementById('acc-info-field3');
        this.infoField4 = document.getElementById('acc-info-field4');
        this.lblField1 = document.getElementById('acc-lbl-field1');
        this.lblField2 = document.getElementById('acc-lbl-field2');
        this.lblField3 = document.getElementById('acc-lbl-field3');
        this.lblField4 = document.getElementById('acc-lbl-field4');

        // Readers & Inbox
        this.inboxListContainer = document.getElementById('accounts-inbox-list');
        this.htmlReader = document.getElementById('email-html-content');
        this.textReader = document.getElementById('outlook-text-content');
        this.readerEmpty = document.getElementById('mail-reader-empty');

        // Browser tracking state
        this.activeBrowserEmails = new Set();
        this.browserStatusBadge = document.getElementById('acc-browser-status');
    }

    async init() {
        // Tải dữ liệu từ cache
        this.mailtmAccounts = await window.electronAPI.loadMailtmAccounts() || [];
        this.outlookAccounts = await window.electronAPI.loadOutlookAccounts() || [];

        // Tải cấu hình Smart+
        try {
            const settings = await window.electronAPI.loadSettings() || {};
            this.smartPlusEnabled = settings.bypassSmartPlus !== false;
            this.updateSmartPlusUI();
        } catch (e) {}

        this.setFilter('all');

        // Tự động chọn tài khoản đầu tiên nếu có
        const list = this.getFilteredAccounts();
        if (list.length > 0) {
            this.selectAccount(list[0].type, list[0].originalIndex);
        }

        // Bắt đầu theo dõi các phiên trình duyệt đang bật
        this.checkActiveBrowsers();
        setInterval(() => this.checkActiveBrowsers(), 2000);

        if (window.electronAPI && window.electronAPI.onAutomationProgress) {
            window.electronAPI.onAutomationProgress(() => {
                this.checkActiveBrowsers();
            });
        }
    }

    async checkActiveBrowsers() {
        if (!window.electronAPI || !window.electronAPI.getActiveBrowsers) return;
        try {
            const activeList = await window.electronAPI.getActiveBrowsers();
            const newSet = new Set((activeList || []).map(e => (e || '').toLowerCase()));
            let changed = newSet.size !== this.activeBrowserEmails.size;
            if (!changed) {
                for (const e of newSet) {
                    if (!this.activeBrowserEmails.has(e)) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) {
                this.activeBrowserEmails = newSet;
                this.renderAccounts();
                this.updateBrowserStatusBadge();
            }
        } catch (e) {}
    }

    updateBrowserStatusBadge() {
        if (!this.browserStatusBadge) return;
        if (!this.selectedAccount) {
            this.browserStatusBadge.classList.add('hidden');
            this.browserStatusBadge.classList.remove('flex');
            return;
        }
        const acc = this.selectedAccount.type === 'mailtm' 
            ? this.mailtmAccounts[this.selectedAccount.originalIndex] 
            : this.outlookAccounts[this.selectedAccount.originalIndex];
        if (!acc) {
            this.browserStatusBadge.classList.add('hidden');
            this.browserStatusBadge.classList.remove('flex');
            return;
        }
        const emailKey = (acc.email || '').toLowerCase();
        const userKey = (acc.user_tt || '').toLowerCase();
        const isBrowserActive = (emailKey && this.activeBrowserEmails.has(emailKey)) || 
                                (userKey && this.activeBrowserEmails.has(userKey));
        if (isBrowserActive) {
            this.browserStatusBadge.classList.remove('hidden');
            this.browserStatusBadge.classList.add('flex');
        } else {
            this.browserStatusBadge.classList.add('hidden');
            this.browserStatusBadge.classList.remove('flex');
        }
    }

    getFilteredAccounts() {
        const list = [];
        if (this.currentFilter === 'all' || this.currentFilter === 'mailtm') {
            this.mailtmAccounts.forEach((acc, i) => {
                list.push({ type: 'mailtm', originalIndex: i, data: acc });
            });
        }
        if (this.currentFilter === 'all' || this.currentFilter === 'outlook') {
            this.outlookAccounts.forEach((acc, i) => {
                list.push({ type: 'outlook', originalIndex: i, data: acc });
            });
        }
        return list;
    }

    setFilter(filter) {
        this.currentFilter = filter;
        const activeClass = "flex-1 py-1 text-[11px] font-semibold rounded text-center transition bg-blue-600 text-white shadow-sm";
        const inactiveClass = "flex-1 py-1 text-[11px] font-semibold rounded text-center transition text-slate-400 hover:text-white";

        if (this.filterAllBtn) this.filterAllBtn.className = filter === 'all' ? activeClass : inactiveClass;
        if (this.filterMailtmBtn) this.filterMailtmBtn.className = filter === 'mailtm' ? activeClass : inactiveClass;
        if (this.filterOutlookBtn) this.filterOutlookBtn.className = filter === 'outlook' ? activeClass : inactiveClass;

        this.renderAccounts();
    }

    renderAccounts() {
        if (!this.listContainer) return;
        this.listContainer.innerHTML = '';
        const list = this.getFilteredAccounts();
        if (this.countLabel) this.countLabel.textContent = `Số lượng: ${list.length}`;

        if (list.length === 0) {
            this.listContainer.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">Chưa có tài khoản. Dán hoặc nạp file txt!</div>`;
            return;
        }

        list.forEach((itemObj, displayIndex) => {
            const acc = itemObj.data;
            const isSelected = this.selectedAccount && 
                               this.selectedAccount.type === itemObj.type && 
                               this.selectedAccount.originalIndex === itemObj.originalIndex;

            let statusBg = 'bg-slate-800/40 hover:bg-slate-800 border-cyber-border text-slate-300';
            if (acc.status === 'live') {
                statusBg = 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400';
            } else if (acc.status === 'die') {
                statusBg = 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-400';
            }

            if (isSelected) {
                statusBg = 'bg-blue-600/20 border-blue-500 text-white font-semibold shadow-sm shadow-blue-500/20';
            }

            const item = document.createElement('div');
            item.className = `px-2.5 py-1.5 rounded-md border cursor-pointer mb-1 transition-all duration-150 ${statusBg}`;
            item.onclick = () => this.selectAccount(itemObj.type, itemObj.originalIndex);

            // Kiểm tra trạng thái trình duyệt đang mở
            const emailKey = (acc.email || '').toLowerCase();
            const userKey = (acc.user_tt || '').toLowerCase();
            const isBrowserActive = (emailKey && this.activeBrowserEmails.has(emailKey)) || 
                                    (userKey && this.activeBrowserEmails.has(userKey));

            const browserIndicator = isBrowserActive 
                ? `<span class="relative flex h-2.5 w-2.5 mr-1.5 flex-shrink-0 items-center justify-center inline-flex" title="Trình duyệt đang bật">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                   </span>`
                : '';

            let badgeHtml = '';
            const liveVal = acc.liveCount !== undefined ? acc.liveCount : (acc.status === 'live' ? 1 : 0);
            const dieVal = acc.dieCount !== undefined ? acc.dieCount : (acc.status === 'die' ? 1 : 0);
            if (liveVal > 0) {
                badgeHtml += `<span class="bg-emerald-500 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center inline-block shadow-sm shadow-emerald-500/30 mr-1">${liveVal}</span>`;
            }
            if (dieVal > 0) {
                badgeHtml += `<span class="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center inline-block shadow-sm shadow-rose-500/30">${dieVal}</span>`;
            }

            const typeTag = this.currentFilter === 'all' 
                ? (itemObj.type === 'mailtm' 
                    ? `<span class="text-[9px] px-1 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold mr-1">TM</span>` 
                    : `<span class="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold mr-1">OUT</span>`) 
                : '';

            const userText = itemObj.type === 'mailtm' ? acc.email : (acc.user_tt || acc.email);
            const displayName = acc.note ? `<span class="text-blue-400 font-semibold mr-1.5">[${acc.note}]</span><span class="text-slate-200">${userText}</span>` : `<span class="text-slate-200 font-semibold">${userText}</span>`;

            item.innerHTML = `
                <div class="flex items-center justify-between w-full min-w-0">
                    <div class="truncate text-xs tracking-wide flex-1 mr-1.5 min-w-0 flex items-center account-display-name">
                        ${browserIndicator}
                        <span class="text-slate-400 font-mono mr-1">${displayIndex + 1}.</span>
                        ${typeTag}
                        <span class="truncate">${displayName}</span>
                    </div>
                    <div class="flex items-center space-x-1 flex-shrink-0">
                        ${badgeHtml}
                        <button onclick="event.stopPropagation(); window.tabAccounts.openRowMenu(event, '${itemObj.type}', ${itemObj.originalIndex})" 
                                class="text-slate-400 hover:text-white px-2 py-0.5 text-xs font-bold rounded bg-slate-800/40 hover:bg-slate-700/80 transition flex-shrink-0 leading-none" title="Tùy chọn">
                            ···
                        </button>
                    </div>
                </div>
            `;
            this.listContainer.appendChild(item);
        });
    }

    openRowMenu(event, type, originalIndex) {
        if (window.openAccountRowMenu) {
            window.openAccountRowMenu(event, type, originalIndex);
        }
    }

    async selectAccount(type, originalIndex) {
        this.selectedAccount = { type, originalIndex };
        const acc = type === 'mailtm' ? this.mailtmAccounts[originalIndex] : this.outlookAccounts[originalIndex];
        if (!acc) return;

        this.renderAccounts();
        this.updateBrowserStatusBadge();

        // Cập nhật nhãn và giá trị thông tin
        if (type === 'mailtm') {
            if (this.lblField1) this.lblField1.textContent = 'Email';
            if (this.lblField2) this.lblField2.textContent = 'Pass Mail';
            if (this.lblField3) this.lblField3.textContent = 'Pass TikTok';
            if (this.lblField4) this.lblField4.textContent = 'Mã 2FA';

            if (this.infoField1) this.infoField1.value = acc.email || '...';
            if (this.infoField2) this.infoField2.value = acc.password || '...';
            if (this.infoField3) this.infoField3.value = acc.pass2 || acc.password || '...';
            if (this.infoField4) this.infoField4.value = '...';

            this.generateOTP(acc['2fa_secret']);
        } else {
            if (this.lblField1) this.lblField1.textContent = 'User / Mail';
            if (this.lblField2) this.lblField2.textContent = 'Email Outlook';
            if (this.lblField3) this.lblField3.textContent = 'Pass TikTok';
            if (this.lblField4) this.lblField4.textContent = 'Pass Outlook';

            if (this.infoField1) this.infoField1.value = acc.user_tt || acc.email || '...';
            if (this.infoField2) this.infoField2.value = acc.email || '...';
            if (this.infoField3) this.infoField3.value = acc.pass_tt || '...';
            if (this.infoField4) this.infoField4.value = acc.pass_mail || '...';

            if (acc['2fa_secret']) {
                this.generateOTP(acc['2fa_secret']);
            }
        }

        // Reset hộp thư và reader
        this.messages = [];
        this.selectedMessageId = null;
        this.currentToken = null;
        this.accessToken = null;
        this.renderInbox();
        this.clearReader();

        if (this.inboxInterval) clearInterval(this.inboxInterval);

        if (type === 'mailtm') {
            showStatus(`Đang kết nối API Mail.tm cho: ${acc.email}...`);
            await this.fetchMailtmInbox(acc.email, acc.password);
            this.inboxInterval = setInterval(() => {
                this.fetchMailtmInbox(acc.email, acc.password);
            }, 5000);
        } else {
            if (acc.type === 'oauth') {
                showStatus(`Đang đăng nhập API Outlook OAuth: ${acc.email}...`);
                let clientId = acc.client_id;
                if (!clientId) {
                    const settings = await window.electronAPI.loadSettings() || {};
                    clientId = settings.defaultClientId;
                }
                if (clientId && acc.refresh_token) {
                    const token = await window.electronAPI.loginOAuth(clientId, acc.refresh_token);
                    if (token) {
                        this.accessToken = token;
                        acc.status = 'live';
                        this.saveOutlook();
                        this.renderAccounts();
                        await this.fetchOutlookEmails();
                        this.inboxInterval = setInterval(() => {
                            this.fetchOutlookEmails();
                        }, 5000);
                    }
                }
            } else {
                showStatus(`Đã chọn: ${acc.email} (Yêu cầu mở trình duyệt để đọc mail)`);
            }
        }
    }

    generateOTP(secret) {
        if (!secret) {
            if (this.infoField4 && this.selectedAccount?.type === 'mailtm') this.infoField4.value = '';
            return;
        }
        try {
            const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
            window.electronAPI.generateTOTP(cleanSecret).then(code => {
                if (this.infoField4 && this.selectedAccount?.type === 'mailtm') {
                    this.infoField4.value = code || 'Lỗi';
                }
            });
        } catch(e) {
            if (this.infoField4 && this.selectedAccount?.type === 'mailtm') this.infoField4.value = 'Lỗi Key';
        }
    }

    async fetchMailtmInbox(email, password) {
        try {
            const session = axios.create({ baseURL: 'https://api.mail.tm' });
            if (!this.currentToken) {
                const tokenResp = await session.post('/token', { address: email, password: password });
                if (tokenResp.data && tokenResp.data.token) {
                    this.currentToken = tokenResp.data.token;
                }
            }
            if (this.currentToken) {
                const headers = { Authorization: `Bearer ${this.currentToken}` };
                const msgsResp = await session.get('/messages', { headers, params: { page: 1, itemsPerPage: 100 } });
                const newMessages = msgsResp.data['hydra:member'] || [];
                if (JSON.stringify(newMessages) !== JSON.stringify(this.messages)) {
                    this.messages = newMessages;
                    this.renderInbox();
                }
                showStatus(`Đã đồng bộ hộp thư Mail.tm lúc: ${new Date().toLocaleTimeString()}`);
            }
        } catch (e) {}
    }

    async fetchOutlookEmails() {
        if (!this.accessToken) return;
        try {
            const data = await window.electronAPI.fetchEmails(this.accessToken);
            if (data && data.value) {
                const newMessages = data.value.map(msg => ({
                    id: msg.id,
                    from: { address: msg.from?.emailAddress?.address || 'Chưa rõ' },
                    subject: msg.subject || '(Không có tiêu đề)',
                    createdAt: msg.receivedDateTime,
                    body: msg.body?.content || ''
                }));
                if (JSON.stringify(newMessages) !== JSON.stringify(this.messages)) {
                    this.messages = newMessages;
                    this.renderInbox();
                }
            }
        } catch (e) {}
    }

    renderInbox() {
        if (!this.inboxListContainer) return;
        this.inboxListContainer.innerHTML = '';
        if (this.messages.length === 0) {
            this.inboxListContainer.innerHTML = `<div class="text-center py-12 text-slate-500 text-xs">Hộp thư trống.</div>`;
            return;
        }

        this.messages.forEach(msg => {
            const isSelected = this.selectedMessageId === msg.id;
            let highlightClass = 'bg-slate-900/40 hover:bg-slate-800 border-cyber-border text-slate-300';
            if (isSelected) {
                highlightClass = 'bg-blue-600/20 border-blue-500/50 text-white font-semibold shadow-sm';
            } else {
                const sub = (msg.subject || '').toLowerCase();
                if (sub.includes('chấm dứt') || sub.includes('suspended')) {
                    highlightClass = 'bg-rose-500/10 border-rose-500/30 text-rose-300';
                } else if (sub.includes('lifted') || sub.includes('hết bị') || sub.includes('good news')) {
                    highlightClass = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300';
                }
            }

            const formattedDate = msg.createdAt ? msg.createdAt.slice(0, 19).replace('T', ' ') : '';
            const fromAddr = msg.from ? (msg.from.address || 'Chưa rõ') : 'Chưa rõ';

            const item = document.createElement('div');
            item.className = `px-2.5 py-1.5 rounded-md border cursor-pointer mb-1 transition ${highlightClass}`;
            item.onclick = () => this.selectEmail(msg.id);

            item.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[11px] font-bold text-slate-400 truncate w-3/5">${fromAddr}</span>
                    <span class="text-[9px] text-slate-500">${formattedDate}</span>
                </div>
                <div class="text-xs font-semibold truncate text-slate-200">${msg.subject}</div>
            `;
            this.inboxListContainer.appendChild(item);
        });
    }

    async selectEmail(msgId) {
        this.selectedMessageId = msgId;
        this.renderInbox();
        if (this.readerEmpty) this.readerEmpty.classList.add('hidden');

        if (this.selectedAccount?.type === 'mailtm') {
            if (this.textReader) this.textReader.classList.add('hidden');
            if (this.htmlReader) {
                this.htmlReader.classList.remove('hidden');
                this.htmlReader.srcdoc = `<html><body style="font-family:sans-serif;font-size:12px;padding:20px;color:#94a3b8;">Đang tải nội dung thư...</body></html>`;
            }

            try {
                const session = axios.create({ baseURL: 'https://api.mail.tm' });
                const headers = { Authorization: `Bearer ${this.currentToken}` };
                const resp = await session.get(`/messages/${msgId}`, { headers });
                if (resp.status === 200) {
                    const data = resp.data;
                    let htmlStr = '';
                    if (data.html) htmlStr = Array.isArray(data.html) ? data.html[0] : data.html;
                    if (!htmlStr && (data.text || data.intro)) {
                        htmlStr = `<html><body style="font-family:sans-serif;font-size:12px;padding:20px;white-space:pre-wrap;line-height:1.6;color:#334155;">${data.text || data.intro}</body></html>`;
                    }
                    if (htmlStr && this.htmlReader) this.htmlReader.srcdoc = htmlStr;
                }
            } catch (e) {}
        } else {
            // Outlook email text/html
            const msg = this.messages.find(m => m.id === msgId);
            if (msg) {
                if (this.htmlReader) {
                    this.htmlReader.classList.remove('hidden');
                    this.htmlReader.srcdoc = msg.body || `<html><body>${msg.subject}</body></html>`;
                }
                if (this.textReader) this.textReader.classList.add('hidden');
            }
        }
    }

    clearReader() {
        if (this.htmlReader) {
            this.htmlReader.srcdoc = '';
            this.htmlReader.classList.add('hidden');
        }
        if (this.textReader) {
            this.textReader.textContent = '';
            this.textReader.classList.add('hidden');
        }
        if (this.readerEmpty) this.readerEmpty.classList.remove('hidden');
    }

    // THÊM TÀI KHOẢN NHANH QUA Ô INPUT
    quickAdd() {
        const raw = this.quickPasteInput ? this.quickPasteInput.value.trim() : '';
        if (!raw) return;

        const parts = raw.split('|').map(p => p.trim());
        if (parts.length < 2) {
            showToast("Định dạng: Mail|Pass hoặc Mail|Pass|2FA|PassTT");
            return;
        }

        // Tự động phân loại: nếu đang chọn tab Outlook hoặc có >= 4 phần hoặc domain outlook
        const isOutlook = this.currentFilter === 'outlook' || parts.length >= 4 || parts[0].toLowerCase().includes('outlook') || parts[0].toLowerCase().includes('hotmail');

        if (isOutlook) {
            const acc = {
                user_tt: parts[0],
                email: parts[1] || parts[0],
                pass_tt: parts[2] || parts[1],
                pass_mail: parts[3] || parts[2] || parts[1],
                "2fa_secret": parts[4] || '',
                type: 'basic',
                status: 'normal'
            };
            this.outlookAccounts.unshift(acc);
            this.saveOutlook();
            this.setFilter(this.currentFilter === 'all' ? 'all' : 'outlook');
            this.selectAccount('outlook', 0);
            showToast("Đã thêm tài khoản Outlook thành công!");
        } else {
            let code_2fa = '';
            let pass2 = parts[1];
            if (parts.length >= 3) {
                if (parts[2].length >= 16) code_2fa = parts[2];
                else pass2 = parts[2];
            }
            if (parts.length >= 4 && parts[3].length >= 16) {
                code_2fa = parts[3];
            }
            const acc = {
                email: parts[0],
                password: parts[1],
                pass2: pass2,
                "2fa_secret": code_2fa,
                status: 'normal'
            };
            this.mailtmAccounts.unshift(acc);
            this.saveMailtm();
            this.setFilter(this.currentFilter === 'all' ? 'all' : 'mailtm');
            this.selectAccount('mailtm', 0);
            showToast("Đã thêm tài khoản Mail.tm thành công!");
        }
        if (this.quickPasteInput) this.quickPasteInput.value = '';
    }

    // MỞ FILE TXT NẠP TÀI KHOẢN
    async openFile(type) {
        const fileContent = await window.electronAPI.openFileDialog();
        if (!fileContent) return;

        const lines = fileContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        let count = 0;

        if (type === 'mailtm') {
            lines.forEach(line => {
                const parts = line.split('|').map(s => s.trim());
                if (parts.length >= 2) {
                    const email = parts[0];
                    if (!this.mailtmAccounts.some(a => a.email.toLowerCase() === email.toLowerCase())) {
                        this.mailtmAccounts.push({
                            email: parts[0],
                            password: parts[1],
                            pass2: parts[2] || parts[1],
                            "2fa_secret": (parts[3] && parts[3].length >= 16) ? parts[3] : ((parts[2] && parts[2].length >= 16) ? parts[2] : ''),
                            status: 'normal'
                        });
                        count++;
                    }
                }
            });
            this.saveMailtm();
            showToast(`Đã nạp ${count} tài khoản Mail.tm từ file!`);
        } else {
            lines.forEach(line => {
                const parts = line.split('|').map(s => s.trim());
                if (parts.length >= 2) {
                    this.outlookAccounts.push({
                        user_tt: parts[0],
                        email: parts[1] || parts[0],
                        pass_tt: parts[2] || parts[1],
                        pass_mail: parts[3] || parts[2] || parts[1],
                        type: 'basic',
                        status: 'normal'
                    });
                    count++;
                }
            });
            this.saveOutlook();
            showToast(`Đã nạp ${count} tài khoản Outlook từ file!`);
        }

        this.renderAccounts();
    }

    // CHECK KHÁNG HÀNG LOẠT (MAIL.TM)
    async checkLive() {
        if (this.mailtmAccounts.length === 0) {
            showToast("Không có tài khoản Mail.tm nào để quét kháng!");
            return;
        }
        showStatus("Đang kiểm tra trạng thái kháng tài khoản Mail.tm...");
        const session = axios.create({ baseURL: 'https://api.mail.tm' });

        for (let acc of this.mailtmAccounts) {
            try {
                const tokenResp = await session.post('/token', { address: acc.email, password: acc.password }, { timeout: 8000 });
                if (tokenResp.data && tokenResp.data.token) {
                    const token = tokenResp.data.token;
                    const headers = { Authorization: `Bearer ${token}` };
                    const msgsResp = await session.get('/messages', { headers, params: { page: 1, itemsPerPage: 100 } });
                    const msgs = msgsResp.data['hydra:member'] || [];
                    
                    let liveCount = 0;
                    let dieCount = 0;
                    for (let m of msgs) {
                        const sub = (m.subject || '').toLowerCase();
                        if (sub.includes('lifted') || sub.includes('hết bị tạm ngưng') || sub.includes('good news')) liveCount++;
                        else if (sub.includes('suspended') || sub.includes('tạm ngưng') || sub.includes('chấm dứt')) dieCount++;
                    }
                    acc.liveCount = liveCount;
                    acc.dieCount = dieCount;
                    acc.status = liveCount > 0 ? 'live' : (dieCount > 0 ? 'die' : 'normal');
                } else {
                    acc.status = 'die';
                }
            } catch (e) {
                acc.status = 'die';
            }
            this.renderAccounts();
        }
        this.saveMailtm();
        showStatus("Đã hoàn tất kiểm tra kháng!");
        showToast("Đã quét kháng xong toàn bộ tài khoản!");
    }

    // XÓA TÀI KHOẢN
    deleteAccount(type, originalIndex) {
        const list = type === 'mailtm' ? this.mailtmAccounts : this.outlookAccounts;
        const target = list[originalIndex];
        if (!target) return;

        const name = type === 'mailtm' ? target.email : (target.user_tt || target.email);
        if (confirm(`Bạn có chắc chắn muốn xóa tài khoản ${name}?`)) {
            list.splice(originalIndex, 1);
            if (type === 'mailtm') this.saveMailtm();
            else this.saveOutlook();

            if (this.selectedAccount && this.selectedAccount.type === type && this.selectedAccount.originalIndex === originalIndex) {
                this.selectedAccount = null;
                this.clearReader();
                if (this.inboxInterval) clearInterval(this.inboxInterval);
            }
            this.renderAccounts();
            showToast("Đã xóa tài khoản!");
        }
    }

    // XÓA TOÀN BỘ DANH SÁCH
    clearAll() {
        const msg = this.currentFilter === 'mailtm' ? "toàn bộ tài khoản Mail.tm" :
                    (this.currentFilter === 'outlook' ? "toàn bộ tài khoản Outlook" : "TẤT CẢ tài khoản");
        if (confirm(`Bạn có chắc chắn muốn xóa ${msg}?`)) {
            if (this.currentFilter === 'mailtm' || this.currentFilter === 'all') {
                this.mailtmAccounts = [];
                this.saveMailtm();
            }
            if (this.currentFilter === 'outlook' || this.currentFilter === 'all') {
                this.outlookAccounts = [];
                this.saveOutlook();
            }
            this.selectedAccount = null;
            this.clearReader();
            if (this.inboxInterval) clearInterval(this.inboxInterval);
            this.renderAccounts();
            showToast("Đã xóa sạch tài khoản!");
        }
    }

    // CHẠY SELENIUM ĐĂNG NHẬP ADS
    runSelenium() {
        if (!this.selectedAccount) {
            showToast("Vui lòng chọn tài khoản từ danh sách trước!");
            return;
        }
        const { type, originalIndex } = this.selectedAccount;
        if (type === 'mailtm') {
            const acc = this.mailtmAccounts[originalIndex];
            if (acc && acc.email) this.activeBrowserEmails.add(acc.email.toLowerCase());
            this.renderAccounts();
            this.updateBrowserStatusBadge();
            showStatus(`Bắt đầu đăng nhập TikTok Ads cho: ${acc.email}...`);
            window.electronAPI.loginTikTokAds(acc.email, acc.pass2 || acc.password, acc.password);
        } else {
            const acc = this.outlookAccounts[originalIndex];
            if (acc && acc.email) this.activeBrowserEmails.add(acc.email.toLowerCase());
            if (acc && acc.user_tt) this.activeBrowserEmails.add(acc.user_tt.toLowerCase());
            this.renderAccounts();
            this.updateBrowserStatusBadge();
            showStatus(`Mở Chrome đăng nhập cho: ${acc.email}...`);
            window.electronAPI.loginOutlookBrowser(acc.email, acc.pass_mail, acc['2fa_secret'] || '');
        }
    }

    refreshInbox() {
        if (this.selectedAccount) {
            this.selectAccount(this.selectedAccount.type, this.selectedAccount.originalIndex);
        }
    }

    saveMailtm() {
        window.electronAPI.saveMailtmAccounts(this.mailtmAccounts);
    }

    saveOutlook() {
        window.electronAPI.saveOutlookAccounts(this.outlookAccounts);
    }

    updateSmartPlusUI() {
        const btn = document.getElementById('acc-btn-smartplus');
        const status = document.getElementById('acc-smartplus-status');
        if (!btn || !status) return;
        if (this.smartPlusEnabled) {
            btn.className = "px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider transition border bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30";
            status.textContent = "BẬT";
        } else {
            btn.className = "px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider transition border bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700";
            status.textContent = "TẮT";
        }
    }

    async toggleSmartPlus() {
        this.smartPlusEnabled = !this.smartPlusEnabled;
        this.updateSmartPlusUI();
        try {
            const settings = await window.electronAPI.loadSettings() || {};
            settings.bypassSmartPlus = this.smartPlusEnabled;
            await window.electronAPI.saveSettings(settings);
        } catch (e) {}

        if (this.selectedAccount) {
            const acc = this.selectedAccount.type === 'mailtm' 
                ? this.mailtmAccounts[this.selectedAccount.originalIndex] 
                : this.outlookAccounts[this.selectedAccount.originalIndex];
            try {
                const res = await window.electronAPI.toggleSmartPlus(acc.email, this.smartPlusEnabled);
                if (res && res.success) {
                    showToast(this.smartPlusEnabled ? "Đã BẬT Bypass TikTok Smart+ trên trình duyệt!" : "Đã TẮT Bypass TikTok Smart+ trên trình duyệt!");
                    return;
                }
            } catch (e) {}
        }
        showToast(this.smartPlusEnabled ? "Đã BẬT chế độ Bypass Smart+ (Chiến dịch thủ công)" : "Đã TẮT chế độ Bypass Smart+");
    }

    openEditModal(type = null, index = null) {
        const targetType = type || this.selectedAccount?.type;
        const targetIndex = index !== null ? index : this.selectedAccount?.originalIndex;
        if (!targetType || targetIndex === undefined || targetIndex === null) {
            showToast("Vui lòng chọn tài khoản cần sửa!");
            return;
        }
        currentEditContext = { tab: targetType, index: targetIndex };
        const acc = targetType === 'mailtm' ? this.mailtmAccounts[targetIndex] : this.outlookAccounts[targetIndex];
        if (!acc) return;

        if (targetType === 'mailtm') {
            document.getElementById('modal-edit-title').textContent = 'Chỉnh sửa tài khoản Mail.tm';
            document.getElementById('edit-lbl-field1').textContent = 'Email Mail.tm';
            document.getElementById('edit-input-field1').value = acc.email || '';
            document.getElementById('edit-lbl-field2').textContent = 'Mật khẩu Mail';
            document.getElementById('edit-input-field2').value = acc.password || '';
            document.getElementById('edit-lbl-field3').textContent = 'Mật khẩu TikTok';
            document.getElementById('edit-input-field3').value = acc.pass2 || acc.password || '';
            document.getElementById('edit-lbl-field4').textContent = 'Mã bí mật 2FA';
            document.getElementById('edit-input-field4').value = acc['2fa_secret'] || '';
        } else {
            document.getElementById('modal-edit-title').textContent = 'Chỉnh sửa tài khoản Outlook';
            document.getElementById('edit-lbl-field1').textContent = 'Username / TikTok';
            document.getElementById('edit-input-field1').value = acc.user_tt || acc.email || '';
            document.getElementById('edit-lbl-field2').textContent = 'Email Outlook';
            document.getElementById('edit-input-field2').value = acc.email || '';
            document.getElementById('edit-lbl-field3').textContent = 'Mật khẩu TikTok';
            document.getElementById('edit-input-field3').value = acc.pass_tt || '';
            document.getElementById('edit-lbl-field4').textContent = 'Mật khẩu Outlook';
            document.getElementById('edit-input-field4').value = acc.pass_mail || '';
        }
        document.getElementById('edit-quick-paste').value = '';
        document.getElementById('modal-edit-account').classList.remove('hidden');
    }

    toggleManageMenu(event) {
        event.stopPropagation();
        const menu = document.getElementById('accounts-manage-menu');
        if (!menu) return;
        if (!menu.classList.contains('hidden')) {
            menu.classList.add('hidden');
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.classList.remove('hidden');
    }
}

// Khởi tạo đối tượng toàn cục
window.tabAccounts = new TabAccounts();
