// Polls the Samsung heat pump via the SmartThings API and stores the readings in InfluxDB.
//
// Configuration (environment variables, e.g. in a .env file, see .env.example):
//   SMARTTHINGS_TOKEN   personal access token (with or without the "Bearer " prefix)
//   SMARTTHINGS_DEVICE  device id
//   INFLUX_URL          default http://localhost:8086
//   INFLUX_TOKEN, INFLUX_ORG (default nanoCorp), INFLUX_BUCKET (default nano)
//   POLL_INTERVAL_SEC   default 240
// If SMARTTHINGS_* / INFLUX_TOKEN are unset, the legacy src/config.js is used as a fallback.
//
// Every point carries the timestamp the *device* reported, not the poll time. Writing the same
// series+timestamp twice is idempotent in InfluxDB, so overlapping polls never create duplicates.
import axios from 'axios';
import {InfluxDB, Point} from '@influxdata/influxdb-client';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHistory, RANGES} from './history.js';
import {fetchOutdoor} from './weather.js';
import {SmartThingsAuth} from './smartthings-auth.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// systemd watchdog: when started with WatchdogSec= (NOTIFY_SOCKET is set), tell systemd after every finished poll
// that we are alive; if polls stop completing (hang), systemd restarts the service. No-op outside systemd.
const watchdog = (state = 'WATCHDOG=1') => {
    if (!process.env.NOTIFY_SOCKET) return;
    execFile('systemd-notify', [state], (e) => { if (e) log('systemd-notify failed:', e.message); });
};

async function loadConfig(env = process.env) {
    let legacy = {};
    if (!env.SMARTTHINGS_TOKEN || !env.SMARTTHINGS_DEVICE || !env.INFLUX_TOKEN) {
        try {
            legacy = (await import('./config.js')).tokens || {};
        } catch { /* no legacy config */ }
    }
    const token = env.SMARTTHINGS_TOKEN || legacy.smartthings?.token;
    const device = env.SMARTTHINGS_DEVICE || legacy.smartthings?.device;
    const influxToken = env.INFLUX_TOKEN || legacy.influxDB;
    const oauth = Boolean(env.ST_CLIENT_ID && env.ST_CLIENT_SECRET);
    const missing = [!token && !oauth && 'SMARTTHINGS_TOKEN (or ST_CLIENT_ID + ST_CLIENT_SECRET)', !device && 'SMARTTHINGS_DEVICE', !influxToken && 'INFLUX_TOKEN'].filter(Boolean);
    if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
    return {
        smartthings: {
            auth: new SmartThingsAuth({
                clientId: env.ST_CLIENT_ID,
                clientSecret: env.ST_CLIENT_SECRET,
                tokenFile: resolveTokenFile(env),
                tokenUrl: env.ST_TOKEN_URL || undefined,
                staticToken: token && (/^bearer /i.test(token) ? token : `Bearer ${token}`),
            }),
            url: `https://api.smartthings.com/v1/devices/${device}/status`,
        },
        influx: {
            url: env.INFLUX_URL || 'http://localhost:8086',
            token: influxToken,
            org: env.INFLUX_ORG || 'nanoCorp',
            bucket: env.INFLUX_BUCKET || 'nano',
        },
        intervalMs: Number(env.POLL_INTERVAL_SEC || 240) * 1000,
    };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const ts = (attr) => (attr?.timestamp ? new Date(attr.timestamp) : undefined);

/**
 * Turns a SmartThings /status response into a list of plain point descriptors:
 * {measurement, tags, fields: {name: number|string}, time?: Date}
 * Missing capabilities are skipped instead of being written as 0.
 */
export function extractPoints(data) {
    const points = [];
    const add = (measurement, tags, fields, time) => {
        const f = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null));
        if (Object.keys(f).length) points.push({measurement, tags, fields: f, time});
    };
    const c = data?.components || {};

    // temperatures: INDOOR2 is the heating circuit, main the warm water tank
    for (const [component, name] of [['INDOOR2', 'heating'], ['main', 'warmwater'], ['INDOOR1', 'indoor1']]) {
        const attr = c[component]?.temperatureMeasurement?.temperature;
        add('temperature', {component: name}, {temp: num(attr?.value)}, ts(attr));
    }

    // power: `power` is reported in kW (-> W), `energy` in Wh (-> kWh)
    const pc = c.main?.powerConsumptionReport?.powerConsumption;
    const v = pc?.value;
    if (v) {
        add('powerconsumption', {component: 'heatpump'}, {
            power: num(v.power) !== undefined ? v.power * 1000 : undefined,
            energy: num(v.energy) !== undefined ? v.energy / 1000 : undefined,
            deltaEnergy: num(v.deltaEnergy),
            powerEnergy: num(v.powerEnergy),
            energySaved: num(v.energySaved),
            persistedEnergy: num(v.persistedEnergy) !== undefined ? v.persistedEnergy / 1000 : undefined,
            // report window: exact basis for per-window kWh / COP
            windowSeconds: v.start && v.end ? (new Date(v.end) - new Date(v.start)) / 1000 : undefined,
        }, ts(pc));
    }

    // state: on/off and operating mode as strings
    for (const [component, name] of [['main', 'warmwater'], ['INDOOR2', 'heating'], ['INDOOR1', 'indoor1']]) {
        const sw = c[component]?.switch?.switch;
        const mode = c[component]?.airConditionerMode?.airConditionerMode;
        if (sw?.value) add('state', {component: name, attribute: 'switch'}, {value: sw.value}, ts(sw));
        if (mode?.value) add('state', {component: name, attribute: 'mode'}, {value: mode.value}, ts(mode));
    }

    // target temperatures. SmartThings only models "cooling"/"heating" setpoints; which one the
    // heating circuit actually uses depends on its mode, so keep both.
    for (const [component, name] of [['main', 'warmwater'], ['INDOOR2', 'heating'], ['INDOOR1', 'indoor1']]) {
        for (const [cap, attr, kind] of [['thermostatCoolingSetpoint', 'coolingSetpoint', 'cooling'], ['thermostatHeatingSetpoint', 'heatingSetpoint', 'heating']]) {
            const a = c[component]?.[cap]?.[attr];
            add('setpoint', {component: name, kind}, {value: num(a?.value)}, ts(a));
        }
    }
    // firmware / software versions: the ehsCycleData blob layout changes with the firmware,
    // so keep them next to the raw data (see docs/ehsCycleData.md)
    for (const [attribute, a] of [
        ['firmware', c.main?.ocf?.mnfv],
        ['driver', c.main?.['samsungce.driverVersion']?.versionNumber],
        ['micom', c.main?.['samsungce.deviceIdentification']?.micomAssayCode],
    ]) {
        if (a?.value !== undefined && a?.value !== null && a.value !== '') {
            add('state', {component: 'heatpump', attribute}, {value: String(a.value)}, ts(a));
        }
    }
    const update = c.main?.['samsungce.softwareUpdate']?.newVersionAvailable;
    if (typeof update?.value === 'boolean') add('state', {component: 'heatpump', attribute: 'updateAvailable'}, {value: String(update.value)}, ts(update));

    const outing = c.main?.['custom.outingMode']?.outingMode;
    if (outing?.value) add('state', {component: 'heatpump', attribute: 'outingMode'}, {value: outing.value}, ts(outing));

    // live operating states (diagnostics): booster heater, diverter valve (room/tank), defrost, thermostat link
    for (const [component, name] of [['main', 'warmwater'], ['INDOOR2', 'heating'], ['INDOOR1', 'indoor1']]) {
        const comp = c[component] || {};
        for (const [attribute, a] of [
            ['boosterHeater', comp['samsungce.ehsBoosterHeater']?.status],
            ['diverterValve', comp['samsungce.ehsDiverterValve']?.position],
            ['defrost', comp['samsungce.ehsDefrostMode']?.status],
            ['thermostatConnection', comp['samsungce.ehsThermostat']?.connectionState],
            ['temperatureReference', comp['samsungce.ehsTemperatureReference']?.temperatureReference],
        ]) {
            if (a?.value) add('state', {component: name, attribute}, {value: String(a.value)}, ts(a));
        }
        // allowed setpoint range
        const sc = comp['custom.thermostatSetpointControl'];
        add('setpoint', {component: name, kind: 'limit'}, {min: num(sc?.minimumSetpoint?.value), max: num(sc?.maximumSetpoint?.value)}, ts(sc?.minimumSetpoint));
    }
    // indoor/outdoor board module versions
    const sw = c.main?.['samsungce.softwareVersion']?.versions;
    for (const m of sw?.value || []) {
        if (m?.versionNumber) add('state', {component: 'heatpump', attribute: `module${m.id}`}, {value: String(m.versionNumber)}, ts(sw));
    }

    // field service values (FSV): water-law and limit settings, useful when tuning the configuration
    const fsv = c.main?.['samsungce.ehsFsvSettings']?.fsvSettings;
    for (const s of fsv?.value || []) {
        if (s?.inUse && s.isValid !== false) add('fsv', {id: String(s.id), type: String(s.type)}, {value: num(s.value), min: num(s.minValue), max: num(s.maxValue)}, ts(fsv));
    }

    // raw Samsung cycle data (5 min samples, hex blobs, format not yet decoded) - keep it verbatim
    const cycle = c.main?.['samsungce.ehsCycleData'] || {};
    for (const kind of ['outdoor', 'indoor']) {
        for (const e of cycle[kind]?.value || []) {
            if (e?.data && e?.timestamp) add('ehs_cycle', {kind}, {raw: e.data}, new Date(e.timestamp));
        }
    }
    return points;
}

export function resolveTokenFile(env = process.env) {
    return env.ST_TOKEN_FILE || fileURLToPath(new URL('../data/smartthings-token.json', import.meta.url));
}

const bearer = (t) => (/^bearer /i.test(t) ? t : `Bearer ${t}`);

export async function fetchStatus({url, auth}) {
    const get = async (force) => axios.get(url, {
        headers: {Authorization: bearer(await auth.getToken({force}))},
        timeout: 20_000,
    });
    try {
        return (await get(false)).data;
    } catch (e) {
        // access token rejected (expired early / revoked): refresh once and retry
        if (e.response?.status === 401 && auth.oauth) return (await get(true)).data;
        throw e;
    }
}

// latest value per series, for the status page
function summarize(points) {
    const t = (m, tags, field) => {
        const p = points.find((x) => x.measurement === m && Object.entries(tags).every(([k, val]) => x.tags[k] === val) && field in x.fields);
        return p ? {value: p.fields[field], at: p.time} : undefined;
    };
    return {
        heating: t('temperature', {component: 'heating'}, 'temp'),
        warmwater: t('temperature', {component: 'warmwater'}, 'temp'),
        power: t('powerconsumption', {component: 'heatpump'}, 'power'),
        energy: t('powerconsumption', {component: 'heatpump'}, 'energy'),
        heatingMode: t('state', {component: 'heating', attribute: 'mode'}, 'value'),
        warmwaterMode: t('state', {component: 'warmwater', attribute: 'mode'}, 'value'),
        heatingSetHeat: t('setpoint', {component: 'heating', kind: 'heating'}, 'value'),
        heatingSetCool: t('setpoint', {component: 'heating', kind: 'cooling'}, 'value'),
        warmwaterSet: t('setpoint', {component: 'warmwater', kind: 'cooling'}, 'value'),
        cycleSamples: points.filter((p) => p.measurement === 'ehs_cycle').length,
    };
}

function authLine(i) {
    if (i.mode !== 'oauth') return 'auth: personal access token (may expire without notice)';
    const days = i.refreshExpiresAt ? (i.refreshExpiresAt - Date.now()) / 86_400_000 : NaN;
    const warn = days < 7 ? ' class=bad' : '';
    return `auth: oauth · access token until ${i.accessExpiresAt?.toLocaleString() ?? '?'} · <span${warn}>refresh token valid ~${Math.floor(days)}d (renewed on every refresh)</span>`;
}

// dashboard + report: the built site (`npm run build` -> dist/), served from the same origin as the API
// (SITE_DIR overrides the location). Returns false when there is no such file.
const SITE_ROOT = path.resolve(process.env.SITE_DIR || fileURLToPath(new URL('../dist/', import.meta.url))) + path.sep;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
async function serveSite(pathname, req, res) {
    const file = path.resolve(SITE_ROOT, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(SITE_ROOT)) return false; // no path traversal
    try {
        const body = await readFile(file);
        res.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'});
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
    } catch { return false; }
}

// dashboard at /, report at /report.html, read-only status page at /status, JSON API under /api (STATUS_PORT=0 disables, STATUS_HOST to expose)
function startStatusServer(config, status) {
    const port = Number(process.env.STATUS_PORT ?? 8787);
    if (!port) return null;
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
    const ago = (d) => (d ? `${Math.round((Date.now() - d) / 1000)}s ago` : 'never');
    const history = createHistory(config);
    const server = createServer((req, res) => {
        const v = status.values;
        const row = (label, x, unit = '') => `<tr><td>${label}</td><td>${x ? esc(x.value) + unit : '–'}</td><td>${x?.at ? 'device: ' + ago(x.at) : ''}</td></tr>`;
        if (req.url === '/api/status' && req.method === 'OPTIONS') {
            // CORS preflight from the dashboard (served from another port)
            res.writeHead(204, {
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET, OPTIONS',
                'access-control-allow-headers': '*',
                'access-control-max-age': '600',
            });
            return res.end();
        }
        if (req.url === '/api/status') {
            // read-only copy of the last device status for the dashboard (src/index.html); no token needed
            if (!status.latestRaw) { res.writeHead(503, {'access-control-allow-origin': '*'}); return res.end('no data yet'); }
            res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*'});
            return res.end(JSON.stringify(status.latestRaw));
        }
        if (req.url?.startsWith('/api/history')) {
            // read-only history for the report page (src/report.html), served from InfluxDB
            const range = new URL(req.url, 'http://x').searchParams.get('range') || '7d';
            const headers = {'content-type': 'application/json', 'access-control-allow-origin': '*'};
            if (!RANGES[range]) { res.writeHead(400, headers); return res.end(JSON.stringify({error: `range must be one of ${Object.keys(RANGES).join(', ')}`})); }
            history(range)
                .then((h) => { res.writeHead(200, headers); res.end(JSON.stringify(h)); })
                .catch((e) => { log('history:', e.message); res.writeHead(500, headers); res.end(JSON.stringify({error: e.message})); });
            return;
        }
        if (req.url === '/status.json') {
            res.writeHead(200, {'content-type': 'application/json'});
            const stale = !status.lastPollAt || Date.now() - status.lastPollAt > config.intervalMs * 2.5;
            return res.end(JSON.stringify({...status, state: stale ? 'STALE' : status.lastError ? 'ERROR' : 'running', intervalMs: config.intervalMs, auth: authLine(config.smartthings.auth.info())}));
        }
        const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
        if (pathname !== '/status') {
            serveSite(pathname, req, res).then((served) => {
                if (served) return;
                // no built site (yet): fall back to the status page at /, else 404
                if (pathname === '/') { res.writeHead(302, {location: '/status'}); return res.end(); }
                res.writeHead(404, {'content-type': 'text/plain'});
                res.end('not found');
            }).catch((e) => { res.writeHead(500); res.end(e.message); });
            return;
        }
        const stale = !status.lastPollAt || Date.now() - status.lastPollAt > config.intervalMs * 2.5;
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
        res.end(`<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=20><title>nano</title>
<style>body{font:15px system-ui;margin:2rem auto;max-width:34rem;padding:0 1rem}td{padding:.2rem .8rem .2rem 0}.ok{color:#2a7}.bad{color:#c33}pre{background:#f4f4f4;padding:.6rem;overflow:auto}</style>
<h2>nano <span class=${stale || status.lastError ? 'bad' : 'ok'}>${stale ? 'STALE' : status.lastError ? 'ERROR' : 'running'}</span></h2>
<p>last poll: ${ago(status.lastPollAt)} · polls ${status.polls} · failures ${status.failures} · every ${config.intervalMs / 1000}s<br>
${status.lastError ? `<span class=bad>${esc(status.lastError)}</span><br>` : ''}${authLine(config.smartthings.auth.info())}<br>uptime since ${status.startedAt.toLocaleString()}</p>
<table>${row('Heizung', v.heating, ' °C')}${row('Warmwasser', v.warmwater, ' °C')}${row('Leistung', v.power, ' W')}${row('Energie', v.energy, ' kWh')}${row('Heizung Modus', v.heatingMode)}${row('Heizung Soll (heat)', v.heatingSetHeat, ' °C')}${row('Heizung Soll (cool)', v.heatingSetCool, ' °C')}${row('Warmwasser Modus', v.warmwaterMode)}${row('Warmwasser Soll', v.warmwaterSet, ' °C')}
<tr><td>cycle samples</td><td>${v.cycleSamples ?? '–'}</td><td></td></tr></table>
<h3>recent</h3><pre>${esc(status.events.join('\n'))}</pre>`);
    });
    server.on('error', (e) => log('status server:', e.message));
    server.listen(port, process.env.STATUS_HOST || '127.0.0.1', () => log(`status page: http://localhost:${port}`));
    return server;
}

export async function startPolling(config) {
    const influx = new InfluxDB({url: config.influx.url, token: config.influx.token});
    const writeApi = influx.getWriteApi(config.influx.org, config.influx.bucket, 'ns', {
        // retry later if Influx is briefly unavailable
        maxRetries: 5,
        writeFailed: (err, lines) => { log('influx write failed:', err.message, `(${lines.length} lines)`); },
    });

    const status = {startedAt: new Date(), polls: 0, failures: 0, lastPollAt: null, lastError: null, points: 0, values: {}, events: []};
    // raw SmartThings response of the last successful poll, served at /api/status (not part of /status.json)
    Object.defineProperty(status, 'latestRaw', {value: null, writable: true, enumerable: false});
    const note = (msg) => { status.events.unshift(`${new Date().toLocaleTimeString()}  ${msg}`); status.events.length = Math.min(status.events.length, 15); };
    const server = startStatusServer(config, status);

    let running = false;
    const poll = async () => {
        if (running) return log('previous poll still running, skipping');
        running = true;
        try {
            const data = await fetchStatus(config.smartthings);
            const points = extractPoints(data);
            status.values = summarize(points);
            status.latestRaw = data;
            for (const p of points) {
                const pt = new Point(p.measurement);
                for (const [k, val] of Object.entries(p.tags)) pt.tag(k, val);
                for (const [k, val] of Object.entries(p.fields)) {
                    typeof val === 'string' ? pt.stringField(k, val) : pt.floatField(k, val);
                }
                if (p.time) pt.timestamp(p.time);
                writeApi.writePoint(pt);
            }
            await writeApi.flush();
            status.polls++; status.points = points.length; status.lastPollAt = new Date(); status.lastError = null;
            log(`polled: ${points.length} points written`);
            note(`ok, ${points.length} points`);
        } catch (e) {
            const http = e.response ? ` (HTTP ${e.response.status})` : '';
            status.failures++; status.lastError = `${e.message}${http}`;
            log(`poll failed${http}:`, e.message);
            note(`FAILED${http}: ${e.message}`);
        } finally {
            running = false;
            // a finished poll (successful or not) proves the loop is alive; a hung one never gets here
            watchdog();
        }
    };

    // outdoor temperature: hourly values, rewriting the same hour is idempotent; 30 days backfill on start
    let weatherDays = 30;
    const pollWeather = async () => {
        try {
            const rows = await fetchOutdoor(undefined, weatherDays);
            for (const w of rows) {
                const pt = new Point('weather').tag('source', 'open-meteo').floatField('temp', w.temp).timestamp(new Date(w.time));
                if (w.humidity !== undefined) pt.floatField('humidity', w.humidity);
                writeApi.writePoint(pt);
            }
            await writeApi.flush();
            weatherDays = 2;
            log(`outdoor temperature: ${rows.length} hourly points`);
        } catch (e) {
            log('outdoor temperature failed:', e.message);
        }
    };

    await poll();
    pollWeather();
    const timer = setInterval(poll, config.intervalMs);
    const weatherTimer = setInterval(pollWeather, 3600_000);
    const shutdown = async () => {
        clearInterval(timer);
        clearInterval(weatherTimer);
        server?.close();
        try { await writeApi.close(); } catch (e) { log('flush on shutdown failed:', e.message); }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    log(`polling every ${config.intervalMs / 1000}s -> ${config.influx.url} bucket ${config.influx.bucket}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    loadConfig().then(startPolling).catch((e) => {
        console.error(e.message);
        process.exit(1);
    });
}
