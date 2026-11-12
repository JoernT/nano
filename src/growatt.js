// Growatt hybrid inverter (SPH, "mix" endpoints) with battery via the OpenAPI v1 (token in GROWATT_TOKEN, serial in
// GROWATT_SN; without a serial the first storage device of the account is used).
// The API rate-limits hard (error 10012 "frequently access"): poll no faster than every few minutes.
//   dry run on the Pi:  cd ~/nano && node --env-file=.env src/growatt.js --dry   (lists plants/devices and the live values)
export const BASE = 'https://openapi.growatt.com/v1/';

export async function call(path, token, {params, body, fetchImpl = fetch} = {}) {
    const url = new URL(path, BASE);
    if (params && !body) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: {token, ...(body ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})},
        body: body ? new URLSearchParams(body) : undefined,
        signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`growatt ${path}: HTTP ${r.status}, not JSON: ${text.slice(0, 200)}`);
    }
}

const TZ = 'Europe/Berlin';

/** "2026-11-12 13:14:12" as local plant time (Europe/Berlin) -> epoch ms */
export function localToMs(str, tz = TZ) {
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)$/.exec(str ?? '');
    if (!m) return undefined;
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}).formatToParts(new Date(asUtc)).map((p) => [p.type, +p.value]));
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUtc - (shown - asUtc); // offset of the zone at that moment
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** live values of a mix_last_data answer: powers in W, SOC in %, day counters in kWh; unknown fields are left out */
export function parseMix(json) {
    const d = json?.data;
    if (!d || typeof d !== 'object') throw new Error(`growatt: ${json?.error_msg || 'no data'} (code ${json?.error_code ?? '?'})`);
    const time = localToMs(d.time) ?? Date.now();
    const f = {
        pv_w: d.ppv, charge_w: d.pcharge1, discharge_w: d.pdischarge1, soc: d.soc ?? d.bmsSOC,
        grid_import_w: d.pacToUserR, grid_export_w: d.pacToGridR, load_w: d.plocalLoadR,
        pv1_w: d.ppv1, pv2_w: d.ppv2, ac_charge_w: d.acChargePower, // per roof string; battery charging from the grid
        pv_kwh_today: d.epvtoday, pv_kwh_total: d.epvTotal, pv1_kwh_today: d.epv1Today, pv2_kwh_today: d.epv2Today, ac_charge_kwh_today: d.acChargeEnergyToday, load_kwh_today: d.elocalLoadToday, import_kwh_today: d.etoUserToday, export_kwh_today: d.etoGridToday,
    };
    return {time, fields: Object.fromEntries(Object.entries(f).filter(([, v]) => num(v) !== undefined))};
}

export async function findStorageSn(token, fetchImpl = fetch) {
    const plants = (await call('plant/list', token, {fetchImpl}))?.data?.plants ?? [];
    for (const p of plants) {
        const devices = (await call('device/list', token, {params: {plant_id: p.plant_id}, fetchImpl}))?.data?.devices ?? [];
        const d = devices.find((x) => x.type === 5) ?? devices[0]; // type 5 = SPH (mix)
        if (d) return d.device_sn;
    }
    throw new Error('growatt: no device found for this token');
}

export async function fetchMix(token, sn, fetchImpl = fetch) {
    return parseMix(await call('device/mix/mix_last_data', token, {body: {mix_sn: sn}, fetchImpl}));
}

async function dry() {
    const token = process.env.GROWATT_TOKEN;
    if (!token) throw new Error('GROWATT_TOKEN is not set (put it in ~/nano/.env)');
    const show = (label, v) => console.log(`\n== ${label}\n${JSON.stringify(v, null, 2)}`);

    const plants = await call('plant/list', token);
    show('plant/list', plants);
    const list = plants?.data?.plants ?? [];
    for (const p of list) {
        const id = p.plant_id ?? p.id;
        show(`device/list plant_id=${id}`, await call('device/list', token, {params: {plant_id: id}}));
    }
    const sn = process.env.GROWATT_SN || (await findStorageSn(token));
    await new Promise((r) => setTimeout(r, 65_000)); // rate limit
    show(`live values of ${sn}`, await fetchMix(token, sn));
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--dry')) {
    dry().catch((e) => {
        console.error(e.message);
        process.exit(1);
    });
}
