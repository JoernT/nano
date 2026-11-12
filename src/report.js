import ApexCharts from 'apexcharts';

// the poller (src/nano.js) serves the history from InfluxDB
const API = '/api/history';
const GROUP = 'nano'; // same group = synchronised zoom and tooltip
const charts = {};
let view = {}; // selected window and experiments
const expAnnotations = () => (view.experiments || []).filter((e) => e.at >= view.min).map((e) => ({x: e.at, borderColor: '#76b041', strokeDashArray: 3, label: {text: e.label, orientation: 'horizontal', textAnchor: 'end', position: 'top', offsetX: -4, style: {color: '#fff', background: '#76b041'}}})); // selected time window, so every time chart spans it even where there is no data
const COLORS = ['#e4572e', '#2e86ab', '#76b041', '#a23b72', '#f2a541', '#6c757d'];
const STATE_LABELS = {mode: 'Heizmodus', diverterValve: 'Ventil', defrost: 'Abtauen'};
const STATE_COLORS = {auto: '#2e86ab', heat: '#e4572e', cool: '#76b041', room: '#6c757d', tank: '#f2a541', on: '#e4572e', off: '#d6d9dc'};

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const base = (extra) => ({
    chart: {group: GROUP, height: 260, toolbar: {show: true, tools: {download: false}}, zoom: {type: 'x'}, animations: {enabled: false}, background: 'transparent', foreColor: dark ? '#bbb' : '#555', ...extra.chart},
    theme: {mode: dark ? 'dark' : 'light'},
    dataLabels: {enabled: false},
    colors: COLORS,
    grid: {borderColor: dark ? '#333' : '#e3e5e8'},
    annotations: {xaxis: expAnnotations()},
    xaxis: {type: 'datetime', labels: {datetimeUTC: false}, min: view.min, max: view.max},
    tooltip: {x: {format: 'dd.MM. HH:mm'}},
    legend: {position: 'top'},
    ...extra.rest,
});

function draw(id, options) {
    charts[id]?.destroy();
    charts[id] = new ApexCharts(document.getElementById(id), options);
    charts[id].render();
}

const fmt = (n, d = 1) => (n === undefined || n === null ? '–' : Number(n).toFixed(d));
const ROOM_LABEL = {bedroom1: 'Schlafzimmer 1', bedroom2: '1.Stck', livingroom: 'Wohnzimmer'};

function renderTiles(h) {
    const s = h.summary;
    const kwh = h.daily.map((d) => d.kwh).filter((x) => x !== undefined);
    const tiles = [
        [s.starts, 'Verdichter-Starts'],
        [s.shortCycles, `Kurzläufe (<10 min)`],
        [fmt(s.avgRunMinutes, 0) + ' min', 'Ø Laufzeit'],
        [fmt(s.medianRunMinutes, 0) + ' min', 'Median Laufzeit'],
        [kwh.length ? fmt(kwh.reduce((a, b) => a + b, 0) / kwh.length) + ' kWh' : '–', 'Ø Energie pro Tag'],
    ];
    document.getElementById('summary').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
}

// start of the plant's lifetime counter: creation date of the plant at Growatt (plant/list)
const PV_SINCE = '22.11.2023';

function renderSolar(h) {
    const sol = h.solar || {};
    const hasData = (sol.pv_w || []).length > 0;
    const panel = document.getElementById('c-solar');
    if (!hasData) {
        charts['c-solar']?.destroy();
        delete charts['c-solar'];
        document.getElementById('solar-tiles').innerHTML = '';
        panel.innerHTML = '<p class="msg">Noch keine Solardaten (GROWATT_TOKEN auf dem Pi setzen).</p>';
        return;
    }
    panel.innerHTML = '';
    const last = (pts) => pts?.length ? pts[pts.length - 1][1] : undefined;
    const todayKey = new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Berlin'});
    const today = (sol.pvDaily || []).find(([d]) => d === todayKey)?.[1];
    const sum = (sol.pvDaily || []).reduce((a, [, v]) => a + v, 0);
    const tiles = [
        [fmt(last(sol.pv_w), 0) + ' W', 'PV jetzt'],
        [fmt(last(sol.soc), 0) + ' %', 'Batterie'],
        [today !== undefined ? fmt(today) + ' kWh' : '–', 'PV heute'],
        [(sol.pvDaily || []).length ? fmt(sum) + ' kWh' : '–', 'PV im Zeitraum'],
        [sol.pvTotal !== undefined ? Math.round(sol.pvTotal).toLocaleString('de-DE') + ' kWh' : '–', `PV gesamt seit ${PV_SINCE}`],
    ];
    document.getElementById('solar-tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
    // battery power: charging positive, discharging negative; grid: import positive, export negative
    const net = (a, b) => {
        const bm = new Map((b || []).map(([t, v]) => [t, v]));
        return (a || []).map(([t, v]) => [t, Math.round(v - (bm.get(t) ?? 0))]);
    };
    // one entry per series; the two roof strings only appear once they have been recorded
    const strings = (sol.pv1_w || []).length > 0;
    const specs = [
        {name: 'PV (W)', type: 'area', data: sol.pv_w || [], width: 1, opacity: 0.25, dash: 0},
        ...(strings ? [
            {name: 'String 1 (W)', type: 'line', data: sol.pv1_w, width: 1.5, opacity: 1, dash: 2},
            {name: 'String 2 (W)', type: 'line', data: sol.pv2_w || [], width: 1.5, opacity: 1, dash: 2},
        ] : []),
        {name: 'Verbrauch Haus (W)', type: 'line', data: sol.load_w || [], width: 2, opacity: 1, dash: 0},
        {name: 'Netz (W, + Bezug / − Einspeisung)', type: 'line', data: net(sol.grid_import_w, sol.grid_export_w), width: 2, opacity: 1, dash: 0},
        {name: 'Einstrahlung (W/m²)', type: 'line', data: sol.radiation || [], width: 2, opacity: 1, dash: 4},
        {name: 'Batterie-Ladestand (%)', type: 'line', data: sol.soc || [], width: 2, opacity: 1, dash: 0, percent: true},
    ];
    draw('c-solar', {
        ...base({chart: {type: 'line'}, rest: {}}),
        series: specs.map(({name, type, data}) => ({name, type, data})),
        stroke: {width: specs.map((x) => x.width), curve: 'smooth', dashArray: specs.map((x) => x.dash)},
        fill: {opacity: specs.map((x) => x.opacity)},
        ...((view.max - view.min) <= 25 * 3600_000 ? {xaxis: {...base({chart: {}, rest: {}}).xaxis, tickAmount: Math.round((view.max - view.min) / 3600_000), labels: {datetimeUTC: false, format: 'HH:mm', rotate: -45, rotateAlways: true}}} : {}),
        // everything in W shares the first axis, the battery level has its own (0-100 %)
        yaxis: specs.map((x, i) => (x.percent ? {opposite: true, min: 0, max: 100, title: {text: '%'}, decimalsInFloat: 0}
            : i === 0 ? {seriesName: 'PV (W)', title: {text: 'W'}, decimalsInFloat: 0} : {seriesName: 'PV (W)', show: false})),
    });
}

function renderHdd(h) {
    const today = new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Berlin'});
    const rows = h.daily.filter((d) => d.day !== today);
    draw('c-hdd', {
        ...base({chart: {type: 'line', group: undefined, height: 240}, rest: {}}),
        series: [
            {name: 'kWh je Gradtag', type: 'column', data: rows.map((d) => (d.kwh !== undefined && d.hdd >= 1 ? Math.round((d.kwh / d.hdd) * 100) / 100 : null))},
            {name: 'Starts pro Tag', type: 'line', data: rows.map((d) => d.starts)},
        ],
        xaxis: {categories: rows.map((d) => d.day)},
        annotations: {},
        stroke: {width: [0, 3]},
        yaxis: [{title: {text: 'kWh/Gradtag'}, decimalsInFloat: 2}, {opposite: true, title: {text: 'Starts'}, decimalsInFloat: 0}],
        tooltip: {shared: true},
    });
}

// trend: rolling 7-day means of the daily values and the last 7 full days compared with the 7 before
const METRICS = [
    ['Starts pro Tag', (d) => d.starts, 1, -1],
    ['Laufzeit min pro Tag', (d) => d.runMinutes, 0, 0],
    ['Ø Laufzeit pro Start (min)', (d) => (d.starts ? d.runMinutes / d.starts : undefined), 0, 1],
    ['Ø Verdichter-Frequenz (Hz, laufend)', (d) => d.avgHz, 1, 0],
    ['Energie kWh pro Tag', (d) => d.kwh, 1, -1],
    ['kWh je Gradtag', (d) => (d.kwh !== undefined && d.hdd >= 1 ? d.kwh / d.hdd : undefined), 2, -1],
];
const meanOf = (xs) => { const v = xs.filter((x) => x !== undefined && x !== null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined; };

function renderTrend(h) {
    const today = new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Berlin'});
    const rows = h.daily.filter((d) => d.day !== today && !d.partial); // today is running, the first day may start mid-day
    const el = document.getElementById('trend');
    if (rows.length < 2) { el.innerHTML = '<p class="msg">Zu wenige volle Tage für einen Trend (Zeitraum 7 oder 30 Tage wählen).</p>'; charts['c-trend']?.destroy(); return; }
    if (rows.length < 4) {
        el.innerHTML = `<p class="msg">Erst ${rows.length} volle Tage: der Vergleich letzte/vorherige Tage braucht mindestens 4.</p>`;
    } else {
        const n = Math.min(7, Math.floor(rows.length / 2));
        const last = rows.slice(-n), prev = rows.slice(-2 * n, -n);
        const body = METRICS.map(([label, f, dec, good]) => {
            const a = meanOf(last.map(f)), b = meanOf(prev.map(f));
            const pct = a !== undefined && b ? ((a - b) / b) * 100 : undefined;
            const cls = pct === undefined || Math.abs(pct) < 5 || good === 0 ? '' : (pct * good > 0 ? 'ok' : 'bad');
            const arrow = pct === undefined ? '' : Math.abs(pct) < 5 ? '→' : pct > 0 ? '↑' : '↓';
            return `<tr><td>${label}</td><td>${fmt(b, dec)}</td><td>${fmt(a, dec)}</td><td class="${cls}">${arrow} ${pct === undefined ? '–' : (pct > 0 ? '+' : '') + fmt(pct, 0) + ' %'}</td></tr>`;
        }).join('');
        el.innerHTML = `<table class="phases totals"><thead><tr><th>Ø je Tag</th><th>vorherige ${prev.length} Tage</th><th>letzte ${last.length} Tage</th><th>Änderung</th></tr></thead><tbody>${body}</tbody></table>`;
    }
    const roll = (f) => rows.map((_, i) => { const v = meanOf(rows.slice(Math.max(0, i - 6), i + 1).map(f)); return v === undefined ? null : Math.round(v * 100) / 100; });
    draw('c-trend', {
        ...base({chart: {type: 'line', group: undefined, height: 240}, rest: {}}),
        series: [
            {name: 'Starts (Ø 7 T)', type: 'line', data: roll((d) => d.starts)},
            {name: 'Laufzeit min (Ø 7 T)', type: 'line', data: roll((d) => d.runMinutes)},
            {name: 'Energie kWh (Ø 7 T)', type: 'line', data: roll((d) => d.kwh)},
            {name: 'Verdichter Hz (Ø 7 T)', type: 'line', data: roll((d) => d.avgHz)},
        ],
        xaxis: {categories: rows.map((d) => d.day)},
        annotations: {},
        stroke: {width: 3, curve: 'smooth'},
        yaxis: [{seriesName: 'Starts (Ø 7 T)', title: {text: 'Starts / kWh'}, decimalsInFloat: 1}, {seriesName: 'Laufzeit min (Ø 7 T)', opposite: true, title: {text: 'min'}, decimalsInFloat: 0}, {seriesName: 'Starts (Ø 7 T)', show: false}, {seriesName: 'Verdichter Hz (Ø 7 T)', opposite: true, title: {text: 'Hz'}, decimalsInFloat: 0}],
        tooltip: {shared: true},
    });
}

const REMIND_MONTHS = 6;

function renderTotals(h) {
    const t = h.energyTotals || {months: [], years: []};
    const cell = (x, d = 1) => (x === undefined ? '–' : fmt(x, d));
    const head = (label, last) => `<thead><tr><th>${label}</th><th>Strom kWh</th><th>Wärme kWh</th><th>COP</th><th>${last}</th></tr></thead>`;
    const years = t.years.slice().reverse().map((y) => `<tr><td>${y.year}</td><td>${cell(y.consumed)}</td><td>${cell(y.produced, 0)}</td><td>${cell(y.cop, 2)}</td><td>${y.months} ${y.months === 1 ? "Monat" : "Monate"}</td></tr>`).join('');
    const months = t.months.slice().reverse().map((m) => `<tr><td>${m.month}</td><td>${cell(m.consumed)}</td><td>${cell(m.produced, 0)}</td><td>${cell(m.cop, 2)}</td><td>${m.source === 'Display' ? 'Display' : `gemessen, ${m.days} Tage`}</td></tr>`).join('');
    // reminder: the display values (src/energy-history.json) are typed in by hand, ask for new ones every 6 months
    const lastDisplay = t.months.filter((m) => m.source === 'Display').map((m) => m.month).pop();
    const now = new Date(h.to);
    const age = lastDisplay ? now.getFullYear() * 12 + now.getMonth() - (+lastDisplay.slice(0, 4) * 12 + +lastDisplay.slice(5, 7) - 1) : Infinity;
    const reminder = document.getElementById('reminder');
    reminder.hidden = age < REMIND_MONTHS;
    reminder.textContent = lastDisplay
        ? `Erinnerung: Die letzten Display-Werte der Wärmepumpe sind von ${lastDisplay}. Bitte Strom- und Wärmemengen der Monate seither vom Display ablesen und in src/energy-history.json nachtragen.`
        : 'Erinnerung: Es gibt noch keine Display-Werte der Wärmepumpe (src/energy-history.json).';
    document.getElementById('totals').innerHTML = t.months.length
        ? `<table class="phases totals">${head('Jahr', 'Basis')}<tbody>${years}</tbody></table><br><table class="phases totals">${head('Monat', 'Quelle')}<tbody>${months}</tbody></table>`
        : '<p class="msg">Noch keine Energiedaten.</p>';
}

function renderPhases(h) {
    const f = (v, d = 1) => (v === undefined ? '–' : Number(v).toFixed(d));
    const rows = h.phases.map((p) => `<tr><td>${p.label}${p.from ? ` <small>ab ${new Date(p.from).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</small>` : ''}</td><td>${p.days}</td><td>${f(p.kwhPerHdd, 2)}</td><td>${f(p.kwh)}</td><td>${f(p.starts, 0)}</td><td>${f(p.shortCycles)}</td><td>${f(p.roomMean)}</td></tr>`).join('');
    document.getElementById('phases').innerHTML = `<table class="phases"><thead><tr><th>Phase</th><th>volle Tage</th><th>kWh/Gradtag</th><th>kWh/Tag</th><th>Starts/Tag</th><th>Kurzläufe/Tag</th><th>Ø Raum °C</th></tr></thead><tbody>${rows}</tbody></table>`
        + (h.phases.every((p) => !p.days) ? '<p class="msg">Keine vollen Tage im gewählten Zeitraum: 7 oder 30 Tage wählen.</p>' : '')
        + (h.experiments.length ? '' : '<p class="msg">Noch keine Änderung eingetragen: Eintrag in src/experiments.json, z. B. {"at": "2026-11-11T14:00:00+01:00", "label": "Kurve -2 K"}</p>');
}

function renderStates(h) {
    // state points are change events; each segment lasts until the next change (last one until now)
    const series = [];
    for (const [key, label] of Object.entries(STATE_LABELS)) {
        const pts = h.states[key] || [];
        const segs = [];
        pts.forEach(([t, v], i) => {
            const end = i + 1 < pts.length ? pts[i + 1][0] : h.to;
            const from = Math.max(t, h.from);
            if (end > h.from) segs.push({x: label, y: [from, end], fillColor: STATE_COLORS[v] || '#999', v});
        });
        series.push(...segs);
    }
    draw('c-states', {
        ...base({chart: {type: 'rangeBar', height: 230}, rest: {}}),
        series: [{data: series}],
        plotOptions: {bar: {horizontal: true, rangeBarGroupRows: true}},
        legend: {show: false},
        tooltip: {custom: ({dataPointIndex, w}) => {
            const p = w.config.series[0].data[dataPointIndex];
            return `<div style="padding:.4rem .6rem">${p.x}: <b>${p.v}</b><br>${new Date(p.y[0]).toLocaleString('de-DE')} –<br>${new Date(p.y[1]).toLocaleString('de-DE')}</div>`;
        }},
    });
}

// y-range for the heating curve: a few degrees around the data instead of starting at 0
function flowBounds(curve = []) {
    if (!curve.length) return {};
    const ys = curve.map((p) => p[1]);
    return {min: Math.floor(Math.min(...ys)) - 2, max: Math.ceil(Math.max(...ys)) + 2};
}

// union of all room timestamps (server windows are aligned); the shared tooltip matches series by index,
// so every series is put on this grid with null where a sensor has no value
const roomGrid = (rooms) => [...new Set(Object.values(rooms).flatMap((pts) => pts.map((p) => p[0])))].sort((a, b) => a - b);
const onGrid = (pts, grid, maxGapMs = 15 * 60_000) => {
    const m = new Map(pts);
    let last = null;
    return grid.map((t) => {
        if (m.has(t)) last = [t, m.get(t)];
        // hold the previous value over short gaps so the line stays connected, longer gaps stay empty
        return [t, m.has(t) ? m.get(t) : last && t - last[0] <= maxGapMs ? last[1] : null];
    });
};

// outdoor values are hourly, rooms every few minutes: resample onto the room timestamps (linear, last value held)
// so the shared tooltip finds an outdoor value at every x position
function resample(series = [], grid = []) {
    if (!series.length) return [];
    let i = 0;
    return grid.map((t) => {
        while (i + 1 < series.length && series[i + 1][0] <= t) i++;
        const [t0, v0] = series[i];
        const next = series[i + 1];
        if (t <= t0 || !next) return [t, v0];
        return [t, Math.round((v0 + ((next[1] - v0) * (t - t0)) / (next[0] - t0)) * 10) / 10];
    });
}

// ApexCharts' shared tooltip showed only the nearest series here, so list all series at the hovered point ourselves
function allSeriesTooltip({series, dataPointIndex, w}) {
    const t = w.globals.seriesX[0]?.[dataPointIndex];
    const rows = series.map((s, i) => [w.globals.seriesNames[i], s[dataPointIndex], w.globals.colors[i]]).filter(([, v]) => v !== null && v !== undefined);
    return `<div style="padding:.4rem .6rem"><b>${t ? new Date(t).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : ''}</b>`
        + rows.map(([n, v, c]) => `<div><i style="display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:${c};margin-right:.4rem"></i>${n}: <b>${Number(v).toFixed(1)} °C</b></div>`).join('') + '</div>';
}

async function load(range) {
    const msg = document.getElementById('msg');
    msg.textContent = 'lade …';
    let h;
    try {
        const r = await fetch(`${API}?range=${range}`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
        h = await r.json();
    } catch (e) {
        msg.textContent = `Fehler beim Laden: ${e.message} (läuft der Poller auf Port 8787?)`;
        return;
    }
    view = {min: h.from, max: h.to, experiments: h.experiments};
    const firsts = [h.hz, h.power, ...Object.values(h.rooms), ...Object.values(h.temps)].map((pts) => pts?.[0]?.[0]).filter((t) => t !== undefined);
    const first = firsts.length ? Math.min(...firsts) : null;
    const f = (t) => new Date(t).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
    const gap = first && first - h.from > 3600_000;
    document.getElementById('range-info').innerHTML = `Zeitraum ${f(h.from)} – ${f(h.to)}`
        + (!first ? ' · <b class="warn">keine Daten</b>' : gap ? ` · <b class="warn">Daten erst ab ${f(first)}</b> (davor leer)` : '');
    msg.textContent = `Stand ${new Date(h.to).toLocaleString('de-DE')}`;
    renderTiles(h);

    draw('c-rooms', {
        ...base({chart: {type: 'line'}, rest: {}}),
        series: (() => {
            const grid = roomGrid(h.rooms);
            return [...Object.entries(h.rooms).map(([name, data]) => ({name: ROOM_LABEL[name] || name, data: onGrid(data, grid)})), {name: 'Außen (DWD)', data: resample(h.outdoor, grid)}];
        })(),
        stroke: {width: [...Object.keys(h.rooms).map(() => 2), 2], curve: 'smooth', dashArray: [...Object.keys(h.rooms).map(() => 0), 5]},
        yaxis: {decimalsInFloat: 1, title: {text: '°C'}},
        tooltip: {custom: allSeriesTooltip},
        annotations: {xaxis: expAnnotations(), yaxis: [{y: 22.5, borderColor: '#e4572e', strokeDashArray: 4, label: {text: '22,5 °C', style: {color: '#fff', background: '#e4572e'}}}]},
    });
    draw('c-flow', {
        ...base({chart: {type: 'line'}, rest: {}}),
        series: [
            {name: 'Heizung (Vorlauf)', data: h.temps.heating || []},
            {name: 'Warmwasser', data: h.temps.warmwater || []},
        ],
        stroke: {width: 2, curve: 'smooth'},
        yaxis: {decimalsInFloat: 1, title: {text: '°C'}},
    });
    const c = h.correlation || {};
    document.getElementById('corr').textContent = [
        c.flowVsOutdoor !== undefined ? `r = ${c.flowVsOutdoor} (Vorlauf/außen)` : '',
        c.kwhVsOutdoor !== undefined ? `r = ${c.kwhVsOutdoor} (kWh/Tag vs. außen)` : '',
    ].filter(Boolean).join(' · ');
    draw('c-curve', {
        ...base({chart: {type: 'scatter', group: undefined, zoom: {type: 'xy'}}, rest: {}}),
        series: [{name: 'Stundenmittel', data: h.curve || []}],
        xaxis: {type: 'numeric', title: {text: 'Außentemperatur °C'}, decimalsInFloat: 1, tickAmount: 8},
        yaxis: {decimalsInFloat: 0, ...flowBounds(h.curve), title: {text: 'Vorlauf °C'}},
        markers: {size: 4},
        annotations: {},
        tooltip: {x: {formatter: (v) => `${v} °C außen`}},
    });
    draw('c-power', {
        ...base({chart: {type: 'line'}, rest: {}}),
        series: [
            {name: 'Leistung (W, Ø)', type: 'line', data: h.power},
            {name: 'Verdichter (Hz)', type: 'area', data: h.hz},
        ],
        stroke: {width: [2, 1], curve: ['smooth', 'stepline']},
        fill: {opacity: [1, 0.25]},
        // hourly scale: one tick label per hour where the window is a day or less
        ...((view.max - view.min) <= 25 * 3600_000 ? {xaxis: {...base({chart: {}, rest: {}}).xaxis, tickAmount: Math.round((view.max - view.min) / 3600_000), labels: {datetimeUTC: false, format: 'HH:mm', rotate: -45, rotateAlways: true}}} : {}),
        yaxis: [{title: {text: 'W'}, decimalsInFloat: 0}, {opposite: true, title: {text: 'Hz'}, decimalsInFloat: 0}],
    });
    const days = h.daily.map((d) => d.day);
    draw('c-daily', {
        ...base({chart: {type: 'line', group: undefined}, rest: {}}),
        series: [
            {name: 'Starts', type: 'column', data: h.daily.map((d) => d.starts)},
            {name: 'Kurzläufe', type: 'column', data: h.daily.map((d) => d.shortCycles)},
            {name: 'Energie (kWh)', type: 'line', data: h.daily.map((d) => d.kwh ?? null)},
        ],
        xaxis: {categories: days},
        annotations: {},
        stroke: {width: [0, 0, 3]},
        yaxis: [
            {seriesName: 'Starts', title: {text: 'Starts'}, decimalsInFloat: 0},
            {seriesName: 'Starts', show: false},
            {seriesName: 'Energie (kWh)', opposite: true, title: {text: 'kWh'}, decimalsInFloat: 1},
        ],
        tooltip: {shared: true},
    });
    renderHdd(h);
    renderTrend(h);
    renderSolar(h);
    renderTotals(h);
    renderPhases(h);
    renderStates(h);
    document.getElementById('state-legend').innerHTML = Object.entries(STATE_COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('');
}

let range = '24h';
try {
    const r = localStorage.getItem('nano-range');
    if (['24h', '7d', '30d'].includes(r)) range = r;
} catch {}
const nav = document.getElementById('ranges');
nav.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.range === range));
nav.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    nav.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    range = b.dataset.range;
    try {
        localStorage.setItem('nano-range', range);
    } catch {}
    load(range);
});

// switch between the heat pump and the solar view; charts are drawn while visible, so reload after switching
const views = document.getElementById('views');
function showView(v) {
    views.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
    document.getElementById('view-heat').hidden = v !== 'heat';
    document.getElementById('view-solar').hidden = v !== 'solar';
    try {
        localStorage.setItem('nano-view', v);
    } catch {}
}
views.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    showView(b.dataset.view);
    load(range);
});
let saved = 'heat';
try {
    saved = localStorage.getItem('nano-view') === 'solar' ? 'solar' : 'heat';
} catch {}
showView(saved);
load(range);
