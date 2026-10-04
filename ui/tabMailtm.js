// Tab Mail.tm Manager
class TabMailtm {
    constructor() {
        this.accounts = [];
        this.selectedAccountIndex = null;
        this.currentToken = null;
        this.messages = [];
        this.selectedMessageId = null;
        this.inboxInterval = null;
        this.viewMode = 'text'; // 'text' or 'html'
        this.smartPlusEnabled = true;
        
        // DOM Elements
        this.listContainer = document.getElementById('mailtm-accounts-list');
        this.quickPasteInput = document.getElementById('mailtm-quick-paste');
        this.countLabel = document.getElementById('mailtm-count');
        this.inboxListContainer = document.getElementById('mailtm-inbox-list');
        this.htmlReader = document.getElementById('email-html-content');
        this.readerEmpty = document.getElementById('mail-reader-empty');
        
        // Info panel elements
        this.infoEmail = document.getElementById('mailtm-info-email');
        this.infoPass = document.getElementById('mailtm-info-pass');
        this.infoPass2 = document.getElementById('mailtm-info-pass2');
        this.info2FA = document.getElementById('mailtm-info-2fa');
        this.infoNote = document.getElementById('mailtm-info-note');
    }

    async init() {
        // Tải tài khoản từ cache
        this.accounts = await window.electronAPI.loadMailtmAccounts() || [];
        this.renderAccounts();
        
        // Tải cấu hình Smart+
        try {
            const settings = await window.electronAPI.loadSettings() || {};
            this.smartPlusEnabled = settings.bypassSmartPlus !== false;
            this.updateSmartPlusUI();
        } catch (e) {}

        // Đăng ký nhận thông báo tiến trình Selenium
        window.electronAPI.onAutomationProgress((msg) => {
            showStatus(msg);
        });

        // Gắn sự kiện ghi chú tự động lưu khi nhập
        if (this.infoNote) {
            this.infoNote.addEventListener('input', () => {
                if (this.selectedAccountIndex !== null) {
                    const noteVal = this.infoNote.value.trim();
                    this.accounts[this.selectedAccountIndex].note = noteVal;
                    this.saveAccounts();
                    
                    // Cập nhật text hiển thị trực tiếp ở danh sách tài khoản
                    const itemEl = document.getElementById(`mailtm-item-${this.selectedAccountIndex}`);
                    if (itemEl) {
                        const nameEl = itemEl.querySelector('.account-display-name');
                        if (nameEl) {
                            const email = this.accounts[this.selectedAccountIndex].email;
                            nameEl.innerHTML = noteVal ? `<span class="text-blue-400 font-semibold mr-1.5">[${noteVal}]</span><span class="text-slate-200">${email}</span>` : `<span class="text-slate-200 font-semibold">${email}</span>`;
                        }
                    }
                }
            });
        }
    }

    renderAccounts() {
        this.listContainer.innerHTML = '';
        this.countLabel.textContent = `Số lượng: ${this.accounts.length}`;

        if (this.accounts.length === 0) {
            this.listContainer.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">Chưa có tài khoản. Hãy nạp file txt!</div>`;
            return;
        }

        this.accounts.forEach((acc, index) => {
            const isSelected = this.selectedAccountIndex === index;
            
            // Xác định màu trạng thái
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
            item.id = `mailtm-item-${index}`;
            item.className = `px-2.5 py-1.5 rounded-md border cursor-pointer mb-1 transition-all duration-150 ${statusBg}`;
            item.onclick = () => this.selectAccount(index);

            let badgeHtml = '';
            const liveVal = acc.liveCount !== undefined ? acc.liveCount : (acc.status === 'live' ? 1 : 0);
            const dieVal = acc.dieCount !== undefined ? acc.dieCount : (acc.status === 'die' ? 1 : 0);
            
            if (liveVal > 0) {
                badgeHtml += `<span class="bg-emerald-500 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center inline-block shadow-sm shadow-emerald-500/30 mr-1">${liveVal}</span>`;
            }
            if (dieVal > 0) {
                badgeHtml += `<span class="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center inline-block shadow-sm shadow-rose-500/30">${dieVal}</span>`;
            }

            const displayName = acc.note ? `<span class="text-blue-400 font-semibold mr-1.5">[${acc.note}]</span><span class="text-slate-200">${acc.email}</span>` : `<span class="text-slate-200 font-semibold">${acc.email}</span>`;

            item.innerHTML = `
                <div class="flex items-center justify-between w-full min-w-0">
                    <div class="truncate text-xs tracking-wide flex-1 mr-1.5 min-w-0 account-display-name">
                        <span class="text-slate-400 font-mono mr-1">${index + 1}.</span>
                        ${displayName}
                    </div>
                    <div class="flex items-center space-x-1 flex-shrink-0">
                        ${badgeHtml}
                        <button onclick="event.stopPropagation(); window.tabMailtm.openRowMenu(event, ${index})" 
                                class="text-slate-400 hover:text-white px-2 py-0.5 text-xs font-bold rounded bg-slate-800/40 hover:bg-slate-700/80 transition flex-shrink-0 leading-none" title="Tùy chọn">
                            ···
                        </button>
                    </div>
                </div>
            `;
            this.listContainer.appendChild(item);
        });
    }

    openRowMenu(event, index) {
        if (window.openAccountRowMenu) {
            window.openAccountRowMenu(event, 'mailtm', index);
        }
    }

    openEditModal(index = null) {
        const targetIndex = index !== null ? index : this.selectedAccountIndex;
        if (targetIndex === null || !this.accounts[targetIndex]) {
            showToast('Vui lòng chọn tài khoản cần sửa!');
            return;
        }
        const acc = this.accounts[targetIndex];
        currentEditContext = { tab: 'mailtm', index: targetIndex };

        document.getElementById('modal-edit-title').textContent = 'Chỉnh sửa tài khoản Mail.tm';
        document.getElementById('edit-lbl-field1').textContent = 'Email Mail.tm';
        document.getElementById('edit-input-field1').value = acc.email || '';
        document.getElementById('edit-lbl-field2').textContent = 'Mật khẩu Mail';
        document.getElementById('edit-input-field2').value = acc.password || '';
        document.getElementById('edit-lbl-field3').textContent = 'Mật khẩu TikTok';
        document.getElementById('edit-input-field3').value = acc.pass2 || acc.password || '';
        document.getElementById('edit-lbl-field4').textContent = 'Mã bí mật 2FA';
        document.getElementById('edit-input-field4').value = acc['2fa_secret'] || '';
        document.getElementById('edit-quick-paste').value = '';

        document.getElementById('modal-edit-account').classList.remove('hidden');
    }

    async selectAccount(index) {
        this.selectedAccountIndex = index;
        const acc = this.accounts[index];
        this.renderAccounts();

        // Cập nhật thông tin chi tiết
        this.infoEmail.value = acc.email;
        this.infoPass.value = acc.password;
        this.infoPass2.value = acc.pass2 || acc.password;
        this.info2FA.value = '...';
        if (this.infoNote) this.infoNote.value = acc.note || '';

        // Tạo OTP tự động
        this.generateOTP(acc['2fa_secret']);

        // Reset hộp thư
        this.messages = [];
        this.selectedMessageId = null;
        this.currentToken = null;
        this.renderInbox();
        this.clearReader();

        // Dừng vòng lặp cũ và chạy vòng lặp mới tải mail
        if (this.inboxInterval) clearInterval(this.inboxInterval);
        
        showStatus(`Đang kết nối API Mail.tm cho: ${acc.email}...`);
        await this.fetchInboxDirectly(acc.email, acc.password);

        // Tự động tải lại hộp thư mỗi 5 giây
        this.inboxInterval = setInterval(() => {
            this.fetchInboxDirectly(acc.email, acc.password);
        }, 5000);
    }

    deleteAccount(index) {
        if (confirm(`Bạn có chắc chắn muốn xóa tài khoản ${this.accounts[index].email} khỏi danh sách?`)) {
            // Nếu tài khoản đang được chọn thì reset thông tin chi tiết
            if (this.selectedAccountIndex === index) {
                this.selectedAccountIndex = null;
                this.infoEmail.value = '...';
                this.infoPass.value = '...';
                this.infoPass2.value = '...';
                this.info2FA.value = '...';
                if (this.infoNote) this.infoNote.value = '';
                this.clearReader();
                this.inboxListContainer.innerHTML = '';
                if (this.inboxInterval) clearInterval(this.inboxInterval);
            } else if (this.selectedAccountIndex > index) {
                // Điều chỉnh chỉ số tài khoản đang chọn nếu phần tử trước nó bị xóa
                this.selectedAccountIndex--;
            }
            
            this.accounts.splice(index, 1);
            this.saveAccounts();
            this.renderAccounts();
            showToast("Đã xóa tài khoản khỏi danh sách!");
        }
    }

    generateOTP(secret) {
        if (!secret) {
            this.info2FA.value = '';
            return;
        }
        try {
            // Tải OTP thông qua thư viện preload exposes
            const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
            // Lấy totp bằng cách gọi code hoặc truyền tải
            // Để tiện nhất, chúng ta có thể gọi otplib từ Main process qua IPC hoặc làm trực tiếp.
            // Vì ta đã khai báo preload OTP generator, hãy để Main process tính hoặc ta tự tính
            // Để gọn nhất, hãy tính 2FA bằng cách gọi SeleniumService / otplib gián tiếp hoặc chạy node code.
            // Ở preload.js ta chưa viết helper generateTOTP. Ta có thể dùng otplib hoặc tính trong Main process.
            window.electronAPI.generateTOTP(cleanSecret).then(code => {
                this.info2FA.value = code || 'Lỗi';
            });
        } catch(e) {
            this.info2FA.value = 'Lỗi Key';
        }
    }

    async fetchInboxDirectly(email, password) {
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
                
                // So sánh xem có email mới không để render lại
                if (JSON.stringify(newMessages) !== JSON.stringify(this.messages)) {
                    this.messages = newMessages;
                    this.renderInbox();
                }
                showStatus(`Đã đồng bộ hộp thư lúc: ${new Date().toLocaleTimeString()}`);
            }
        } catch (e) {
            showStatus(`⚠️ Lỗi tải hộp thư Mail.tm`);
        }
    }

    renderInbox() {
        this.inboxListContainer.innerHTML = '';
        if (this.messages.length === 0) {
            this.inboxListContainer.innerHTML = `<div class="text-center py-12 text-slate-500 text-xs">Hộp thư trống.</div>`;
            return;
        }

        this.messages.forEach(msg => {
            const isSelected = this.selectedMessageId === msg.id;
            
            // Highlight màu dựa theo chủ đề email
            let highlightClass = 'bg-slate-900/40 hover:bg-slate-800 border-cyber-border text-slate-300';
            if (isSelected) {
                highlightClass = 'bg-blue-600/20 border-blue-500/50 text-white font-semibold shadow-sm shadow-blue-500/10';
            } else {
                const sub = msg.subject.toLowerCase();
                if (sub.includes('chấm dứt') || sub.includes('suspended')) {
                    highlightClass = 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 text-rose-300';
                } else if (sub.includes('lifted') || sub.includes('hết bị') || sub.includes('good news')) {
                    highlightClass = 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-300';
                }
            }

            const formattedDate = msg.createdAt ? msg.createdAt.slice(0, 19).replace('T', ' ') : '';

            const item = document.createElement('div');
            item.className = `px-2.5 py-1.5 rounded-md border cursor-pointer mb-1 transition ${highlightClass}`;
            item.onclick = () => this.selectEmail(msg.id);

            item.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[11px] font-bold text-slate-400 truncate w-3/5">${msg.from.address}</span>
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
        
        const isDark = document.documentElement.classList.contains('dark');
        const bgVal = isDark ? '#0B0F19' : '#FFFFFF';
        const fgVal = isDark ? '#94A3B8' : '#334155';
        const textVal = isDark ? '#E2E8F0' : '#0F172A';

        if (this.htmlReader) {
            this.htmlReader.classList.add('hidden');
            this.htmlReader.srcdoc = `<html><body style="background-color:${bgVal};color:${fgVal};font-family:sans-serif;font-size:12px;padding:20px;">Đang tải nội dung thư...</body></html>`;
        }
        this.readerEmpty.classList.add('hidden');

        try {
            const session = axios.create({ baseURL: 'https://api.mail.tm' });
            const headers = { Authorization: `Bearer ${this.currentToken}` };
            const resp = await session.get(`/messages/${msgId}`, { headers });
            
            if (resp.status === 200) {
                const data = resp.data;
                
                // Trích xuất HTML
                let htmlStr = '';
                if (data.html) {
                    htmlStr = Array.isArray(data.html) ? data.html[0] : data.html;
                }
                
                // Nếu không có HTML thì tự bọc văn bản thô trong HTML để hiển thị đẹp đẽ
                if (!htmlStr && (data.text || data.intro)) {
                    const text = data.text || data.intro || '';
                    htmlStr = `<html><body style="background-color:${bgVal};color:${textVal};font-family:sans-serif;font-size:12px;padding:20px;white-space:pre-wrap;line-height:1.6;">${text}</body></html>`;
                }

                if (htmlStr && this.htmlReader) {
                    this.htmlReader.srcdoc = htmlStr;
                    this.htmlReader.classList.remove('hidden');
                }
            }
        } catch(e) {
            if (this.htmlReader) {
                this.htmlReader.srcdoc = `<html><body style="background-color:${bgVal};color:#EF4444;font-family:sans-serif;font-size:12px;padding:20px;">❌ Lỗi: Không thể tải nội dung email.</body></html>`;
                this.htmlReader.classList.remove('hidden');
            }
        }
    }

    clearReader() {
        if (this.htmlReader) {
            this.htmlReader.srcdoc = '';
            this.htmlReader.classList.add('hidden');
        }
        this.readerEmpty.classList.remove('hidden');
    }

    // ĐĂNG NHẬP NHANH THỦ CÔNG
    mailtmManualLogin() {
        const raw = this.quickPasteInput.value.trim();
        if (!raw) return;
        const acc = this.parseAccountLine(raw);
        if (acc) {
            const dupIndex = this.accounts.findIndex(a => a.email.toLowerCase() === acc.email.toLowerCase());
            if (dupIndex !== -1) {
                // Lấy tài khoản cũ ra, gộp thông tin mới
                const existing = this.accounts.splice(dupIndex, 1)[0];
                const updated = { ...existing, ...acc };
                this.accounts.unshift(updated); // Đẩy lên đầu danh sách
                this.saveAccounts();
                this.renderAccounts();
                this.quickPasteInput.value = '';
                this.selectAccount(0); // Mở hiển thị thông tin tài khoản
                showToast("Tài khoản đã tồn tại, đã đẩy lên đầu danh sách!");
                return;
            }
            this.accounts.unshift(acc); // Đưa lên đầu
            this.saveAccounts();
            this.renderAccounts();
            this.quickPasteInput.value = '';
            this.selectAccount(0); // Mở hiển thị thông tin tài khoản
            showToast("Đã thêm tài khoản mới thành công!");
        } else {
            showToast("⚠️ Định dạng không đúng! Vui lòng dán Mail|Pass hoặc Mail|Pass|2FA");
        }
    }

    isValid2FA(text) {
        if (!text) return false;
        text = text.replace(/\s+/g, '').toUpperCase();
        if (text.length < 16) return false;
        return /^[A-Z0-9]+$/.test(text); // Khớp hoàn hảo với logic isalnum() của Python
    }

    parseAccountLine(line) {
        line = line.trim();
        if (!line) return null;
        const parts = line.split('|').map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length >= 2) {
            const email = parts[0];
            const password = parts[1];
            let pass2 = password;
            let code_2fa = '';
            
            if (parts.length >= 3) {
                const raw_p3 = parts[2];
                const clean_p3 = raw_p3.split(/\s+/)[0] || '';
                if (this.isValid2FA(clean_p3)) {
                    code_2fa = clean_p3;
                } else {
                    pass2 = raw_p3;
                    if (parts.length >= 4) {
                        const raw_p4 = parts[3];
                        const clean_p4 = raw_p4.split(/\s+/)[0] || '';
                        if (this.isValid2FA(clean_p4)) {
                            code_2fa = clean_p4;
                        }
                    }
                }
            }
            return { email, password, pass2, "2fa_secret": code_2fa, status: 'normal' };
        }
        return null;
    }

    // NHẬP TÀI KHOẢN TỪ FILE TXT
    async mailtmOpenFile() {
        const fileContent = await window.electronAPI.openFileDialog();
        if (!fileContent) return;

        let count = 0;
        const lines = fileContent.split(/\r?\n/);
        lines.forEach(line => {
            const raw = line.trim();
            if (!raw) return;
            const acc = this.parseAccountLine(raw);
            if (acc) {
                // Tránh trùng email (không phân biệt hoa thường)
                if (!this.accounts.some(a => a.email.toLowerCase() === acc.email.toLowerCase())) {
                    this.accounts.push(acc);
                    count++;
                }
            }
        });

        if (count > 0) {
            this.saveAccounts();
            this.renderAccounts();
            showToast(`Đã nạp thêm ${count} tài khoản từ file!`);
        } else {
            showToast("Không tìm thấy tài khoản mới nào hợp lệ.");
        }
    }

    // XÓA TOÀN BỘ TÀI KHOẢN
    mailtmClearAll() {
        if (confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách tài khoản Mail.tm không?")) {
            this.accounts = [];
            this.selectedAccountIndex = null;
            this.saveAccounts();
            this.renderAccounts();
            this.clearReader();
            this.inboxListContainer.innerHTML = '';
            
            // Xóa info panel
            this.infoEmail.value = '...';
            this.infoPass.value = '...';
            this.infoPass2.value = '...';
            this.info2FA.value = '...';

            if (this.inboxInterval) clearInterval(this.inboxInterval);
            showToast("Đã xóa sạch tài khoản!");
        }
    }

    // CHECK KHÁNG VỀ (QUÉT HÀNG LOẠT TRONG NỀN BẰNG PROMISE LIMIT)
    async mailtmCheckLive() {
        if (this.accounts.length === 0) return;
        showStatus("⏳ Đang tiến hành quét kiểm tra trạng thái kháng tài khoản...");
        
        const accountsToScan = [...this.accounts];
        const session = axios.create({ baseURL: 'https://api.mail.tm' });

        // Tạo hàng đợi xử lý tối đa 5 luồng cùng lúc
        const scanAccount = async (acc, index) => {
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
                        const sub = m.subject.toLowerCase();
                        if (sub.includes('lifted') || sub.includes('hết bị tạm ngưng') || sub.includes('good news')) {
                            liveCount++;
                        } else if (sub.includes('suspended') || sub.includes('tạm ngưng') || sub.includes('chấm dứt')) {
                            dieCount++;
                        }
                    }

                    acc.liveCount = liveCount;
                    acc.dieCount = dieCount;

                    if (liveCount > 0) {
                        acc.status = 'live';
                    } else if (dieCount > 0) {
                        acc.status = 'die';
                    } else {
                        acc.status = 'normal';
                    }
                } else {
                    acc.status = 'die';
                    acc.liveCount = 0;
                    acc.dieCount = 0;
                }
            } catch (e) {
                acc.status = 'die';
                acc.liveCount = 0;
                acc.dieCount = 0;
            }
            this.renderAccounts();
        };

        // Chạy song song tối đa 5 tài khoản
        const promises = [];
        const limit = 5;
        for (let i = 0; i < accountsToScan.length; i++) {
            const p = scanAccount(accountsToScan[i], i);
            promises.push(p);
            if (promises.length >= limit) {
                await Promise.all(promises);
                promises.length = 0;
            }
        }
        if (promises.length > 0) {
            await Promise.all(promises);
        }

        this.saveAccounts();
        showStatus("✅ Đã hoàn tất kiểm tra kháng!");
        showToast("Đã quét kháng xong toàn bộ tài khoản!");
    }

    // CHẠY SELENIUM ĐĂNG NHẬP NHANH TIKTOK ADS
    mailtmRunSelenium() {
        if (this.selectedAccountIndex === null) {
            showToast("⚠️ Vui lòng chọn tài khoản từ danh sách trước!");
            return;
        }
        const acc = this.accounts[this.selectedAccountIndex];
        
        showStatus(`🚀 Bắt đầu tự động đăng nhập TikTok Ads cho: ${acc.email}...`);
        window.electronAPI.loginTikTokAds(acc.email, acc.pass2 || acc.password, acc.password);
    }

    mailtmRefreshInbox() {
        if (this.selectedAccountIndex !== null) {
            const acc = this.accounts[this.selectedAccountIndex];
            this.fetchInboxDirectly(acc.email, acc.password);
        }
    }

    saveAccounts() {
        window.electronAPI.saveMailtmAccounts(this.accounts);
    }

    updateSmartPlusUI() {
        const btn = document.getElementById('mailtm-btn-smartplus');
        const status = document.getElementById('mailtm-smartplus-status');
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
            if (window.tabSettings && window.tabSettings.bypassSmartPlusCheckbox) {
                window.tabSettings.bypassSmartPlusCheckbox.checked = this.smartPlusEnabled;
            }
        } catch (e) {}

        if (this.selectedAccountIndex !== null) {
            const acc = this.accounts[this.selectedAccountIndex];
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
}

window.tabMailtm = new TabMailtm();
