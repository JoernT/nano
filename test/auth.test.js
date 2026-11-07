import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, writeFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SmartThingsAuth} from '../src/smartthings-auth.js';

// fake token endpoint that rotates refresh tokens like SmartThings does
async function fakeServer() {
    const calls = [];
    let n = 0;
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            calls.push({auth: req.headers.authorization, body: Object.fromEntries(new URLSearchParams(body))});
            n++;
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify({access_token: `access${n}`, refresh_token: `refresh${n}`, expires_in: 86399, installed_app_id: 'app1'}));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return {calls, server, url: `http://127.0.0.1:${server.address().port}/token`};
}

test('refreshes with basic auth, rotates and persists tokens, refreshes once for concurrent callers', async () => {
    const {calls, server, url} = await fakeServer();
    try {
        const file = join(mkdtempSync(join(tmpdir(), 'nano-')), 'tok.json');
        let t = 1_000_000;
        writeFileSync(file, JSON.stringify({accessToken: 'old', refreshToken: 'r0', expiresAt: t + 60_000, refreshedAt: t - 1000}));
        const auth = new SmartThingsAuth({clientId: 'id', clientSecret: 'sec', tokenFile: file, tokenUrl: url, now: () => t});

        // 1 min left (< 30 min margin) -> refresh; two concurrent callers share one request
        const [a, b] = await Promise.all([auth.getToken(), auth.getToken()]);
        assert.equal(a, 'access1');
        assert.equal(b, 'access1');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].auth, `Basic ${Buffer.from('id:sec').toString('base64')}`);
        assert.deepEqual(calls[0].body, {grant_type: 'refresh_token', refresh_token: 'r0', client_id: 'id'});

        const saved = JSON.parse(readFileSync(file, 'utf8'));
        assert.equal(saved.refreshToken, 'refresh1');
        assert.equal(saved.installedAppId, 'app1');
        assert.equal(statSync(file).mode & 0o777, 0o600);

        // plenty of lifetime left -> no new request
        assert.equal(await auth.getToken(), 'access1');
        assert.equal(calls.length, 1);

        // forced refresh uses the rotated refresh token
        assert.equal(await auth.getToken({force: true}), 'access2');
        assert.equal(calls[1].body.refresh_token, 'refresh1');
    } finally {
        server.close();
    }
});

test('exchangeCode sends the authorization_code grant', async () => {
    const {calls, server, url} = await fakeServer();
    try {
        const file = join(mkdtempSync(join(tmpdir(), 'nano-')), 'tok.json');
        const auth = new SmartThingsAuth({clientId: 'id', clientSecret: 'sec', tokenFile: file, tokenUrl: url});
        await auth.exchangeCode('CODE', 'https://example.org/cb');
        assert.deepEqual(calls[0].body, {grant_type: 'authorization_code', code: 'CODE', client_id: 'id', redirect_uri: 'https://example.org/cb'});
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).accessToken, 'access1');
    } finally {
        server.close();
    }
});

test('without client credentials the static token is used', async () => {
    const auth = new SmartThingsAuth({staticToken: 'Bearer pat'});
    assert.equal(await auth.getToken(), 'Bearer pat');
});

test('missing token file gives an actionable error', async () => {
    const auth = new SmartThingsAuth({clientId: 'id', clientSecret: 's', tokenFile: join(tmpdir(), 'does-not-exist-nano.json')});
    await assert.rejects(() => auth.getToken(), /st-auth/);
});
