import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localToMs, parseMix} from '../src/growatt.js';
import {parseHourly} from '../src/weather.js';

test('localToMs reads plant time as Europe/Berlin (winter and summer)', () => {
    assert.equal(new Date(localToMs('2026-11-12 13:14:12')).toISOString(), '2026-11-12T12:14:12.000Z');
    assert.equal(new Date(localToMs('2026-07-01 12:00:00')).toISOString(), '2026-07-01T10:00:00.000Z');
    assert.equal(localToMs('garbage'), undefined);
});

test('parseMix maps the mix_last_data fields and skips missing ones', () => {
    const {time, fields} = parseMix({error_code: 0, data: {time: '2026-11-12 13:14:12', ppv: 2030, pcharge1: 1400, pdischarge1: 0, soc: 24, pacToUserR: 47.7, pacToGridR: 0, plocalLoadR: 240, epvtoday: 1.3, etoUserToday: 15.6, ppv1: 1844.6, ppv2: 186, epv1Today: 0.8, epv2Today: 0.5, acChargePower: 0, acChargeEnergyToday: 1}});
    assert.equal(time, Date.parse('2026-11-12T12:14:12Z'));
    assert.deepEqual(fields, {pv_w: 2030, charge_w: 1400, discharge_w: 0, soc: 24, grid_import_w: 47.7, grid_export_w: 0, load_w: 240, pv_kwh_today: 1.3, import_kwh_today: 15.6, pv1_w: 1844.6, pv2_w: 186, ac_charge_w: 0, pv1_kwh_today: 0.8, pv2_kwh_today: 0.5, ac_charge_kwh_today: 1});
});

test('parseMix reports API errors', () => {
    assert.throws(() => parseMix({error_msg: 'error_frequently_access', data: '', error_code: 10012}), /frequently_access.*10012/);
});

test('parseHourly carries the radiation when present', () => {
    const out = parseHourly({hourly: {time: [0], temperature_2m: [2], shortwave_radiation: [120]}}, 3600_000);
    assert.deepEqual(out, [{time: 0, temp: 2, humidity: undefined, radiation: 120}]);
});
