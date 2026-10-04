// Chạy ở document_start. Việc duy nhất: ghi bản ghi opt-out CỦA CHÍNH TikTok
// vào sessionStorage trước khi ứng dụng đọc nó.
//
//   khóa:  user_skip_1mn_preference_<aadvid>
//   giá:   {"app":true,"lead":true,"sales":true}

(() => {
  "use strict";

  const TAT = "__ttspp_tat";        // cờ tắt của riêng tiện ích (localStorage)
  const TIEN_TO = "user_skip_1mn_preference_";
  const MUC = ["app", "lead", "sales"];

  function maTaiKhoan() {
    try {
      let id = new URLSearchParams(location.search).get("aadvid");
      if (!id && location.hash.includes("?")) {
        id = new URLSearchParams(location.hash.split("?")[1]).get("aadvid");
      }
      if (id && /^\d{6,}$/.test(id)) return id;
    } catch (e) {}
    return null;
  }

  function khoa() {
    const id = maTaiKhoan();
    return id ? TIEN_TO + id : null;
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
    const k = khoa();
    if (!k) return null;
    const cu = doc(k) || {};
    const tat = dangTat();
    try {
      if (tat) {
        if (MUC.some((m) => cu[m])) {
          const moi = { ...cu };
          for (const m of MUC) delete moi[m];
          sessionStorage.setItem(k, JSON.stringify(moi));
        }
        return { khoa: k, bat: false, gia: sessionStorage.getItem(k) };
      }
      if (!MUC.every((m) => cu[m] === true)) {
        sessionStorage.setItem(k, JSON.stringify({ ...cu, app: true, lead: true, sales: true }));
      }
      return { khoa: k, bat: true, gia: sessionStorage.getItem(k) };
    } catch (e) {
      return { khoa: k, bat: !tat, gia: null, loi: String(e && e.message) };
    }
  }

  // Áp dụng ngay khi tải trang
  apDung();

  // Đề phòng SPA đổi aadvid trên URL hoặc tự xóa bản ghi giữa phiên
  setInterval(apDung, 500);
  addEventListener("popstate", apDung);
  addEventListener("pageshow", apDung);

  // Trả lời popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((tin, _goc, traLoi) => {
      if (!tin || typeof tin !== "object") return;
      // Nếu là iframe phụ và không có mã tài khoản thì không trả lời đè lên top frame
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

