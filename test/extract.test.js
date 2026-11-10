import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractPoints} from '../src/nano.js';

const dump = JSON.parse(readFileSync(new URL('./fixtures/status.json', import.meta.url)));

test('extracts temperature, power and cycle data with device timestamps', () => {
    const pts = extractPoints(dump);
    const power = pts.find((p) => p.measurement === 'powerconsumption');
    assert.equal(power.fields.power, 1294); // kW -> W
    assert.equal(power.fields.energy, 2749.946); // Wh -> kWh
    assert.equal(power.time.toISOString(), '2024-02-04T18:22:27.208Z');
    const heating = pts.find((p) => p.measurement === 'temperature' && p.tags.component === 'heating');
    assert.equal(heating.fields.temp, 44.6);
    assert.equal(pts.filter((p) => p.measurement === 'ehs_cycle' && p.tags.kind === 'outdoor').length, 3);
});

test('missing capabilities yield no points instead of zeros', () => {
    assert.deepEqual(extractPoints({}), []);
});

test('heating circuit mode is separate from warm water mode; setpoints and FSV are captured', () => {
    const pts = extractPoints(dump);
    const mode = (component) => pts.find((p) => p.measurement === 'state' && p.tags.component === component && p.tags.attribute === 'mode')?.fields.value;
    assert.equal(mode('warmwater'), 'eco');
    assert.equal(mode('heating'), 'auto');
    const sp = pts.find((p) => p.measurement === 'setpoint' && p.tags.component === 'heating' && p.tags.kind === 'cooling');
    assert.equal(sp.fields.value, 24);
    const fsv = pts.find((p) => p.measurement === 'fsv' && p.tags.id === '1031');
    assert.equal(fsv.fields.value, 60);
});

test('firmware and driver versions are stored as state strings', () => {
    const pts = extractPoints(dump);
    const st = (attribute) => pts.find((p) => p.measurement === 'state' && p.tags.component === 'heatpump' && p.tags.attribute === attribute);
    assert.equal(st('firmware').fields.value, '20230914.1');
    assert.equal(st('firmware').time.toISOString(), '2023-11-29T17:15:10.462Z');
    assert.equal(st('driver').fields.value, '23070101');
    assert.equal(st('micom'), undefined); // null in the fixture -> not written
});

test('operating states, setpoint limits, report window and module versions are captured', () => {
    const pts = extractPoints({components: {
        main: {
            'samsungce.ehsBoosterHeater': {status: {value: 'off'}},
            'samsungce.ehsDiverterValve': {position: {value: 'room'}},
            'custom.thermostatSetpointControl': {minimumSetpoint: {value: 40}, maximumSetpoint: {value: 60}},
            powerConsumptionReport: {powerConsumption: {value: {power: 1, energy: 2000, persistedEnergy: 2000, start: '2026-11-09T11:10:14Z', end: '2026-11-09T11:30:14Z'}}},
            'samsungce.softwareVersion': {versions: {value: [{id: '3', versionNumber: 'DB91-02450A'}]}},
        },
        INDOOR2: {'samsungce.ehsDefrostMode': {status: {value: 'off'}}},
    }});
    const st = (component, attribute) => pts.find((p) => p.measurement === 'state' && p.tags.component === component && p.tags.attribute === attribute)?.fields.value;
    assert.equal(st('warmwater', 'boosterHeater'), 'off');
    assert.equal(st('warmwater', 'diverterValve'), 'room');
    assert.equal(st('heating', 'defrost'), 'off');
    assert.equal(st('heatpump', 'module3'), 'DB91-02450A');
    assert.deepEqual(pts.find((p) => p.tags.kind === 'limit').fields, {min: 40, max: 60});
    assert.equal(pts.find((p) => p.measurement === 'powerconsumption').fields.windowSeconds, 1200);
});

import {compressorHz, detectCycles, dailyStats, summary} from '../src/cycles.js';

test('cycle detection: runs, gaps and short cycles', () => {
    const m = 60_000;
    const t0 = Date.UTC(2026, 10, 9, 10, 0);
    // 0 0 | 20 20 20 | 0 | 25 | gap | 20 20
    const samples = [
        [0, 0], [5, 0], [10, 20], [15, 20], [20, 20], [25, 0], [30, 25], [90, 20], [95, 20],
    ].map(([min, hz]) => ({t: t0 + min * m, hz}));
    const runs = detectCycles(samples);
    assert.equal(runs.length, 3);
    assert.equal(runs[0].durationMs, 15 * m);
    assert.equal(runs[0].avgHz, 20);
    assert.equal(runs[0].short, false);
    assert.equal(runs[1].durationMs, 5 * m);
    assert.equal(runs[1].short, true);
    assert.equal(runs[2].start, t0 + 90 * m);
    const s = summary(runs);
    assert.equal(s.starts, 3);
    assert.equal(s.shortCycles, 1);
    assert.deepEqual(dailyStats(runs).map((d) => [d.starts, d.shortCycles]), [[3, 1]]);
});

test('compressorHz reads byte 3 of the outdoor blob', () => {
    assert.equal(compressorHz('0014001900'), 25);
    assert.equal(compressorHz('00'), undefined);
});

import {parseHourly} from '../src/weather.js';
import {pearson} from '../src/cycles.js';

test('parseHourly drops future and null hours', () => {
    const now = 3600_000 * 3;
    const out = parseHourly({hourly: {time: [0, 3600, 7200, 14400], temperature_2m: [1.5, null, 3, 9], relative_humidity_2m: [80, 80, 70, 60]}}, now);
    assert.deepEqual(out, [{time: 0, temp: 1.5, humidity: 80}, {time: 7200000, temp: 3, humidity: 70}]);
});

test('pearson', () => {
    assert.equal(pearson([[1, 2], [2, 4], [3, 6]]), 1);
    assert.equal(pearson([[1, 6], [2, 4], [3, 2]]), -1);
    assert.equal(pearson([[1, 1], [2, 2]]), undefined);
});

import {heatingDegreeDays, dayStartMs, phaseStats} from '../src/cycles.js';

test('heatingDegreeDays uses 20/15', () => {
    assert.equal(heatingDegreeDays(3), 17);
    assert.equal(heatingDegreeDays(15), 0);
    assert.equal(heatingDegreeDays(undefined), 0);
});

test('dayStartMs is local midnight (winter and summer)', () => {
    assert.equal(new Date(dayStartMs('2026-11-10')).toISOString(), '2026-11-09T23:00:00.000Z');
    assert.equal(new Date(dayStartMs('2026-07-10')).toISOString(), '2026-07-09T22:00:00.000Z');
});

test('phaseStats splits full days by experiment and skips mixed and running days', () => {
    const day = (d, starts, kwh, hdd) => ({day: d, starts, shortCycles: 0, kwh, hdd});
    const daily = [day('2026-11-05', 30, 28, 14), day('2026-11-06', 28, 26, 14), day('2026-11-07', 26, 20, 14), day('2026-11-08', 20, 14, 14), day('2026-11-09', 18, 14, 14)];
    const at = Date.parse('2026-11-07T14:00:00+01:00');
    const now = Date.parse('2026-11-09T12:00:00+01:00');
    const [before, after] = phaseStats(daily, [{at, label: 'Kurve -2 K'}], now);
    assert.equal(before.days, 2); // 11-05, 11-06
    assert.equal(before.starts, 29);
    assert.equal(before.kwhPerHdd, 1.93); // (2 + 1.857) / 2
    assert.equal(after.days, 1); // 11-08 only: 11-07 has the change, 11-09 is running
    assert.equal(after.label, 'Kurve -2 K');
    assert.equal(after.kwhPerHdd, 1);
});

test('phaseStats skips days that start before the data does', () => {
    const daily = [{day: '2026-11-07', starts: 9, shortCycles: 0, kwh: 5, hdd: 14}, {day: '2026-11-08', starts: 20, shortCycles: 0, kwh: 14, hdd: 14}];
    const [p] = phaseStats(daily, [], Date.parse('2026-11-10T12:00:00+01:00'), 'Europe/Berlin', Date.parse('2026-11-07T01:30:00+01:00'));
    assert.equal(p.days, 1);
    assert.equal(p.starts, 20);
});
