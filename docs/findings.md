# Findings and open questions (2026-11-09)

## What the API delivers
- The poller (`src/nano.js`, `extractPoints()`) reads SmartThings `/status` every 240 s and writes to InfluxDB with the device timestamps.
- `dump.json` is from 2024 (firmware `20230914.1`) and is stale. Current firmware is `20260320.1` and exposes three capabilities the old dump lacked: booster heater (`samsungce.ehsBoosterHeater`), diverter valve (`samsungce.ehsDiverterValve`) and defrost flag (`samsungce.ehsDefrostMode`).
- **Not delivered at all:** flow, return and outdoor temperature, pump and fan state, a DHW-charging flag and COP. Outdoor temperature comes from DWD (`src/dwd-sunshine.js` and the Telegraf configs).
- **Layout:** `INDOOR2` is the active heating circuit, `INDOOR1` is the switched-off second zone, `main` is the warm-water tank plus the whole unit.
- State-type points keep the device's own timestamp, which can be days old, so Influx queries need a wide time range (for example `-90d`).

## Live values on 2026-11-09

| Item | Value |
|---|---|
| Heating circuit mode | `heat` |
| Diverter valve | `room` |
| Booster heater | `off` |
| Defrost | `off` |
| Thermostat connection | `disconnected` (all three components) |
| Temperature reference | `water` (all three) |
| Setpoint limits | warm water 40–60 °C, heating 28–50 °C (the 2024 dump said 40–70) |
| Report window | not fixed at 1200 s: 1259 s in the last Influx sample |
| Board modules | four `DB91-…` versions (the outdoor one is labelled "EHS MONO LOWTEMP") |

## ehsCycleData
- The only place where compressor and refrigerant data could be hiding. The 5-minute hex blobs are stored raw.
- Blob layout changed with firmware: 18 and 24 bytes in 2024, 28 and 31 bytes in 2026.
- Interpreted bytes: outdoor byte 3 = compressor Hz (confirmed), outdoor byte 1 = target Hz (likely), indoor bytes 13 and 17 = compressor stop flags (confirmed), indoor byte 9 = hot-water charging (likely).
- Details: `docs/ehsCycleData.md`, `analysis/decode-cycle.mjs`.

## Changes made
- Poller stores operating states, setpoint limits, `persistedEnergy`, `windowSeconds`, module versions and FSV min/max (`7d07070`). Verified in Influx after a restart.
- Dashboard: Modus, Ventil, Heizstab and Abtauen chips (`f7bf717`), a collapsible Info panel and the Modus chip (`e4b3b4f`). All pushed.
- The poller now runs in the background from the Claude Code session, not in a terminal.

## Open questions
1. **Which blob bytes are temperatures, and what are they?** Outdoor bytes 6–8 and indoor bytes 0, 2, 3 look like temperatures (flow, return, discharge or defrost sensors). Outdoor bytes 10–11 (about 0–2000, falling while running) could be a defrost or anti-short-cycle timer. Indoor byte 8 (0–100) could be a pump or valve percentage. The rest are not understood. Needs experiments on the real unit: change a setpoint or mode and see which bytes move.
2. **Do defrost, booster heater and diverter valve ever change?** Everything has been idle so far, so the series have no `on` or `tank` values yet.
3. **How do the 2026 blob layouts map against the 2024 ones?** Decoding was built on the older layouts, so the byte mapping may have shifted.
4. **How do we get COP?** The power report gives exact kWh per window, but there is no heat meter, so no heat output. Is an external meter or a flow/return estimate from the blobs an option?
5. **Why is `thermostatConnection` `disconnected`?** Assumed to be the room-thermostat link, not confirmed. Does it matter, given control runs on water temperature?
6. **Which heating setpoint does the circuit actually use?** SmartThings only models cooling and heating setpoints, and `heatingSetpoint` is null on `main`. The poller keeps both. The FSV water-law entries (2011, 2012, 2021, 2022, 2031, 2032) look relevant but are not interpreted yet.
7. **Dashboard layout is unchecked.** The chips, Info panel and Modus chip have not been viewed in a browser.
8. **35 Dependabot alerts** on the repo (1 critical, 14 high, 19 moderate, 1 low), predating these changes.
