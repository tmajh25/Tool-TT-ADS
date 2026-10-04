// hook.js - Chạy trong thế giới MAIN world tại document_start
// Nguyên lý: Đảm bảo TikTok Ads Manager luôn đọc được cờ opt-out của nút "Switch back"
// Khóa: user_skip_1mn_preference_<aadvid>
// Giá trị: {"app":true,"lead":true,"sales":true,"hasRectifiedSession":true}

(() => {
  "use strict";

  const TIEN_TO = "user_skip_1mn_preference_";
  const GIA_TRI_MAC_DINH = { app: true, lead: true, sales: true, hasRectifiedSession: true };

  // 1. Can thiệp Storage.prototype.getItem trong MAIN world
  try {
    if (!window.__origStorageGetItem) {
      window.__origStorageGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (typeof key === "string" && key.startsWith(TIEN_TO)) {
          try {
            const raw = window.__origStorageGetItem.apply(this, arguments);
            let cu = {};
            if (raw) {
              try { cu = JSON.parse(raw); } catch (e) {}
            }
            return JSON.stringify({ ...cu, ...GIA_TRI_MAC_DINH });
          } catch (e) {
            return JSON.stringify(GIA_TRI_MAC_DINH);
          }
        }
        return window.__origStorageGetItem.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 2. Can thiệp Storage.prototype.setItem trong MAIN world để ngăn TikTok ghi đè false
  try {
    if (!window.__origStorageSetItem) {
      window.__origStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, val) {
        if (typeof key === "string" && key.startsWith(TIEN_TO)) {
          try {
            let parsed = {};
            if (typeof val === "string") {
              try { parsed = JSON.parse(val); } catch (e) {}
            }
            const hopNhat = JSON.stringify({ ...parsed, ...GIA_TRI_MAC_DINH });
            return window.__origStorageSetItem.call(this, key, hopNhat);
          } catch (e) {}
        }
        return window.__origStorageSetItem.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 3. Quét ID tài khoản từ URL và ghi sẵn vào sessionStorage
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
    } catch (e) {}
    return Array.from(ids);
  }

  function ghiOptOut() {
    try {
      const ids = layTatCaIds();
      for (const id of ids) {
        const key = TIEN_TO + id;
        let cu = {};
        try {
          const raw = window.__origStorageGetItem ? window.__origStorageGetItem.call(sessionStorage, key) : sessionStorage.getItem(key);
          if (raw) cu = JSON.parse(raw);
        } catch (e) {}
        sessionStorage.setItem(key, JSON.stringify({ ...cu, ...GIA_TRI_MAC_DINH }));
      }
    } catch (e) {}
  }

  ghiOptOut();
  setInterval(ghiOptOut, 500);
  addEventListener("popstate", ghiOptOut);
  addEventListener("pageshow", ghiOptOut);
})();
