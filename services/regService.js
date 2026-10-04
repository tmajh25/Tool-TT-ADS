const { chromium } = require('playwright');
const axios = require('axios');
const otplib = require('otplib');
const cacheService = require('./cacheService');

class RegService {
  constructor() {
    this.isStopped = false;
  }

  stop() {
    this.isStopped = true;
  }

  // ============================================================
  // MAIL.TM HELPERS
  // ============================================================

  async getDomain() {
    const res = await axios.get('https://api.mail.tm/domains');
    return res.data['hydra:member'][0].domain;
  }

  async createMailAccount(domain, password) {
    const user = Math.random().toString(36).substring(2, 12);
    const address = `${user}@${domain}`;
    try {
      await axios.post('https://api.mail.tm/accounts', { address, password });
      return address;
    } catch (err) {
      return null;
    }
  }

  async getMailToken(address, password) {
    const res = await axios.post('https://api.mail.tm/token', { address, password });
    return res.data.token;
  }

  async getMessages(token) {
    const res = await axios.get('https://api.mail.tm/messages', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data['hydra:member'];
  }

  async getMessage(token, id) {
    const res = await axios.get(`https://api.mail.tm/messages/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  }

  async waitForMailCode(token, ignoreIds = []) {
    const startTime = Date.now();
    while (Date.now() - startTime < 120000) {
      if (this.isStopped) return null;
      try {
        const messages = await this.getMessages(token);
        for (const msg of messages) {
          if (ignoreIds.includes(msg.id)) continue;
          if (msg.from.address.toLowerCase().includes('tiktok') || msg.subject.toLowerCase().includes('tiktok')) {
            const detail = await this.getMessage(token, msg.id);
            const content = detail.text || detail.intro || '';
            const match = content.match(/\b\d{6}\b/) || content.match(/\b[A-Z0-9]{6}\b/);
            if (match) return match[0];
          }
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 4000));
    }
    return null;
  }

  // ============================================================
  // MAIN REGISTRATION FLOW
  // ============================================================

  async runRegistration(config, progressCallback, resultCallback) {
    this.isStopped = false;
    const { password, quantity, onlyMail, autoClose } = config;

    for (let i = 0; i < quantity; i++) {
      if (this.isStopped) {
        progressCallback('⛔ Đã dừng tiến trình!');
        break;
      }

      progressCallback(`--- Đang Reg Acc ${i + 1}/${quantity} ---`);
      const finalPwd = password || `TikTok${Math.floor(100000 + Math.random() * 900000)}!`;

      let domain, email;
      try {
        domain = await this.getDomain();
        email = await this.createMailAccount(domain, finalPwd);
      } catch (e) {
        progressCallback(`❌ Lỗi tạo domain/mail: ${e.message}`);
        continue;
      }

      if (!email) {
        progressCallback(`❌ Lỗi tạo mail!`);
        continue;
      }

      progressCallback(`📧 Mail tạo thành công: ${email}`);

      if (onlyMail) {
        progressCallback(`✅ Kết quả: ${email}|${finalPwd}`);
        resultCallback(`${email}|${finalPwd}`);
        continue;
      }

      let token;
      try {
        token = await this.getMailToken(email, finalPwd);
      } catch (e) {
        progressCallback(`❌ Lỗi lấy token mail: ${e.message}`);
        continue;
      }

      await this.regProcess(email, finalPwd, token, autoClose, progressCallback, resultCallback);
    }

    progressCallback('🔥 TẤT CẢ TIẾN TRÌNH ĐÃ HOÀN TẤT!');
  }

  async regProcess(email, password, token, autoClose, progressCallback, resultCallback) {
    const settings = cacheService.loadSettings();
    progressCallback(`🌐 Đang khởi tạo trình duyệt Playwright...`);
    
    let playProxy = undefined;
    if (settings.proxy) {
      const pStr = settings.proxy.trim();
      const parts = pStr.split(':');
      if (parts.length === 4) {
        playProxy = {
          server: `http://${parts[0]}:${parts[1]}`,
          username: parts[2],
          password: parts[3]
        };
      } else {
        let server = pStr;
        if (!server.startsWith('http://') && !server.startsWith('https://') && !server.startsWith('socks5://')) {
          server = 'http://' + server;
        }
        playProxy = { server };
      }
    }

    const browser = await chromium.launch({
      headless: settings.headless !== undefined ? settings.headless : false,
      channel: settings.chromePath ? undefined : 'chrome',
      executablePath: settings.chromePath || undefined,
      proxy: playProxy,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Stealth measures & Smart+ Bypass
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // Bypass TikTok Smart+
      try {
        const TIEN_TO = "user_skip_1mn_preference_";
        const MUC = ["app", "lead", "sales"];
        const applyBypass = () => {
          let id = new URLSearchParams(location.search).get("aadvid");
          if (!id && location.hash && location.hash.includes("?")) {
            id = new URLSearchParams(location.hash.split("?")[1]).get("aadvid");
          }
          if (id && /^\d{6,}$/.test(id)) {
            const k = TIEN_TO + id;
            try {
              let cur = {};
              try { cur = JSON.parse(sessionStorage.getItem(k) || '{}'); } catch (e) {}
              if (!MUC.every(m => cur[m] === true)) {
                sessionStorage.setItem(k, JSON.stringify({ ...cur, app: true, lead: true, sales: true }));
              }
            } catch (e) {}
          }
        };
        applyBypass();
        setInterval(applyBypass, 500);
      } catch (e) {}
    });

    try {
      progressCallback(`🔗 Đang mở trang đăng ký TikTok Ads...`);
      await page.goto('https://ads.tiktok.com/i18n/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      try {
        await page.waitForSelector('input[name="email"]', { timeout: 30000 });
      } catch (e) {}

      // Agree to terms — thử nhiều cách
      await this._clickTermsCheckbox(page, progressCallback);

      // Fill form
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);

      // Get current message IDs to detect new ones
      const existingIds = (await this.getMessages(token)).map(m => m.id);

      progressCallback(`🚀 Đã điền form. HÃY GIẢI CAPTCHA NGAY!`);
      try {
        await page.click("id=TikTokAds_Register-register-button", { timeout: 10000 });
      } catch (e) {
        try {
          await page.click("button[type='submit']", { timeout: 5000 });
        } catch (e2) {}
      }

      const code = await this.waitForMailCode(token, existingIds);
      if (!code) {
        progressCallback(`❌ Hết thời gian chờ mã xác minh!`);
        if (autoClose) await browser.close();
        return;
      }

      progressCallback(`📩 Nhận được mã: ${code}. Đang điền...`);
      try {
        await page.waitForSelector('input[maxlength="1"], input[maxlength="6"]', { timeout: 15000 });
      } catch (e) {}

      const otpInputs = await page.$$('input[maxlength="1"]');
      if (otpInputs.length >= 6) {
        for (let i = 0; i < 6; i++) {
          await otpInputs[i].type(code[i]);
          await page.waitForTimeout(100);
        }
      } else {
        try {
          await page.fill("input[maxlength='6']", code);
        } catch (e) {}
      }

      progressCallback(`⏳ Đang đợi vào trang đích...`);
      try {
        await page.waitForURL(/nb_register|onboarding|overview|business/, { timeout: 60000 });
      } catch (e) {
        const currentUrl = page.url();
        if (!/nb_register|onboarding|overview|business/.test(currentUrl)) {
          progressCallback(`❌ Không chuyển trang đích sau khi điền mã (URL: ${currentUrl}). Dừng acc này.`);
          if (autoClose) await browser.close();
          return;
        }
      }

      progressCallback(`✅ Đăng ký thành công! Đang thiết lập 2FA...`);
      await page.waitForTimeout(5000);

      const secret = await this.setup2FA(page, email, token, progressCallback);
      const resultStr = `${email}|${password}|${secret || 'NO_2FA'}`;
      resultCallback(resultStr);
      progressCallback(`✅ Hoàn tất: ${resultStr}`);

      if (autoClose) {
        if (!secret) {
          progressCallback(`⏳ 2FA chưa thành công. Giữ trình duyệt 30 giây để kiểm tra...`);
          await page.waitForTimeout(30000);
        }
        progressCallback(`🔒 Đóng trình duyệt...`);
        await browser.close();
      }
    } catch (error) {
      progressCallback(`❌ Lỗi: ${error.message}`);
      if (autoClose) await browser.close();
    }
  }

  async setup2FA(page, email, token, progressCallback) {
    try {
      progressCallback(`🔒 Điều hướng đến trang bảo mật...`);
      await page.goto('https://ads.tiktok.com/ac/page/security', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);

      await this.destroyPopups(page);

      progressCallback(`➡️ Tìm nút Thiết lập 2FA...`);
      const setupBtnXpath = "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'set up')] | //button[contains(., 'Thiết lập')] | //span[contains(., 'Set up')] | //span[contains(., 'Thiết lập')]";
      try {
        const setupBtn = await page.waitForSelector(setupBtnXpath, { timeout: 15000 });
        await setupBtn.click();
        await page.waitForTimeout(3000);
      } catch (e) {
        progressCallback(`⚠️ Không tìm thấy nút Thiết lập, thử Enter...`);
        await page.keyboard.press('Enter');
      }

      // Toggle Authenticator switch
      const switches = await page.$$("div[role='switch']");
      for (let s of switches) {
        const text = await s.evaluate(el => el.parentElement.innerText);
        if (text.includes('Authenticator') || text.includes('xác thực') || text.includes('Email')) {
          const isChecked = await s.evaluate(el => el.classList.contains('is-checked'));
          if (!isChecked) {
            await s.click();
            await page.waitForTimeout(1000);
          }
        }
      }

      // Send verification code for 2FA setup
      try {
        const sendBtnXpath = "//button[contains(@class, 'ac-sendcode-input__btn')] | //button[contains(., 'Send code')] | //button[contains(., 'Gửi mã')]";
        const sendBtn = await page.waitForSelector(sendBtnXpath, { timeout: 10000 });
        if (sendBtn) {
          const existingIds = (await this.getMessages(token)).map(m => m.id);
          await sendBtn.click();
          progressCallback(`📧 Đã nhấn 'Send code'. Đang chờ mail 2FA...`);
          const vcode = await this.waitForMailCode(token, existingIds);
          if (vcode) {
            await page.fill("//input[contains(@class, 'code-input')] | //input[@placeholder='Enter verification code']", vcode);
            await page.waitForTimeout(1000);

            // Click Confirm
            const clicked = await page.evaluate(() => {
              const findAndClickByText = (root) => {
                const all = root.querySelectorAll('*');
                for (let el of all) {
                  const txt = (el.childNodes[0]?.textContent || el.innerText || "").trim();
                  const isConfirm = ['Confirm', 'Xác nhận'].some(k => txt === k || (txt.includes(k) && txt.length < 15));
                  const isNotCancel = !txt.includes('Cancel') && !txt.includes('Hủy');

                  if (isConfirm && isNotCancel && el.offsetParent !== null) {
                    el.click();
                    if (el.shadowRoot) {
                      const btn = el.shadowRoot.querySelector('button') || el.shadowRoot.querySelector('[role="button"]');
                      if (btn) btn.click();
                    }
                    return true;
                  }
                  if (el.shadowRoot && findAndClickByText(el.shadowRoot)) return true;
                }
                return false;
              };
              return findAndClickByText(document);
            });

            if (clicked) {
              progressCallback(`✅ Đã tìm thấy và nhấn nút Xác nhận.`);
            } else {
              progressCallback(`⚠️ Không tìm thấy nút bằng chữ, thử nhấn Enter...`);
              await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(5000);
          }
        }
      } catch (e) {
        progressCallback(`ℹ️ Không cần xác minh email cho 2FA.`);
      }

      // Click Save if appears
      try {
        await page.click("//button[contains(., 'Save')] | //button[contains(., 'Lưu')]", { timeout: 3000 });
      } catch (e) {}

      // Get Secret Key
      progressCallback(`⏳ Đang đợi Secret Key...`);
      let secret = '';
      for (let i = 0; i < 15; i++) {
        const codeSplits = await page.$$('.code-split');
        if (codeSplits.length > 0) {
          secret = (await Promise.all(codeSplits.map(s => s.innerText()))).join('').trim();
          if (secret.length >= 16) break;
        }
        const bodyText = await page.innerText('body');
        const match = bodyText.replace(/\n/g, ' ').replace(/\s\s+/g, ' ').match(/Or enter the following code.*?([A-Z0-9\s]{16,})/i);
        if (match) {
          secret = match[1].replace(/\s/g, '');
          break;
        }
        await page.waitForTimeout(1000);
      }

      if (!secret) {
        progressCallback(`❌ Không lấy được Secret Key!`);
        return null;
      }
      progressCallback(`🔑 Secret Key: ${secret}`);

      // Click Next to proceed TOTP entry
      const nextBtnXpath = "//div[contains(@class, 'dialog-footer')]//button[contains(@class, 'vi-button--primary')] | //button[contains(., 'Next')] | //button[contains(., 'Tiếp')]";
      try {
        await page.waitForSelector(nextBtnXpath, { timeout: 10000 });
        await page.click(nextBtnXpath);
      } catch (e) {
        await page.evaluate((xpath) => {
          const btn = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (btn) btn.click();
        }, nextBtnXpath);
      }

      await page.waitForTimeout(3000);

      // Generate & fill TOTP
      const totp = otplib.authenticator.generate(secret.replace(/\s/g, ''));
      progressCallback(`🔢 Mã TOTP: ${totp}. Đang điền...`);

      try {
        const inputs = await page.$$("input[maxlength='1']");
        if (inputs.length >= 6) {
          for (let i = 0; i < 6; i++) {
            await inputs[i].focus();
            await page.keyboard.type(totp[i], { delay: 100 });
          }
        } else {
          const totpInputXpath = "//input[@placeholder='Enter the code'] | //input[contains(@class, 'vi-input__inner')] | //input[contains(@class, 'code-input')] | //input[@type='text']";
          const input = await page.waitForSelector(totpInputXpath, { timeout: 10000 });
          await input.focus();
          await page.keyboard.type(totp, { delay: 100 });
        }
      } catch (e) {
        progressCallback(`⚠️ Không tìm thấy ô nhập mã bằng selector, thử dùng JS...`);
        await page.evaluate((val) => {
          const findAndFill = (root) => {
            const input = root.querySelector('input[placeholder*="code"], input[class*="input"]');
            if (input) {
              input.value = val;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
            for (let el of root.querySelectorAll('*')) {
              if (el.shadowRoot && findAndFill(el.shadowRoot)) return true;
            }
            return false;
          };
          findAndFill(document);
        }, totp);
      }
      await page.waitForTimeout(1000);

      // Final Confirm
      const finalConfirmClicked = await page.evaluate(() => {
        let found = false;
        const findAndClick = (root) => {
          const elements = root.querySelectorAll('button, byted-wc-button, div[role="button"]');
          for (let el of elements) {
            const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
            if (['confirm', 'xác nhận', 'verify', 'xác minh'].some(k => txt.includes(k))) {
              el.click();
              if (el.shadowRoot) {
                const b = el.shadowRoot.querySelector('button');
                if (b) b.click();
              }
              found = true;
              return true;
            }
          }
          for (let el of root.querySelectorAll('*')) {
            if (el.shadowRoot && findAndClick(el.shadowRoot)) return true;
          }
          return false;
        };
        findAndClick(document);
        return found;
      });

      if (!finalConfirmClicked) await page.keyboard.press('Enter');

      await page.waitForTimeout(2000);

      // Save Save Final Save
      try {
        const xpathSaveFinal = "//button[contains(@class, 'vi-button--primary')]//span[contains(text(), 'Save')] | //button[contains(@class, 'vi-button--primary')]//span[contains(text(), 'Lưu')] | //button[normalize-space()='Save']";
        await page.evaluate((xpath) => {
          const btn = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (btn) btn.click();
        }, xpathSaveFinal);
      } catch (e) {}
      await page.waitForTimeout(3000);

      progressCallback(`🎉 Thiết lập 2FA hoàn tất!`);
      return secret;
    } catch (error) {
      progressCallback(`⚠️ Lỗi setup 2FA: ${error.message}`);
      return null;
    }
  }

  async _clickTermsCheckbox(page, progressCallback) {
    progressCallback('☑️ Đang tích checkbox đồng ý điều khoản...');
    await page.waitForTimeout(1500);

    // List of selectors prioritizing the old file's exact xpath (including the typo 'aggrement')
    const selectors = [
      "xpath=//div[contains(@id, 'aggrement')]",
      "xpath=//div[contains(@class, 'agreement')]//span",
      "xpath=//div[contains(@id, 'agreement')]",
      "[id*='aggrement']",
      "[class*='agreement'] span",
      "[id*='agreement']",
      "input[type='checkbox']", // Fallback to first real checkbox
    ];

    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (el && await el.isVisible()) {
          await el.click({ timeout: 2000 });
          progressCallback(`✅ Đã tích checkbox bằng: ${sel}`);
          await page.waitForTimeout(500);
          return;
        }
      } catch (e) {}
    }

    // JS Fallback specifically targeting the terms/agreement elements and avoiding marketing checkboxes
    const clicked = await page.evaluate(() => {
      const forceClick = (el) => {
        if (!el) return false;
        try {
          el.click();
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        } catch (e) {
          return false;
        }
      };

      // Try finding the wrapper container with 'aggrement' (typo) or 'agreement' ID/class first
      const wrapper = document.querySelector("[id*='aggrement'], [id*='agreement'], [class*='agreement']");
      if (wrapper) {
        const cbInside = wrapper.querySelector('input[type="checkbox"], span, div');
        if (cbInside && forceClick(cbInside)) return { method: 'js-wrapper-inside', success: true };
        if (forceClick(wrapper)) return { method: 'js-wrapper-direct', success: true };
      }

      // Try finding the first checkbox on the page
      const realCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      if (realCheckboxes.length > 0) {
        const firstCb = realCheckboxes[0];
        if (!firstCb.checked) {
          // Click label/parent if possible
          let labelClicked = false;
          if (firstCb.id) {
            const label = document.querySelector(`label[for="${firstCb.id}"]`);
            if (label && forceClick(label)) labelClicked = true;
          }
          if (!labelClicked) {
            const parent = firstCb.parentElement;
            if (parent && forceClick(parent)) labelClicked = true;
          }
          if (!labelClicked) {
            forceClick(firstCb);
          }
          return { method: 'js-first-real-cb', success: true };
        }
        return { method: 'js-first-real-cb-already-checked', success: true };
      }

      return { success: false };
    });

    if (clicked && clicked.success) {
      progressCallback(`✅ Đã tích checkbox điều khoản (${clicked.method})`);
      await page.waitForTimeout(500);
      return;
    }

    progressCallback('⚠️ Không tích được checkbox bằng automation — vui lòng tích tay.');
  }

  async destroyPopups(page) {
    await page.evaluate(() => {
      const traverse = (root) => {
        // 1. Check ALL Checkboxes
        const inputs = root.querySelectorAll('input[type="checkbox"]');
        inputs.forEach(cb => {
          if (!cb.checked) {
            cb.click();
            if (!cb.checked) cb.checked = true;
          }
        });

        // 2. Click Fake Checkboxes
        const fakes = root.querySelectorAll('div[class*="checkbox"], span[class*="checkbox"], div[class*="Check"]');
        fakes.forEach(f => { try { f.click(); } catch(e) {} });

        // 3. Find & Click Accept Button (xuyên Shadow DOM và hỗ trợ byted-wc-button)
        const buttons = root.querySelectorAll('button, byted-wc-button, div[role="button"]');
        buttons.forEach(btn => {
          const txt = (btn.innerText || btn.textContent || "").toLowerCase().trim();
          if (['accept', 'chấp nhận', 'agree', 'đồng ý', 'confirm', 'xác nhận'].some(k => txt.includes(k))) {
            try { 
              btn.click(); 
              if (btn.shadowRoot) {
                const innerBtn = btn.shadowRoot.querySelector('button') || btn.shadowRoot.querySelector('[role="button"]');
                if (innerBtn) innerBtn.click();
              }
            } catch(e) {}
          }
        });

        // 4. Recurse into Shadow DOM
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) traverse(el.shadowRoot);
        });
      };
      traverse(document);
    });
    await page.waitForTimeout(2000);
  }
}

module.exports = new RegService();
