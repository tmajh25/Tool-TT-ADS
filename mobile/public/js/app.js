// Tự động xóa sạch Service Worker & Cache cũ để F5 luôn ăn code mới 100%
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let r of registrations) r.unregister();
    }).catch(() => {});
}
if ('caches' in window) {
    caches.keys().then(names => {
        for (let n of names) caches.delete(n);
    }).catch(() => {});
}

class MobileApp {
    constructor() {
        this.accounts = [];
        this.currentAccountIndex = null;
        this.loginPollTimer = null;
        this.activeCaptchaEmail = null;
        this.captchaClicks = [];
        this.captchaOriginalWidth = 0;
        this.captchaOriginalHeight = 0;
        this.currentBcId = null;
        this.init();
    }

    async init() {
        // Nếu đã ở màn hình Business Center hoặc Members trước đó, giữ nguyên giao diện ngay lập tức khi F5
        const savedEmail = localStorage.getItem('activeAccountEmail');
        const savedBcId = localStorage.getItem('activeBcId');

        if (savedEmail) {
            const vAcc = document.getElementById('view-accounts');
            const vBc = document.getElementById('view-bc');
            const vMembers = document.getElementById('view-members');
            const btnBack = document.getElementById('btn-back');
            const headerTitle = document.getElementById('header-title');
            const bcEmail = document.getElementById('bc-current-email');

            if (savedBcId) {
                if (vAcc) vAcc.style.display = 'none';
                if (vBc) vBc.style.display = 'none';
                if (vMembers) vMembers.style.display = 'block';
                if (btnBack) btnBack.style.display = 'inline-block';
                if (headerTitle) headerTitle.textContent = 'Quản lý thành viên';
            } else {
                if (vAcc) vAcc.style.display = 'none';
                if (vBc) vBc.style.display = 'block';
                if (vMembers) vMembers.style.display = 'none';
                if (btnBack) btnBack.style.display = 'inline-block';
                if (headerTitle) headerTitle.textContent = 'Business Center';
            }
            if (bcEmail) bcEmail.textContent = savedEmail;
        }

        await this.loadAccounts();

        if (savedEmail && this.accounts.length > 0) {
            const idx = this.accounts.findIndex(a => a.email.toLowerCase() === savedEmail.toLowerCase());
            if (idx >= 0) {
                this.currentAccountIndex = idx;
                if (savedBcId) {
                    this.switchToMembersView(savedBcId);
                } else {
                    this.switchToBCView(this.accounts[idx]);
                }
            }
        }
    }

    async loadAccounts() {
        try {
            const resp = await fetch('/api/accounts');
            const data = await resp.json();
            if (data.success) {
                this.accounts = data.accounts || [];
                this.renderAccounts();
            }
        } catch (e) {
            this.showToast('Lỗi tải danh sách tài khoản');
        }
    }

    parseAccountLine(line) {
        line = (line || '').trim();
        if (!line) return null;
        const parts = line.split(/[|\t;,]/).map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length >= 2) {
            const email = parts[0];
            const password = parts[1];
            let secret = '';
            if (parts.length >= 3) {
                const p3 = parts[2].replace(/\s+/g, '').toUpperCase();
                if (p3.length >= 16 && /^[A-Z0-9]+$/.test(p3)) {
                    secret = p3;
                } else if (parts.length >= 4) {
                    const p4 = parts[3].replace(/\s+/g, '').toUpperCase();
                    if (p4.length >= 16 && /^[A-Z0-9]+$/.test(p4)) {
                        secret = p4;
                    }
                }
            }
            return { email, password, secret };
        }
        return null;
    }

    // ĐĂNG NHẬP VÀ THÊM TÀI KHOẢN TRỰC TIẾP
    async loginAndAddAccount() {
        const input = document.getElementById('input-quick-paste');
        const text = input ? input.value.trim() : '';

        if (!text) {
            this.showToast('Vui lòng dán Mail|Pass hoặc Mail|Pass|2FA');
            return;
        }

        const parsed = this.parseAccountLine(text);
        if (!parsed) {
            this.showToast('Định dạng không đúng! Dán: Email|Password hoặc Email|Password|2FA');
            return;
        }

        const { email, password, secret } = parsed;
        const progressBox = document.getElementById('login-progress-box');
        const progressText = document.getElementById('login-progress-text');
        const btnLogin = document.getElementById('btn-login-main');

        if (progressBox) progressBox.style.display = 'block';
        if (progressText) progressText.textContent = 'Đang gửi lệnh đăng nhập...';
        if (btnLogin) btnLogin.disabled = true;

        try {
            const resp = await fetch('/api/tiktok/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, secret, mailPass: password })
            });
            const data = await resp.json();

            if (!data.success && data.message) {
                this.showToast(data.message);
                if (progressBox) progressBox.style.display = 'none';
                if (btnLogin) btnLogin.disabled = false;
                return;
            }

            // Bắt đầu theo dõi tiến trình đăng nhập
            this.startLoginPolling(email);

        } catch (e) {
            this.showToast('Lỗi kết nối khởi chạy đăng nhập');
            if (progressBox) progressBox.style.display = 'none';
            if (btnLogin) btnLogin.disabled = false;
        }
    }

    startLoginPolling(email) {
        if (this.loginPollTimer) clearInterval(this.loginPollTimer);

        const progressText = document.getElementById('login-progress-text');
        const progressBox = document.getElementById('login-progress-box');
        const btnLogin = document.getElementById('btn-login-main');
        const input = document.getElementById('input-quick-paste');

        const pollTick = async () => {
            try {
                const resp = await fetch(`/api/tiktok/login-status?email=${encodeURIComponent(email)}`);
                const job = await resp.json();

                if (job.progress && progressText) {
                    progressText.textContent = job.progress;
                }

                // 2. Kiểm tra xem có Captcha không để hiện modal giải từ xa
                try {
                    const cResp = await fetch(`/api/tiktok/captcha?email=${encodeURIComponent(email)}`);
                    const cData = await cResp.json();
                    if (cData.hasCaptcha && cData.captcha) {
                        this.showCaptchaModal(email, cData.captcha);
                    } else if (!cData.hasCaptcha) {
                        const modal = document.getElementById('modal-captcha');
                        if (modal && modal.style.display === 'flex') {
                            this.closeCaptchaModal();
                            this.showToast('✅ Đã giải Captcha thành công! Đang vào tài khoản...');
                        }
                    }
                } catch (ce) {}

                if (job.status === 'success') {
                    if (this.loginPollTimer) clearInterval(this.loginPollTimer);
                    this.loginPollTimer = null;
                    this.closeCaptchaModal();
                    if (progressBox) progressBox.style.display = 'none';
                    if (btnLogin) btnLogin.disabled = false;
                    if (input) input.value = '';

                    this.showToast('Đăng nhập thành công!');
                    await this.loadAccounts();

                    // Tìm index tài khoản vừa đăng nhập để chuyển ngay sang Business Center
                    const idx = this.accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
                    if (idx >= 0) {
                        this.currentAccountIndex = idx;
                        this.switchToBCView(this.accounts[idx]);
                    }
                } else if (job.status === 'error') {
                    if (this.loginPollTimer) clearInterval(this.loginPollTimer);
                    this.loginPollTimer = null;
                    this.closeCaptchaModal();
                    if (progressBox) progressBox.style.display = 'none';
                    if (btnLogin) btnLogin.disabled = false;
                    this.showToast(job.progress || 'Đăng nhập thất bại');
                }
            } catch (err) {
                // Tiếp tục thử poll
            }
        };

        pollTick();
        this.loginPollTimer = setInterval(pollTick, 1500);
    }

    // --- XỬ LÝ CAPTCHA TỪ XA ---
    showCaptchaModal(email, captcha) {
        this.activeCaptchaEmail = email;
        const modal = document.getElementById('modal-captcha');
        const img = document.getElementById('captcha-img');
        if (!modal || !img) return;

        const currentCapId = img.getAttribute('data-captcha-id');
        if (modal.style.display === 'flex' && img.src) {
            if (captcha.id && currentCapId === captcha.id) {
                return;
            }
            this.showToast('🔄 TikTok đã tải ảnh Captcha mới, vui lòng chạm lại!');
        }

        img.src = captcha.image;
        if (captcha.id) img.setAttribute('data-captcha-id', captcha.id);
        this.clearCaptchaMarkers();
        const instruct = document.getElementById('captcha-instruction');
        if (instruct) instruct.textContent = 'Chạm 2 hình giống nhau (Tool sẽ tự động xác nhận trên PC)';

        this.captchaOriginalWidth = captcha.width || 348;
        this.captchaOriginalHeight = captcha.height || 217;

        modal.style.display = 'flex';
    }

    closeCaptchaModal() {
        const modal = document.getElementById('modal-captcha');
        if (modal) modal.style.display = 'none';
        this.clearCaptchaMarkers();
        this.activeCaptchaEmail = null;
    }

    onCaptchaImageClick(event) {
        const img = document.getElementById('captcha-img');
        const markersContainer = document.getElementById('captcha-markers');
        if (!img || !markersContainer) return;

        const rect = img.getBoundingClientRect();

        const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
        const clientX = touch ? touch.clientX : event.clientX;
        const clientY = touch ? touch.clientY : event.clientY;

        const clickX = clientX - rect.left;
        const clickY = clientY - rect.top;

        if (clickX < 0 || clickX > rect.width || clickY < 0 || clickY > rect.height) {
            return;
        }

        const origW = this.captchaOriginalWidth || img.naturalWidth || 348;
        const origH = this.captchaOriginalHeight || img.naturalHeight || 217;
        const scaleX = origW / rect.width;
        const scaleY = origH / rect.height;

        const actualX = Math.round(clickX * scaleX);
        const actualY = Math.round(clickY * scaleY);

        if (this.captchaClicks.length >= 2) {
            this.clearCaptchaMarkers();
        }

        this.captchaClicks.push({ x: actualX, y: actualY });

        // Tạo điểm đánh dấu hiển thị số thứ tự (1, 2)
        const marker = document.createElement('div');
        marker.className = 'captcha-marker';
        marker.textContent = this.captchaClicks.length;
        marker.style.left = `${clickX}px`;
        marker.style.top = `${clickY}px`;
        markersContainer.appendChild(marker);

        if (this.captchaClicks.length === 1) {
            this.showToast('Đã chọn hình 1/2. Chạm tiếp hình thứ 2...');
        } else if (this.captchaClicks.length === 2) {
            this.showToast('⏳ Đang gửi xác nhận và giải Captcha trên PC...');
            const instruct = document.getElementById('captcha-instruction');
            if (instruct) instruct.textContent = '⏳ Đang gửi điểm chạm và xác nhận trên máy tính...';
            setTimeout(() => {
                this.submitCaptchaSolution();
            }, 250);
        }
    }

    clearCaptchaMarkers() {
        this.captchaClicks = [];
        const markersContainer = document.getElementById('captcha-markers');
        if (markersContainer) markersContainer.innerHTML = '';
        const instruct = document.getElementById('captcha-instruction');
        if (instruct) instruct.textContent = 'Chạm 2 hình giống nhau (Tool sẽ tự động xác nhận trên PC)';
    }

    async submitCaptchaSolution() {
        if (!this.activeCaptchaEmail) {
            this.showToast('Không có phiên đăng nhập cần giải captcha');
            return;
        }

        if (this.captchaClicks.length === 0) {
            this.showToast('Vui lòng chạm vào các điểm cần chọn trên ảnh');
            return;
        }

        try {
            const resp = await fetch('/api/tiktok/solve-captcha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: this.activeCaptchaEmail,
                    clicks: this.captchaClicks
                })
            });

            const data = await resp.json();
            if (data.success) {
                this.showToast('✅ Đã bấm Confirm trên PC! Đang kiểm tra kết quả...');
            } else {
                this.showToast(data.error || 'Lỗi gửi giải captcha');
                this.clearCaptchaMarkers();
            }
        } catch (e) {
            this.showToast('Lỗi kết nối khi gửi captcha');
        }
    }

    async manualConfirmCaptcha() {
        if (!this.activeCaptchaEmail) {
            this.showToast('Không có phiên Captcha đang chờ');
            return;
        }
        this.showToast('Đang nhấn nút Confirm trên PC...');
        try {
            const resp = await fetch('/api/tiktok/captcha-confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.activeCaptchaEmail })
            });
            const data = await resp.json();
            if (data.success) {
                this.showToast('Đã bấm nút Confirm trên PC!');
            } else {
                this.showToast(data.error || 'Chưa tìm thấy nút Confirm');
            }
        } catch (e) {
            this.showToast('Lỗi kết nối');
        }
    }

    async deleteAccount(encodedEmail) {
        const email = decodeURIComponent(encodedEmail || '');
        if (!confirm(`Xóa tài khoản ${email}?`)) return;

        try {
            const resp = await fetch('/api/accounts/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await resp.json();

            if (data.success) {
                this.showToast(`Đã xóa ${email}`);
                await this.loadAccounts();
            } else {
                this.showToast(data.error || 'Lỗi xóa tài khoản');
            }
        } catch (e) {
            this.showToast('Lỗi kết nối server');
        }
    }

    renderAccounts() {
        const countEl = document.getElementById('acc-count');
        const listEl = document.getElementById('accounts-list');
        if (!listEl) return;

        if (countEl) countEl.textContent = this.accounts.length;

        if (this.accounts.length === 0) {
            listEl.innerHTML = `<div class="empty-box">Chưa có tài khoản nào. Dán Mail|Pass bên trên để đăng nhập.</div>`;
            return;
        }

        listEl.innerHTML = this.accounts.map((acc, index) => {
            const escapedEmail = this.escapeHtml(acc.email);
            const encodedEmail = encodeURIComponent(acc.email || '');
            return `
                <div class="acc-item" onclick="app.openAccountBusinessCenter(${index})">
                    <div class="acc-item-main">
                        <div class="acc-item-email">${escapedEmail}</div>
                    </div>
                    <div class="acc-item-right">
                        <button class="btn-danger-text" onclick="event.stopPropagation(); app.deleteAccount('${encodedEmail}')">Xóa</button>
                        <span class="acc-arrow">›</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // KIỂM TRA COOKIE TRƯỚC KHI VÀO - NẾU HẾT HẠN THÌ TỰ ĐỘNG ĐĂNG NHẬP LẠI (KHÔNG QUÉT BC)
    async openAccountBusinessCenter(index) {
        if (this.isCheckingCookie) return;
        this.isCheckingCookie = true;
        this.currentAccountIndex = index;
        const acc = this.accounts[index];
        if (!acc) {
            this.isCheckingCookie = false;
            return;
        }

        this.showToast('⏳ Đang kiểm tra cookie tài khoản...');

        try {
            const resp = await fetch('/api/tiktok/verify-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email })
            });
            const data = await resp.json();

            if (data.valid) {
                // Cookie còn hạn -> Thông báo và chuyển vào trang Business Center
                this.showToast('✅ Cookie còn hiệu lực!');
                this.switchToBCView(acc);
            } else if (data.relogging) {
                // Cookie hết hạn -> Hiển thị hộp tiến trình đăng nhập lại & theo dõi
                this.showToast('⚠️ Cookie đã hết hạn! Đang tự động đăng nhập lại...');
                const progressBox = document.getElementById('login-progress-box');
                const progressText = document.getElementById('login-progress-text');
                if (progressBox) progressBox.style.display = 'block';
                if (progressText) progressText.textContent = 'Cookie hết hạn, đang tự động đăng nhập lại...';

                this.startLoginPolling(acc.email);
            } else {
                this.showToast('❌ ' + (data.message || 'Cookie đã hết hạn! Vui lòng đăng nhập lại.'));
            }
        } catch (e) {
            this.showToast('❌ Lỗi kết nối khi kiểm tra cookie');
        } finally {
            this.isCheckingCookie = false;
        }
    }

    switchToBCView(acc) {
        localStorage.setItem('activeAccountEmail', acc.email);
        localStorage.removeItem('activeBcId');
        this.currentBcId = null;

        const vAcc = document.getElementById('view-accounts');
        const vBc = document.getElementById('view-bc');
        const vMembers = document.getElementById('view-members');
        const btnBack = document.getElementById('btn-back');
        const headerTitle = document.getElementById('header-title');
        const bcEmail = document.getElementById('bc-current-email');

        if (vAcc) vAcc.style.display = 'none';
        if (vBc) vBc.style.display = 'block';
        if (vMembers) vMembers.style.display = 'none';
        if (btnBack) btnBack.style.display = 'inline-block';
        if (headerTitle) headerTitle.textContent = 'Business Center';
        if (bcEmail) bcEmail.textContent = acc.email;

        this.renderBusinessCenters();
    }

    handleBack() {
        const vMembers = document.getElementById('view-members');
        if (vMembers && vMembers.style.display !== 'none') {
            this.goBackToBC();
        } else {
            this.goBackToAccounts();
        }
    }

    goBackToBC() {
        localStorage.removeItem('activeBcId');
        this.currentBcId = null;

        const vAcc = document.getElementById('view-accounts');
        const vBc = document.getElementById('view-bc');
        const vMembers = document.getElementById('view-members');
        const btnBack = document.getElementById('btn-back');
        const headerTitle = document.getElementById('header-title');

        if (vAcc) vAcc.style.display = 'none';
        if (vBc) vBc.style.display = 'block';
        if (vMembers) vMembers.style.display = 'none';
        if (btnBack) btnBack.style.display = 'inline-block';
        if (headerTitle) headerTitle.textContent = 'Business Center';

        this.renderBusinessCenters();
    }

    goBackToAccounts() {
        localStorage.removeItem('activeAccountEmail');
        localStorage.removeItem('activeBcId');
        this.currentAccountIndex = null;
        this.currentBcId = null;

        const vAcc = document.getElementById('view-accounts');
        const vBc = document.getElementById('view-bc');
        const vMembers = document.getElementById('view-members');
        const btnBack = document.getElementById('btn-back');
        const headerTitle = document.getElementById('header-title');

        if (vAcc) vAcc.style.display = 'block';
        if (vBc) vBc.style.display = 'none';
        if (vMembers) vMembers.style.display = 'none';
        if (btnBack) btnBack.style.display = 'none';
        if (headerTitle) headerTitle.textContent = 'TikTok Ads';
        this.renderAccounts();
    }

    async reloadCurrentAccountBCs(force = false) {
        if (this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        this.showToast(`Đang tự động quét Business Center...`);
        const bcListEl = document.getElementById('bc-list');
        if (bcListEl) bcListEl.innerHTML = `<div class="empty-box">Đang tự động quét Business Center từ TikTok...<br><span style="font-size: 11px; margin-top: 6px; display: inline-block;">Đang phân tích phiên trình duyệt và dữ liệu...</span></div>`;

        try {
            const url = force ? '/api/tiktok/bcs?force=true' : '/api/tiktok/bcs';
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email, force })
            });
            const data = await resp.json();

            if (data.success && data.businessCenters) {
                acc.businessCenters = data.businessCenters;
                this.renderBusinessCenters();
                if (data.businessCenters.length > 0) {
                    this.showToast(`Quét thấy ${data.businessCenters.length} Business Center!`);
                } else if (data.message) {
                    this.showToast(data.message);
                }
            } else {
                this.renderBusinessCenters();
                if (data.message) this.showToast(data.message);
            }
        } catch (e) {
            this.renderBusinessCenters();
            this.showToast('Lỗi kết nối quét Business Center');
        }
    }

    renderBusinessCenters() {
        if (this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const countEl = document.getElementById('bc-count');
        const listEl = document.getElementById('bc-list');

        if (countEl) countEl.textContent = bcs.length;
        if (!listEl) return;

        if (bcs.length === 0) {
            listEl.innerHTML = `
                <div class="empty-box">
                    Tài khoản chưa có Business Center nào.<br>
                    <span style="font-size: 11px; margin-top: 6px; display: inline-block;">Bạn có thể bấm "+ Thêm BC" hoặc "Tải lại từ TikTok".</span>
                </div>
            `;
            return;
        }

        listEl.innerHTML = bcs.map((bc, idx) => {
            const memberCount = (bc.members && Array.isArray(bc.members)) ? bc.members.length : (bc.memberCount || 1);
            const escapedName = this.escapeHtml(bc.name);
            const escapedId = this.escapeHtml(bc.id);
            const encodedBcId = encodeURIComponent(bc.id || '');

            return `
            <div class="bc-card" onclick="app.switchToMembersView('${encodedBcId}')" title="Bấm để vào trang Business Center">
                <div class="bc-card-main">
                    <div class="bc-card-name">${escapedName}</div>
                    <div class="bc-card-id">ID: ${escapedId}</div>
                    <div class="bc-card-stats">
                        <span><b>${parseInt(bc.advCount) || 0}</b> TKQC</span>
                        <span>•</span>
                        <span>👥 <b>${memberCount}</b> thành viên</span>
                        <span class="status-active-badge" style="margin-left: 6px;"><span class="status-active-dot"></span> Active</span>
                    </div>
                </div>
                <div class="bc-card-arrow">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
            </div>
            `;
        }).join('');
    }

    /* =========================================================
       QUẢN LÝ THÀNH VIÊN (MEMBERS / USERS) CỦA BUSINESS CENTER
       ========================================================= */
    openMembersModal(bcId) {
        if (this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(bcId));
        if (!bc) {
            this.showToast('Không tìm thấy Business Center');
            return;
        }

        this.currentBcId = bcId;
        localStorage.setItem('activeBcId', bcId);

        if (!bc.members || !Array.isArray(bc.members)) {
            bc.members = [];
            bc.memberCount = 0;
        }

        const vAcc = document.getElementById('view-accounts');
        const vBc = document.getElementById('view-bc');
        const vMembers = document.getElementById('view-members');
        const btnBack = document.getElementById('btn-back');
        const headerTitle = document.getElementById('header-title');

        if (vAcc) vAcc.style.display = 'none';
        if (vBc) vBc.style.display = 'none';
        if (vMembers) vMembers.style.display = 'block';
        if (btnBack) btnBack.style.display = 'inline-block';
        if (headerTitle) headerTitle.textContent = bc.name || 'Business Center';

        const nameEl = document.getElementById('member-page-bc-name') || document.getElementById('member-modal-bc-name');
        const idEl = document.getElementById('member-page-bc-id') || document.getElementById('member-modal-bc-id');
        const searchInput = document.getElementById('member-search-input');
        const filterSelect = document.getElementById('member-role-filter');

        if (nameEl) nameEl.textContent = bc.name || 'Business Center';
        if (idEl) idEl.textContent = bc.id || '';
        if (searchInput) searchInput.value = '';
        this.toggleAddMemberForm(false);
        const savedTab = localStorage.getItem('activeBcTab') || 'members';
        this.switchBCTab(savedTab);

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    switchToMembersView(bcId) {
        this.openMembersModal(decodeURIComponent(bcId || ''));
    }

    closeMembersModal() {
        this.goBackToBC();
    }

    /* =========================================================
       BC TABS SWITCHING (MEMBERS / ADV / PAYMENT)
       ========================================================= */
    switchBCTab(tabName) {
        localStorage.setItem('activeBcTab', tabName);

        const btnMembers = document.getElementById('tab-btn-members');
        const btnAdv = document.getElementById('tab-btn-adv');
        const btnPayment = document.getElementById('tab-btn-payment');

        const paneMembers = document.getElementById('tab-pane-members');
        const paneAdv = document.getElementById('tab-pane-adv');
        const panePayment = document.getElementById('tab-pane-payment');

        if (btnMembers) btnMembers.classList.toggle('active', tabName === 'members');
        if (btnAdv) btnAdv.classList.toggle('active', tabName === 'adv');
        if (btnPayment) btnPayment.classList.toggle('active', tabName === 'payment');

        if (paneMembers) paneMembers.style.display = tabName === 'members' ? 'block' : 'none';
        if (paneAdv) paneAdv.style.display = tabName === 'adv' ? 'block' : 'none';
        if (panePayment) panePayment.style.display = tabName === 'payment' ? 'block' : 'none';

        const headerTitle = document.getElementById('header-title');
        let bcName = '';
        if (this.currentAccountIndex !== null && this.currentBcId) {
            const bcs = (this.accounts[this.currentAccountIndex] && this.accounts[this.currentAccountIndex].businessCenters) || [];
            const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
            if (bc) bcName = bc.name;
        }

        if (headerTitle && bcName) {
            if (tabName === 'members') headerTitle.textContent = `${bcName} • Users`;
            else if (tabName === 'adv') headerTitle.textContent = `${bcName} • Accounts`;
            else if (tabName === 'payment') headerTitle.textContent = `${bcName} • Payment`;
        }

        if (tabName === 'members') {
            this.renderMembersList();
        } else if (tabName === 'adv') {
            this.renderAdvList();
        } else if (tabName === 'payment') {
            this.renderPaymentInfo();
        }

        // Vào đến tab nào thì tự động quét trang đó từ TikTok PC
        this.scanCurrentTab(tabName);
    }

    /* =========================================================
       TỰ ĐỘNG QUÉT DỮ LIỆU TAB HIỆN TẠI TỪ TIKTOK PC
       (Members: users/members, Adv: accounts/adv, Payment: payment/v2)
       ========================================================= */
    async scanCurrentTab(tabName, isManual = false) {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc) return;

        if (this.isScanningTab && this.isScanningTab === tabName) return;
        this.isScanningTab = tabName;

        const tabTitle = tabName === 'members' ? 'Thành viên (Users)' : (tabName === 'adv' ? 'Tài khoản QC (Accounts)' : 'Thanh toán (Payment)');
        if (isManual) {
            this.showToast(`🔄 Đang quét trang ${tabTitle} từ Chrome PC...`);
        }

        try {
            const resp = await fetch('/api/tiktok/bc/scan-tab', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: acc.email,
                    bcId: this.currentBcId,
                    tab: tabName
                })
            });
            const data = await resp.json();

            if (data && data.success && data.data) {
                if (tabName === 'members' && Array.isArray(data.data) && data.data.length > 0) {
                    bc.members = data.data;
                    bc.memberCount = bc.members.length;
                    this.renderMembersList();
                    this.showToast(`✅ Đã quét xong ${data.data.length} thành viên từ PC!`);
                } else if (tabName === 'adv' && Array.isArray(data.data) && data.data.length > 0) {
                    bc.advAccounts = data.data;
                    bc.advCount = bc.advAccounts.length;
                    this.renderAdvList();
                    this.showToast(`✅ Đã quét xong ${data.data.length} TKQC từ PC!`);
                } else if (tabName === 'payment' && data.data) {
                    bc.paymentInfo = data.data;
                    this.renderPaymentInfo();
                    const curr = data.data.currency || 'USD';
                    const bal = data.data.balance || '0.00';
                    this.showToast(`✅ Đã quét số dư: ${bal} ${curr} từ PC!`);
                }
                await this.saveCurrentAccountBCs();
            } else if (isManual && data && data.error) {
                this.showToast(`❌ ${data.error}`);
            }
        } catch (err) {
            if (isManual) this.showToast(`❌ Lỗi kết nối quét trang: ${err.message}`);
        } finally {
            this.isScanningTab = null;
        }
    }


    renderMembersList() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc) return;

        const tbody = document.getElementById('members-table-body');
        const emptyBox = document.getElementById('members-empty-box');
        const table = document.getElementById('members-table');
        const searchInput = document.getElementById('member-search-input');
        const filterSelect = document.getElementById('member-role-filter');

        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const roleFilter = filterSelect ? filterSelect.value : 'all';

        const members = bc.members || [];
        const filtered = members.filter(m => {
            const matchesQuery = !query || 
                (m.username && m.username.toLowerCase().includes(query)) ||
                (m.email && m.email.toLowerCase().includes(query));
            const matchesRole = roleFilter === 'all' || 
                (m.role && m.role.toLowerCase().includes(roleFilter.toLowerCase()));
            return matchesQuery && matchesRole;
        });

        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (table) table.style.display = 'none';
            if (emptyBox) emptyBox.style.display = 'block';
            return;
        }

        if (table) table.style.display = 'table';
        if (emptyBox) emptyBox.style.display = 'none';

        tbody.innerHTML = filtered.map(m => {
            const username = m.username || 'user';
            const email = m.email || '';
            const initial = (username ? username[0] : (email ? email[0] : 'U')).toUpperCase();
            const isAdmin = m.role && m.role.includes('Admin');
            const encodedEmail = encodeURIComponent(email);
            const escapedUsername = this.escapeHtml(username);
            const escapedEmail = this.escapeHtml(email);
            const escapedRole = this.escapeHtml(m.role || 'Admin');
            const escapedStatus = this.escapeHtml(m.status || 'Active');
            const escapedAssets = this.escapeHtml(m.assignedAssets || 'Assigned accounts (0) Assigned assets (0)');

            return `
            <tr>
                <td>
                    <div class="member-user-cell">
                        <div class="member-avatar">${this.escapeHtml(initial)}</div>
                        <span>${escapedUsername}</span>
                    </div>
                </td>
                <td>
                    <span class="status-active-badge">
                        <span class="status-active-dot"></span>
                        ${escapedStatus}
                    </span>
                </td>
                <td>
                    <span class="member-email-text" onclick="app.copyText(decodeURIComponent('${encodedEmail}'), 'Email')" title="Bấm để copy" style="cursor: pointer;">${escapedEmail}</span>
                </td>
                <td>
                    <span class="role-tag ${isAdmin ? 'admin' : ''}">${escapedRole}</span>
                </td>
                <td>
                    <div class="assets-text">${escapedAssets}</div>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="action-btn-view" onclick="app.viewMemberDetail('${encodedEmail}')">View</button>
                    <button class="action-btn-remove" onclick="app.removeMember('${encodedEmail}')">Remove</button>
                </td>
            </tr>
            `;
        }).join('');
    }

    toggleAddMemberForm(forceShow) {
        const form = document.getElementById('member-add-form');
        const btn = document.getElementById('btn-show-add-member');
        if (!form) return;

        const isVisible = form.style.display !== 'none';
        const willShow = (forceShow !== undefined) ? forceShow : !isVisible;

        form.style.display = willShow ? 'block' : 'none';
        if (btn) btn.textContent = willShow ? '✕ Đóng Form' : '+ Add Members';

        if (willShow) {
            const uInput = document.getElementById('input-member-username');
            const eInput = document.getElementById('input-member-email');
            const aInput = document.getElementById('input-member-assets');
            if (uInput) uInput.value = '';
            if (eInput) eInput.value = '';
            if (aInput) aInput.value = 'Assigned accounts (1) Assigned assets (0)';
            if (uInput) uInput.focus();
        }
    }

    async submitAddMember() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc) return;

        const uInput = document.getElementById('input-member-username');
        const eInput = document.getElementById('input-member-email');
        const rSelect = document.getElementById('input-member-role');
        const aInput = document.getElementById('input-member-assets');

        const username = uInput ? uInput.value.trim() : '';
        const email = eInput ? eInput.value.trim() : '';
        const role = rSelect ? rSelect.value : 'Admin';
        const assets = aInput && aInput.value.trim() ? aInput.value.trim() : `Assigned accounts (${bc.advCount || 1}) Assigned assets (0)`;

        if (!email) {
            this.showToast('Vui lòng nhập email thành viên');
            return;
        }

        if (!bc.members) bc.members = [];

        const existingIdx = bc.members.findIndex(m => (m.email || '').toLowerCase() === email.toLowerCase());
        const newMember = {
            username: username || email.split('@')[0],
            status: 'Active',
            email: email,
            role: role,
            assignedAssets: assets
        };

        if (existingIdx >= 0) {
            bc.members[existingIdx] = newMember;
            this.showToast('Đã cập nhật thông tin thành viên!');
        } else {
            bc.members.push(newMember);
            this.showToast('Đã thêm thành viên mới vào BC!');
        }

        bc.memberCount = bc.members.length;
        await this.saveCurrentAccountBCs();

        this.toggleAddMemberForm(false);
        this.renderMembersList();
        this.renderBusinessCenters();
    }

    async removeMember(encodedEmail) {
        const email = decodeURIComponent(encodedEmail);
        if (!confirm(`Bạn có chắc muốn xóa thành viên "${email}" khỏi Business Center này?`)) return;

        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc || !bc.members) return;

        bc.members = bc.members.filter(m => (m.email || '').toLowerCase() !== email.toLowerCase());
        bc.memberCount = bc.members.length;

        await this.saveCurrentAccountBCs();
        this.showToast(`Đã xóa thành viên ${email}`);
        this.renderMembersList();
        this.renderBusinessCenters();
    }

    viewMemberDetail(encodedEmail) {
        const email = decodeURIComponent(encodedEmail);
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc || !bc.members) return;

        const member = bc.members.find(m => (m.email || '').toLowerCase() === email.toLowerCase());
        if (!member) return;

        alert(`Thông tin thành viên:\n- Username: ${member.username}\n- Trạng thái: ${member.status}\n- Email: ${member.email}\n- Vai trò: ${member.role}\n- Phân bổ: ${member.assignedAssets}`);
    }

    exportMembers() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc || !bc.members || bc.members.length === 0) {
            this.showToast('Không có thành viên nào để xuất dữ liệu');
            return;
        }

        const lines = [
            `# DANH SÁCH THÀNH VIÊN BUSINESS CENTER: ${bc.name} (ID: ${bc.id})`,
            `Username | Status | Email | Role | Assigned Assets`,
            ...bc.members.map(m => `${m.username} | ${m.status} | ${m.email} | ${m.role} | ${m.assignedAssets}`)
        ];

        this.copyText(lines.join('\n'), 'danh sách thành viên');
    }

    copyUserLink(bcId) {
        const url = `https://business.tiktok.com/manage/users/members?org_id=${bcId}`;
        this.copyText(url, 'Link User Business Center');
    }

    copyCurrentBcUserLink() {
        if (!this.currentBcId) return;
        this.copyUserLink(this.currentBcId);
    }

    copyCurrentBcId() {
        if (!this.currentBcId) return;
        this.copyText(this.currentBcId, 'ID Business Center');
    }

    openCurrentBcUserWeb() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/users/members?org_id=${this.currentBcId}`;
        window.open(url, '_blank');
    }

    async openUserOnPC(bcId) {
        const targetBcId = bcId || this.currentBcId;
        if (!targetBcId || this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const url = `https://business.tiktok.com/manage/users/members?org_id=${targetBcId}`;
        this.showToast('Đang yêu cầu mở trên Chrome PC...');

        try {
            const resp = await fetch('/api/tiktok/open-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email, url })
            });
            const data = await resp.json();
            if (data.success) {
                this.showToast('Đã mở trang Member trên Chrome PC!');
            } else {
                this.showToast(data.error || 'Trình duyệt PC chưa sẵn sàng');
            }
        } catch (e) {
            this.showToast('Lỗi kết nối mở URL trên PC');
        }
    }

    async openCurrentBcUserPC() {
        await this.openUserOnPC(this.currentBcId);
    }

    /* =========================================================
       TAB 2: TÀI KHOẢN QUẢNG CÁO (ADV ACCOUNTS)
       https://business.tiktok.com/manage/accounts/adv?org_id=
       ========================================================= */
    renderAdvList() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc) return;

        if (!bc.advAccounts || !Array.isArray(bc.advAccounts)) {
            bc.advAccounts = [];
            bc.advCount = 0;
        }

        const tbody = document.getElementById('adv-table-body');
        const emptyBox = document.getElementById('adv-empty-box');
        const table = document.getElementById('adv-table');
        const searchInput = document.getElementById('adv-search-input');
        const statusFilter = document.getElementById('adv-status-filter');
        const ownerFilter = document.getElementById('adv-owner-filter');

        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const statusVal = statusFilter ? statusFilter.value : 'all';
        const ownerVal = ownerFilter ? ownerFilter.value : 'all';

        // Cập nhật dropdown Owner nếu chưa có
        if (ownerFilter && ownerFilter.options.length <= 1) {
            const owners = [...new Set(bc.advAccounts.map(a => a.owner || bc.name))];
            owners.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o;
                opt.textContent = o;
                ownerFilter.appendChild(opt);
            });
        }

        const list = (bc.advAccounts || []).filter(a => {
            const matchesQuery = !query || 
                (a.name && a.name.toLowerCase().includes(query)) || 
                (a.id && String(a.id).includes(query));
            const matchesStatus = statusVal === 'all' || 
                (a.status && a.status.toLowerCase() === statusVal.toLowerCase());
            const matchesOwner = ownerVal === 'all' || 
                (a.owner && a.owner.toLowerCase() === ownerVal.toLowerCase());

            return matchesQuery && matchesStatus && matchesOwner;
        });

        const totalEl = document.getElementById('adv-records-total');
        if (totalEl) totalEl.textContent = `${list.length} Records in Total`;

        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = '';
            if (table) table.style.display = 'none';
            if (emptyBox) emptyBox.style.display = 'block';
            return;
        }

        if (table) table.style.display = 'table';
        if (emptyBox) emptyBox.style.display = 'none';

        tbody.innerHTML = list.map(a => {
            const encodedAdvId = encodeURIComponent(a.id || '');
            const escapedName = this.escapeHtml(a.name);
            const escapedId = this.escapeHtml(a.id);
            const escapedOwner = this.escapeHtml(a.owner || bc.name || '');
            const escapedAssets = this.escapeHtml(a.linkedAssets || '0 assets');
            const membersCount = parseInt(a.membersCount) || 2;
            const adsManagerUrl = `https://ads.tiktok.com/i18n/home?adv_id=${encodedAdvId}`;
            const isApproved = (a.status || '').toLowerCase() === 'approved';
            const statusHtml = isApproved
                ? `<span class="status-approved-badge"><span class="status-dot-green">●</span> Approved</span>`
                : `<span class="status-suspended-badge"><span class="status-dot-red">▲</span> Suspended</span>`;

            return `
            <tr>
                <td>
                    <div class="adv-name-title">${escapedName}</div>
                    <div class="adv-id-subtitle" onclick="app.copyText(decodeURIComponent('${encodedAdvId}'), 'ID TKQC')" title="Bấm để copy ID">ID: ${escapedId}</div>
                </td>
                <td>${statusHtml}</td>
                <td><span style="font-size: 12px; color: var(--text-secondary);">${escapedOwner}</span></td>
                <td>
                    <div style="font-weight: 500; font-size: 12px;">${escapedAssets}</div>
                    <div style="font-size: 10px; color: var(--text-tertiary);">ℹ No TikTok accounts are linked</div>
                </td>
                <td>
                    <span style="font-weight: 600; font-size: 12px;">${membersCount}</span>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <a href="${adsManagerUrl}" target="_blank" class="adv-action-link primary" title="Mở TikTok Ads Manager">Go to Ads Manager ↗</a>
                    <button class="action-btn-remove" onclick="app.removeAdvAccount('${encodedAdvId}')" title="Xóa">✕</button>
                </td>
            </tr>
            `;
        }).join('');
    }

    toggleAddAdvForm(forceShow) {
        const form = document.getElementById('adv-add-form');
        const btn = document.getElementById('btn-show-add-adv');
        if (!form) return;

        const isVisible = form.style.display !== 'none';
        const willShow = (forceShow !== undefined) ? forceShow : !isVisible;

        form.style.display = willShow ? 'block' : 'none';
        if (btn) btn.textContent = willShow ? '✕ Đóng Form' : '+ Add advertiser account';

        if (willShow) {
            const nInput = document.getElementById('input-adv-name');
            const idInput = document.getElementById('input-adv-id');
            const oInput = document.getElementById('input-adv-owner');
            if (nInput) nInput.value = '';
            if (idInput) idInput.value = '';
            if (oInput && this.currentAccountIndex !== null) {
                const bc = (this.accounts[this.currentAccountIndex].businessCenters || []).find(b => String(b.id) === String(this.currentBcId));
                oInput.value = bc ? bc.name : 'Dalton RodriguezLU8C';
            }
            if (nInput) nInput.focus();
        }
    }

    async submitAddAdv() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc) return;

        const nInput = document.getElementById('input-adv-name');
        const idInput = document.getElementById('input-adv-id');
        const sSelect = document.getElementById('input-adv-status');
        const oInput = document.getElementById('input-adv-owner');

        const name = nInput ? nInput.value.trim() : '';
        const id = idInput ? idInput.value.trim() : '';
        const status = sSelect ? sSelect.value : 'Approved';
        const owner = oInput && oInput.value.trim() ? oInput.value.trim() : (bc.name || 'Dalton RodriguezLU8C');

        if (!name || !id) {
            this.showToast('Vui lòng nhập tên và ID tài khoản quảng cáo');
            return;
        }

        if (!bc.advAccounts) bc.advAccounts = [];
        bc.advAccounts.unshift({
            id,
            name,
            status,
            owner,
            linkedAssets: '0 assets',
            membersCount: 2
        });
        bc.advCount = bc.advAccounts.length;

        await this.saveCurrentAccountBCs();
        this.toggleAddAdvForm(false);
        this.renderAdvList();
        this.showToast('Đã thêm tài khoản quảng cáo!');
    }

    async removeAdvAccount(encodedAdvId) {
        const advId = decodeURIComponent(encodedAdvId || '');
        if (!confirm(`Bạn có chắc muốn xóa tài khoản QC này khỏi Business Center?`)) return;
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc || !bc.advAccounts) return;

        bc.advAccounts = bc.advAccounts.filter(a => String(a.id) !== String(advId));
        bc.advCount = bc.advAccounts.length;

        await this.saveCurrentAccountBCs();
        this.renderAdvList();
        this.showToast('Đã xóa tài khoản quảng cáo');
    }

    copyAdvLink() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/accounts/adv?org_id=${this.currentBcId}`;
        this.copyText(url, 'Link Quản lý TKQC');
    }

    openAdvWeb() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/accounts/adv?org_id=${this.currentBcId}`;
        window.open(url, '_blank');
    }

    async openAdvPC() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/accounts/adv?org_id=${this.currentBcId}`;
        await this.openUrlOnPCInternal(url, 'Quản lý TKQC');
    }

    /* =========================================================
       TAB 3: THANH TOÁN (PAYMENT & BILLING)
       https://business.tiktok.com/manage/payment/v2?org_id=
       ========================================================= */
    renderPaymentInfo() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const bcs = acc.businessCenters || [];
        const bc = bcs.find(b => String(b.id) === String(this.currentBcId));
        if (!bc) return;

        const info = bc.paymentInfo || {};
        const portfolioIdEl = document.getElementById('payment-portfolio-id');
        const amountEl = document.getElementById('payment-cash-amount');
        const currencyEl = document.getElementById('payment-cash-currency');
        const totalStrEl = document.getElementById('payment-total-str');
        const methodsCountEl = document.getElementById('payment-methods-count');

        if (portfolioIdEl) portfolioIdEl.textContent = info.portfolioId || bc.id || '---';
        if (amountEl) amountEl.textContent = (info.balance !== undefined && info.balance !== '') ? info.balance : '0.00';
        if (currencyEl) currencyEl.textContent = info.currency || 'USD';
        if (totalStrEl) totalStrEl.textContent = (info.balance !== undefined && info.balance !== '') ? `${info.balance} ${info.currency || 'USD'}` : 'Chưa quét dữ liệu';
        if (methodsCountEl) methodsCountEl.textContent = info.paymentMethodsCount !== undefined ? info.paymentMethodsCount : 0;

        this.filterPaymentTable();
    }

    filterPaymentTable() {
        if (this.currentAccountIndex === null || !this.currentBcId) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;
        const bc = (acc.businessCenters || []).find(b => String(b.id) === String(this.currentBcId));
        if (!bc || !bc.paymentInfo) return;

        const tbody = document.getElementById('payment-table-body');
        const searchInput = document.getElementById('payment-search-input');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        const list = (bc.paymentInfo.adCreditAccounts || []).filter(item => {
            return !query || 
                (item.name && item.name.toLowerCase().includes(query)) ||
                (item.id && String(item.id).includes(query));
        });

        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-tertiary); padding: 24px;">Chưa có dữ liệu thanh toán.<br><button class="btn-small btn-tiktok-green" style="margin-top: 8px;" onclick="app.scanCurrentTab('payment', true)">🔄 Bấm để quét live từ Chrome PC</button></td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(item => {
            const isApproved = (item.status || '').toLowerCase() === 'approved';
            const statusHtml = isApproved
                ? `<span class="status-approved-badge"><span class="status-dot-green">●</span> Approved</span>`
                : `<span class="status-suspended-badge"><span class="status-dot-red">●</span> Suspended</span>`;
            const encodedId = encodeURIComponent(item.id || '');
            const adsManagerUrl = `https://ads.tiktok.com/i18n/home?adv_id=${encodedId}`;
            const escapedName = this.escapeHtml(item.name);
            const escapedId = this.escapeHtml(item.id);
            const escapedBalance = this.escapeHtml(item.creditBalance || ('0.00 ' + ((bc.paymentInfo && bc.paymentInfo.currency) ? bc.paymentInfo.currency : 'USD')));
            const escapedThreshold = this.escapeHtml(item.threshold || '-');
            const escapedBudget = this.escapeHtml(item.budgetManager || 'Unlimited');

            return `
            <tr>
                <td>
                    <div style="font-weight: 600; font-size: 13px; color: #ffffff;">${escapedName}</div>
                    <div style="font-size: 11px; font-family: monospace; color: var(--text-tertiary);">ID: ${escapedId}</div>
                    <a href="${adsManagerUrl}" target="_blank" style="font-size: 11px; color: #00bfa5; text-decoration: none;">Ads Manager ↗</a>
                </td>
                <td>${statusHtml}</td>
                <td>
                    <span style="font-weight: 600; font-size: 12px; color: #ffffff;">${escapedBalance}</span>
                </td>
                <td><span style="color: var(--text-tertiary); font-size: 12px;">${escapedThreshold}</span></td>
                <td style="text-align: right;">
                    <span style="font-size: 12px; color: var(--text-secondary);">${escapedBudget}</span>
                </td>
            </tr>
            `;
        }).join('');
    }

    copyPaymentLink() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/payment/v2?org_id=${this.currentBcId}`;
        this.copyText(url, 'Link Thanh toán (Payment)');
    }

    openPaymentWeb() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/payment/v2?org_id=${this.currentBcId}`;
        window.open(url, '_blank');
    }

    async openPaymentPC() {
        if (!this.currentBcId) return;
        const url = `https://business.tiktok.com/manage/payment/v2?org_id=${this.currentBcId}`;
        await this.openUrlOnPCInternal(url, 'Thanh toán (Payment)');
    }

    async openUrlOnPCInternal(url, label) {
        if (this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        this.showToast(`Đang mở ${label} trên Chrome PC...`);
        try {
            const resp = await fetch('/api/tiktok/open-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email, url })
            });
            const data = await resp.json();
            if (data.success) {
                this.showToast(`Đã mở ${label} trên Chrome PC!`);
            } else {
                this.showToast(data.error || 'Trình duyệt PC chưa sẵn sàng');
            }
        } catch (e) {
            this.showToast('Lỗi kết nối mở URL trên PC');
        }
    }


    async saveCurrentAccountBCs() {
        if (this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        try {
            await fetch('/api/tiktok/bcs/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email, businessCenters: acc.businessCenters })
            });
        } catch (e) {}
    }

    async promptAddBC() {
        if (this.currentAccountIndex === null) return;
        const acc = this.accounts[this.currentAccountIndex];
        if (!acc) return;

        const name = prompt('Nhập tên Business Center:', 'Amelie Smith');
        if (!name) return;
        const id = prompt('Nhập mã ID Business Center (19 số):', '');
        if (!id) return;
        const advCountStr = prompt('Số lượng tài khoản quảng cáo (Ads Manager):', '1');

        const bcs = acc.businessCenters || [];
        bcs.push({
            id: id.trim(),
            name: name.trim(),
            advCount: parseInt(advCountStr) || 0,
            memberCount: 1,
            status: 'Active',
            members: [
                {
                    username: (acc.email.split('@')[0] || 'admin').toLowerCase(),
                    status: 'Active',
                    email: acc.email,
                    role: 'Admin',
                    assignedAssets: `Assigned accounts (${advCountStr || 1}) Assigned assets (0)`
                }
            ]
        });

        try {
            const resp = await fetch('/api/tiktok/bcs/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email, businessCenters: bcs })
            });
            const data = await resp.json();
            if (data.success) {
                acc.businessCenters = data.businessCenters;
                this.renderBusinessCenters();
                this.showToast('Đã lưu Business Center');
            }
        } catch (e) {
            this.showToast('Lỗi lưu Business Center');
        }
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async copyText(text, label = '') {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            this.showToast(`Đã copy ${label}`);
        } catch (e) {
            this.showToast('Lỗi sao chép');
        }
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 2200);
    }
}

window.app = new MobileApp();
