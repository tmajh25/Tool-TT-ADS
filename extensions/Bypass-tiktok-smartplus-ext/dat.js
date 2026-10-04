// Chạy ở document_start. Việc duy nhất: ghi bản ghi opt-out CỦA CHÍNH TikTok
// vào sessionStorage trước khi ứng dụng đọc nó.
//
//   khóa:  user_skip_1mn_preference_<aadvid/advertiser_id>
//   giá:   {"app":true,"lead":true,"sales":true,"hasRectifiedSession":true}

(() => {
  "use strict";

  const TAT = "__ttspp_tat";        // cờ tắt của riêng tiện ích (localStorage)
  const TIEN_TO = "user_skip_1mn_preference_";
  const MUC = ["app", "lead", "sales"];

  // 1. Tiêm script can thiệp Storage.prototype.getItem trực tiếp vào MAIN world
  try {
    const s = document.createElement("script");
    s.textContent = `
      (() => {
        try {
          if (!window.__origStorageGetItem) {
            window.__origStorageGetItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function(k) {
              if (typeof k === "string" && k.startsWith("user_skip_1mn_preference_")) {
                try {
                  const raw = window.__origStorageGetItem.apply(this, arguments);
                  let cu = {};
                  if (raw) { try { cu = JSON.parse(raw); } catch (e) {} }
                  return JSON.stringify({ ...cu, app: true, lead: true, sales: true, hasRectifiedSession: true });
                } catch (e) {
                  return JSON.stringify({ app: true, lead: true, sales: true, hasRectifiedSession: true });
                }
              }
              return window.__origStorageGetItem.apply(this, arguments);
            };
          }
        } catch (e) {}
      })();
    `;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {}

  // 2. Tìm tất cả ID tài khoản quảng cáo qua URL search, hash, path, cookie, storage
  function tatCaIds() {
    const ids = new Set();
    try {
      // URL search params
      const sp = new URLSearchParams(location.search);
      for (const k of ['aadvid', 'advertiser_id', 'adv_id', 'org_id']) {
        const v = sp.get(k);
        if (v && /^\d{6,}$/.test(v)) ids.add(v);
      }

      // URL hash params
      if (location.hash && location.hash.includes("?")) {
        const hp = new URLSearchParams(location.hash.split("?")[1]);
        for (const k of ['aadvid', 'advertiser_id', 'adv_id', 'org_id']) {
          const v = hp.get(k);
          if (v && /^\d{6,}$/.test(v)) ids.add(v);
        }
      }

      // Pathname (các dãy số 16-20 chữ số đặc trưng của TikTok Advertiser ID)
      const pathMatches = location.pathname.match(/\b(7\d{18,19}|\d{16,20})\b/g);
      if (pathMatches) {
        pathMatches.forEach(id => ids.add(id));
      }

      // Cookies
      const cMatch = document.cookie.match(/(?:advertiser_id|aadvid|adv_id)=(\d{6,})/ig);
      if (cMatch) {
        cMatch.forEach(c => {
          const m = c.match(/\d{6,}/);
          if (m) ids.add(m[0]);
        });
      }

      // Quét các khóa đã có trong sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(TIEN_TO)) {
          const id = k.replace(TIEN_TO, '');
          if (id && /^\d{6,}$/.test(id)) ids.add(id);
        }
      }
    } catch (e) {}
    return Array.from(ids);
  }

  function maTaiKhoan() {
    const ids = tatCaIds();
    return ids.length > 0 ? ids[0] : null;
  }

  function dangTat() {
    try { return localStorage.getItem(TAT) === "1"; } catch (e) { return false; }
  }

  function doc(k) {
    try {
      const t = sessionStorage.getItem(k);
      if (!t) return null;
      const o = JSON.parse(t);
      return o && typeof o === "object" ? o : null;
    } catch (e) { return null; }
  }

  // Trộn chứ không ghi đè: TikTok còn cất hasRectifiedSession trong cùng bản ghi.
  function apDung() {
    const ids = tatCaIds();
    const tat = dangTat();
    if (ids.length === 0) return null;

    let lastRes = null;
    for (const id of ids) {
      const k = TIEN_TO + id;
      const cu = doc(k) || {};
      try {
        if (tat) {
          if (MUC.some((m) => cu[m])) {
            const moi = { ...cu };
            for (const m of MUC) delete moi[m];
            sessionStorage.setItem(k, JSON.stringify(moi));
          }
          lastRes = { khoa: k, bat: false, gia: sessionStorage.getItem(k) };
        } else {
          if (!MUC.every((m) => cu[m] === true)) {
            sessionStorage.setItem(k, JSON.stringify({ ...cu, app: true, lead: true, sales: true, hasRectifiedSession: true }));
          }
          lastRes = { khoa: k, bat: true, gia: sessionStorage.getItem(k) };
        }
      } catch (e) {
        lastRes = { khoa: k, bat: !tat, gia: null, loi: String(e && e.message) };
      }
    }
    return lastRes;
  }

  // Áp dụng ngay khi tải trang
  apDung();

  // Đề phòng SPA chuyển trang không tải lại hoặc đổi advertiser_id
  setInterval(apDung, 400);
  addEventListener("popstate", apDung);
  addEventListener("pageshow", apDung);

  // Trả lời popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((tin, _goc, traLoi) => {
      if (!tin || typeof tin !== "object") return;
      if (window.self !== window.top && !maTaiKhoan()) return;

      if (tin.viec === "trangThai") {
        traLoi({ ok: true, tk: maTaiKhoan(), tat: dangTat(), ...(apDung() || {}) });
        return true;
      }
      if (tin.viec === "dat") {
        try {
          if (tin.tat) localStorage.setItem(TAT, "1");
          else localStorage.removeItem(TAT);
        } catch (e) {}
        traLoi({ ok: true, tk: maTaiKhoan(), tat: dangTat(), ...(apDung() || {}) });
        return true;
      }
    });
  }
})();

