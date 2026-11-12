import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate, notify, STALL_MS} from '../src/tankwatch.js';

const H = 3600_000;
test('no warning while the tank is warm or the stall is short', () => {
    let s = evaluate({}, {temp: 45, valve: 'room', now: 0});
    s = evaluate(s, {temp: 30, valve: 'room', now: 1 * H});
    assert.equal(s.warning, undefined);
});
test('warns after the stall time below the limit, once, and clears on recovery', () => {
    let s = evaluate({lastTank: 0}, {temp: 30, valve: 'room', now: STALL_MS});
    assert.equal(s.event, 'start');
    s = evaluate(s, {temp: 28, valve: 'room', now: STALL_MS + H});
    assert.equal(s.event, undefined);
    assert.ok(s.warning);
    s = evaluate(s, {temp: 36, valve: 'tank', now: STALL_MS + 2 * H});
    assert.equal(s.event, 'end');
    assert.equal(s.warning, undefined);
});
test('a tank cycle resets the timer', () => {
    let s = evaluate({lastTank: 0}, {temp: 30, valve: 'tank', now: 3 * H});
    s = evaluate(s, {temp: 30, valve: 'room', now: 4 * H});
    assert.equal(s.warning, undefined);
});
test('notify is a no-op without a url, posts with one', async () => {
    assert.equal(await notify('t', 'm', {url: ''}), false);
    let got;
    assert.equal(await notify('t', 'm', {url: 'http://x/y', fetchImpl: async (u, o) => { got = [u, o]; return {ok: true}; }}), true);
    assert.equal(got[1].body, 'm');
});
