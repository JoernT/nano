// poller status for the <details id="status"> block in index.html: badge always visible, details on demand
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const ago = (d) => (d ? `${Math.round((Date.now() - new Date(d)) / 1000)} s her` : 'nie');
const row = (label, x, unit = '') => `<tr><td>${label}</td><td>${x ? esc(x.value) + unit : '–'}</td><td>${x?.at ? ago(x.at) : ''}</td></tr>`;

async function refresh() {
    const badge = document.getElementById('st-badge');
    try {
        const s = await (await fetch('/status.json')).json();
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
