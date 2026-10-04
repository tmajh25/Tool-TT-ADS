// services/smartplusHelper.js
// Logic Bypass TikTok Smart+ Campaign tích hợp trực tiếp vào Tool

function getInjectionScript(enabled = true) {
    return `
(() => {
    "use strict";
    window.__ttSmartPlusBypassEnabled = ${enabled ? 'true' : 'false'};

    const TIEN_TO = "user_skip_1mn_preference_";
    const MUC = ["app", "lead", "sales"];

    function maTaiKhoan() {
        try {
            let id = new URLSearchParams(location.search).get("aadvid");
            if (!id && location.hash && location.hash.includes("?")) {
                id = new URLSearchParams(location.hash.split("?")[1]).get("aadvid");
            }
            if (id && /^\\d{6,}$/.test(id)) return id;
        } catch (e) {}
        return null;
    }

    function khoa() {
        const id = maTaiKhoan();
        return id ? TIEN_TO + id : null;
    }

    function apDung(bat) {
        const k = khoa();
        if (!k) return null;
        let cu = {};
        try {
            const raw = sessionStorage.getItem(k);
            if (raw) cu = JSON.parse(raw);
        } catch (e) {}

        try {
            if (!bat) {
                if (MUC.some(m => cu[m])) {
                    const moi = { ...cu };
                    for (const m of MUC) delete moi[m];
                    sessionStorage.setItem(k, JSON.stringify(moi));
                }
                const hop = document.getElementById("ttcm-hop");
                if (hop) hop.remove();
                return { khoa: k, bat: false };
            } else {
                if (!MUC.every(m => cu[m] === true)) {
                    sessionStorage.setItem(k, JSON.stringify({ ...cu, app: true, lead: true, sales: true }));
                }
                return { khoa: k, bat: true };
            }
        } catch (e) {
            return { error: e.message };
        }
    }

    // Luôn áp dụng cờ opt-out vào sessionStorage
    apDung(window.__ttSmartPlusBypassEnabled);
    setInterval(() => apDung(window.__ttSmartPlusBypassEnabled), 600);
    addEventListener("popstate", () => apDung(window.__ttSmartPlusBypassEnabled));
    addEventListener("pageshow", () => apDung(window.__ttSmartPlusBypassEnabled));

    // Khởi tạo bảng chuyển đổi chế độ chiến dịch nổi trên giao diện form TikTok Ads
    const CHE_DO_MAC_DINH = [
        { value: 0, ten: "Smart+", mo: "TikTok tự tối ưu nhắm mục tiêu và nội dung" },
        { value: 1, ten: "Thủ công", mo: "Tự đặt ngân sách, nhắm mục tiêu, nội dung" },
        { value: 2, ten: "Tìm kiếm", mo: "Chiến dịch theo từ khoá trên kết quả tìm kiếm" }
    ];

    function timVm() {
        const da = new Set();
        for (const el of document.querySelectorAll("*")) {
            const c = el.__vueParentComponent || el.__vue__ || null;
            if (!c) continue;
            let cur = c, sau = 0;
            while (cur && sau++ < 14) {
                if (!da.has(cur)) {
                    da.add(cur);
                    for (const o of [cur, cur.proxy, cur.ctx, cur.setupState].filter(Boolean)) {
                        let ten = [];
                        try { ten = Object.keys(o); } catch { continue; }
                        if (ten.includes("handleCampaignTypeClick") && ten.includes("campaignType")) return o;
                    }
                }
                cur = cur.parent;
            }
        }
        return null;
    }

    function damBaoCSS() {
        if (document.getElementById("ttcm-style")) return;
        const style = document.createElement("style");
        style.id = "ttcm-style";
        style.textContent = \`
            #ttcm-hop { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 290px; padding: 12px 13px 13px; box-sizing: border-box; background: #fff; border: 1px solid #e2e2e5; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.16); font: 13px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #18181b; }
            #ttcm-hop * { box-sizing: border-box; }
            .ttcm-dau { display: flex; align-items: center; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6b6b74; margin-bottom: 8px; }
            .ttcm-dong { margin-left: auto; border: 0; background: none; font: inherit; font-size: 17px; line-height: 1; color: #6b6b74; cursor: pointer; padding: 0 2px; }
            .ttcm-dong:hover { color: #18181b; }
            .ttcm-mo { margin: 0 0 9px; font-size: 11.5px; color: #6b6b74; }
            .ttcm-nut { display: block; width: 100%; text-align: left; padding: 7px 10px; margin-bottom: 6px; border: 1px solid #e2e2e5; border-radius: 7px; background: #fff; font: inherit; cursor: pointer; }
            .ttcm-nut:hover { background: #f6f6f7; }
            .ttcm-nut b { display: block; font-weight: 600; font-size: 12.5px; }
            .ttcm-nut small { display: block; margin-top: 1px; font-size: 11px; color: #6b6b74; }
            .ttcm-nut.ttcm-dang { border-color: #2563eb; background: #eff6ff; }
            .ttcm-nut.ttcm-dang b { color: #1d4ed8; }
            .ttcm-canh { margin: 9px 0 0; padding: 7px 9px; border: 1px solid #fde68a; border-radius: 6px; background: #fffbeb; font-size: 11px; color: #92400e; }
            .ttcm-lai { width: 100%; margin-top: 8px; padding: 5px 8px; border: 1px solid #e2e2e5; border-radius: 6px; background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
            .ttcm-lai:hover { background: #f6f6f7; }
            #ttcm-bao:empty { display: none; }
            #ttcm-bao { margin-top: 8px; padding: 6px 8px; border-radius: 6px; font-size: 11.5px; }
            #ttcm-bao.ttcm-ok { background: #e6f5ec; color: #0d6b3d; }
            #ttcm-bao.ttcm-loi { background: #fdecea; color: #a1281c; }
        \`;
        document.head.appendChild(style);
    }

    function veBang(vm) {
        if (!window.__ttSmartPlusBypassEnabled) {
            const h = document.getElementById("ttcm-hop");
            if (h) h.remove();
            return;
        }
        damBaoCSS();
        let hop = document.getElementById("ttcm-hop");
        if (!hop) {
            hop = document.createElement("div");
            hop.id = "ttcm-hop";
            document.body.appendChild(hop);
        }
        hop.textContent = "";

        const dau = document.createElement("div");
        dau.className = "ttcm-dau";
        dau.textContent = "Chế độ chiến dịch TikTok";
        const dong = document.createElement("button");
        dong.className = "ttcm-dong";
        dong.textContent = "×";
        dong.title = "Ẩn bảng";
        dong.addEventListener("click", () => hop.remove());
        dau.appendChild(dong);
        hop.appendChild(dau);

        if (!vm) {
            const p = document.createElement("p");
            p.className = "ttcm-mo";
            p.textContent = "Đang ở chế độ tạo chiến dịch. Hãy chọn mục tiêu (Doanh số/Khách hàng) rồi bấm Tìm lại form.";
            hop.appendChild(p);
        } else {
            let hienTai = null;
            try { hienTai = vm.campaignType; } catch (e) {}

            for (const cd of CHE_DO_MAC_DINH) {
                const nut = document.createElement("button");
                nut.className = "ttcm-nut" + (cd.value === hienTai ? " ttcm-dang" : "");
                const b = document.createElement("b");
                b.textContent = cd.ten + (cd.value === hienTai ? "  (Đang chọn)" : "");
                const s = document.createElement("small");
                s.textContent = cd.mo;
                nut.append(b, s);
                nut.addEventListener("click", () => {
                    try {
                        vm.handleCampaignTypeClick({ value: cd.value });
                    } catch (err) {
                        const bEl = document.getElementById("ttcm-bao");
                        if (bEl) { bEl.textContent = "Lỗi đổi chế độ: " + err.message; bEl.className = "ttcm-loi"; }
                        return;
                    }
                    setTimeout(() => {
                        veBang(vm);
                        const bEl = document.getElementById("ttcm-bao");
                        if (bEl) { bEl.textContent = "Đã chuyển sang: " + cd.ten; bEl.className = "ttcm-ok"; }
                    }, 500);
                });
                hop.appendChild(nut);
            }
        }

        const lai = document.createElement("button");
        lai.className = "ttcm-lai";
        lai.textContent = "Tìm lại form chiến dịch";
        lai.addEventListener("click", () => veBang(timVm()));
        hop.appendChild(lai);

        const bang = document.createElement("div");
        bang.id = "ttcm-bao";
        hop.appendChild(bang);
    }

    // Tự động kiểm tra hiển thị khi đang ở trang tạo chiến dịch
    if (location.href.includes("campaign/create") || location.href.includes("i18n")) {
        let dem = 0;
        const interval = setInterval(() => {
            const vm = timVm();
            if (vm || ++dem > 15) {
                clearInterval(interval);
                if (vm) veBang(vm);
            }
        }, 1500);
    }

    // Expose hàm điều khiển thủ công cho Selenium
    window.__setTTSmartPlusBypass = (enable) => {
        window.__ttSmartPlusBypassEnabled = !!enable;
        apDung(window.__ttSmartPlusBypassEnabled);
        if (enable) {
            veBang(timVm());
        } else {
            const h = document.getElementById("ttcm-hop");
            if (h) h.remove();
        }
        return { success: true, enabled: window.__ttSmartPlusBypassEnabled };
    };
})();
`;
}

module.exports = {
    getInjectionScript
};
