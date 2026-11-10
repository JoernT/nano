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

/** Gradtag 20/15 (German convention): 20 °C minus the daily mean outdoor temperature on heating days (mean < 15 °C), else 0 */
export function heatingDegreeDays(meanOutdoor) {
    if (meanOutdoor === undefined || meanOutdoor === null || meanOutdoor >= 15) return 0;
    return Math.round((20 - meanOutdoor) * 10) / 10;
}

/** start of a local calendar day ('YYYY-MM-DD' in tz) as epoch ms */
export function dayStartMs(day, tz = TZ) {
    const utcMidnight = Date.parse(`${day}T00:00:00Z`);
    const local = (ms) => Date.parse(new Date(ms).toLocaleString('sv-SE', {timeZone: tz}).replace(' ', 'T') + 'Z');
    // offset of tz at that moment; one correction step handles the DST day itself
    let start = utcMidnight - (local(utcMidnight) - utcMidnight);
    start = utcMidnight - (local(start) - start);
    return start;
}

/**
 * Compare operating phases separated by experiments (changes made on the unit, see src/experiments.json).
 * Only complete days inside one phase count: days containing a change and the running day are left out.
 * since: first moment with data; days starting earlier are incomplete.
 * daily: rows from dailyStats with optional kwh, hdd, roomMean. experiments: [{at: ms, label}] sorted.
 */
export function phaseStats(daily, experiments, now = Date.now(), tz = TZ, since = -Infinity) {
    const bounds = experiments.map((e) => e.at);
    const phases = [{label: 'vor der ersten Änderung', from: -Infinity, days: []}, ...experiments.map((e) => ({label: e.label, from: e.at, days: []}))];
    for (const d of daily) {
        const start = dayStartMs(d.day, tz);
        const end = dayStartMs(new Date(start + 36 * 3600_000).toLocaleDateString('sv-SE', {timeZone: tz}), tz);
        if (end > now) continue; // running day
        if (start < since) continue; // data starts during this day
        const p = bounds.filter((b) => b <= start).length;
        if (bounds.some((b) => b > start && b < end)) continue; // change happened during this day
        phases[p].days.push(d);
    }
    const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : undefined);
    return phases.map((ph) => {
        const withHdd = ph.days.filter((d) => d.kwh !== undefined && d.hdd >= 1);
        return {
            label: ph.label,
            from: Number.isFinite(ph.from) ? ph.from : null,
            days: ph.days.length,
            starts: avg(ph.days.map((d) => d.starts)),
            shortCycles: avg(ph.days.map((d) => d.shortCycles)),
            kwh: avg(ph.days.filter((d) => d.kwh !== undefined).map((d) => d.kwh)),
            kwhPerHdd: avg(withHdd.map((d) => d.kwh / d.hdd)),
            roomMean: avg(ph.days.filter((d) => d.roomMean !== undefined).map((d) => d.roomMean)),
        };
    });
}
