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

## How to find out more
- Samples are snapshots in 5 minute slots. A stop shorter than one slot can be missed.
- To pin down the unknown fields, change a setting on the pump (setpoint, mode, boost) and watch which bytes move.
- The 4 mismatches in the stop flags (4 of 82) are probably timing offsets between the two blobs.
