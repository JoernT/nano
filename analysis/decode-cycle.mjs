#!/usr/bin/env node
// Decode the Samsung EHS "ehsCycleData" blobs exported from InfluxDB and report compressor
// starts/stops at 5 minute resolution. Layout and confidence levels: docs/ehsCycleData.md
//
// Usage: node analysis/decode-cycle.mjs [data/ehs-cycle.csv] [--power data/nano-export.csv] [--short 30] [--out data/ehs-decoded.csv]
// The input is the Flux export of measurement "ehs_cycle" (columns _time, kind, raw).
import {readFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || 'data/ehs-cycle.csv';
const powerFile = opt('power', 'data/nano-export.csv');
const SHORT_MIN = Number(opt('short', 30));
const outFile = opt('out', 'data/ehs-decoded.csv');
const STEP = 5 * 60_000; // device samples every 5 minutes

// --- load blobs -------------------------------------------------------------
const outdoor = new Map(), indoor = new Map();
for (const line of readFileSync(file, 'utf8').split('\n')) {
    const c = line.trim().split(',');
    const [t, kind, raw] = [c[3], c[4], c[5]];
    if (!/^\d{4}-\d\d-\d\dT/.test(t || '') || !/^[0-9A-Fa-f]+$/.test(raw || '')) continue;
    const bytes = Buffer.from(raw, 'hex');
    (kind === 'outdoor' ? outdoor : indoor).set(new Date(t).getTime(), bytes);
}

// --- decode (see docs/ehsCycleData.md; only fields marked "confirmed"/"likely" are interpreted) ----
const samples = [...outdoor.keys()].sort((a, b) => a - b).map((t) => {
    const o = outdoor.get(t), i = indoor.get(t);
    return {
        t,
        freq: o[3],                 // confirmed: compressor frequency in Hz, 0 = compressor off
        freqTarget: o[1],           // likely: target frequency
        compOn: o[3] > 0,
        stopFlag: i ? i[13] === 1 : null,   // confirmed: set while the compressor is stopped
        runFlag: i ? i[17] === 1 : null,    // confirmed: cleared while the compressor is stopped
        mode9: i ? i[9] : null,             // likely: set while hot water is being charged (2 events, both coincide with warm water temp rising)
        o, i,
    };
});
if (!samples.length) { console.error('no outdoor samples found in', file); process.exit(1); }

// --- runs: split at gaps (missing samples) so a missing hour is not counted as "on" ----------
const runs = []; // {on, start, end, censored}
for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last.on === s.compOn && s.t - last.end <= STEP * 1.4) last.end = s.t;
    else {
        const gapBefore = last && s.t - last.end > STEP * 1.4;
        runs.push({on: s.compOn, start: s.t, end: s.t, leftCensored: !last || gapBefore});
        if (last) last.rightCensored = gapBefore;
    }
}
runs[runs.length - 1].rightCensored = true;
const len = (r) => (r.end - r.start + STEP) / 60_000; // each sample stands for a 5 min slot
const fmt = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

const stops = runs.filter((r) => !r.on);
const onRuns = runs.filter((r) => r.on);
const completeOn = onRuns.filter((r) => !r.leftCensored && !r.rightCensored);
const covered = samples.length * STEP / 3.6e6;

console.log(`file: ${file}`);
console.log(`samples: ${samples.length} (${fmt(samples[0].t)} .. ${fmt(samples.at(-1).t)} UTC), covered ${covered.toFixed(1)} h`);
const gaps = samples.slice(1).map((s, k) => [samples[k].t, s.t - samples[k].t]).filter(([, d]) => d > STEP * 1.4);
console.log(`gaps in the series: ${gaps.length}, total ${(gaps.reduce((a, [, d]) => a + d - STEP, 0) / 3.6e6).toFixed(1)} h missing`);

console.log(`\ncompressor stops: ${stops.length}   (starts per 24h of covered data: ${(onRuns.filter((r) => !r.leftCensored).length / (covered / 24)).toFixed(1)})`);
console.log(`stop length min: median ${pct(stops.map(len), 0.5)}  p90 ${pct(stops.map(len), 0.9)}  max ${Math.max(...stops.map(len))}  (resolution 5 min; stops shorter than one sample can be missed)`);
console.log(`on-run length min (complete runs only, n=${completeOn.length}): median ${pct(completeOn.map(len), 0.5)}  p10 ${pct(completeOn.map(len), 0.1)}  p90 ${pct(completeOn.map(len), 0.9)}  max ${Math.max(...completeOn.map(len))}`);
const shortRuns = completeOn.filter((r) => len(r) <= SHORT_MIN);
console.log(`short runs (<= ${SHORT_MIN} min): ${shortRuns.length} of ${completeOn.length} (${(100 * shortRuns.length / Math.max(1, completeOn.length)).toFixed(0)}%)`);

// starts per hour of day (local time of this machine)
const byHour = new Array(24).fill(0);
for (const r of onRuns) if (!r.leftCensored) byHour[new Date(r.start).getHours()]++;
console.log('\nstarts by local hour of day:');
console.log(byHour.map((n, h) => `${String(h).padStart(2, '0')}:${n}`).join('  '));

// --- cross-checks ---------------------------------------------------------------------
const withIndoor = samples.filter((s) => s.stopFlag !== null);
const off = withIndoor.filter((s) => !s.compOn);
console.log(`\ncross-check 1 (indoor blob flags): ${off.filter((s) => s.stopFlag && !s.runFlag).length} of ${off.length} compressor-off samples have stopFlag set and runFlag cleared;`
    + ` ${withIndoor.filter((s) => s.compOn && s.stopFlag).length} of ${withIndoor.filter((s) => s.compOn).length} running samples have stopFlag set`);

try {
    const power = [];
    for (const line of readFileSync(powerFile, 'utf8').split('\n')) {
        const c = line.split(',');
        if (c[4] === 'powerconsumption.power.heatpump') power.push({t: new Date(c[3]).getTime(), w: Number(c[5])});
    }
    const tally = {};
    for (const p of power) {
        const win = samples.filter((s) => s.t > p.t - 15 * 60_000 && s.t <= p.t);
        if (!win.length) continue;
        const on = win.filter((s) => s.compOn).length;
        const k = `${p.w > 300 ? 'power>300W' : 'power<=300W'} / ${on === win.length ? 'compressor on throughout' : on === 0 ? 'compressor off throughout' : 'stops within window'}`;
        tally[k] = (tally[k] || 0) + 1;
    }
    console.log(`cross-check 2 (power reports vs the 15 min before each report, n=${power.length}):`);
    for (const [k, v] of Object.entries(tally).sort()) console.log(`   ${k}: ${v}`);
} catch { console.log('cross-check 2 skipped (no power export found)'); }

const m9 = withIndoor.filter((s) => s.mode9 === 1);
if (m9.length) {
    const periods = []; let cur = null;
    for (const s of m9) { if (cur && s.t - cur.end <= STEP * 1.4) cur.end = s.t; else periods.push((cur = {start: s.t, end: s.t})); }
    console.log(`\nhot water charging? (indoor byte 9 set) in ${m9.length} samples:${periods.map((p) => `${fmt(p.start)}..${new Date(p.end).toISOString().slice(11, 16)}`).join(', ')}`);
}

console.log('\nstops (UTC):');
for (const r of stops) console.log(`  ${fmt(r.start)}  ${String(len(r)).padStart(3)} min${r.leftCensored || r.rightCensored ? '  (edge of data)' : ''}`);

// --- decoded csv for plotting ---------------------------------------------------------------
const head = 'time,compressor_on,freq_hz,target_hz,stop_flag,run_flag,mode9,o4,o6,o7,o8,o11,o13,o19,o21,o23\n';
const body = samples.map((s) => [new Date(s.t).toISOString(), +s.compOn, s.freq, s.freqTarget, +!!s.stopFlag, +!!s.runFlag, s.mode9 ?? '',
    s.o[4], s.o[6], s.o[7], s.o[8], s.o[10] * 256 + s.o[11], s.o[13], s.o[19], s.o[21], s.o[23]].join(',')).join('\n');
writeFileSync(outFile, head + body + '\n');
console.log(`\ndecoded samples written to ${outFile}`);
