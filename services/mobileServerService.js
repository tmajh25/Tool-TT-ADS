const MobileServer = require('../mobile/server');
const cacheService = require('./cacheService');
const seleniumService = require('./seleniumService');

class MobileServerService {
    constructor() {
        this.server = null;
        this.port = 3888;
    }

    async init() {
        if (!this.server) {
            this.server = new MobileServer({
                port: this.port,
                cacheService: cacheService,
                seleniumService: seleniumService
            });
        }


        try {
            const info = await this.server.start();
            console.log(`[MobileServerService] Server started successfully on port ${this.port}`);
            return info;
        } catch (e) {
            console.error('[MobileServerService] Error starting server:', e.message);
            // Thử cổng dự phòng 3889 nếu 3888 bị chiếm
            if (e.code === 'EADDRINUSE') {
                this.port = 3889;
                this.server = new MobileServer({
                    port: this.port,
                    cacheService: cacheService
                });
                return await this.server.start();
            }
            return null;
        }
    }

    async getInfo() {
        if (!this.server) return { isRunning: false };
        const ips = this.server.getLocalIPs();
        const primaryIP = ips.length > 0 ? ips[0] : '127.0.0.1';
        const primaryUrl = `http://${primaryIP}:${this.port}`;
        const localUrl = `http://localhost:${this.port}`;
        const qrCode = await this.server.getQRCodeDataURL(primaryUrl);

        return {
            isRunning: this.server.isRunning,
            port: this.port,
            ips,
            primaryUrl,
            localUrl,
            qrCode
        };
    }

    async stop() {
        if (this.server) {
            await this.server.stop();
        }
    }

    async restart() {
        await this.stop();
        return await this.init();
    }
}

module.exports = new MobileServerService();
