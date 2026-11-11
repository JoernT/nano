# Deployment on the Raspberry Pi (`nano`)

The poller (`src/nano.js`) runs on the Pi as a systemd service next to InfluxDB 2.

| File | Install to |
|---|---|
| `nano-poller.service` | `/etc/systemd/system/nano-poller.service` |
| `nano-poller.service.d/daily-restart.conf` | `/etc/systemd/system/nano-poller.service.d/` – restart every 24 h |
| `nano-poller.service.d/watchdog.conf` | `/etc/systemd/system/nano-poller.service.d/` – restart if no poll finished for 12 min |

## Layout on the Pi

```
~/nano/.env            # secrets (chmod 600), INFLUX_URL=http://localhost:8086
~/nano/package.json    # {"type": "module"} + axios, openmeteo, @influxdata/influxdb-client
~/nano/src/            # nano.js history.js weather.js smartthings-auth.js cycles.js rooms.json experiments.json
```

Node 20 and npm come from apt (`sudo apt install nodejs npm`).

## Update

```sh
scp src/nano.js src/history.js src/weather.js src/smartthings-auth.js src/cycles.js src/rooms.json src/experiments.json jwt@nano:nano/src/
ssh -t jwt@nano 'sudo systemctl restart nano-poller'
```

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
curl http://nano.local:8787/            # status page
```
