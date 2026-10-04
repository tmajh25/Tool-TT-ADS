// Tab Outlook Manager
class TabOutlook {
    constructor() {
        this.accounts = [];
        this.selectedAccountIndex = null;
        this.accessToken = null;
        this.messages = [];
        this.selectedMessageId = null;
        this.searchQuery = '';
        this.inboxInterval = null;
        this.smartPlusEnabled = true;
        
        // DOM Elements
        this.listContainer = document.getElementById('outlook-accounts-list');
        this.quickPasteInput = document.getElementById('outlook-quick-paste');
        this.countLabel = document.getElementById('outlook-count');
        this.inboxListContainer = document.getElementById('outlook-inbox-list');
        this.textReader = document.getElementById('outlook-text-content');
        this.readerEmpty = document.getElementById('outlook-reader-empty');
        this.searchInput = document.getElementById('outlook-search-user');
        
        // Info panel elements
        this.infoUser = document.getElementById('outlook-info-user');
        this.infoEmail = document.getElementById('outlook-info-email');
        this.infoPassTT = document.getElementById('outlook-info-pass-tt');
        this.infoPassMail = document.getElementById('outlook-info-pass-mail');
        this.info2FA = document.getElementById('outlook-info-2fa');
        this.infoNote = document.getElementById('outlook-info-note');
    }

    async init() {
        // Tải tài khoản từ cache
        this.accounts = await window.electronAPI.loadOutlookAccounts() || [];
        this.renderAccounts();
        
        // Tải cấu hình Smart+
        try {
            const settings = await window.electronAPI.loadSettings() || {};
            this.smartPlusEnabled = settings.bypassSmartPlus !== false;
            this.updateSmartPlusUI();
        } catch (e) {}

        // Gắn sự kiện gõ ô tìm kiếm ở list
        const searchBox = document.getElementById('outlook-quick-paste'); // Có thể dùng chung hoặc tạo ô tìm kiếm ở sidebar
        const searchInput = document.getElementById('outlook-search-user');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderAccounts();
            });
        }

        // Gắn sự kiện ghi chú tự động lưu khi nhập
        if (this.infoNote) {
            this.infoNote.addEventListener('input', () => {
                if (this.selectedAccountIndex !== null) {
                    const noteVal = this.infoNote.value.trim();
                    this.accounts[this.selectedAccountIndex].note = noteVal;
                    this.saveAccounts();
                    
                    // Cập nhật text hiển thị trực tiếp ở danh sách tài khoản
                    const itemEl = document.getElementById(`outlook-item-${this.selectedAccountIndex}`);
                    if (itemEl) {
                        const nameEl = itemEl.querySelector('.account-display-name');
                        if (nameEl) {
                            const user_tt = this.accounts[this.selectedAccountIndex].user_tt;
                            nameEl.innerHTML = noteVal ? `<span class="text-blue-400 font-semibold mr-1.5">[${noteVal}]</span><span class="text-slate-200">${user_tt}</span>` : `<span class="text-slate-200 font-semibold">${user_tt}</span>`;
                        }
                    }
                }
            });
        }
    }

    renderAccounts() {
        this.listContainer.innerHTML = '';
        
        // Lọc tài khoản dựa theo tìm kiếm
        const filteredAccounts = this.accounts.filter(acc => {
            if (!this.searchQuery) return true;
            return acc.user_tt.toLowerCase().includes(this.searchQuery) || acc.email.toLowerCase().includes(this.searchQuery);
        });

        this.countLabel.textContent = `Số lượng: ${this.accounts.length}`;

        if (filteredAccounts.length === 0) {
            this.listContainer.innerHTML = `<div class="text-center py-8 text-slate-500 text-xs">Không tìm thấy tài khoản.</div>`;
            return;
        }

        filteredAccounts.forEach((acc, index) => {
            // Tìm index thực trong mảng chính
            const originalIndex = this.accounts.indexOf(acc);
            const isSelected = this.selectedAccountIndex === originalIndex;

            // Xác định màu trạng thái
            let statusBg = 'bg-slate-800/40 hover:bg-slate-800 border-cyber-border text-slate-300';
            if (acc.status === 'live') {
                statusBg = 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400';
            } else if (acc.status === 'die') {
                statusBg = 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-400';
            } else if (acc.status === 'warning') {
                statusBg = 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400';
            }

            if (isSelected) {
                statusBg = 'bg-blue-600/20 border-blue-500 text-white font-semibold shadow-sm shadow-blue-500/20';
            }

            const item = document.createElement('div');
            item.id = `outlook-item-${originalIndex}`;
            item.className = `px-2.5 py-1.5 rounded-md border cursor-pointer mb-1 transition-all duration-150 ${statusBg}`;
            item.onclick = () => this.selectAccount(originalIndex);

            let badgeHtml = '';
            const liveVal = acc.liveCount !== undefined ? acc.liveCount : (acc.status === 'live' ? 1 : 0);
            const dieVal = acc.dieCount !== undefined ? acc.dieCount : (acc.status === 'die' ? 1 : 0);
            
            if (liveVal > 0) {
                badgeHtml += `<span class="bg-emerald-500 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center inline-block shadow-sm shadow-emerald-500/30 mr-1">${liveVal}</span>`;
            }
            if (dieVal > 0) {
                badgeHtml += `<span class="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center inline-block shadow-sm shadow-rose-500/30">${dieVal}</span>`;
            }

            const displayName = acc.note ? `<span class="text-blue-400 font-semibold mr-1.5">[${acc.note}]</span><span class="text-slate-200">${acc.user_tt}</span>` : `<span class="text-slate-200 font-semibold">${acc.user_tt}</span>`;

            item.innerHTML = `
                <div class="flex items-center justify-between w-full min-w-0">
                    <div class="truncate text-xs tracking-wide flex-1 mr-1.5 min-w-0 account-display-name">
                        <span class="text-slate-400 font-mono mr-1">${originalIndex + 1}.</span>
                        ${displayName}
                        <span class="text-[10px] text-slate-500 ml-1">(${acc.type ? acc.type.toUpperCase() : 'BASIC'})</span>
                    </div>
                    <div class="flex items-center space-x-1 flex-shrink-0">
                        ${badgeHtml}
                        <button onclick="event.stopPropagation(); window.tabOutlook.openRowMenu(event, ${originalIndex})" 
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
            window.openAccountRowMenu(event, 'outlook', index);
        }
    }

    openEditModal(index = null) {
        const targetIndex = index !== null ? index : this.selectedAccountIndex;
        if (targetIndex === null || !this.accounts[targetIndex]) {
            showToast('Vui lòng chọn tài khoản cần sửa!');
            return;
        }
        const acc = this.accounts[targetIndex];
        currentEditContext = { tab: 'outlook', index: targetIndex };

        document.getElementById('modal-edit-title').textContent = 'Chỉnh sửa tài khoản Outlook';
        document.getElementById('edit-lbl-field1').textContent = 'Username / TikTok';
        document.getElementById('edit-input-field1').value = acc.user_tt || acc.email || '';
        document.getElementById('edit-lbl-field2').textContent = 'Email Outlook';
        document.getElementById('edit-input-field2').value = acc.email || '';
        document.getElementById('edit-lbl-field3').textContent = 'Mật khẩu TikTok';
        document.getElementById('edit-input-field3').value = acc.pass_tt || '';
        document.getElementById('edit-lbl-field4').textContent = 'Mật khẩu Outlook';
        document.getElementById('edit-input-field4').value = acc.pass_mail || '';
        document.getElementById('edit-quick-paste').value = '';

        document.getElementById('modal-edit-account').classList.remove('hidden');
    }

    async selectAccount(index) {
        this.selectedAccountIndex = index;
        const acc = this.accounts[index];
        this.renderAccounts();

        // Cập nhật thông tin chi tiết
        this.infoUser.value = acc.user_tt;
        this.infoEmail.value = acc.email;
        this.infoPassTT.value = acc.pass_tt;
        this.infoPassMail.value = acc.pass_mail;
        if (this.info2FA) this.info2FA.value = '...';
        if (this.infoNote) this.infoNote.value = acc.note || '';

        // Tính toán mã OTP tự động
        this.generateOTP(acc['2fa_secret']);

        // Reset hộp thư
        this.messages = [];
        this.selectedMessageId = null;
        this.accessToken = null;
        this.renderInbox();
        this.clearReader();

        if (this.inboxInterval) clearInterval(this.inboxInterval);

        // Xử lý đăng nhập API nếu là tài khoản OAuth
        if (acc.type === 'oauth') {
            showStatus(`🔄 Đang đăng nhập API Outlook: ${acc.email}...`);
            let clientId = acc.client_id;
            if (!clientId) {
                const settings = await window.electronAPI.loadSettings() || {};
                clientId = settings.defaultClientId;
            }
            if (!clientId) {
                showStatus(`❌ Lỗi: Thiếu Client ID (Hãy bổ sung Client ID mặc định ở tab Cài đặt)`);
                acc.status = 'die';
                this.saveAccounts();
                this.renderAccounts();
                return;
            }
            const token = await window.electronAPI.loginOAuth(clientId, acc.refresh_token);
            
            if (token) {
                this.accessToken = token;
                acc.status = 'live';
                this.saveAccounts();
                this.renderAccounts();
                showStatus(`✅ Đăng nhập API thành công! Đang tải thư...`);
                await this.fetchEmailsDirectly();
                
                // Tự động tải lại hộp thư Outlook mỗi 5 giây
                this.inboxInterval = setInterval(() => {
                    this.fetchEmailsDirectly();
                }, 5000);
            } else {
                acc.status = 'die';
                this.saveAccounts();
                this.renderAccounts();
                showStatus(`❌ Lỗi: Refresh Token hết hạn hoặc Client ID sai!`);
            }
        } else {
            showStatus(`ℹ️ Đã chọn: ${acc.email} (Yêu cầu đăng nhập trình duyệt để đọc mail)`);
        }
    }

    deleteAccount(index) {
        if (confirm(`Bạn có chắc chắn muốn xóa tài khoản ${this.accounts[index].user_tt} khỏi danh sách?`)) {
            if (this.selectedAccountIndex === index) {
                this.selectedAccountIndex = null;
                this.infoUser.value = '...';
                this.infoEmail.value = '...';
                this.infoPassTT.value = '...';
                this.infoPassMail.value = '...';
                if (this.info2FA) this.info2FA.value = '...';
                if (this.infoNote) this.infoNote.value = '';
                this.clearReader();
                this.inboxListContainer.innerHTML = '';
                if (this.inboxInterval) clearInterval(this.inboxInterval);
            } else if (this.selectedAccountIndex > index) {
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
        this.info2FA.value = 'Đang tính...';
        // Gọi IPC tính TOTP từ Main process (đã tích hợp otplib)
        window.electronAPI.generateTOTP(secret.replace(/\s+/g, '').toUpperCase())
            .then(code => {
                this.info2FA.value = code || 'Lỗi';
            });
    }

    async fetchEmailsDirectly() {
        if (!this.accessToken) return;
        
        try {
            const mails = await window.electronAPI.fetchEmails(this.accessToken);
            this.messages = mails || [];
            this.renderInbox();
            showStatus("✅ Đã tải thư Outlook mới nhất!");
        } catch (e) {
            showStatus("⚠️ Lỗi tải thư Outlook từ API");
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
            let highlightClass = 'bg-slate-900/40 hover:bg-slate-800 border-cyber-border text-slate-300';
            if (isSelected) {
                highlightClass = 'bg-blue-600/20 border-blue-500/50 text-white font-semibold shadow-sm shadow-blue-500/10';
            }

            const sender = msg.from ? msg.from.emailAddress.name || msg.from.emailAddress.address : 'Unknown';
            
            const item = document.createElement('div');
            item.className = `px-2.5 py-1.5 rounded-md border cursor-pointer mb-1 transition ${highlightClass}`;
            item.onclick = () => this.selectEmail(msg.id);

            item.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[11px] font-bold text-slate-400 truncate w-3/5">${sender}</span>
                </div>
                <div class="text-xs font-semibold truncate text-slate-200">${msg.subject || '(Không có chủ đề)'}</div>
            `;
            this.inboxListContainer.appendChild(item);
        });
    }

    selectEmail(msgId) {
        this.selectedMessageId = msgId;
        this.renderInbox();
        
        const msg = this.messages.find(m => m.id === msgId);
        if (msg && msg.body) {
            this.readerEmpty.classList.add('hidden');
            
            // Giải nén HTML body thành plain text sạch sẽ
            const rawHtml = msg.body.content || '';
            let cleanText = rawHtml
                .replace(/<style([\s\S]*?)<\/style>/gi, '')
                .replace(/<script([\s\S]*?)<\/script>/gi, '')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/gi, ' ');
            
            // Định dạng dòng
            cleanText = cleanText.split('\n')
                .map(line => line.trim())
                .filter(line => line !== '')
                .join('\n');

            this.textReader.textContent = cleanText;
        }
    }

    clearReader() {
        this.textReader.textContent = '';
        this.readerEmpty.classList.remove('hidden');
    }

    // THÊM TÀI KHOẢN NHANH QUA Ô DÁN
    outlookAddAccount() {
        const raw = this.quickPasteInput.value.trim();
        if (!raw) return;
        const acc = this.parseLine(raw);
        if (acc) {
            const dupIndex = this.accounts.findIndex(a => a.user_tt.toLowerCase() === acc.user_tt.toLowerCase());
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
            this.accounts.unshift(acc);
            this.saveAccounts();
            this.renderAccounts();
            this.quickPasteInput.value = '';
            this.selectAccount(0); // Mở hiển thị thông tin tài khoản
            showToast("Đã thêm tài khoản Outlook mới thành công!");
        } else {
            showToast("⚠️ Sai định dạng dán! Vui lòng kiểm tra lại.");
        }
    }

    parseLine(line) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 6) {
            return {
                user_tt: parts[0], pass_tt: parts[1], email: parts[2],
                pass_mail: parts[3], refresh_token: parts[4], client_id: parts[5],
                status: 'normal', type: 'oauth'
            };
        } else if (parts.length === 5) {
            return {
                user_tt: parts[0], pass_tt: parts[1], email: parts[2],
                pass_mail: parts[3], refresh_token: parts[4], client_id: '',
                status: 'normal', type: 'oauth'
            };
        } else if (parts.length >= 3) {
            const secret = parts[2].split(/\s+/)[0];
            return {
                user_tt: parts[0], pass_tt: parts[1], email: parts[0],
                pass_mail: parts[1], "2fa_secret": secret,
                status: 'normal', type: '2fa'
            };
        } else if (parts.length === 2) {
            return {
                user_tt: parts[0], pass_tt: parts[1], email: parts[0],
                pass_mail: parts[1],
                status: 'normal', type: 'basic'
            };
        }
        return null;
    }

    // NHẬP TỪ FILE TXT
    async outlookOpenFile() {
        const fileContent = await window.electronAPI.openFileDialog();
        if (!fileContent) return;

        let count = 0;
        const lines = fileContent.split(/\r?\n/);
        lines.forEach(line => {
            const raw = line.trim();
            if (!raw) return;
            const acc = this.parseLine(raw);
            if (acc) {
                // Tránh trùng tài khoản (không phân biệt hoa thường)
                if (!this.accounts.some(a => a.user_tt.toLowerCase() === acc.user_tt.toLowerCase())) {
                    this.accounts.push(acc);
                    count++;
                }
            }
        });

        if (count > 0) {
            this.saveAccounts();
            this.renderAccounts();
            showToast(`Đã nạp thêm ${count} tài khoản từ file txt!`);
        } else {
            showToast("Không tìm thấy tài khoản mới hợp lệ.");
        }
    }

    // XÓA LIST
    outlookClearAll() {
        if (confirm("Bạn có chắc chắn muốn xóa sạch danh sách tài khoản Outlook không?")) {
            this.accounts = [];
            this.selectedAccountIndex = null;
            this.saveAccounts();
            this.renderAccounts();
            this.clearReader();
            this.inboxListContainer.innerHTML = '';
            
            // Clear info box
            this.infoUser.value = '...';
            this.infoEmail.value = '...';
            this.infoPassTT.value = '...';
            this.infoPassMail.value = '...';
            this.info2FA.value = '...';
            
            if (this.inboxInterval) clearInterval(this.inboxInterval);
            
            showToast("Đã xóa toàn bộ list Outlook!");
        }
    }

    // CHẠY TRÌNH DUYỆT TỰ ĐỘNG (SELENIUM)
    outlookRunSelenium() {
        if (this.selectedAccountIndex === null) {
            showToast("⚠️ Vui lòng chọn tài khoản Outlook trước!");
            return;
        }
        const acc = this.accounts[this.selectedAccountIndex];
        showStatus(`🚀 Đang mở Chrome điều khiển Selenium cho: ${acc.email}...`);
        window.electronAPI.loginOutlookBrowser(acc.email, acc.pass_mail, acc['2fa_secret'] || '');
    }

    outlookRefreshInbox() {
        if (this.selectedAccountIndex !== null) {
            this.selectAccount(this.selectedAccountIndex);
        }
    }

    saveAccounts() {
        window.electronAPI.saveOutlookAccounts(this.accounts);
    }

    updateSmartPlusUI() {
        const btn = document.getElementById('outlook-btn-smartplus');
        const status = document.getElementById('outlook-smartplus-status');
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

window.tabOutlook = new TabOutlook();
