import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPS } from '../../src/map/houseProps.ts';
import { clearanceZones, propProblems } from '../../src/map/clearance.ts';

test('furniture keeps every doorway, stair end and hatch clear, stays inside its room and does not overlap', () => {
  assert.ok(clearanceZones().length > 40, 'clearance zones computed from the layout');
  assert.deepEqual(propProblems(PROPS), []);
});
