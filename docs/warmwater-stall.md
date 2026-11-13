# Warm water stall (12 Nov 2026)

## What happened
- The tank fell from 46.5 to 25 °C between 17:45 and 19:15 (large draw). The last tank cycle had ended at 07:01 and no new one started.
- Boost with "erzwingen" at 21:56 worked (24 → 45.6 °C). "Strom" mode does nothing: the electric heater's fuses are off on purpose (backup for extreme cold, 6 kW).
- The user switched back to eco at about 23:06. The unit finished the charge by itself and the valve returned to "room" at 23:22.
- Heating flow fell from about 33 to 26.8 °C during forced mode and recovered afterwards.
- The user has seen this stall about 1-2 times a year; each time they switch mode, wait and switch back to eco. Earlier stalls were noticed by chance: the SmartThings app does not alert reliably.

## Tank cycles (valve = tank, from InfluxDB, since 9 Nov, the start of valve recording)

| Start | Length | Tank | Gap since last |
|---|---|---|---|
| 09.11. 19:51 | 35 min | 45.5 → 49.3 | – |
| 10.11. 14:18 | 34 min | 45.3 → 50 | 17.9 h |
| 11.11. 10:39 | 39 min | 46 → 43.3 | 19.8 h |
| 11.11. 21:41 | 45 min | 45.5 → 46.6 | 10.4 h |
| 12.11. 06:16 | 45 min | 45.5 → 48.8 | 7.8 h |
| 12.11. 21:56 | boost | 24 → 45.6 | 14.9 h |
| 13.11. 08:44 | 27 min | 45.1 → 49.1 | 9.4 h |
| 13.11. 15:43 | 45 min | 46.6 → 48.1 | 6.5 h |

## Reading
- Normal operation: reheating starts when the tank is at about 45-46 °C, heats to 48-50 °C in 30-45 min. Gaps are 6.5-20 h depending on the draw.
- The stall is a missed trigger: the tank was far below the usual start point and the unit did not react. It is not a general settings problem.
- Cause unknown. Guesses: a fast large draw confuses the trigger logic, or a blocked state (defrost, heating phase, lockout timer). Sensor fault considered and unlikely (it responded 24 → 45.6 °C).
- Normal gaps of 15+ h occur, so a long gap alone is not a stall; temperature below about 35 °C is.

## Phantom booster power
With the heater fuses off the unit still reports about 6 kW while forced mode runs (heater commanded on, booster flag "on"), while the Growatt house load stays at the compressor's 1-3 kW. This is corrected in `src/corrections.json` (21:56-23:06) for the charts, daily kWh and months. See `src/corrections.js`.

## Monitoring
- Page banner and optional ntfy push (`NTFY_URL` in `~/nano/.env`) when the tank is below 35 °C and the valve has not been in "tank" for 2 h; clears at 40 °C or when the valve goes to "tank" (`src/tankwatch.js`).
- The background watch for "drop below 43 °C" ended without a result: the tank never fell below 43 °C again.

## Questions for the installer
- DHW start threshold, hysteresis and minimum wait between heating phases (field setting #3011 and the DHW settings).
- Is there a known issue with missed DHW reheating after a large draw on this model/firmware?
