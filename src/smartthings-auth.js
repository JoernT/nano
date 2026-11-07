// OAuth token handling for SmartThings (access token ~24h, single-use rotating refresh token ~30d).
// Tokens live in a small JSON file that is rewritten (atomically) after every refresh, because the
// old refresh token stops working as soon as a new one has been issued.
//
// Falls back to a static personal access token (PAT) when no client id/secret are configured.
import axios from 'axios';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export const DEFAULT_TOKEN_URL = 'https://api.smartthings.com/v1/oauth/token';
const REFRESH_BEFORE_MS = 30 * 60 * 1000; // refresh when less than 30 min are left
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 3600 * 1000;

export class SmartThingsAuth {
    constructor({clientId, clientSecret, tokenFile, tokenUrl = DEFAULT_TOKEN_URL, staticToken, now = () => Date.now()}) {
        Object.assign(this, {clientId, clientSecret, tokenFile, tokenUrl, staticToken, now});
        this.state = null;
        this.inflight = null;
    }

    get oauth() { return Boolean(this.clientId && this.clientSecret); }

    /** Current state for the status page (never includes secrets). */
    info() {
        if (!this.oauth) return {mode: 'personal access token'};
        const s = this.state || this._load();
        return {
            mode: 'oauth',
            accessExpiresAt: s ? new Date(s.expiresAt) : null,
            refreshExpiresAt: s ? new Date(s.refreshedAt + REFRESH_TOKEN_LIFETIME_MS) : null,
        };
    }

    async getToken({force = false} = {}) {
        if (!this.oauth) return this.staticToken;
        const s = this.state || this._load();
        if (!s) throw new Error(`No OAuth tokens in ${this.tokenFile}. Run: node --env-file=.env src/st-auth.mjs`);
        if (force || s.expiresAt - this.now() < REFRESH_BEFORE_MS) await this.refresh();
        return this.state.accessToken;
    }

    /** Refresh once at a time: a second caller waits for the request that is already in flight. */
    refresh() {
        if (!this.inflight) {
            this.inflight = this._refresh().finally(() => { this.inflight = null; });
        }
        return this.inflight;
    }

    async _refresh() {
        const s = this.state || this._load();
        if (!s?.refreshToken) throw new Error('No refresh token available');
        const next = await this._post(new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: s.refreshToken,
            client_id: this.clientId,
        }), s.installedAppId);
        return next;
    }

    async exchangeCode(code, redirectUri) {
        return this._post(new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: this.clientId,
            redirect_uri: redirectUri,
        }));
    }

    async _post(body, previousInstalledAppId) {
        const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        let res;
        try {
            res = await axios.post(this.tokenUrl, body.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${basic}`,
                    Accept: 'application/json',
                },
                timeout: 20_000,
            });
        } catch (e) {
            const detail = e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
            throw new Error(`SmartThings token request failed: ${detail}`);
        }
        const d = res.data;
        if (!d?.access_token || !d?.refresh_token) throw new Error('SmartThings token response lacks access_token/refresh_token');
        const next = {
            accessToken: d.access_token,
            refreshToken: d.refresh_token,
            expiresAt: this.now() + Number(d.expires_in || 86399) * 1000,
            refreshedAt: this.now(),
            installedAppId: d.installed_app_id || previousInstalledAppId,
        };
        this._save(next); // persist first: the previous refresh token is already invalid
        this.state = next;
        return next;
    }

    _load() {
        try {
            const raw = JSON.parse(readFileSync(this.tokenFile, 'utf8'));
            if (raw.accessToken && raw.refreshToken) return (this.state = raw);
        } catch { /* missing or unreadable */ }
        return null;
    }

    _save(state) {
        mkdirSync(dirname(this.tokenFile), {recursive: true});
        const tmp = `${this.tokenFile}.tmp`;
        writeFileSync(tmp, JSON.stringify(state, null, 2), {mode: 0o600});
        renameSync(tmp, this.tokenFile);
    }
}
