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
~/nano/src/            # nano.js history.js weather.js smartthings-auth.js cycles.js rooms.json experiments.json
~/nano/dist/           # built dashboard + report (npm run build), served by nano.js
~/nano/src/room-sensors.py, ~/nano/requirements-ble.txt, ~/nano/.venv/   # room sensors (python3 -m venv .venv && .venv/bin/pip install -r requirements-ble.txt)
```

The poller serves everything on port 8787: dashboard `/`, report `/report.html`, status page `/status`, API `/api/status` and `/api/history`.

Node 20 and npm come from apt (`sudo apt install nodejs npm`).

## Update

```sh
npm run build                      # dashboard + report -> dist/
rsync -a --delete dist/ jwt@nano:nano/dist/   # or: ssh jwt@nano 'rm -rf nano/dist' && scp -r dist jwt@nano:nano/dist
scp src/nano.js src/history.js src/weather.js src/smartthings-auth.js src/cycles.js src/rooms.json src/experiments.json jwt@nano:nano/src/
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
