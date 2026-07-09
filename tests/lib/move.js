const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'src');

function loadLib() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'segment.js'), 'utf8'), ctx, { filename: 'segment.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'move.js'), 'utf8'), ctx, { filename: 'move.js' });
  return ctx;
}

const tests = {
  'exact-fit move needs no splitting': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 10, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    target: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'full' },
    ],
  },

  'moving a middle chunk splits the source into before/after': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 20, lv_name: 'lv1', lv_start: 0, lv_size: 20, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 20, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 5, target_pv_name: 'pv0', target_pv_start: 20, size: 10, type: 'partial' },
    target: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 5, lv_name: 'lv1', lv_start: 0, lv_size: 5, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 5, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 15, pv_size: 5, lv_name: 'lv1', lv_start: 15, lv_size: 5, lv_index: 3 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 20, pv_size: 10, lv_name: 'lv1', lv_start: 5, lv_size: 10, lv_index: 2, move_type: 'partial' },
    ],
  },

  'moving into a larger free extent leaves a free remainder': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 10, pv_size: 30 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    target: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'full' },
      { segtype: 'free', pv_name: 'pv0', pv_start: 20, pv_size: 20 },
    ],
  },

  'vacated source space merges with an adjacent pre-existing free segment': {
    source: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 5 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 5, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 15, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 5, target_pv_name: 'pv0', target_pv_start: 15, size: 10, type: 'full' },
    // The freed [5,15) merges with the pre-existing free [0,5) into one [0,15) run.
    target: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 15 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 15, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'full' },
    ],
  },

  'cross-PV move works the same way': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv1', pv_start: 0, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv1', target_pv_start: 0, size: 10, type: 'indirect' },
    target: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv1', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'indirect' },
    ],
  },

  'throws when the source extent does not exist': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 10, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 100, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    throws: /Failed to find segments/,
  },

  'throws when the target free extent is too small': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 10, pv_size: 5 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    throws: /Failed to find segments/,
  },

  'throws when the target extent is occupied, not free': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv2', lv_start: 0, lv_size: 10, lv_index: 1 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    throws: /Failed to find segments/,
  },

  'throws when the source position is free space (nothing to move)': {
    source: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 10 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 10, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    throws: /Failed to find segments/,
  },

  'throws when the move would produce overlapping segments': {
    // Deliberately inconsistent input: the "free" segment at [5,15) overlaps the
    // occupied lv1 segment at [0,10), which real report data should never contain.
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 5, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 5, size: 10, type: 'full' },
    throws: /overlapping segments/,
  },

  'marks a segment complete once it reaches its recorded target position': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, target_pv_name: 'pv0', target_pv_start: 10 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 10, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv0', target_pv_start: 10, size: 10, type: 'full' },
    target: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'full', target_pv_name: 'pv0', target_pv_start: 10, complete: true },
    ],
  },

  'keeps a segment pending when moved to a staging position short of its target': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, target_pv_name: 'pv0', target_pv_start: 10 },
      { segtype: 'free', pv_name: 'pv1', pv_start: 0, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 0, target_pv_name: 'pv1', target_pv_start: 0, size: 10, type: 'indirect' },
    target: [
      { segtype: 'free', pv_name: 'pv0', pv_start: 0, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv1', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'indirect', target_pv_name: 'pv0', target_pv_start: 10, pending: true },
    ],
  },

  'splitting a pending segment shifts target_pv_start for the before/after remainder': {
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 20, lv_name: 'lv1', lv_start: 0, lv_size: 20, lv_index: 1, target_pv_name: 'pv1', target_pv_start: 100 },
      { segtype: 'free', pv_name: 'pv0', pv_start: 20, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv0', source_pv_start: 5, target_pv_name: 'pv0', target_pv_start: 20, size: 10, type: 'partial' },
    target: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 5, lv_name: 'lv1', lv_start: 0, lv_size: 5, lv_index: 1, target_pv_name: 'pv1', target_pv_start: 100, pending: true },
      { segtype: 'free', pv_name: 'pv0', pv_start: 5, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 15, pv_size: 5, lv_name: 'lv1', lv_start: 15, lv_size: 5, lv_index: 3, target_pv_name: 'pv1', target_pv_start: 115, pending: true },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 20, pv_size: 10, lv_name: 'lv1', lv_start: 5, lv_size: 10, lv_index: 2, move_type: 'partial', target_pv_name: 'pv1', target_pv_start: 105, pending: true },
    ],
  },

  'does not merge adjacent LV segments with non-contiguous lv_start/lv_size': {
    // archive#1 and archive#2 sit back-to-back on pv0 (pv_start 0-10, 10-20) but both
    // claim lv_start 0 - i.e. they are NOT a contiguous range of the same LV - so a
    // move elsewhere (on pv1) must not fuse them together when segments get reordered.
    source: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'archive', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'archive', lv_start: 0, lv_size: 10, lv_index: 2 },
      { segtype: 'linear', pv_name: 'pv1', pv_start: 0, pv_size: 10, lv_name: 'other', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'free', pv_name: 'pv1', pv_start: 10, pv_size: 10 },
    ],
    params: { source_pv_name: 'pv1', source_pv_start: 0, target_pv_name: 'pv1', target_pv_start: 10, size: 10, type: 'full' },
    target: [
      { segtype: 'linear', pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'archive', lv_start: 0, lv_size: 10, lv_index: 1 },
      { segtype: 'linear', pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'archive', lv_start: 0, lv_size: 10, lv_index: 2 },
      { segtype: 'free', pv_name: 'pv1', pv_start: 0, pv_size: 10 },
      { segtype: 'linear', pv_name: 'pv1', pv_start: 10, pv_size: 10, lv_name: 'other', lv_start: 0, lv_size: 10, lv_index: 1, move_type: 'full' },
    ],
  },
};

let failures = 0;
const names = Object.keys(tests);

for (const name of names) {
  const { source, params, target, throws } = tests[name];
  const ctx = loadLib();
  const run = () => ctx.performMove(source, params, params.type);

  try {
    if (throws) {
      assert.throws(run, throws);
    } else {
      assert.deepEqual(run(), target);
    }
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} of ${names.length} case(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${names.length} case(s) passed`);
