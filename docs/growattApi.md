# Growatt OpenAPI v1: what it offers (checked 2026-11-12 against our SPH hybrid)

Base `https://openapi.growatt.com/v1/`, header `token`. Plant `2350889` (6.75 kWp, Berlin), one device: SPH hybrid inverter + battery, type 5, "mix" endpoints.
Reference used: the `growattServer` Python library (`growattServer/open_api_v1`, v2.2.0), which links the vendor docs on showdoc.com.cn. All times come back as Europe/Berlin local time.

**Rate limit:** error `10012 error_frequently_access`, roughly one call per minute (per device, not per endpoint). The poller uses 5 min.
Other codes: 10002 object not found, 10003 wrong serial / id, 10004 wrong date format (for `plant/energy` in `day` mode, see below).

## Read endpoints (all tried)

| Endpoint | Method, params | What it gives |
|---|---|---|
| `plant/list` | GET | plants (id, name, peak power, `current_power`, location, create date 2023-11-22) |
| `plant/details` | GET `plant_id` | mostly empty master data (address, timezone, peak power); nothing useful beyond `plant/list` |
| `plant/data` | GET `plant_id` | totals: `today_energy`, `monthly_energy`, `yearly_energy`, `total_energy` (kWh), `current_power` |
| `plant/power` | GET `plant_id`, `date` | one day in 5 min steps (288 points `{time, power W}`); the unordered array has `null` for the future. **PV power history without our own polling** |
| `plant/energy` | GET `plant_id`, `start_date`, `end_date`, `time_unit=month` | PV yield per month (works for the current year, 2026: 45.5 kWh in Jan ... 43.4 in Nov). `time_unit=day` answered `10004 time format is incorrect` with my dates; the library limits `day` to 7 days and `year` to 20 years, so retry with a shorter window |
| `device/list` | GET `plant_id` | devices: serial `NPCUCJ405A`, datalogger `JPC8CLC1PZ`, type 5 |
| `device/mix/mix_last_data` | POST `mix_sn` | **live values**, ~200 fields (what the poller reads, see below) |
| `device/mix/mix_data` | POST `mix_sn`, `start_date`, `end_date` (max 7 days apart), `page`, `perpage` (100), `timezone_id` | **history of the same ~218 fields, one row per ~5 min, newest first**; `count` 163 for today until 13:29; paging via `next_page_start_id`. Could backfill the `solar` series for the last days (the poller only has data since 12 Nov 13:17) |
| `device/mix/mix_data_info` | GET `device_sn` | inverter settings and master data, see below |
| sph read parameter (library: `sph_read_parameter`) | by register / parameter id | raw holding registers (not tried) |

## Live / history fields worth having (names as returned)

Already stored in `solar`: `ppv` PV W, `pcharge1` / `pdischarge1` battery W, `soc` %, `pacToUserR` grid import W, `pacToGridR` export W, `plocalLoadR` house load W, and the day counters `epvtoday`, `elocalLoadToday`, `etoUserToday`, `etoGridToday` (kWh).

Available but not stored yet:
- per string: `ppv1`, `ppv2`, `vpv1`, `vpv2`, `epv1Today`, `epv2Today` (two roof strings, totals `epv1Total` 8692 kWh, `epv2Total` 6282 kWh)
- battery: `bmsBatteryVolt`, `bmsBatteryCurr`, `bmsBatteryTemp`, `echarge1Today/Total`, `edischarge1Today/Total`, `acChargeEnergyToday/Total` (charging from the grid), cell data (zero for our battery)
- energy totals: `epvTotal` (14975 kWh), `etoUserTotal`, `etogridTotal`, `elocalLoadTotal`, `esystemtoday/total`
- inverter: `pac`, `vac1` (grid voltage), `temp1..3`, `uwSysWorkMode`, `statusText`, fault words (`faultCode`, `sysFaultWord1..7`, `warnCode`)

## Settings visible in `mix_data_info` (read only; the API can also write them, we do not)

`priorityChoose` (0 = load first), `loadFirstStopSocSet` 20, `vbatStartForDischarge` 48, `vbatStopForCharge` 5.75, `acChargeEnable` 0 (no grid charging), `chargePowerCommand` 100, `exportLimit` 0, `batFirstSwitch1..3` / `forcedChargeTimeStart/Stop1..6` / `forcedDischargeTime*` (time windows, all empty), `backUpEn` 0, `epsFunEn` 0, plus firmware (`communicationVersion` ZCBA-0006, `innerVersion` RAAA212006).
The library has write calls for AC charge/discharge time windows and parameters; for a heat pump this could one day let the battery or grid charging follow the heat demand, but writing settings is out of scope here.

## Ideas (none done)
1. Backfill `solar` from `mix_data` for the days before 12 Nov (7 days per call, 100 rows per page), and `plant/power` for older days.
2. Store the per-string power and grid-charge counters; useful for shading and "how much was bought for the battery".
3. Daily balance: PV, house load, import, export, battery in/out, with the heat pump's share (we know its kWh).
4. Battery-aware heat pump run times: does the heat pump run on PV or battery (`pcharge1` / `pdischarge1` against our compressor Hz).
