# TikTok · Trả lại lựa chọn Smart+

Hiện lại **Chiến dịch thủ công** bên cạnh **Chiến dịch Smart+** trên trang tạo
chiến dịch, cho tài khoản bị TikTok khoá vào Smart+.

Không token. Không chạm vào Vue của trang. Không gõ cứng tên thẻ nào. Nó chỉ
ghi **đúng cái cờ opt-out mà nút "Switch back" của TikTok dùng**, rồi để Ads
Manager tự vẽ lại lựa chọn.

Từ **v2.2.0** không cần key kích hoạt, tiện ích chạy hoàn toàn offline và cục bộ trên trình duyệt.

## Cài đặt

1. Mở `chrome://extensions` trên trình duyệt.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển).
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục này.
4. Tải lại (F5) trang `ads.tiktok.com` đang mở.


## Dùng

Mở trang tạo chiến dịch. Chọn mục tiêu. Lựa chọn hiện ra sẵn, không phải bấm gì
trong tiện ích. Bấm vào icon tiện ích để xem nó đang bật cho tài khoản nào và cờ
đang là gì.

## Nó làm gì, chính xác

Trong bundle của Ads Manager (`6465.*.js`):

```js
zk = e => { try { const t = sessionStorage.getItem(e); if (t) return JSON.parse(t); return null } ... }

get hitSpp1mnLead() {
  const { lead = false } = zk(`user_skip_1mn_preference_${MU()}`) || {};
  return !lead && this.isSpp1mnLeadWhite;
}
```

và trong `2897.*.js`:

```js
const { app = false, lead = false, sales = false } = zk(`user_skip_1mn_preference_${MU()}`) || {};
P = {
  isAppPromotion: hitSpp1mnApp  || (isSpp1mnAppWhite  && isAppInstall && isSearchCampaign && !app),
  isLeadAds:      hitSpp1mnLead || (isSpp1mnLeadWhite && isLeadAds    && isSearchCampaign && !lead),
  isVirtualSales: hitSpp1mnSales|| (isSpp1mnSalesWhite&& isSalesSearchCampaign            && !sales),
  isTraffic:      isSpp1mnTrafficWhite,
};
// hideManualCampaignBySPPOnly({ key, hasSmartPlusCampaign }) -> featureGatingMap[key] -> ẩn "thủ công"
```

Đặt `app/lead/sales = true` làm **cả hai vế** của mỗi dòng thành `false`, nên
`hideManualCampaignBySPPOnly` trả `false`, và `CUSTOM_CAMPAIGN` được đưa trở lại
danh sách — do chính TikTok dựng, nên có nhãn thật, mô tả thật, `onChange` thật.

Vì vậy tiện ích chỉ cần đúng một việc, ở `document_start`:

```js
sessionStorage.setItem(
  "user_skip_1mn_preference_" + aadvid,
  JSON.stringify({ ...cũ, app: true, lead: true, sales: true })
);
```

Ghi **trộn**, không ghi đè, vì TikTok còn cất `hasRectifiedSession` trong cùng
bản ghi. TikTok xoá bản ghi này ở `beforeunload`, nên phải ghi lại mỗi lần tải
trang; có thêm một vòng 500 ms để đỡ trường hợp SPA đổi `aadvid` giữa phiên.

## Đo được gì

Trên tài khoản `…3393` (tài khoản trước đây chỉ có 1 lựa chọn), tab mới, tiện ích
đã nạp, không chèn script nào:

```
sessionStorage[user_skip_1mn_preference_7478857388263653393]
  = {"sales":true,"app":true,"lead":true,"hasRectifiedSession":true}

Tạo khách hàng tiềm năng   → Chiến dịch thủ công (đang chọn) · Chiến dịch Smart+
Doanh số bán hàng          → Chiến dịch thủ công · Chiến dịch Smart+ · Kế hoạch quảng cáo tìm kiếm
Quảng cáo ứng dụng         → Chiến dịch thủ công · Chiến dịch Smart+ · Kế hoạch quảng cáo tìm kiếm
Lưu lượng                  → không có lựa chọn nào (xem dưới)
loi console: khong co
```

Bấm **Chiến dịch thủ công** ở mục Khách hàng tiềm năng: `universalType` đi `1 → 0`,
`secondaryType` thành `CUSTOM_CAMPAIGN`, và form hiện các ô của chiến dịch thủ công
(*Tối ưu hóa ngân sách chiến dịch*, *Đặt ngân sách của chiến dịch*).

## Ba giới hạn

**Mục Lưu lượng không mở được bằng cách này.** Cổng của nó là
`isTraffic: isSpp1mnTrafficWhite` — không có vế `!skip` nào, nên không có cờ
opt-out để ghi. Đo thử: mục Lưu lượng vẫn không hiện lựa chọn nào.

**Chưa ai đăng thật.** Tôi kiểm tới chỗ form đổi sang thủ công và vẽ lại đúng.
Tôi **không** tạo chiến dịch thật, nên không biết máy chủ có nhận không. Khác với
cách cũ, đây là đúng đường TikTok dành cho người bấm "Switch back", nên rủi ro bị
chặn lúc đăng thấp hơn nhiều — nhưng vẫn nên để ngân sách nhỏ nhất ở lần đăng đầu
và soát lại từng ô.

**TikTok đổi bundle là hỏng.** Tên cờ `user_skip_1mn_preference_*` nằm trong bundle
của họ. Họ đổi tên hoặc chuyển sang lưu ở máy chủ thì tiện ích hết tác dụng, và
popup sẽ vẫn báo "đang bật" trong khi trang không còn hiện lựa chọn. Cách bền là
nhờ rep TikTok mở cờ cho tài khoản — xem đoạn nhắn soạn sẵn trong
`tiktok-smartplus-api-ext/README.md`.

## Thư mục `cu/`

`cu/chon.js`, `cu/chon.css` là bản 1.x: dò instance Vue rồi gọi thẳng
`vm.handleCampaignTypeClick({value: 1})`. Không còn được manifest nạp. Giữ lại để
tham khiếu thôi — đọc nguồn mới biết cách đó có lỗi ngầm:

```js
onChange: e => e === CUSTOM_CAMPAIGN
  ? (isSPPOnlyExperiment ? { universalType: AUTOMATED_AD, ... }   // ← ép về Smart+
                         : { universalType: UNSET, ... })
```

Khi tài khoản còn bị khoá, chọn "thủ công" bị chính TikTok ép lại về Smart+.
Bản 2.x tắt `isSPPOnlyExperiment` trước, nên không gặp chuyện đó.
