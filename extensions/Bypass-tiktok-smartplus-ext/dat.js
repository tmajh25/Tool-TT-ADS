// dat.js - Chạy ở document_start trong Isolated World
// Phối hợp với popup và đảm bảo cờ opt-out được áp dụng

(() => {
  "use strict";

  const TAT = "__ttspp_tat";
  const TIEN_TO = "user_skip_1mn_preference_";
  const MUC = ["app", "lead", "sales"];
  const GIA_TRI_MAC_DINH = { app: true, lead: true, sales: true, hasRectifiedSession: true };

  function layTatCaIds() {
    const ids = new Set();
    try {
      const sp = new URLSearchParams(location.search);
      for (const k of ["aadvid", "advertiser_id", "adv_id", "org_id"]) {
        const v = sp.get(k);
        if (v && /^\d{6,}$/.test(v)) ids.add(v);
      }

      if (location.hash && location.hash.includes("?")) {
        const hp = new URLSearchParams(location.hash.split("?")[1]);
        for (const k of ["aadvid", "advertiser_id", "adv_id", "org_id"]) {
          const v = hp.get(k);
          if (v && /^\d{6,}$/.test(v)) ids.add(v);
        }
      }

      const matchPath = location.pathname.match(/\b(7\d{18,19}|\d{16,20})\b/g);
      if (matchPath) {
        matchPath.forEach(id => ids.add(id));
      }

      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(TIEN_TO)) {
          const id = k.replace(TIEN_TO, "");
          if (id && /^\d{6,}$/.test(id)) ids.add(id);
        }
      }
    } catch (e) {}
    return Array.from(ids);
  }

  function maTaiKhoan() {
    const ids = layTatCaIds();
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

  function apDung() {
    const ids = layTatCaIds();
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
            sessionStorage.setItem(k, JSON.stringify({ ...cu, ...GIA_TRI_MAC_DINH }));
          }
          lastRes = { khoa: k, bat: true, gia: sessionStorage.getItem(k) };
        }
      } catch (e) {
        lastRes = { khoa: k, bat: !tat, gia: null, loi: String(e && e.message) };
      }
    }
    return lastRes;
  }

  apDung();
  setInterval(apDung, 400);
  addEventListener("popstate", apDung);
  addEventListener("pageshow", apDung);

  // Giao tiếp với popup.js
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
