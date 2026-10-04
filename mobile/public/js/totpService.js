/**
 * Client-Side TOTP Generator (RFC 6238)
 * Sử dụng Web Crypto API có sẵn trên mọi trình duyệt di động iOS / Android
 */
class TotpService {
    constructor() {
        this.base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    }

    _base32ToBuf(str) {
        str = str.toUpperCase().replace(/[\s=-]/g, '');
        let bits = '';
        for (let i = 0; i < str.length; i++) {
            const val = this.base32chars.indexOf(str.charAt(i));
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substr(i, 8), 2));
        }
        return new Uint8Array(bytes);
    }

    async generateTOTP(secret, epochSeconds = Math.floor(Date.now() / 1000), timeStep = 30, digits = 6) {
        try {
            if (!secret) return '';
            const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
            const keyBytes = this._base32ToBuf(cleanSecret);
            if (keyBytes.length === 0) return '';

            const counter = Math.floor(epochSeconds / timeStep);
            const counterBuf = new ArrayBuffer(8);
            const counterView = new DataView(counterBuf);
            // Write 64-bit integer
            counterView.setUint32(0, Math.floor(counter / 0x100000000));
            counterView.setUint32(4, counter & 0xffffffff);

            const cryptoKey = await window.crypto.subtle.importKey(
                'raw',
                keyBytes,
                { name: 'HMAC', hash: 'SHA-1' },
                false,
                ['sign']
            );

            const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, counterBuf);
            const hmac = new Uint8Array(signature);
            const offset = hmac[hmac.length - 1] & 0x0f;

            const binaryCode =
                ((hmac[offset] & 0x7f) << 24) |
                ((hmac[offset + 1] & 0xff) << 16) |
                ((hmac[offset + 2] & 0xff) << 8) |
                (hmac[offset + 3] & 0xff);

            const otp = binaryCode % Math.pow(10, digits);
            return otp.toString().padStart(digits, '0');
        } catch (e) {
            console.error('Lỗi tính TOTP client:', e);
            return '';
        }
    }

    getSecondsRemaining(timeStep = 30) {
        const now = Math.floor(Date.now() / 1000);
        return timeStep - (now % timeStep);
    }
}

window.totpService = new TotpService();
