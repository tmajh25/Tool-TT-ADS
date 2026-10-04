// Chạy trong CHÍNH trang (world MAIN) — bắt buộc, vì phải chạm vào instance Vue
// của form, thứ mà thế giới riêng của tiện ích không nhìn thấy.
//
// Tiện ích KHÔNG tự bịa ra logic nào. Nó tìm đúng component mà Ads Manager dùng
// cho ô "Điểm bán hàng", rồi gọi chính hàm `handleCampaignTypeClick` của component
// đó — y như khi anh bấm nút gạt trên tài khoản có nút.
//
// Vì sao cần: có tài khoản bị TikTok ẩn nút gạt Smart+ (`isShowSppCreationApproachToggle`
// = false, và nó là computed nên không gán được). Nút bị ẩn nhưng hàm vẫn còn.

(() => {
  "use strict";

  // WebsiteCampaignType của chính TikTok — đọc được từ vm, đây chỉ là bản dự phòng.
  const CHE_DO_MAC_DINH = [
    { value: 0, ten: "Smart+", mo: "TikTok tự tối ưu nhắm mục tiêu và nội dung" },
    { value: 1, ten: "Thủ công", mo: "Anh tự đặt ngân sách, nhắm mục tiêu, nội dung" },
    { value: 2, ten: "Tìm kiếm", mo: "Chiến dịch theo từ khoá trên trang kết quả tìm kiếm" },
  ];

  // ─── Tìm component của form ────────────────────────────────────────────────

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

  function danhSachCheDo(vm) {
    // Ưu tiên enum thật của TikTok nếu đọc được.
    try {
      const e = vm.WebsiteCampaignType;
      if (e && typeof e === "object") {
        const ra = [];
        for (const [k, val] of Object.entries(e)) {
          if (!/^\d+$/.test(k)) continue;
          const goc = CHE_DO_MAC_DINH.find((x) => x.value === Number(k));
          ra.push({ value: Number(k), ten: goc ? goc.ten : String(val), mo: goc ? goc.mo : String(val) });
        }
        if (ra.length) return ra;
      }
    } catch {}
    return CHE_DO_MAC_DINH;
  }

  // ─── Bảng nhỏ ──────────────────────────────────────────────────────────────

  let hop = null;

  function ve(vm) {
    if (!hop) {
      hop = document.createElement("div");
      hop.id = "ttcm-hop";
      document.body.appendChild(hop);
    }
    hop.textContent = "";

    const dau = document.createElement("div");
    dau.className = "ttcm-dau";
    dau.textContent = "Chế độ chiến dịch";
    const dong = document.createElement("button");
    dong.className = "ttcm-dong";
    dong.textContent = "×";
    dong.title = "Ẩn bảng này";
    dong.addEventListener("click", () => hop.remove());
    dau.appendChild(dong);
    hop.appendChild(dau);

    if (!vm) {
      const p = document.createElement("p");
      p.className = "ttcm-mo";
      p.textContent = "Chưa thấy ô Điểm bán hàng. Chọn mục tiêu (ví dụ Doanh số bán hàng) rồi bấm ⟳.";
      hop.appendChild(p);
    } else {
      let hienTai = null;
      try { hienTai = vm.campaignType; } catch {}

      const an = document.createElement("p");
      an.className = "ttcm-mo";
      const coNut = (() => { try { return !!vm.isShowSppCreationApproachToggle; } catch { return null; } })();
      an.textContent = coNut === false
        ? "TikTok đang ẩn nút gạt Smart+ ở tài khoản này. Dưới đây gọi thẳng hàm của trang."
        : "Tài khoản này có sẵn nút gạt trên form. Dùng nút của TikTok cũng được.";
      hop.appendChild(an);

      for (const cd of danhSachCheDo(vm)) {
        const nut = document.createElement("button");
        nut.className = "ttcm-nut" + (cd.value === hienTai ? " ttcm-dang" : "");
        const b = document.createElement("b");
        b.textContent = cd.ten + (cd.value === hienTai ? "  ·  đang chọn" : "");
        const s = document.createElement("small");
        s.textContent = cd.mo;
        nut.append(b, s);
        nut.addEventListener("click", () => {
          try {
            vm.handleCampaignTypeClick({ value: cd.value });
          } catch (e) {
            bao("Gọi hàm hỏng: " + (e && e.message), true);
            return;
          }
          setTimeout(() => {
            let sau = null;
            try { sau = vm.campaignType; } catch {}
            ve(vm);   // vẽ lại trước, vì ve() dựng lại ô thông báo
            bao(sau === cd.value
              ? `Đã chuyển sang ${cd.ten}. Kiểm lại các ô trên form trước khi đăng.`
              : `Bấm rồi mà campaignType vẫn là ${sau}. Có thể TikTok đã đổi bản dựng.`, sau !== cd.value);
          }, 600);
        });
        hop.appendChild(nut);
      }

      const canh = document.createElement("p");
      canh.className = "ttcm-canh";
      canh.textContent = "Đổi xong hãy soát lại toàn bộ form. Chế độ này TikTok chưa mở cho tài khoản, nên máy chủ vẫn có quyền từ chối lúc đăng.";
      hop.appendChild(canh);
    }

    const lai = document.createElement("button");
    lai.className = "ttcm-lai";
    lai.textContent = "⟳  Tìm lại form";
    lai.addEventListener("click", () => ve(timVm()));
    hop.appendChild(lai);

    const bang = document.createElement("div");
    bang.id = "ttcm-bao";
    hop.appendChild(bang);
  }

  function bao(chu, loi) {
    const el = document.getElementById("ttcm-bao");
    if (!el) return;
    el.textContent = chu;
    el.className = loi ? "ttcm-loi" : "ttcm-ok";
  }

  // ─── Khởi động ─────────────────────────────────────────────────────────────
  // Form là SPA, component chỉ mount sau khi chọn mục tiêu, nên dò lại vài lần.

  let lan = 0;
  const dong = setInterval(() => {
    const vm = timVm();
    if (vm || ++lan > 20) {
      clearInterval(dong);
      ve(vm);
    }
  }, 1500);
})();
