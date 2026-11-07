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
