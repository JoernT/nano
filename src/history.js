// Read-only history for the report page (src/report.html): queries InfluxDB so the browser never needs a token.
import {InfluxDB} from '@influxdata/influxdb-client';
import {readFileSync} from 'node:fs';
import {dayStartMs, compressorHz, detectCycles, dailyStats, summary, pearson, heatingDegreeDays, phaseStats, TZ} from './cycles.js';

// energy per day against the daily mean outdoor temperature
function dailyCorrelation(daily) {
    return {kwhVsOutdoor: pearson(daily.filter((d) => d.kwh !== undefined && d.outdoor !== undefined).map((d) => [d.outdoor, d.kwh]))};
}

// allowed ranges: hours back and the averaging window for continuous series
export const RANGES = {'24h': {hours: 24, every: '5m'}, '7d': {hours: 168, every: '15m'}, '30d': {hours: 720, every: '1h'}};

const STATES = [
    {key: 'mode', component: 'heating', attribute: 'mode'},
    {key: 'diverterValve', component: 'warmwater', attribute: 'diverterValve'},
    {key: 'defrost', component: 'heating', attribute: 'defrost'},
];

// room names live in rooms.json; points written before a sensor was named keep their raw id
function roomNames() {
    try { return JSON.parse(readFileSync(new URL('./rooms.json', import.meta.url), 'utf8')); } catch { return {}; }
}

// monthly values read off the heat pump's display, typed in by hand: {"months": {"2025-12": {"consumed": 812, "produced": 3100}}} (kWh)
function energyHistory() {
    try { return JSON.parse(readFileSync(new URL('./energy-history.json', import.meta.url), 'utf8')).months || {}; } catch { return {}; }
}

// changes made on the unit, newest last: [{"at": "2026-11-10T14:00:00+01:00", "label": "FSV 2022 -2 K"}]; see docs/findings.md
function experiments() {
    try {
        return JSON.parse(readFileSync(new URL('./experiments.json', import.meta.url), 'utf8'))
            .map((e) => ({at: Date.parse(e.at), label: String(e.label || 'Änderung')}))
            .filter((e) => Number.isFinite(e.at))
            .sort((a, b) => a.at - b.at);
    } catch { return []; }
}

export function createHistory(config) {
    const api = new InfluxDB({url: config.influx.url, token: config.influx.token}).getQueryApi(config.influx.org);
    const bucket = config.influx.bucket;
    const rows = (flux) => api.collectRows(flux);
    const pairs = (rs) => rs.map((r) => [Date.parse(r._time), r._value]);

    return async function history(rangeKey) {
        const range = RANGES[rangeKey];
        if (!range) throw new Error(`unknown range ${rangeKey}`);
        const {hours, every} = range;
        const base = `from(bucket: "${bucket}")`;
        const mean = (measurement, field, extra = '') => rows(`${base} |> range(start: -${hours}h)
            |> filter(fn: (r) => r._measurement == "${measurement}" and r._field == "${field}" ${extra})
            |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`);

        const hourly = (measurement, extra) => rows(`${base} |> range(start: -${hours}h)
            |> filter(fn: (r) => r._measurement == "${measurement}" and r._field == "temp" ${extra})
            |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)`);

        // the device only reports a temperature when it changes: remember the value that was valid when the window starts
        const tempsBefore = rows(`${base} |> range(start: -90d, stop: -${hours}h)
            |> filter(fn: (r) => r._measurement == "temperature" and r._field == "temp")
            |> group(columns: ["component"]) |> last()`);

        // kWh per month and year over all recorded data (the counter is cumulative: daily last value, differences summed)
        const totalsRows = rows(`import "timezone"
            option location = timezone.location(name: "${TZ}")
            ${base} |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "powerconsumption" and r._field == "energy" and r.component == "heatpump")
            |> aggregateWindow(every: 1d, fn: last, createEmpty: false)
            |> difference()`);

        const [temps, roomRows, power, cycleRows, stateRows, energyRows, outdoorRows, outdoorHourly, flowHourly, beforeRows] = await Promise.all([
            mean('temperature', 'temp'),
            mean('room_climate', 'temp'),
            mean('powerconsumption', 'power', 'and r.component == "heatpump"'),
            rows(`${base} |> range(start: -${hours}h)
                |> filter(fn: (r) => r._measurement == "ehs_cycle" and r.kind == "outdoor" and r._field == "raw")
                |> sort(columns: ["_time"])`),
            // state points keep the device timestamp of the last change, so look back further
            rows(`${base} |> range(start: -90d)
                |> filter(fn: (r) => r._measurement == "state" and (${STATES.map((s) => `(r.component == "${s.component}" and r.attribute == "${s.attribute}")`).join(' or ')}))
                |> sort(columns: ["_time"])`),
            rows(`import "timezone"
                option location = timezone.location(name: "${TZ}")
                ${base} |> range(start: -${hours + 24}h)
                |> filter(fn: (r) => r._measurement == "powerconsumption" and r._field == "energy" and r.component == "heatpump")
                |> aggregateWindow(every: 1d, fn: last, createEmpty: false)
                |> difference()`),
            mean('weather', 'temp'),
            hourly('weather', ''),
            hourly('temperature', 'and r.component == "heating"'),
            tempsBefore,
        ]);
        // solar (Growatt, optional: empty when GROWATT_TOKEN is not set): continuous series, radiation from Open-Meteo,
        // yield per day = highest "today" counter of each local day
        const SOLAR_FIELDS = ['pv_w', 'pv1_w', 'pv2_w', 'load_w', 'soc', 'grid_import_w', 'grid_export_w', 'charge_w', 'discharge_w'];
        const [solarRows, radiationRows, pvDayRows, pvTotalRows] = await Promise.all([
            Promise.all(SOLAR_FIELDS.map((f) => mean('solar', f))),
            mean('weather', 'radiation'),
            rows(`import "timezone"
                option location = timezone.location(name: "${TZ}")
                ${base} |> range(start: -${hours + 24}h)
                |> filter(fn: (r) => r._measurement == "solar" and r._field == "pv_kwh_today")
                |> aggregateWindow(every: 1d, fn: max, createEmpty: false)`),
            // lifetime yield of the plant: newest value of the total counter
            rows(`${base} |> range(start: -400d)
                |> filter(fn: (r) => r._measurement == "solar" and r._field == "pv_kwh_total")
                |> last()`),
        ]);
        const solar = {
            pvTotal: pvTotalRows.length ? Math.round(pvTotalRows[pvTotalRows.length - 1]._value) : undefined,
            ...Object.fromEntries(SOLAR_FIELDS.map((f, i) => [f, pairs(solarRows[i])])),
            radiation: pairs(radiationRows),
            // [local day, kWh]
            pvDaily: pvDayRows.map((r) => [new Date(Date.parse(r._time) - 12 * 3600_000).toLocaleDateString('sv-SE', {timeZone: TZ}), Math.round(r._value * 10) / 10]),
        };
        const totalsData = await totalsRows;
        const energyTotals = (() => {
            const months = new Map();
            // the first row has no earlier day to subtract from (it is the counter's lifetime total), so it is skipped
            for (const r of totalsData.slice(1)) {
                if (!(r._value >= 0)) continue; // counter reset
                const day = new Date(Date.parse(r._time) - 12 * 3600_000).toLocaleDateString('sv-SE', {timeZone: TZ});
                const m = months.get(day.slice(0, 7)) || months.set(day.slice(0, 7), {month: day.slice(0, 7), kwh: 0, days: 0}).get(day.slice(0, 7));
                m.kwh += r._value; m.days++;
            }
            const round = (o) => ({...o, kwh: Math.round(o.kwh * 10) / 10});
            // one row per month: the display value (full month) wins over our own, possibly partial, measurement
            const manual = energyHistory();
            const rows = new Map([...months.values()].map((m) => [m.month, {month: m.month, consumed: round(m).kwh, days: m.days, source: 'gemessen'}]));
            for (const [month, v] of Object.entries(manual)) {
                const row = rows.get(month) || rows.set(month, {month}).get(month);
                if (Number.isFinite(v.consumed)) Object.assign(row, {consumed: v.consumed, days: undefined, source: 'Display'});
                if (Number.isFinite(v.produced)) row.produced = v.produced;
            }
            const list = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
            const years = new Map();
            for (const m of list) {
                const y = years.get(m.month.slice(0, 4)) || years.set(m.month.slice(0, 4), {year: m.month.slice(0, 4), consumed: 0, months: 0, copConsumed: 0, copProduced: 0}).get(m.month.slice(0, 4));
                if (m.consumed !== undefined) { y.consumed += m.consumed; y.months++; }
                if (m.consumed !== undefined && m.produced !== undefined) { y.copConsumed += m.consumed; y.copProduced += m.produced; }
            }
            for (const m of list) if (m.consumed && m.produced !== undefined) m.cop = Math.round((m.produced / m.consumed) * 100) / 100;
            const yl = [...years.values()].map((y) => ({year: y.year, consumed: Math.round(y.consumed * 10) / 10, months: y.months, produced: y.copProduced || undefined, cop: y.copConsumed ? Math.round((y.copProduced / y.copConsumed) * 100) / 100 : undefined}));
            return {months: list, years: yl};
        })();
        const to = Date.now();
        const from = to - hours * 3600_000;

        const group = (rs, tag) => {
            const out = {};
            for (const r of rs) (out[r[tag]] ||= []).push(r);
            return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, pairs(v)]));
        };

        // on-change series: hold the value from before the window at its start and the last value up to the window end,
        // otherwise a temperature that has not changed for a while looks like the data stopped
        const tempSeries = group(temps, 'component');
        const gapMs = {'5m': 300_000, '15m': 900_000, '1h': 3600_000}[every] * 2;
        for (const r of beforeRows) {
            const pts = (tempSeries[r.component] ||= []);
            if (!pts.length || pts[0][0] - from > gapMs) pts.unshift([from, r._value]);
        }
        for (const pts of Object.values(tempSeries)) {
            const last = pts[pts.length - 1];
            if (last && last[0] < to) pts.push([to, last[1]]);
        }

        const names = roomNames();
        const rooms = {};
        for (const [id, pts] of Object.entries(group(roomRows, 'room'))) {
            const name = names[id] || (Object.values(names).includes(id) ? id : null);
            if (name) (rooms[name] ||= []).push(...pts); // unnamed sensors are recorded but not charted
        }
        for (const pts of Object.values(rooms)) pts.sort((a, b) => a[0] - b[0]);

        const samples = cycleRows
            .map((r) => ({t: Date.parse(r._time), hz: compressorHz(r._value)}))
            .filter((s) => s.hz !== undefined);
        const runs = detectCycles(samples);
        const kwh = new Map(energyRows.map((r) => [new Date(Date.parse(r._time) - 12 * 3600_000).toLocaleDateString('sv-SE', {timeZone: TZ}), Math.round(r._value * 10) / 10]));
        const outByDay = new Map();
        for (const r of outdoorHourly) {
            const k = new Date(Date.parse(r._time) - 1).toLocaleDateString('sv-SE', {timeZone: TZ});
            (outByDay.get(k) || outByDay.set(k, []).get(k)).push(r._value);
        }
        // daily mean of the named rooms (the unnamed sensor is left out)
        const named = new Set(Object.values(names));
        const roomByDay = new Map();
        for (const [id, pts] of Object.entries(rooms)) {
            if (!named.has(id)) continue;
            for (const [t, v] of pts) {
                const k = new Date(t).toLocaleDateString('sv-SE', {timeZone: TZ});
                (roomByDay.get(k) || roomByDay.set(k, []).get(k)).push(v);
            }
        }
        const mean1 = (xs) => (xs?.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : undefined);
        // mean compressor frequency per day while the compressor runs (Hz > 0)
        const hzByDay = new Map();
        for (const {t, hz} of samples) {
            if (!(hz > 0)) continue;
            const k = new Date(t).toLocaleDateString('sv-SE', {timeZone: TZ});
            (hzByDay.get(k) || hzByDay.set(k, []).get(k)).push(hz);
        }
        const daily = dailyStats(runs).map((d) => {
            const outdoor = mean1(outByDay.get(d.day));
            return {...d, kwh: kwh.get(d.day), outdoor, hdd: heatingDegreeDays(outdoor), roomMean: mean1(roomByDay.get(d.day)), avgHz: mean1(hzByDay.get(d.day)), partial: dayStartMs(d.day, TZ) < (samples[0]?.t ?? 0)};
        });
        const exps = experiments();
        const phases = phaseStats(daily, exps, Date.now(), TZ, samples[0]?.t);

        const states = {};
        for (const s of STATES) {
            states[s.key] = stateRows.filter((r) => r.component === s.component && r.attribute === s.attribute).map((r) => [Date.parse(r._time), r._value]);
        }

        // heating curve: hourly flow temperature against outdoor temperature
        const flowByHour = new Map(flowHourly.map((r) => [Date.parse(r._time), r._value]));
        const curve = outdoorHourly
            .map((r) => [r._value, flowByHour.get(Date.parse(r._time))])
            .filter(([o, f]) => f !== undefined)
            .map(([o, f]) => [Math.round(o * 10) / 10, Math.round(f * 10) / 10]);

        return {
            range: rangeKey,
            from,
            to,
            temps: tempSeries,
            rooms,
            outdoor: pairs(outdoorRows),
            curve,
            correlation: {
                flowVsOutdoor: pearson(curve),
                ...dailyCorrelation(daily),
            },
            power: pairs(power),
            solar,
            hz: samples.map((s) => [s.t, s.hz]),
            runs,
            summary: summary(runs),
            daily,
            energyTotals,
            experiments: exps,
            phases,
            states,
        };
    };
}
