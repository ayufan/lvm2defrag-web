const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// `class` declarations don't attach to the vm context object the way `function`
// declarations do, so pull the binding back out via a second runInContext call.
function loadLib() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'segment.js'), 'utf8'), ctx, { filename: 'segment.js' });
  return vm.runInContext('Segment', ctx);
}

const Segment = loadLib();

const tests = {
  'find locates and removes an occupied segment fully containing the range': () => {
    const segments = [
      { pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1' },
      { pv_name: 'pv0', pv_start: 10, pv_size: 10 },
    ];

    const found = Segment.find(segments, 'pv0', 2, 5, false);
    assert.equal(found.pv_start, 0);
    assert.equal(segments.length, 1);
  },

  'find only matches free space when free is requested': () => {
    const segments = [
      { pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1' },
      { pv_name: 'pv0', pv_start: 10, pv_size: 10 },
    ];

    assert.equal(Segment.find(segments, 'pv0', 0, 5, true), null);
    const found = Segment.find(segments, 'pv0', 10, 5, true);
    assert.equal(found.pv_start, 10);
  },

  'find returns null when nothing matches': () => {
    const segments = [{ pv_name: 'pv0', pv_start: 0, pv_size: 10 }];
    assert.equal(Segment.find(segments, 'pv0', 5, 10, true), null);
    assert.equal(Segment.find(segments, 'pv1', 0, 5, true), null);
  },

  'subdivide with no remainder returns just middle': () => {
    const seg = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10 });
    const { middle, output } = seg.subdivide(0, 10);
    assert.equal(output.length, 0);
    assert.equal(middle.pv_start, 0);
    assert.equal(middle.pv_size, 10);
  },

  'subdivide splits off before/after slivers with shifted lv_start': () => {
    const seg = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 20, lv_name: 'lv1', lv_start: 0, lv_size: 20 });
    const { middle, output } = seg.subdivide(5, 10);

    assert.equal(output.length, 2);
    const [before, after] = output;
    assert.deepEqual(
      { pv_start: before.pv_start, pv_size: before.pv_size, lv_start: before.lv_start, lv_size: before.lv_size },
      { pv_start: 0, pv_size: 5, lv_start: 0, lv_size: 5 }
    );
    assert.deepEqual(
      { pv_start: after.pv_start, pv_size: after.pv_size, lv_start: after.lv_start, lv_size: after.lv_size },
      { pv_start: 15, pv_size: 5, lv_start: 15, lv_size: 5 }
    );
    assert.deepEqual(
      { pv_start: middle.pv_start, pv_size: middle.pv_size, lv_start: middle.lv_start, lv_size: middle.lv_size },
      { pv_start: 5, pv_size: 10, lv_start: 5, lv_size: 10 }
    );
  },

  'subdivide shifts target_pv_start for before/middle/after the same way as lv_start': () => {
    const seg = new Segment({
      pv_name: 'pv0', pv_start: 0, pv_size: 20, lv_name: 'lv1', lv_start: 0, lv_size: 20,
      target_pv_name: 'pv1', target_pv_start: 100,
    });
    const { middle, output } = seg.subdivide(5, 10);
    const [before, after] = output;

    assert.equal(before.target_pv_start, 100);
    assert.equal(middle.target_pv_start, 105);
    assert.equal(after.target_pv_start, 115);
  },

  'subdivide returns null when the range is not fully contained': () => {
    const seg = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10 });
    assert.equal(seg.subdivide(5, 10), null);
  },

  'scheduleMove subdivides a single segment and marks it pending': () => {
    const segments = [
      new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 20, lv_name: 'lv1', lv_start: 0, lv_size: 20 }),
    ];

    const scheduled = Segment.scheduleMove(segments, 'pv0', 5, 10, 'pv1', 100);

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].target_pv_name, 'pv1');
    assert.equal(scheduled[0].target_pv_start, 100);
    assert.equal(scheduled[0].pending, true);
    assert.equal(segments.length, 3);
    assert.equal(segments.filter(s => s.pv_start === 0 && s.pv_size === 5).length, 1);
    assert.equal(segments.filter(s => s.pv_start === 15 && s.pv_size === 5).length, 1);
  },

  'scheduleMove spans multiple adjacent segments, offsetting target_pv_start for each': () => {
    const segments = [
      new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10 }),
      new Segment({ pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv2', lv_start: 0, lv_size: 10 }),
    ];

    const scheduled = Segment.scheduleMove(segments, 'pv0', 5, 10, 'pv1', 100);

    assert.equal(scheduled.length, 2);
    const [first, second] = scheduled.sort((a, b) => a.pv_start - b.pv_start);
    assert.deepEqual(
      { lv_name: first.lv_name, pv_start: first.pv_start, pv_size: first.pv_size, target_pv_start: first.target_pv_start },
      { lv_name: 'lv1', pv_start: 5, pv_size: 5, target_pv_start: 100 }
    );
    assert.deepEqual(
      { lv_name: second.lv_name, pv_start: second.pv_start, pv_size: second.pv_size, target_pv_start: second.target_pv_start },
      { lv_name: 'lv2', pv_start: 10, pv_size: 5, target_pv_start: 105 }
    );
  },

  'scheduleMove throws when the range is not fully covered by occupied segments': () => {
    const gap = [
      new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 5, lv_name: 'lv1', lv_start: 0, lv_size: 5 }),
      new Segment({ pv_name: 'pv0', pv_start: 5, pv_size: 5 }),
    ];
    assert.throws(() => Segment.scheduleMove(gap, 'pv0', 0, 10, 'pv1', 0), /not fully covered/);

    const short = [
      new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 5, lv_name: 'lv1', lv_start: 0, lv_size: 5 }),
    ];
    assert.throws(() => Segment.scheduleMove(short, 'pv0', 0, 10, 'pv1', 0), /not fully covered/);
  },

  'scheduleMove throws when a covering segment already has a target': () => {
    const segments = [
      new Segment({
        pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', lv_start: 0, lv_size: 10,
        target_pv_name: 'pv1', target_pv_start: 50,
      }),
    ];

    assert.throws(() => Segment.scheduleMove(segments, 'pv0', 0, 10, 'pv2', 0), /already has a target_pv_name/);
  },

  'isFree is true for segments with no lv_name, false otherwise': () => {
    const free = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10 });
    assert.equal(free.isFree(), true);

    const occupied = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1' });
    assert.equal(occupied.isFree(), false);
  },

  'shouldBeMoved is false without a target, true when target differs, false once matched': () => {
    const noTarget = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1' });
    assert.equal(noTarget.shouldBeMoved(), false);

    const pending = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', target_pv_name: 'pv0', target_pv_start: 10 });
    assert.equal(pending.shouldBeMoved(), true);

    const matched = new Segment({ pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv1', target_pv_name: 'pv0', target_pv_start: 10 });
    assert.equal(matched.shouldBeMoved(), false);
  },

  'shouldBeMoved is always false for free space, even with a stray target': () => {
    const free = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, target_pv_name: 'pv0', target_pv_start: 10 });
    assert.equal(free.shouldBeMoved(), false);
  },

  'updateMoveState sets complete once pv position matches target': () => {
    const seg = new Segment({ pv_name: 'pv0', pv_start: 10, pv_size: 10, lv_name: 'lv1', target_pv_name: 'pv0', target_pv_start: 10 });
    seg.updateMoveState();
    assert.equal(seg.complete, true);
    assert.equal(seg.pending, undefined);
  },

  'updateMoveState sets pending while pv position differs from target': () => {
    const seg = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', target_pv_name: 'pv0', target_pv_start: 10 });
    seg.updateMoveState();
    assert.equal(seg.pending, true);
    assert.equal(seg.complete, undefined);
  },

  'updateMoveState clears pending/complete when there is no target': () => {
    const seg = new Segment({ pv_name: 'pv0', pv_start: 0, pv_size: 10, lv_name: 'lv1', pending: true });
    seg.updateMoveState();
    assert.equal(seg.pending, undefined);
    assert.equal(seg.complete, undefined);
  },
};

let failures = 0;
const names = Object.keys(tests);

for (const name of names) {
  try {
    tests[name]();
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
