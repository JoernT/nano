// One-off: fill the `solar` series from the Growatt history (device/mix/mix_data) for the last N days.
//   on the Pi:  cd ~/nano && node --env-file=.env src/growatt-backfill.js [--days 7] [--dry]
// The API rate-limits (about one call per minute, error 10012), so this takes roughly (days * 3 pages) minutes.
// Rewriting a point with the same timestamp is idempotent, so it is safe to run more than once or next to the poller.
import {InfluxDB, Point} from '@influxdata/influxdb-client';
import {call, parseMix, findStorageSn} from './growatt.js';

const PER_PAGE = 100;
const CHUNK_DAYS = 7; // the API accepts at most 7 days between start and end
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const day = (ms) => new Date(ms).toLocaleDateString('sv-SE', {timeZone: 'Europe/Berlin'});

/** one rate-limited call: waits and retries on 10012 */
async function patient(path, token, args, tries = 5) {
    for (let i = 0; i < tries; i++) {
        const r = await call(path, token, args);
        if (r.error_code !== 10012) return r;
        await wait(70);
    }
    throw new Error(`${path}: still rate-limited after ${tries} tries`);
}

/** all rows of start..end (Berlin dates, at most 7 days apart), newest first as delivered */
export async function fetchRows(token, sn, start, end) {
    const rows = [];
    for (let page = 1; ; page++) {
        const r = await patient('device/mix/mix_data', token, {body: {mix_sn: sn, start_date: start, end_date: end, page, perpage: PER_PAGE}});
        if (r.error_code !== 0) throw new Error(`mix_data ${start}..${end} page ${page}: ${r.error_msg} (code ${r.error_code})`);
        const got = r.data?.datas ?? [];
        rows.push(...got);
        console.log(`${start}..${end} page ${page}: ${got.length} rows (count ${r.data?.count})`);
        if (got.length < PER_PAGE || rows.length >= (r.data?.count ?? 0)) return rows;
        await wait(65);
    }
}

/** day windows of at most CHUNK_DAYS, oldest first: [[start, end], ...] */
export function chunks(days, now = Date.now()) {
    const out = [];
    for (let back = days - 1; back >= 0; back -= CHUNK_DAYS) {
        out.push([day(now - back * 86400_000), day(now - Math.max(back - (CHUNK_DAYS - 1), 0) * 86400_000)]);
    }
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    const days = Number(args[args.indexOf('--days') + 1]) || 7;
    const dry = args.includes('--dry');
    const token = process.env.GROWATT_TOKEN;
    if (!token) throw new Error('GROWATT_TOKEN is not set');
    const sn = process.env.GROWATT_SN || (await findStorageSn(token));
    const writeApi = dry ? null : new InfluxDB({url: process.env.INFLUX_URL || 'http://localhost:8086', token: process.env.INFLUX_TOKEN})
        .getWriteApi(process.env.INFLUX_ORG || 'nanoCorp', process.env.INFLUX_BUCKET || 'nano', 'ns');
    let written = 0;
    for (const [start, end] of chunks(days)) {
        const seen = new Set();
        for (const row of await fetchRows(token, sn, start, end)) {
            const {time, fields} = parseMix({data: row});
            if (seen.has(time) || !Object.keys(fields).length) continue;
            seen.add(time);
            if (!dry) {
                const pt = new Point('solar').tag('source', 'growatt').timestamp(new Date(time));
                for (const [k, v] of Object.entries(fields)) pt.floatField(k, v);
                writeApi.writePoint(pt);
            }
            written++;
        }
        if (!dry) await writeApi.flush();
        console.log(`${start}..${end}: ${seen.size} points ${dry ? 'found' : 'written'}`);
        await wait(65);
    }
    if (!dry) await writeApi.close();
    console.log(`done: ${written} points`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e.message);
        process.exit(1);
    });
}
