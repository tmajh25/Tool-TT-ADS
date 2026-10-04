// Point mồi khởi chạy Giao diện Frontend Electron
window.addEventListener('DOMContentLoaded', () => {
    // Khởi tạo các Module Tab
    if (window.tabAccounts) {
        window.tabAccounts.init();
    }
    if (window.tabSettings) {
        window.tabSettings.init();
    }
    if (window.tabMobile) {
        window.tabMobile.init();
    }
    
    showStatus("Ứng dụng Mail Tool All-In-One đã sẵn sàng.");
});


// Chuyển đổi định dạng xem Email (HTML / Text) của Tab Mail.tm
function setEmailViewMode(mode) {
    if (window.tabMailtm) {
        window.tabMailtm.setViewMode(mode);
    }
}

