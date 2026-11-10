import ApexCharts from 'apexcharts';

// the poller (src/nano.js) serves the history from InfluxDB
const API = `${location.protocol}//${location.hostname}:8787/api/history`;
const GROUP = 'nano'; // same group = synchronised zoom and tooltip
const charts = {};
let view = {}; // selected time window, so every time chart spans it even where there is no data
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
    view = {min: h.from, max: h.to};
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
        annotations: {yaxis: [{y: 22.5, borderColor: '#e4572e', strokeDashArray: 4, label: {text: '22,5 °C', style: {color: '#fff', background: '#e4572e'}}}]},
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
        stroke: {width: [0, 0, 3]},
        yaxis: [
            {seriesName: 'Starts', title: {text: 'Starts'}, decimalsInFloat: 0},
            {seriesName: 'Starts', show: false},
            {seriesName: 'Energie (kWh)', opposite: true, title: {text: 'kWh'}, decimalsInFloat: 1},
        ],
        tooltip: {shared: true},
    });
    renderStates(h);
    document.getElementById('state-legend').innerHTML = Object.entries(STATE_COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('');
}

const nav = document.getElementById('ranges');
nav.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    nav.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    load(b.dataset.range);
});
load('24h');
