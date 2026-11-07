#!/usr/bin/env node
// One-time OAuth setup for the SmartThings API-only app.
//   node --env-file=.env src/st-auth.mjs url            print the authorization URL
//   node --env-file=.env src/st-auth.mjs exchange CODE  trade the code for tokens and save them
//   node --env-file=.env src/st-auth.mjs status         show token expiry
// Needs ST_CLIENT_ID, ST_CLIENT_SECRET, ST_REDIRECT_URI in .env (ST_SCOPE optional, default r:devices:*).
import {SmartThingsAuth} from './smartthings-auth.js';
import {resolveTokenFile} from './nano.js';

const env = process.env;
const [cmd, code] = process.argv.slice(2);
const need = ['ST_CLIENT_ID', 'ST_CLIENT_SECRET', 'ST_REDIRECT_URI'].filter((k) => !env[k]);
if (need.length) { console.error(`Missing in .env: ${need.join(', ')}`); process.exit(1); }

const auth = new SmartThingsAuth({
    clientId: env.ST_CLIENT_ID,
    clientSecret: env.ST_CLIENT_SECRET,
    tokenFile: resolveTokenFile(env),
    tokenUrl: env.ST_TOKEN_URL || undefined,
});

if (cmd === 'url') {
    const q = new URLSearchParams({
        client_id: env.ST_CLIENT_ID,
        response_type: 'code',
        redirect_uri: env.ST_REDIRECT_URI,
        scope: env.ST_SCOPE || 'r:devices:*',
        state: Math.random().toString(36).slice(2),
    });
    console.log(`https://api.smartthings.com/v1/oauth/authorize?${q}`);
    console.log('\nOpen it, approve, then copy the "code" parameter from the URL you are redirected to (single-use, short-lived).');
} else if (cmd === 'exchange' && code) {
    await auth.exchangeCode(code, env.ST_REDIRECT_URI);
    console.log(`Tokens saved to ${auth.tokenFile}. Expires:`, auth.info());
} else if (cmd === 'status') {
    console.log(auth.info());
} else {
    console.error('usage: st-auth.mjs url | exchange CODE | status');
    process.exit(1);
}
