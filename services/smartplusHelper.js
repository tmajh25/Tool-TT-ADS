// services/smartplusHelper.js
// Logic Bypass TikTok Smart+ Campaign tích hợp trực tiếp vào Tool

function getInjectionScript(enabled = true) {
    return `
(() => {
    "use strict";
    window.__ttSmartPlusBypassEnabled = ${enabled ? 'true' : 'false'};

    // 1. Can thiệp trực tiếp vào Storage.prototype.getItem để bất kỳ khi nào TikTok Ads truy vấn cờ opt-out,
    // luôn trả về { app: true, lead: true, sales: true } ngay lập tức mà không phụ thuộc vào việc tìm aadvid
    try {
        if (!window.__origStorageGetItem) {
            window.__origStorageGetItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function(key) {
                if (window.__ttSmartPlusBypassEnabled !== false && typeof key === 'string' && key.startsWith('user_skip_1mn_preference_')) {
                    try {
                        const raw = window.__origStorageGetItem.apply(this, arguments);
                        let cu = {};
                        if (raw) {
                            try { cu = JSON.parse(raw); } catch (e) {}
                        }
                        return JSON.stringify({ ...cu, app: true, lead: true, sales: true, hasRectifiedSession: true });
                    } catch (e) {
                        return JSON.stringify({ app: true, lead: true, sales: true, hasRectifiedSession: true });
                    }
                }
                return window.__origStorageGetItem.apply(this, arguments);
            };
        }
    } catch (e) {}

    // 2. Tự động quét và ghi trực tiếp vào sessionStorage theo tất cả advertiser ID tìm thấy
    const TIEN_TO = "user_skip_1mn_preference_";
    const MUC = ["app", "lead", "sales"];

    function timTatCaIds() {
        const ids = new Set();
        try {
            // URL search
            const sp = new URLSearchParams(location.search);
            ['aadvid', 'adv_id', 'advertiser_id'].forEach(k => {
                const v = sp.get(k);
                if (v && /^\\d{6,}$/.test(v)) ids.add(v);
            });
            // URL hash
            if (location.hash && location.hash.includes("?")) {
                const hp = new URLSearchParams(location.hash.split("?")[1]);
                ['aadvid', 'adv_id', 'advertiser_id'].forEach(k => {
                    const v = hp.get(k);
                    if (v && /^\\d{6,}$/.test(v)) ids.add(v);
                });
            }
            // URL pathname
            const matchPath = location.pathname.match(/\\b(\\d{16,20})\\b/);
            if (matchPath) ids.add(matchPath[1]);

            // Cookies
            const cMatch = document.cookie.match(/(?:advertiser_id|aadvid|adv_id)=(\\d{6,})/ig);
            if (cMatch) {
                cMatch.forEach(c => {
                    const m = c.match(/\\d{6,}/);
                    if (m) ids.add(m[0]);
                });
            }

            // SessionStorage keys
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(TIEN_TO)) {
                    ids.add(k.replace(TIEN_TO, ''));
                }
            }
        } catch (e) {}
        return Array.from(ids);
    }

    function apDung(bat) {
        try {
            const ids = timTatCaIds();
            ids.forEach(id => {
                const k = TIEN_TO + id;
                let cu = {};
                try {
                    const raw = sessionStorage.getItem(k);
                    if (raw) cu = JSON.parse(raw);
                } catch (e) {}

                if (!bat) {
                    if (MUC.some(m => cu[m])) {
                        const moi = { ...cu };
                        for (const m of MUC) delete moi[m];
                        sessionStorage.setItem(k, JSON.stringify(moi));
                    }
                } else {
                    if (!MUC.every(m => cu[m] === true)) {
                        sessionStorage.setItem(k, JSON.stringify({ ...cu, app: true, lead: true, sales: true, hasRectifiedSession: true }));
                    }
                }
            });
        } catch (e) {}
    }

    apDung(window.__ttSmartPlusBypassEnabled);
    setInterval(() => apDung(window.__ttSmartPlusBypassEnabled), 800);
    addEventListener("popstate", () => apDung(window.__ttSmartPlusBypassEnabled));
    addEventListener("pageshow", () => apDung(window.__ttSmartPlusBypassEnabled));

    // 3. Khởi tạo bảng chuyển đổi chế độ chiến dịch nổi trên giao diện form TikTok Ads
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
            #ttcm-hop { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 300px; padding: 12px 14px 14px; box-sizing: border-box; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.22); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
            #ttcm-hop * { box-sizing: border-box; }
            .ttcm-dau { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #475569; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
            .ttcm-dong { border: 0; background: none; font: inherit; font-size: 18px; line-height: 1; color: #94a3b8; cursor: pointer; padding: 0 4px; }
            .ttcm-dong:hover { color: #0f172a; }
            .ttcm-mo { margin: 0 0 10px; font-size: 11.5px; color: #64748b; line-height: 1.4; }
            .ttcm-nut { display: block; width: 100%; text-align: left; padding: 8px 12px; margin-bottom: 6px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font: inherit; cursor: pointer; transition: all .2s; }
            .ttcm-nut:hover { background: #f1f5f9; border-color: #cbd5e1; }
            .ttcm-nut b { display: block; font-weight: 700; font-size: 13px; color: #0f172a; }
            .ttcm-nut small { display: block; margin-top: 2px; font-size: 11px; color: #64748b; }
            .ttcm-nut.ttcm-dang { border-color: #2563eb; background: #eff6ff; }
            .ttcm-nut.ttcm-dang b { color: #1d4ed8; }
            .ttcm-lai { width: 100%; margin-top: 8px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; color: #334155; }
            .ttcm-lai:hover { background: #f8fafc; }
            #ttcm-bao { margin-top: 8px; padding: 6px 8px; border-radius: 6px; font-size: 11.5px; }
            #ttcm-bao:empty { display: none; }
            #ttcm-bao.ttcm-ok { background: #dcfce7; color: #15803d; }
            #ttcm-bao.ttcm-loi { background: #fee2e2; color: #b91c1c; }
        \`;
        document.head.appendChild(style);
    }

    function veBang(vm) {
        if (window.__ttSmartPlusBypassEnabled === false) {
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
        dau.innerHTML = '<span>⚡ CHẾ ĐỘ CHIẾN DỊCH TIKTOK</span>';
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
            p.textContent = "Chưa nhận diện được form. Hãy chọn mục tiêu (Khách hàng tiềm năng / Doanh số) rồi bấm 'Dò lại form'.";
            hop.appendChild(p);
        } else {
            let hienTai = null;
            try { hienTai = vm.campaignType; } catch (e) {}

            for (const cd of CHE_DO_MAC_DINH) {
                const nut = document.createElement("button");
                nut.className = "ttcm-nut" + (cd.value === hienTai ? " ttcm-dang" : "");
                const b = document.createElement("b");
                b.textContent = cd.ten + (cd.value === hienTai ? "  ✓ (Đang chọn)" : "");
                const s = document.createElement("small");
                s.textContent = cd.mo;
                nut.append(b, s);
                nut.addEventListener("click", () => {
                    try {
                        vm.handleCampaignTypeClick({ value: cd.value });
                    } catch (err) {
                        const bEl = document.getElementById("ttcm-bao");
                        if (bEl) { bEl.textContent = "Lỗi: " + err.message; bEl.className = "ttcm-loi"; }
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
        lai.textContent = "🔄 Dò lại form chiến dịch";
        lai.addEventListener("click", () => veBang(timVm()));
        hop.appendChild(lai);

        const bang = document.createElement("div");
        bang.id = "ttcm-bao";
        hop.appendChild(bang);
    }

    // Định kỳ quét form tạo chiến dịch
    setInterval(() => {
        if (window.__ttSmartPlusBypassEnabled === false) return;
        if (location.href.includes("campaign/create") || location.href.includes("perf") || location.href.includes("ad")) {
            const vm = timVm();
            if (vm && !document.getElementById("ttcm-hop")) {
                veBang(vm);
            }
        }
    }, 2000);

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
