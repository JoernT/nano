// Phantom power of the electric booster heater: with its fuses off, the heat pump still reports 6 kW while it
// commands the heater on (house load measured by the Growatt stays at the compressor's 1-2 kW).
// src/corrections.json: [{"from": ISO, "to": ISO (optional: still running), "kw": 6, "note": "..."}]
import {readFileSync} from 'node:fs';
import {dayStartMs, TZ} from './cycles.js';

export function loadCorrections() {
    try {
        return JSON.parse(readFileSync(new URL('./corrections.json', import.meta.url), 'utf8'))
            .map((c) => ({from: Date.parse(c.from), to: c.to ? Date.parse(c.to) : undefined, kw: c.kw, note: c.note}))
            .filter((c) => Number.isFinite(c.from) && c.kw > 0);
    } catch { return []; }
}

const nextDay = (day, tz) => new Date(dayStartMs(day, tz) + 36 * 3600_000).toLocaleDateString('sv-SE', {timeZone: tz});

/** kWh to subtract per local day ("YYYY-MM-DD" -> kWh): kw x hours of the window that fall on that day */
export function kwhByDay(corrections, now = Date.now(), tz = TZ) {
    const out = new Map();
    for (const c of corrections) {
        const to = Math.min(c.to ?? now, now);
        for (let day = new Date(c.from).toLocaleDateString('sv-SE', {timeZone: tz}); dayStartMs(day, tz) < to; day = nextDay(day, tz)) {
            const s = Math.max(c.from, dayStartMs(day, tz));
            const e = Math.min(to, dayStartMs(nextDay(day, tz), tz));
            if (e > s) out.set(day, (out.get(day) || 0) + (c.kw * (e - s)) / 3600_000);
        }
    }
    return out;
}

/** watts to subtract at time t (ms) */
export function wattsAt(corrections, t, now = Date.now()) {
    return corrections.reduce((w, c) => (t >= c.from && t <= (c.to ?? now) ? w + c.kw * 1000 : w), 0);
}

/**
 * phantom kWh inside a month of the heat pump's own display value: all of it once the month is over, or the part before the
 * reading when the entry has an "asOf" time; an entry of the running month without "asOf" is taken as read before the boost
 */
export function phantomInDisplayMonth(corrections, month, asOf, now = Date.now(), tz = TZ) {
    const current = new Date(now).toLocaleDateString('sv-SE', {timeZone: tz}).slice(0, 7);
    const cap = asOf ? Date.parse(asOf) : month < current ? now : undefined;
    if (!Number.isFinite(cap)) return 0;
    let kwh = 0;
    for (const [day, k] of kwhByDay(corrections, cap, tz)) if (day.startsWith(month)) kwh += k;
    return kwh;
}
