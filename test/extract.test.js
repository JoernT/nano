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
