# Deployment on the Raspberry Pi (`nano`)

The poller (`src/nano.js`) runs on the Pi as a systemd service next to InfluxDB 2.

| File | Install to |
|---|---|
| `nano-poller.service` | `/etc/systemd/system/nano-poller.service` |
| `nano-sensors.service` | `/etc/systemd/system/nano-sensors.service` – room thermometers (SwitchBot, Bluetooth) |
| `nano-poller.service.d/daily-restart.conf` | `/etc/systemd/system/nano-poller.service.d/` – restart every 24 h |
| `nano-poller.service.d/watchdog.conf` | `/etc/systemd/system/nano-poller.service.d/` – restart if no poll finished for 12 min |

## Layout on the Pi

```
~/nano/.env            # secrets (chmod 600), INFLUX_URL=http://localhost:8086
~/nano/package.json    # {"type": "module"} + axios, openmeteo, @influxdata/influxdb-client
~/nano/src/            # nano.js history.js weather.js smartthings-auth.js cycles.js growatt.js rooms.json experiments.json energy-history.json
~/nano/dist/           # built page (npm run build), served by nano.js
~/nano/src/room-sensors.py, ~/nano/requirements-ble.txt, ~/nano/.venv/   # room sensors (python3 -m venv .venv && .venv/bin/pip install -r requirements-ble.txt)
```

The poller serves everything on port 8787: one page `/` (dashboard, status, report), plain status page `/status`, `/status.json`, API `/api/status` and `/api/history`.

Node 20 and npm come from apt (`sudo apt install nodejs npm`).

## Update

```sh
npm run build                      # page -> dist/
rsync -a --delete dist/ jwt@nano:nano/dist/   # or: ssh jwt@nano 'rm -rf nano/dist' && scp -r dist jwt@nano:nano/dist
scp src/nano.js src/history.js src/weather.js src/smartthings-auth.js src/cycles.js src/growatt.js src/rooms.json src/experiments.json src/energy-history.json jwt@nano:nano/src/
ssh -t jwt@nano 'sudo systemctl restart nano-poller'   # only needed when the .js files changed; dist/ is read on every request
```

Development: `npm start` serves `src/` with Vite and proxies `/api` to the Pi (`NANO_API=http://localhost:8787` for a local poller).

## Install / change the unit

```sh
sudo cp nano-poller.service /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/nano-poller.service.d
sudo cp nano-poller.service.d/*.conf /etc/systemd/system/nano-poller.service.d/
sudo systemctl daemon-reload && sudo systemctl enable --now nano-poller
```

## Checks

```sh
systemctl status nano-poller
journalctl -u nano-poller -f
systemctl show nano-poller -p WatchdogUSec -p WatchdogTimestamp -p RuntimeMaxUSec
curl http://nano.local:8787/status      # status page
```

## Monthly values from the heat pump display

`src/energy-history.json` holds monthly values read off the pump's console, in kWh: electricity consumed and heat produced.
They fill the months before recording began and add the heat output, which is not recorded otherwise (it gives the COP):

```json
{"months": {"2025-12": {"consumed": 812, "produced": 3100}, "2026-01": {"consumed": 905}}}
```

A display value wins over our own measurement for the same month (ours is partial for the first and the current month).
Copy the file to the Pi (see Update) and restart the poller; the report shows it right away.

## Solar (Growatt inverter + battery)

Optional. Put `GROWATT_TOKEN=<OpenAPI token>` (and optionally `GROWATT_SN=<inverter serial>`, otherwise the first storage device of the account is used) into `~/nano/.env` and restart the poller.
It then reads `device/mix/mix_last_data` every 5 minutes (the API rate-limits: error 10012) and writes the `solar` measurement (PV, load, grid import/export, battery charge/discharge, SOC, day counters); hourly irradiation comes in with the weather points.
Check what the plant offers: `ssh jwt@nano 'cd nano && node --env-file=.env src/growatt.js --dry'` (takes about a minute because of the rate limit).

## Room sensors and Bluetooth range

`nano-sensors` reads the SwitchBot thermometers from their Bluetooth advertisements, so it only hears sensors within
range of the Pi (roughly 10 m, less through walls). It writes every SwitchBot it hears; unnamed ones go in under their id.

The unnamed sensor `de6910125107` is out of range from the Pi's current spot and is not recorded. Options when that matters:

- **Move the Pi (or the sensor).** Nothing to configure: once it is in range the sensor shows up in the data again.
- **Let the Mac bridge it.** `.env` on the Mac already points at the Pi (`INFLUX_URL=http://nano.local:8086`), so on a Mac that is
  near the sensor run `.venv/bin/python src/room-sensors.py`. It writes to the same series; stop it again when the Pi hears everything
  (running both just doubles the points, which is harmless for the charts).
- A second Pi or ESP32 as a Bluetooth relay in the far room would do the same job.

Check what the Pi hears (a one-off scan that only prints, it can run next to the service): `ssh jwt@nano 'cd nano && .venv/bin/python src/room-sensors.py --dry'`.
