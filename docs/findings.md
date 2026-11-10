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

## Auto mode overheating (2026-11-09)
- The user switched the heating circuit (`INDOOR2`) to `auto` (water-law / weather-compensated). Rooms now exceed 22.5 °C.
- Live state in auto mode: `INDOOR2` water temperature 33.6 °C, `coolingSetpoint` 24, no `heatingSetpoint`, limits 28–50. `thermostatConnection` is `disconnected` and `temperatureReference` is `water`, so there is **no room-temperature feedback**: the flow temperature follows the curve only.
- Water-law FSV values read from the API: 2011 = -12, 2012 = 20 (outdoor temperatures at the curve ends); 2021 = 50, 2022 = 40 (flow temperatures of one curve); 2031 = 47, 2032 = 28 (flow temperatures of the other curve); 2091 = 0, 2092 = 0, 2093 = 1.
- **Unverified:** the mapping of these ids to "floor heating" vs "radiator/fan coil" and the meaning of 2091–2093 comes from memory of Samsung EHS documentation. FSV 2041 (emitter type, decides which curve applies) is not delivered by the API.
- Proposed approach: lower the flow temperature at the mild end of the curve (2022 or 2032, whichever is active) in small steps of 2 K, wait a few days per step, and watch room temperature. Keep the `auto` setpoint offset in mind (unknown whether `coolingSetpoint` 24 is an offset or a target).

## Room temperature sensors (2026-11-09)
- The user owns 4 SwitchBot thermometers (type `i`, no hub), so the cloud API is not available. They are read locally from their Bluetooth advertisements with `src/room-sensors.py` (bleak), which writes `room_climate` points (tag `room`; fields `temp`, `humidity`, `battery`) every 240 s. Setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements-ble.txt`.
- Advertisements arrive only every few seconds, so one scan has to listen about 60 s; a 15 s scan missed a device.
- Device id = first 6 bytes of the manufacturer data (macOS hides MAC addresses). Room names are in `src/rooms.json`: `dad05fa0b998` = bedroom1, `d22e81467466` = livingroom. `e55c0c0ec454` = bedroom2 (upstairs). Still unnamed: `de6910125107` (17.5 °C / 41 %).
- Runs on the Mac, so data has gaps while it sleeps.

## Open questions
1. **Which blob bytes are temperatures, and what are they?** Outdoor bytes 6–8 and indoor bytes 0, 2, 3 look like temperatures (flow, return, discharge or defrost sensors). Outdoor bytes 10–11 (about 0–2000, falling while running) could be a defrost or anti-short-cycle timer. Indoor byte 8 (0–100) could be a pump or valve percentage. The rest are not understood. Needs experiments on the real unit: change a setpoint or mode and see which bytes move.
2. **Do defrost, booster heater and diverter valve ever change?** Everything has been idle so far, so the series have no `on` or `tank` values yet.
3. **How do the 2026 blob layouts map against the 2024 ones?** Decoding was built on the older layouts, so the byte mapping may have shifted.
4. **How do we get COP?** The power report gives exact kWh per window, but there is no heat meter, so no heat output. Is an external meter or a flow/return estimate from the blobs an option?
5. **Why is `thermostatConnection` `disconnected`?** Assumed to be the room-thermostat link, not confirmed. Does it matter, given control runs on water temperature?
6. **Which heating setpoint does the circuit actually use?** SmartThings only models cooling and heating setpoints, and `heatingSetpoint` is null on `main`. The poller keeps both. The FSV water-law entries (2011, 2012, 2021, 2022, 2031, 2032) look relevant but are not interpreted yet.
7. **Dashboard layout at narrow widths is unchecked.** Chips and Info panel were viewed in a browser at about 1400 px and look fine; the open Info panel (about 340 px wide, fixed left) would overlap the centre block on a phone.
8. **Which water-law curve is active, and what does the `auto` setpoint (24) do?** Needs FSV 2041 and the Samsung service manual, or an experiment changing the setpoint and watching the flow temperature in Influx.
9. **Room temperature is recorded since 2026-11-09 (see above).** One of the four sensors is still unnamed, and the Mac must stay awake for continuous data.
10. **35 Dependabot alerts** on the repo (1 critical, 14 high, 19 moderate, 1 low), predating these changes.
