// Compressor cycle detection from the decoded ehsCycleData samples (5 minute resolution).
// Outdoor blob byte 3 is the compressor frequency in Hz (0 = stopped); see docs/ehsCycleData.md.

export const SAMPLE_MS = 5 * 60_000;
export const TZ = 'Europe/Berlin';

/** compressor frequency (Hz) from an outdoor blob given as hex, undefined if the blob is too short */
export function compressorHz(hex) {
    if (typeof hex !== 'string' || hex.length < 8) return undefined;
    return parseInt(hex.slice(6, 8), 16);
}

/**
 * samples: [{t: ms, hz}] sorted by time. A run is a series of samples with hz > 0 without gaps
 * longer than gapMs (a gap means "no data", so the run is closed at the last known sample).
 * A run ends one sample interval after its last running sample.
 */
export function detectCycles(samples, {gapMs = 20 * 60_000, shortMs = 10 * 60_000, sampleMs = SAMPLE_MS} = {}) {
    const runs = [];
    let cur = null;
    let prev = null;
    const close = () => {
        if (!cur) return;
        const end = cur.lastT + sampleMs;
        runs.push({
            start: cur.start,
            end,
            durationMs: end - cur.start,
            avgHz: Math.round((cur.hzSum / cur.n) * 10) / 10,
            short: end - cur.start < shortMs,
        });
        cur = null;
    };
    for (const s of samples) {
        if (prev && s.t - prev.t > gapMs) close();
        if (s.hz > 0) {
            if (!cur) cur = {start: s.t, lastT: s.t, hzSum: 0, n: 0};
            cur.lastT = s.t;
            cur.hzSum += s.hz;
            cur.n += 1;
        } else {
            close();
        }
        prev = s;
    }
    close();
    return runs;
}

export const localDay = (ms, tz = TZ) => new Date(ms).toLocaleDateString('sv-SE', {timeZone: tz});

/** per local day: number of starts, total run minutes, short cycles */
export function dailyStats(runs, tz = TZ) {
    const days = new Map();
    for (const r of runs) {
        const key = localDay(r.start, tz);
        const d = days.get(key) || {day: key, starts: 0, runMinutes: 0, shortCycles: 0};
        d.starts += 1;
        d.runMinutes += Math.round(r.durationMs / 60_000);
        if (r.short) d.shortCycles += 1;
        days.set(key, d);
    }
    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function summary(runs) {
    if (!runs.length) return {starts: 0, shortCycles: 0, avgRunMinutes: 0, medianRunMinutes: 0};
    const mins = runs.map((r) => r.durationMs / 60_000).sort((a, b) => a - b);
    const mid = Math.floor(mins.length / 2);
    return {
        starts: runs.length,
        shortCycles: runs.filter((r) => r.short).length,
        avgRunMinutes: Math.round((mins.reduce((a, b) => a + b, 0) / mins.length) * 10) / 10,
        medianRunMinutes: Math.round((mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2) * 10) / 10,
    };
}

/** Pearson correlation of [x, y] pairs, undefined when fewer than 3 pairs or no variance */
export function pearson(pairs) {
    const n = pairs.length;
    if (n < 3) return undefined;
    const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
    const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    if (!sxx || !syy) return undefined;
    return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}
