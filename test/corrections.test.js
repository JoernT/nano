import test from 'node:test';
import assert from 'node:assert/strict';
import {kwhByDay, wattsAt} from '../src/corrections.js';

const c = [{from: Date.parse('2026-11-12T21:56:00+01:00'), to: Date.parse('2026-11-13T00:56:00+01:00'), kw: 5}];

test('kWh are split over the local days', () => {
    const m = kwhByDay(c, Date.parse('2026-11-14T00:00:00+01:00'));
    assert.ok(Math.abs(m.get('2026-11-12') - 5 * (124 / 60)) < 1e-9);
    assert.ok(Math.abs(m.get('2026-11-13') - 5 * (56 / 60)) < 1e-9);
});

test('an open window runs until now', () => {
    const open = [{from: Date.parse('2026-11-12T21:56:00+01:00'), kw: 4}];
    const m = kwhByDay(open, Date.parse('2026-11-12T22:56:00+01:00'));
    assert.ok(Math.abs(m.get('2026-11-12') - 4) < 1e-9);
});

test('watts only inside the window', () => {
    assert.equal(wattsAt(c, Date.parse('2026-11-12T22:00:00+01:00')), 5000);
    assert.equal(wattsAt(c, Date.parse('2026-11-12T21:00:00+01:00')), 0);
});

import {phantomInDisplayMonth} from '../src/corrections.js';

test('display months: running month only with asOf, ended month fully', () => {
    const w = [{from: Date.parse('2026-11-12T21:00:00+01:00'), to: Date.parse('2026-11-12T23:00:00+01:00'), kw: 6}];
    const now = Date.parse('2026-11-13T12:00:00+01:00');
    assert.equal(phantomInDisplayMonth(w, '2026-11', undefined, now), 0); // read before the boost, month not over
    assert.ok(Math.abs(phantomInDisplayMonth(w, '2026-11', '2026-11-12T22:00:00+01:00', now) - 6) < 1e-9);
    assert.ok(Math.abs(phantomInDisplayMonth(w, '2026-11', '2026-11-13T08:00:00+01:00', now) - 12) < 1e-9);
    assert.ok(Math.abs(phantomInDisplayMonth(w, '2026-11', undefined, Date.parse('2026-12-02T00:00:00+01:00')) - 12) < 1e-9);
});
