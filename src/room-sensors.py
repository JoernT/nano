#!/usr/bin/env python3
"""
Reads SwitchBot thermometers (Meter / Meter Plus) from their Bluetooth advertisements
(no hub, no cloud) and writes room temperature, humidity and battery to InfluxDB.

    python3 -m venv .venv && .venv/bin/pip install -r requirements-ble.txt
    .venv/bin/python src/room-sensors.py            # loop
    .venv/bin/python src/room-sensors.py --once     # one scan + write
    .venv/bin/python src/room-sensors.py --dry      # scan only, print line protocol

Config: same INFLUX_* variables as the poller (read from the environment or ./.env).
Room names: src/rooms.json maps the device id (first 6 bytes of the manufacturer data)
to a room; unknown devices are written under their raw id.
"""
import asyncio
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from bleak import BleakScanner

ROOT = Path(__file__).resolve().parent.parent
SWITCHBOT_COMPANY_ID = 0x0969
SCAN_SECONDS = 60  # sensors advertise only every few seconds; short scans miss devices


def load_env():
    env = dict(os.environ)
    f = ROOT / '.env'
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env.setdefault(k.strip(), v.strip().strip('"\''))
    return env


def decode(m: bytes):
    """manufacturer data after the company id: 6 bytes device id + ... + 3 bytes (decimals, int+sign, humidity)"""
    if len(m) < 9:
        return None
    temp = (m[-2] & 0x7F) + (m[-3] & 0x0F) / 10
    if not m[-2] & 0x80:
        temp = -temp
    return {'id': m[:6].hex(), 'temp': round(temp, 1), 'humidity': m[-1] & 0x7F}


async def scan(seconds=SCAN_SECONDS):
    found = {}

    def cb(device, adv):
        m = adv.manufacturer_data.get(SWITCHBOT_COMPANY_ID)
        if not m:
            return
        r = decode(m)
        if not r:
            return
        sd = next((v for k, v in adv.service_data.items() if k.startswith('0000fd3d')), None)
        if sd and len(sd) > 2:
            r['battery'] = sd[2] & 0x7F
        r['rssi'] = adv.rssi
        found[r['id']] = r

    async with BleakScanner(cb):
        await asyncio.sleep(seconds)
    return found


def to_lines(readings, rooms, now):
    lines = []
    for r in readings.values():
        room = rooms.get(r['id'], r['id'])
        fields = f"temp={r['temp']},humidity={r['humidity']}i"
        if 'battery' in r:
            fields += f",battery={r['battery']}i"
        lines.append(f"room_climate,room={room.replace(' ', '_')} {fields} {now}")
    return lines


def write(env, lines):
    q = urllib.parse.urlencode({'org': env.get('INFLUX_ORG', 'nanoCorp'), 'bucket': env.get('INFLUX_BUCKET', 'nano'), 'precision': 's'})
    req = urllib.request.Request(
        f"{env.get('INFLUX_URL', 'http://localhost:8086')}/api/v2/write?{q}",
        data='\n'.join(lines).encode(),
        headers={'Authorization': f"Token {env['INFLUX_TOKEN']}"},
        method='POST',
    )
    urllib.request.urlopen(req, timeout=20).read()


async def main():
    env = load_env()
    once, dry = '--once' in sys.argv, '--dry' in sys.argv
    interval = int(env.get('POLL_INTERVAL_SEC', 240))
    rooms_file = Path(__file__).with_name('rooms.json')
    while True:
        started = time.time()
        rooms = json.loads(rooms_file.read_text()) if rooms_file.exists() else {}
        try:
            readings = await scan()
            lines = to_lines(readings, rooms, int(time.time()))
            if dry:
                print('\n'.join(lines))
            elif lines:
                write(env, lines)
            print(time.strftime('%FT%T'), f'{len(lines)} room readings', 'written' if lines and not dry else '', flush=True)
        except Exception as e:  # keep running; Bluetooth or Influx may be temporarily unavailable
            print(time.strftime('%FT%T'), 'error:', e, file=sys.stderr, flush=True)
        if once or dry:
            return
        await asyncio.sleep(max(5, interval - (time.time() - started)))


if __name__ == '__main__':
    asyncio.run(main())
