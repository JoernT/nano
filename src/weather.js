// Outdoor temperature from Open-Meteo (DWD ICON model, free, no API key) for the heat pump's location.
// wetter.com offers no free API, so this is the same source the Telegraf configs in src/services use.
export const LOCATION = {lat: 52.44, lon: 13.30}; // Berlin, see src/services/open-meteo-52.44N13.30E50m.csv

export function weatherUrl({lat, lon}, pastDays) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m&past_days=${pastDays}&forecast_days=1&timeformat=unixtime&timezone=UTC&models=icon_seamless`;
}

/** hourly points up to `now` as {time (ms), temp, humidity}; null values (no data yet) are dropped */
export function parseHourly(json, now = Date.now()) {
    const h = json?.hourly;
    if (!h?.time) return [];
    const out = [];
    h.time.forEach((t, i) => {
        const temp = h.temperature_2m?.[i];
        if (t * 1000 > now || temp === null || temp === undefined) return;
        out.push({time: t * 1000, temp, humidity: h.relative_humidity_2m?.[i] ?? undefined});
    });
    return out;
}

export async function fetchOutdoor(location = LOCATION, pastDays = 2, fetchImpl = fetch) {
    const r = await fetchImpl(weatherUrl(location, pastDays), {signal: AbortSignal.timeout(15_000)});
    if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
    return parseHourly(await r.json());
}
