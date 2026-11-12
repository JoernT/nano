// Warm water stall watch: the heat pump sometimes does not reheat the tank after a large draw (about 1-2 times a year).
// Warns when the tank is below LOW °C and the diverter valve has not been in "tank" position for STALL_MS; clears at OK °C
// or when the valve goes to "tank" again. Push via ntfy (NTFY_URL, e.g. https://ntfy.sh/<secret-topic>); without it only the page warns.
export const LOW = 35;
export const OK = 40;
export const STALL_MS = 2 * 3600_000;

/** state: {lastTank, warning}; returns the new state plus `event` ('start' | 'end') when the warning changes */
export function evaluate(state, {temp, valve, now = Date.now()}) {
    const s = {...state};
    if (valve === 'tank') s.lastTank = now;
    s.lastTank ??= now; // nothing known yet: count from now
    let event;
    if (!s.warning && temp < LOW && now - s.lastTank >= STALL_MS) { s.warning = {since: now}; event = 'start'; }
    else if (s.warning && (temp >= OK || valve === 'tank')) { s.warning = undefined; event = 'end'; }
    return {...s, event};
}

export async function notify(title, message, {url = process.env.NTFY_URL, fetchImpl = fetch} = {}) {
    if (!url) return false;
    const r = await fetchImpl(url, {method: 'POST', headers: {Title: title, Priority: 'high', Tags: 'droplet'}, body: message, signal: AbortSignal.timeout(10_000)});
    if (!r.ok) throw new Error(`ntfy HTTP ${r.status}`);
    return true;
}
