"use strict";

const oTrangThai = document.getElementById("trangThai");
const oBat = document.getElementById("bat");
const oTaiLai = document.getElementById("taiLai");

function ve(chu, loai) {
  oTrangThai.textContent = chu;
  oTrangThai.className = "the" + (loai ? " " + loai : "");
}

async function tabHienTai() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function noi(tab, tin) {
  return await new Promise((res) => {
    chrome.tabs.sendMessage(tab.id, tin, (tl) => {
      if (chrome.runtime.lastError) res(null);
      else res(tl || null);
    });
  });
}

function hienKetQua(tl) {
  if (!tl) {
    ve("Không gọi được tiện ích trên trang này.\nHãy mở một trang ads.tiktok.com rồi tải lại trang.", "loi");
    oBat.disabled = true;
    return;
  }
  oBat.disabled = false;
  oBat.checked = !tl.tat;
  if (!tl.tk) {
    ve("Trang này không có tham số aadvid, nên chưa biết tài khoản nào.\nMở trang tạo chiến dịch của một tài khoản quảng cáo.", null);
    return;
  }
  if (tl.tat) {
    ve("ĐANG TẮT cho tài khoản …" + tl.tk.slice(-4) + "\nTikTok sẽ khoá lại như mặc định.", null);
    return;
  }
  ve(
    "ĐANG BẬT cho tài khoản …" + tl.tk.slice(-4) + "\n" + tl.khoa + "\n= " + (tl.gia || "(chưa ghi được)"),
    tl.gia ? "ok" : "loi"
  );
}

async function nap() {
  const tab = await tabHienTai();
  if (!tab || !/^https:\/\/ads\.tiktok\.com\//.test(tab.url || "")) {
    ve("Hãy mở một trang ads.tiktok.com rồi bấm lại vào tiện ích.", null);
    oBat.disabled = true;
    return;
  }
  hienKetQua(await noi(tab, { viec: "trangThai" }));
}

oBat.addEventListener("change", async () => {
  const tab = await tabHienTai();
  if (!tab) return;
  hienKetQua(await noi(tab, { viec: "dat", tat: !oBat.checked }));
  ve(oTrangThai.textContent + "\n\nTải lại trang để TikTok đọc lại cờ.", oBat.checked ? "ok" : null);
});

oTaiLai.addEventListener("click", async () => {
  const tab = await tabHienTai();
  if (tab) chrome.tabs.reload(tab.id);
  window.close();
});

nap();

