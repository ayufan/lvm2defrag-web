# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page, no-build, client-side tool that plans an optimal sequence of
`pvmove` commands to defragment LVM physical volumes. Inspired by
[lvm2defrag](https://github.com/bisqwit/lvm2defrag) but with its own planning
algorithm. It's a static site (`index.html` + a handful of plain `<script>`
files, no bundler/npm/framework) hosted at https://lvm2defrag.ayufan.dev/
(see `CNAME`).

## Commands

There is no build step and no `package.json`. Everything runs on plain Node
via `vm` (each test loads `lib/*.js` fresh into a sandboxed context) or
directly in the browser. All three test runners exit non-zero on any failure
and print `PASS`/`FAIL` per case.

```bash
node tests/run.js         # planner integration tests (fixtures under `tests/fixtures/*.json`)
node tests/run.js hard    # only one fixture, e.g. `tests/fixtures/hard.json`
node tests/move.js        # `performMove` unit tests (inline cases, no fixtures)
node tests/segment.js     # `Segment` class unit tests (inline cases, no fixtures)
open index.html           # the app itself - no server needed
```

## Architecture

Pure planning logic lives in `lib/` (testable in Node); DOM/browser code is
`pvs.js`, `ui.js`, and the inline `<script>` in `index.html`. Load order:

```
utils.js -> pvs.js -> lib/segment.js -> lib/move.js -> lib/planner.js -> ui.js -> index.html inline script
```

### Segment model

The whole system operates on flat arrays of "segment" objects:

```
{ segtype, pv_name, pv_start, pv_size,
  lv_name?, lv_start?, lv_size?, lv_index?,
  target_pv_name?, target_pv_start?, pending?, complete? }
```

- `pv_name`/`pv_start` is always the extent's real current on-disk position.
- A segment with no `lv_name` is free space.
- `target_pv_name`/`target_pv_start`, when present, is the extent's ultimate
  intended position; `pending`/`complete` are derived by comparing the two
  and recomputed on every `performMove` call.
- `pvs.js#parsePVSReport` turns raw `pvs --reportformat json` output into
  this shape; fresh-parsed segments never carry a target.
- `lib/move.js#orderSegments` sorts segments per-PV and merges adjacent
  same-LV segments back together (shared globally, since freshly parsed
  segments are always compatible with it).

### `lib/segment.js` - the `Segment` class

Models one extent and owns the per-segment primitives:

- `Segment.clone`/`Segment.find` - static, operate on a list.
- `clone`, `subdivide` - `subdivide` carves a `[pv_start, pv_start+pv_size)`
  range out of a segment, splitting off before/after remainders with shifted
  `lv_start`/`target_pv_start`.
- `shouldBeMoved` - is this an LV segment whose `target_pv_name`/
  `target_pv_start` differs from its current position; `updateMoveState`
  sets `pending`/`complete` from that same comparison.
- `Segment.scheduleMove(segments, pv_name, pv_start, pv_size,
  target_pv_name, target_pv_start)` - the entry point for attaching new move
  intent onto an existing, untargeted segment list. It walks the requested
  range (which may span several adjacent segments), subdividing each and
  assigning a proportionally-offset target; it throws if the range isn't
  fully covered by occupied segments or if any covering segment already has
  a target set. `index.html#buildPlanSegments` is the main caller.

### `lib/move.js` - the move primitive

`performMove(segments, move, type)` is the only real export: given a segment
list and a `{source_pv_name, source_pv_start, target_pv_name,
target_pv_start, size}` move, it clones the input via `Segment.clone`, uses
`Segment.find`/`segment.subdivide` to split the source/target segments as
needed, swaps their occupied/free status, recomputes `pending`/`complete` on
every segment, and returns a new ordered segment array.

It has no knowledge of planning/strategy - it just executes one
already-decided move and validates the result (throws on missing segments or
resulting overlaps). Callers never need to pre-clone; `performMove` always
returns a fresh array and never mutates its input.

### `lib/planner.js` - the planning/search engine

`planAllMoves(segments, pvOptions, maxIterations)` takes a single segment
list and repeatedly picks the cheapest legal move via `planMoves` until
nothing is left to move or nothing more can be done (capped at
`maxIterations`, default 20000; `MAX_PLAN_ITERATIONS` in `index.html` passes
its own cap).

There's no separate move-queue structure: `planMoves` recomputes the pending
set on every call by filtering `segment.shouldBeMoved()` - `performMove`
already keeps the target fields correctly subdivided across split pieces, so
nothing needs to be tracked by hand between iterations. Strategies only
*describe* their moves (`{ moves: [...] }`); nothing is executed during the
search - only the winning attempt's moves are replayed (and thereby
validated) through `performMove`.

The strategies, in tier order:

1. `directMove2` - move straight into free space that overlaps the segment's
   target; always tried first.
2. `clearTargetAndLand2` and `directMoveViaFree2` compete in one tier:
   - `clearTargetAndLand2` stages *every* blocker out of the segment's
     target range (splitting them across several free holes if needed) and
     lands the freed prefix of the segment in the same attempt. Bundling the
     clear and the landing keeps in-flight chunks from being whittled down
     into ever-smaller pieces by lone partial landings.
   - `directMoveViaFree2` relocates one blocking extent "indirectly" into
     free space elsewhere. The blocker can itself be a pending segment (e.g.
     two segments mutually occupying each other's target, as in a straight
     swap) - `findBlockingExtent` doesn't exempt pending segments, since
     refusing to ever shuffle one aside would leave that kind of cycle
     permanently stuck. When the unblocked segment can't direct-move into
     the hole this stage opens up (e.g. local moves are banned on its PV, so
     it too must route through staging), the stage is capped at half the
     remaining staging capacity - otherwise the plan deadlocks with
     everything parked and nowhere left to stage.

   Letting a large fresh staging move pre-empt a small clear-and-land keeps
   the staging granularity from collapsing to the smallest chunk in flight;
   the small chunks still land promptly through `directMove2` whenever their
   target frees up.
3. `swapMoveWithHalfFree2` - chains blocker-to-free,
   segment-to-blocker's-spot, blocker-to-segment's-old-spot in one attempt;
   rarely the winning strategy, but stays available as a fallback tier.

Each strategy is tried against every queue entry (`pickLongest`), and
attempts are ranked by `betterAttempt`: lowest cost per extent moved first
(`calculateMoveCost` prices same-PV "local" moves at 3x cross-PV moves),
ties broken by the *largest* attempt - ranking by total cost instead would
systematically favour the smallest possible move each iteration and explode
the move count.

Search helpers (`findFreeOverlap`/`findBlockingExtent`/
`findLargestFreeSpace`/`eligibleFreeHoles`) go through `segmentIndex`, a
per-PV, position-sorted view of the segment list memoized per array in a
`WeakMap` - `performMove` returns a fresh array per executed move, so a
stale index is never reused.

`pvOptions` (per-PV `indirectAllowed`/`localAllowed`/`splitAllowed`/
`maxIndirectSize`) constrains which PVs can be used as indirect staging
space or split mid-move, and comes straight from the UI checkboxes
(`buildPvOptions` in `index.html`).

### Browser/UI layer

`pvs.js` only holds `parsePVSReport`. `ui.js` renders parsed segments as
draggable `.extent` divs grouped by PV, reorders them via SortableJS (loaded
from a CDN), and holds small DOM helpers including `dumpPVs()`/`setPVs()`.

Each LV extent's `dataset.pv_name`/`pv_start` stay frozen at its real,
on-load position; `dataset.target_pv_name`/`target_pv_start` track its
current DOM slot (recomputed by `updatePVs()` on every reorder). The
`.moved` CSS class marks when the two differ - and only then does
`dumpPVs()` include that extent's target fields at all.

The inline script in `index.html` wires up the full flow: parse the pasted
`pvs` JSON, read the DOM's current (possibly user-dragged) extent order back
out via `dumpPVs()`, bridge that drag intent onto the real, untouched
segment list via `Segment.scheduleMove` (`buildPlanSegments`), run the
planner, replay every planned move through `performMove` to capture
intermediate states for the move-by-move visualization slider, and finally
emit `pvmove` shell commands.

`setPVs(segments, restoreTarget)` renders a segment list: `restoreTarget`
(only used to restore a saved drag arrangement from `lvm_user_json`) places
each extent at `segment.target_pv_name`/`target_pv_start`; every other
caller (fresh parse, move-by-move snapshots) omits it so extents render at
their real, current position - snapshot segments carry `target_pv_name` too,
but that's the lib's planned-destination, not a DOM slot.

Settings and the last-loaded/edited report persist to `localStorage`.

## Notes

- `tests.js` at the repo root is leftover from an earlier architecture (its
  companion `extents.js` no longer exists) and is not loaded by `index.html`
  or referenced by any test runner - don't treat it as current.
- Test fixtures in `tests/fixtures/*.json` have the shape
  `{ segments, pv_options }`, where segments needing a move already carry
  `target_pv_name`/`target_pv_start`. A raw `buildDebugState()` dump
  (`{ source, target, pv_options }`) also works - `tests/run.js` reads
  `segments || source`, so pasting the "Debug State"/"Copy State" output
  from `index.html` straight into a fixture file works. `tests/run.js` runs
  `planAllMoves` on each fixture and checks every targeted segment's LV
  range ends up fully and contiguously at its target position.
- `target_pv_name`/`target_pv_start` mean two related but distinct things
  depending on who produced the segment: on `dumpPVs()` output it's a DOM
  slot (where the user dragged the extent to); everywhere else (lib output,
  fixtures, `Segment.scheduleMove`) it's the planned final destination. They
  coincide for the common case (bridging a drag into a plan), but don't
  assume one always implies the other - see `setPVs`'s `restoreTarget` flag.
