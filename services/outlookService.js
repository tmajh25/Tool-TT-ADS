const axios = require('axios');

class OutlookService {
    async loginOAuth(clientId, refreshToken) {
        const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');
        params.append('scope', 'https://graph.microsoft.com/.default');
        params.append('redirect_uri', 'https://login.microsoftonline.com/common/oauth2/nativeclient');

        try {
            const resp = await axios.post(url, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });
            if (resp.status === 200 && resp.data.access_token) {
                return resp.data.access_token;
            }
        } catch (e) {
            console.error('OAuth Login Error:', e.message);
        }
        return null;
    }

    async fetchEmails(accessToken) {
        try {
            const resp = await axios.get('https://graph.microsoft.com/v1.0/me/messages', {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                params: {
                    $top: 10,
                    $orderby: 'receivedDateTime desc',
                    $select: 'id,subject,from,body,receivedDateTime'
                },
                timeout: 15000
            });
            if (resp.status === 200) {
                return resp.data.value || [];
            }
        } catch (e) {
            console.error('Fetch Emails Error:', e.message);
        }
        return [];
    }
}

module.exports = new OutlookService();
