#!/usr/bin/env node
// Estimate heat pump compressor starts/stops from polled power data.
// Usage: node analysis/cycles.mjs [data/nano-export.csv] [--on 500] [--off 300] [--gap 20] [--short 10]
//   --on    W above which the compressor counts as running (hysteresis upper)
//   --off   W below which it counts as stopped (hysteresis lower)
//   --gap   minutes; a gap between samples longer than this ends/ignores the session (no data)
//   --short minutes; runs shorter than this count as "short cycles"
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : def;
};
const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || 'data/nano-export.csv';
const ON = opt('on', 500);
const OFF = opt('off', 300);
const GAP_MIN = opt('gap', 20);
const SHORT_MIN = opt('short', 10);

// --- load power samples (W) -------------------------------------------------
const samples = [];
for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    const c = line.split(',');
    const [time, series, value] = [c[3], c[4], Number(c[5])];
    if (!series || !/^(energy|powerconsumption)\.power\.heatpump$/.test(series)) continue;
    // 7-9 Feb 2024 poller wrote kW (series "energy.power"), later versions write W.
    const watts = series.startsWith('energy.') ? value * 1000 : value;
    samples.push({ t: new Date(time).getTime(), w: watts });
}
samples.sort((a, b) => a.t - b.t);

// thin out duplicates written seconds apart during poller testing
const pts = [];
for (const s of samples) {
    if (!pts.length || s.t - pts[pts.length - 1].t >= 60_000) pts.push(s);
}

// --- split into contiguous sessions (no gap > GAP_MIN) ---------------------
const sessions = [];
let cur = [];
for (const p of pts) {
    if (cur.length && p.t - cur[cur.length - 1].t > GAP_MIN * 60_000) {
        sessions.push(cur);
        cur = [];
    }
    cur.push(p);
}
if (cur.length) sessions.push(cur);

// --- detect runs with hysteresis -------------------------------------------
const runs = []; // {start, end, minutes, peak, kwh, startedInSession, endedInSession}
for (const s of sessions) {
    let run = null;
    for (let i = 0; i < s.length; i++) {
        const p = s[i];
        if (!run && p.w >= ON) {
            run = { start: p.t, last: p.t, peak: p.w, wh: 0, leftCensored: i === 0 };
        } else if (run) {
            const dt = (p.t - run.last) / 3.6e6;
            run.wh += p.w * dt;
            run.last = p.t;
            run.peak = Math.max(run.peak, p.w);
            if (p.w < OFF) {
                runs.push({ ...run, end: p.t, rightCensored: false });
                run = null;
            }
        }
    }
    if (run) runs.push({ ...run, end: run.last, rightCensored: true });
}

// --- report -----------------------------------------------------------------
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const mins = (r) => (r.end - r.start) / 60_000;
const complete = runs.filter((r) => !r.leftCensored && !r.rightCensored);
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

const covered = sessions.reduce((a, s) => a + (s[s.length - 1].t - s[0].t), 0) / 3.6e6;
console.log(`file: ${file}  thresholds: on>=${ON}W off<${OFF}W  gap>${GAP_MIN}min  short<${SHORT_MIN}min`);
console.log(`samples: ${samples.length} raw, ${pts.length} after thinning; sessions: ${sessions.length}; covered: ${covered.toFixed(1)} h`);
console.log(`runs detected: ${runs.length} (complete: ${complete.length}, censored by data gaps: ${runs.length - complete.length})`);
if (complete.length) {
    const len = complete.map(mins);
    console.log(`run length min: median ${med(len).toFixed(0)}  min ${Math.min(...len).toFixed(0)}  max ${Math.max(...len).toFixed(0)}`);
    console.log(`short cycles (<${SHORT_MIN} min): ${len.filter((l) => l < SHORT_MIN).length} of ${complete.length}`);
}
console.log(`starts per 24h of covered data: ${(runs.length / (covered / 24)).toFixed(1)}`);
const coarse = SHORT_MIN;
console.log(`note: poll step median ${(med(pts.slice(1).map((p, i) => (p.t - pts[i].t) / 60_000))).toFixed(1)} min; cycles < ${coarse} min may be invisible at this resolution`);

console.log('\nsession  start             end               hours  runs');
sessions.forEach((s, i) => {
    const n = runs.filter((r) => r.start >= s[0].t && r.start <= s[s.length - 1].t).length;
    console.log(`${String(i).padStart(7)}  ${iso(s[0].t)}  ${iso(s[s.length - 1].t)}  ${((s[s.length - 1].t - s[0].t) / 3.6e6).toFixed(1).padStart(5)}  ${n}`);
});
console.log('\nstart             end               min  peakW   Wh  flags');
for (const r of runs) {
    console.log(`${iso(r.start)}  ${iso(r.end)}  ${mins(r).toFixed(0).padStart(3)}  ${r.peak.toFixed(0).padStart(5)}  ${r.wh.toFixed(0).padStart(4)}  ${r.leftCensored ? 'L' : ''}${r.rightCensored ? 'R' : ''}`);
}
