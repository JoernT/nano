# samsungce.ehsCycleData

The SmartThings capability `samsungce.ehsCycleData` holds two lists of 5-minute samples,
`outdoor` and `indoor`, each a hex blob. The poller stores them verbatim
(InfluxDB measurement `ehs_cycle`, tag `kind`, field `raw`); `analysis/decode-cycle.mjs` decodes them.

Samsung does not document the format. Everything below was derived from ~42 h of data
(2026-11-07 .. 11-09) by comparing fields with the power reports and the temperature readings.
The blob length changed with the firmware: in 2024 the outdoor blob had 18 and the indoor blob 24 bytes,
now 28 and 31 bytes. The offsets below are for the current layout and have not been checked against older firmware.

Confidence: **confirmed** = checked against an independent signal, **likely** = fits the data in
at least two cases, **unknown** = varies but is not understood.

Firmware seen so far (device attribute `ocf.mnfv`): `20230914.1` in the 2024 dump (blobs 18/24 bytes),
`20260320.1` since at least 2026-11-07 (blobs 28/31 bytes). The poller stores the current value as
measurement `state`, tags `component=heatpump, attribute=firmware` (also `driver`, `micom`, `updateAvailable`),
so a layout change can be matched to a firmware change in the history.

## outdoor blob (28 bytes)

| byte | meaning | confidence |
|---|---|---|
| 3 | compressor frequency in Hz, `0` = compressor off. Usual value 20 (the minimum), up to 68. | confirmed: power reports show ~26 W exactly when it is 0 |
| 1 | same as byte 3 almost always, probably the target frequency | likely |
| 4 | 81..149, no daily pattern, not the outdoor temperature | unknown |
| 6, 7, 8 | 50..62 (6 and 7 sometimes 255 = invalid): look like temperatures in °C | unknown which sensors |
| 10-11 | 16-bit big endian, 0..2000. Falls by about 10 per sample while running; 2000 during a stop | unknown |
| 13, 15, 19, 21, 23, 25, 27 | vary, not understood | unknown |
| 0, 2, 5, 9, 14, 16-18, 22, 24, 26 | constant | - |

## indoor blob (31 bytes)

| byte | meaning | confidence |
|---|---|---|
| 13 | `1` while the compressor is stopped | confirmed: set in 78 of 82 stopped samples |
| 17 | `0` while the compressor is stopped, otherwise `1` | confirmed (same 78 of 82) |
| 9 | `1` during hot water charging | likely: 13 samples in two periods (11-08 10:28-10:53 and 18:01-18:31 UTC), both while the warm water temperature rose from about 45 to 52 °C |
| 0, 2, 3 | 59..114, slowly varying, look like temperatures | unknown |
| 8 | 0..100 | unknown |
| 22-23 | looks like a counter / checksum | unknown |

## Check for heat output (2026-11-11, 1227 samples, 11-07 .. 11-11)

Goal: find flow rate or return temperature in the indoor blob, to compute heat = flow x delta-T x 1.16 Wh/(l K).
Method: correlate every byte with the recorded flow temperature (INDOOR2).

- byte 29 (range 83..91) correlates 0.79 with the flow temperature: likely a flow-side temperature, scale not yet known.
- bytes 0, 2, 3 (look like 59..114) do **not** follow the flow temperature, and a Fahrenheit reading (x - 32) / 1.8 is off by 0.5..3 K with a spread of 1.5..3.4 K: not the flow temperature in F.
- byte 22 correlates -0.40 and byte 9 -0.32 with it (byte 9 is the hot-water flag, so that is the valve changing the flow temperature).
- No byte so far looks like a flow rate. Without it there is no heat figure; the display values stay the reliable source.

## How to find out more
- Samples are snapshots in 5 minute slots. A stop shorter than one slot can be missed.
- To pin down the unknown fields, change a setting on the pump (setpoint, mode, boost) and watch which bytes move.
- The 4 mismatches in the stop flags (4 of 82) are probably timing offsets between the two blobs.
