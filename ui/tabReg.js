// ui/tabReg.js — Tab Đăng Ký Tài Khoản TikTok Ads

class TabReg {
    constructor() {
        this._setupIPCListeners();
    }

    _setupIPCListeners() {
        window.electronAPI.onRegProgress((text) => {
            this._addLog(text);
        });

        window.electronAPI.onRegResult((text) => {
            const box = document.getElementById('reg-result');
            box.value += text + '\n';
            box.scrollTop = box.scrollHeight;
        });

        window.electronAPI.onRegDone(() => {
            document.getElementById('btn-run-reg').disabled = false;
            document.getElementById('btn-stop-reg').disabled = true;
            this._addLog('🔥🔥 TẤT CẢ TIẾN TRÌNH ĐÃ HOÀN TẤT! 🔥🔥');
        });
    }

    _addLog(text) {
        const logBox = document.getElementById('reg-log');
        const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });

        // Chọn màu dựa theo ký tự đầu
        let color = 'text-slate-300';
        if (text.includes('✅') || text.includes('🎉')) color = 'text-emerald-400';
        else if (text.includes('❌') || text.includes('Lỗi')) color = 'text-red-400';
        else if (text.includes('⚠️')) color = 'text-amber-400';
        else if (text.includes('---')) color = 'text-blue-400 font-bold';

        const entry = document.createElement('div');
        entry.className = color;
        entry.innerHTML = `<span class="text-slate-500">[${time}]</span> ${text}`;
        logBox.appendChild(entry);

        // Giới hạn 300 dòng
        while (logBox.children.length > 300) logBox.removeChild(logBox.firstChild);
        logBox.scrollTop = logBox.scrollHeight;
    }

    startReg() {
        const config = {
            password: document.getElementById('reg-pass').value.trim(),
            quantity: parseInt(document.getElementById('reg-qty').value) || 1,
            onlyMail: document.getElementById('reg-only-mail').checked,
            autoClose: document.getElementById('reg-auto-close').checked,
        };

        document.getElementById('btn-run-reg').disabled = true;
        document.getElementById('btn-stop-reg').disabled = false;
        document.getElementById('reg-log').innerHTML = '';

        this._addLog(`🚀 Bắt đầu reg ${config.quantity} tài khoản...`);
        window.electronAPI.startReg(config);
    }

    stopReg() {
        window.electronAPI.stopReg();
        this._addLog('⛔ Đã gửi lệnh dừng...');
        document.getElementById('btn-stop-reg').disabled = true;
    }

    exportResults() {
        const data = document.getElementById('reg-result').value;
        if (!data.trim()) { showToast('Chưa có kết quả để xuất!'); return; }
        window.electronAPI.exportRegResults(data);
    }
}

window.tabReg = new TabReg();
