const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Tags every console call from inside planner.js with the test name, so its internal
// logs are attributed and visible instead of blending into the PASS/FAIL summary lines.
function loadLib(name) {
  const log = (...args) => console.log(`[${name}]`, ...args);
  const ctx = { console: { log, error: log, warn: log } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'segment.js'), 'utf8'), ctx, { filename: 'segment.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'move.js'), 'utf8'), ctx, { filename: 'move.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'planner.js'), 'utf8'), ctx, { filename: 'planner.js' });
  return ctx;
}

function currentPos(seg) {
  return { pv_name: seg.pv_name, pv_start: Number(seg.pv_start) };
}

// Verifies the [lv_start, lv_start + lv_size) range of `want.lv_name` is fully and
// contiguously covered, at the right PV offset, by segments in `finalReport`.
function checkTarget(finalReport, want) {
  const wantStart = Number(want.lv_start);
  const wantEnd = wantStart + Number(want.lv_size);
  let covered = wantStart;

  const segs = finalReport
    .filter(s => s.lv_name === want.lv_name)
    .map(s => ({ ...s, lv_start: Number(s.lv_start), lv_size: Number(s.lv_size) }))
    .filter(s => s.lv_start < wantEnd && s.lv_start + s.lv_size > wantStart)
    .sort((a, b) => a.lv_start - b.lv_start);

  for (const seg of segs) {
    if (seg.lv_start > covered) break;

    const pos = currentPos(seg);
    const offset = covered - seg.lv_start;
    const expectedStart = Number(want.pv_start) + (covered - wantStart);

    if (pos.pv_name !== want.pv_name || pos.pv_start + offset !== expectedStart) {
      return `${want.lv_name}[${covered}] expected at ${want.pv_name}:${expectedStart}, found at ${pos.pv_name}:${pos.pv_start + offset}`;
    }

    covered = Math.min(wantEnd, seg.lv_start + seg.lv_size);
  }

  if (covered < wantEnd) {
    return `${want.lv_name}[${covered}-${wantEnd - 1}] never placed`;
  }

  return null;
}

function runCase(fixturePath, ctx) {
  // Accepts either { segments, pv_options } or a raw buildDebugState() dump
  // ({ source, target, pv_options }) - the "Debug State" button in index.html
  // outputs the latter, so a repro can be pasted straight into a fixture file.
  const { segments, source, pv_options } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const list = segments || source;
  const pvOptions = pv_options || {};

  const expected = list
    .filter(s => s.lv_name && s.target_pv_name !== undefined)
    .map(s => ({
      lv_name: s.lv_name,
      lv_start: s.lv_start,
      lv_size: s.lv_size,
      pv_name: s.target_pv_name,
      pv_start: s.target_pv_start,
    }));

  const { finalReport, finalQueue, finalIterations, finalMoves } = ctx.planAllMoves(list, pvOptions, 20000);

  if (finalQueue.length > 0) {
    return { failure: `${finalQueue.length} move(s) stuck after ${finalIterations} iteration(s)` };
  }

  for (const want of expected) {
    const failure = checkTarget(finalReport, want);
    if (failure) return { failure };
  }

  return { moveCount: finalMoves.length };
}

function main() {
  const only = process.argv[2];

  const cases = fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.json'))
    .map(e => e.name.slice(0, -'.json'.length))
    .filter(name => !only || name === only);

  if (only && cases.length === 0) {
    console.log(`No test named "${only}" found in tests/fixtures/`);
    process.exit(1);
  }

  let failures = 0;

  for (const name of cases) {
    const fixturePath = path.join(FIXTURES_DIR, name + '.json');
    const ctx = loadLib(name);
    const started = Date.now();

    try {
      const { failure, moveCount } = runCase(fixturePath, ctx);
      const elapsed = Date.now() - started;
      if (failure) {
        failures++;
        console.log(`FAIL ${name}: ${failure} (${elapsed}ms)`);
      } else {
        console.log(`PASS ${name} (${moveCount} move(s) planned, ${elapsed}ms)`);
      }
    } catch (e) {
      failures++;
      console.log(`FAIL ${name}: ${e.message} (${Date.now() - started}ms)`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} of ${cases.length} case(s) failed`);
    process.exit(1);
  }

  console.log(`\nAll ${cases.length} case(s) passed`);
}

main();
