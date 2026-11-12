// poller status for the <details id="status"> block in index.html: badge always visible, details on demand
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const ago = (d) => {
    if (!d) return 'nie';
    const s = Math.round((Date.now() - new Date(d)) / 1000);
    return s < 120 ? `vor ${s} s` : s < 7200 ? `vor ${Math.round(s / 60)} min` : s < 172800 ? `vor ${Math.round(s / 3600)} h` : `vor ${Math.round(s / 86400)} d`;
};
const row = (label, x, unit = '') => `<tr><td>${label}</td><td>${x ? esc(typeof x.value === 'number' ? Math.round(x.value * 10) / 10 : x.value) + unit : '–'}</td><td>${x?.at ? ago(x.at) : ''}</td></tr>`;

let lastPoll;
async function refresh() {
    const badge = document.getElementById('st-badge');
    try {
        const s = await (await fetch('/status.json')).json();
        if (lastPoll && s.lastPollAt !== lastPoll) window.dispatchEvent(new Event('nano-polled')); // new values: the page reloads its charts and live values
        lastPoll = s.lastPollAt;
        const w = document.getElementById('tank-warn');
        if (w) {
            w.hidden = !s.tankWarning;
            if (s.tankWarning) w.textContent = `Warmwasser nur ${Math.round(s.tankWarning.temp * 10) / 10} °C: seit ${new Date(s.tankWarning.lastTank).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} kein Aufheizen. Modus wechseln oder Boost starten.`;
        }
        const v = s.values || {};
        badge.textContent = `nano ${s.state}`;
        badge.className = `badge ${s.state === 'running' ? 'ok' : 'bad'}`;
        document.getElementById('st-body').innerHTML = `
<p>letzte Abfrage: ${ago(s.lastPollAt)} · Abfragen ${s.polls} · Fehler ${s.failures} · alle ${s.intervalMs / 1000} s<br>
${s.lastError ? `<span class="bad">${esc(s.lastError)}</span><br>` : ''}${s.auth}<br>läuft seit ${new Date(s.startedAt).toLocaleString('de-DE')}</p>
<table class="kv">${row('Heizung', v.heating, ' °C')}${row('Warmwasser', v.warmwater, ' °C')}${row('Leistung', v.power, ' W')}${row('Energie', v.energy, ' kWh')}${row('Heizung Modus', v.heatingMode)}${row('Heizung Soll (heat)', v.heatingSetHeat, ' °C')}${row('Heizung Soll (cool)', v.heatingSetCool, ' °C')}${row('Warmwasser Modus', v.warmwaterMode)}${row('Warmwasser Soll', v.warmwaterSet, ' °C')}</table>
<pre>${esc((s.events || []).join('\n'))}</pre>`;
    } catch (e) {
        badge.textContent = 'nano offline';
        badge.className = 'badge bad';
    }
}
refresh();
setInterval(refresh, 20000);
