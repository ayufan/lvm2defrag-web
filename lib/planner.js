// Projects `segments` (e.g. dumpPVs() output, where target_pv_name/target_pv_start is
// the extent's current DOM slot) onto what the layout would look like if every extent
// actually reached that slot - a UI debug preview, not something the planner consumes.
function buildTargetReport(segments) {
  return segments.map(seg => {
    if (!seg.lv_name || seg.target_pv_name === undefined) return seg;

    return {
      ...seg,
      pv_name: seg.target_pv_name,
      pv_start: seg.target_pv_start,
      target_pv_name: undefined,
      target_pv_start: undefined,
    };
  });
}

function pvOption(pvOptions, set) {
  const opts = (pvOptions && pvOptions[set]) || {};
  return {
    indirectAllowed: opts.indirectAllowed !== undefined ? opts.indirectAllowed : true,
    localAllowed: opts.localAllowed !== undefined ? opts.localAllowed : true,
    splitAllowed: opts.splitAllowed !== undefined ? opts.splitAllowed : true,
    maxIndirectSize: opts.maxIndirectSize || 0,
  };
}

function directAllowed(pvOptions, from_set, to_set) {
  return from_set !== to_set || pvOption(pvOptions, to_set).localAllowed;
}

function makeMove(segment, from_set, from_start, to_set, to_start, size, type) {
  return {
    from_set,
    from_start,
    to_set,
    to_start,
    size,
    type,
    lv_name: segment.lv_name,
    lv_start: segment.lv_start,
    name: `${segment.lv_name}[${segment.lv_start}-${segment.lv_start + segment.lv_size - 1}]`,
  };
}

// Per-PV, position-sorted view of a segment list, memoized per array - performMove
// returns a fresh array for every executed move, so a stale index can never be reused.
// Only valid while the array isn't mutated in place, which holds inside a single
// planMoves iteration.
const segmentIndexCache = new WeakMap();

function segmentIndex(segments) {
  let index = segmentIndexCache.get(segments);
  if (index) return index;

  index = { occupied: {}, freeByPv: {}, free: [] };

  for (const seg of segments) {
    if (seg.isFree()) {
      (index.freeByPv[seg.pv_name] = index.freeByPv[seg.pv_name] || []).push(seg);
      index.free.push(seg);
    } else {
      (index.occupied[seg.pv_name] = index.occupied[seg.pv_name] || []).push(seg);
    }
  }

  for (const set in index.occupied) index.occupied[set].sort((a, b) => a.pv_start - b.pv_start);
  for (const set in index.freeByPv) index.freeByPv[set].sort((a, b) => a.pv_start - b.pv_start);

  segmentIndexCache.set(segments, index);
  return index;
}

// First index in a position-sorted, non-overlapping segment list whose extent ends
// past `start` - the first candidate that could overlap a range starting there.
function firstEndingPast(list, start) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].pv_start + list[mid].pv_size > start) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function findFreeOverlap(segments, set, start, size) {
  const list = segmentIndex(segments).freeByPv[set] || [];

  for (let i = firstEndingPast(list, start); i < list.length; i++) {
    const seg = list[i];
    if (seg.pv_start >= start + size) break;

    const overlapStart = Math.max(seg.pv_start, start);
    const overlapEnd = Math.min(seg.pv_start + seg.pv_size, start + size);

    if (overlapStart < overlapEnd) {
      return {
        start: overlapStart,
        size: overlapEnd - overlapStart,
        isStart: overlapStart === start,
        isEnd: overlapEnd === start + size,
      };
    }
  }

  return null;
}

// A pending segment can still be a blocker: two segments can mutually occupy each
// other's target (e.g. a straight swap), and refusing to ever shuffle a pending segment
// aside would leave that cycle permanently stuck instead of resolving it via indirect
// staging - pickLongest's cost comparison already prefers a segment's own cheap direct
// move over shuffling it aside when both are on the table for a given iteration.
// `avoid` skips `segment`'s own current position (it can't block itself).
function findBlockingExtent(segments, set, start, size, avoid = null) {
  const list = segmentIndex(segments).occupied[set] || [];

  for (let i = firstEndingPast(list, start); i < list.length; i++) {
    const seg = list[i];
    if (seg.pv_start >= start + size) break;
    if (seg === avoid) continue;

    const overlapStart = Math.max(seg.pv_start, start);
    const overlapEnd = Math.min(seg.pv_start + seg.pv_size, start + size);

    if (overlapStart < overlapEnd) {
      return { segment: seg, from_set: seg.pv_name, overlapStart, overlapEnd };
    }
  }

  return null;
}

function findIndirectSpace(segments, size, sourceSet, pvOptions, exclude = null) {
  for (const seg of segmentIndex(segments).free) {
    if (exclude && seg.pv_name === exclude.set) {
      const segEnd = seg.pv_start + seg.pv_size;
      if (seg.pv_start < exclude.end && segEnd > exclude.start) continue;
    }

    const opts = pvOption(pvOptions, seg.pv_name);
    const local = seg.pv_name === sourceSet;

    if (local ? !opts.localAllowed : !opts.indirectAllowed) continue;

    let take = seg.pv_size;
    if (!local && opts.maxIndirectSize) {
      take = Math.min(take, opts.maxIndirectSize);
    }
    take = Math.min(take, size);

    if (take <= 0) continue;
    if (take < size && !opts.splitAllowed) continue;

    return { set: seg.pv_name, start: seg.pv_start, size: take };
  }

  return null;
}

function directMove2(segment, segments, pvOptions) {
  if (!directAllowed(pvOptions, segment.pv_name, segment.target_pv_name)) return null;

  const overlap = findFreeOverlap(segments, segment.target_pv_name, segment.target_pv_start, segment.pv_size);
  if (!overlap) return null;

  if ((!overlap.isStart || !overlap.isEnd) && !pvOption(pvOptions, segment.target_pv_name).splitAllowed) {
    return null;
  }

  const shift = overlap.start - segment.target_pv_start;
  const from_start = segment.pv_start + shift;
  const type = overlap.size === segment.pv_size ? 'full' : 'partial';

  const move = makeMove(segment, segment.pv_name, from_start, segment.target_pv_name, overlap.start, overlap.size, type);

  return { moves: [move] };
}

// Collects every free extent usable as staging space for data currently on
// `sourceSet`, applying the same eligibility rules as findLargestFreeSpace.
function eligibleFreeHoles(segments, sourceSet, pvOptions, exclude) {
  const holes = [];

  for (const seg of segmentIndex(segments).free) {
    if (exclude && seg.pv_name === exclude.set) {
      const segEnd = seg.pv_start + seg.pv_size;
      if (seg.pv_start < exclude.end && segEnd > exclude.start) continue;
    }

    const opts = pvOption(pvOptions, seg.pv_name);
    const local = seg.pv_name === sourceSet;

    if (local ? !opts.localAllowed : !opts.indirectAllowed) continue;

    holes.push({ set: seg.pv_name, start: seg.pv_start, size: seg.pv_size, local, opts });
  }

  return holes;
}

// Clears as much of `segment`'s target range as staging space allows - staging every
// blocker in range order, possibly splitting them across several holes - then lands the
// freed prefix of the segment in a single move. Keeping the clear and the landing in
// one attempt is what stops in-flight chunks from being whittled down: a lone partial
// landing against whatever little space happens to be free splits the chunk, and split
// chunks (whose later stages are capped by their own shrunken size) can never grow back.
function clearTargetAndLand2(segment, segments, pvOptions) {
  if (!directAllowed(pvOptions, segment.pv_name, segment.target_pv_name)) return null;

  const targetStart = segment.target_pv_start;
  const targetEnd = targetStart + segment.pv_size;

  if (segment.pv_name === segment.target_pv_name
    && segment.pv_start < targetEnd && segment.pv_start + segment.pv_size > targetStart) {
    return null;
  }

  const exclude = { set: segment.target_pv_name, start: targetStart, end: targetEnd };
  const holes = eligibleFreeHoles(segments, segment.target_pv_name, pvOptions, exclude);

  const blockers = (segmentIndex(segments).occupied[segment.target_pv_name] || [])
    .filter(seg => seg !== segment
      && seg.pv_start < targetEnd && seg.pv_start + seg.pv_size > targetStart);

  const moves = [];
  let cleared = targetEnd;

  for (const blocker of blockers) {
    let at = Math.max(blocker.pv_start, targetStart);
    const blockerEnd = blocker.pv_start + blocker.pv_size;
    let end = Math.min(blockerEnd, targetEnd);

    while (at < end) {
      // Best fit: the smallest hole that swallows the rest of this blocker in one
      // piece, falling back to the largest hole when a split is unavoidable. Perfect
      // fits keep hole sizes locked to chunk sizes instead of shaving big holes into
      // ever-smaller leftovers.
      let hole = null;
      for (const h of holes) {
        if (h.size >= end - at && (!hole || hole.size < end - at || h.size < hole.size)) hole = h;
        else if (h.size > 0 && (!hole || (hole.size < end - at && h.size > hole.size))) hole = h;
      }

      let take = hole ? Math.min(hole.size, end - at) : 0;
      if (take > 0 && !hole.local && hole.opts.maxIndirectSize) {
        take = Math.min(take, hole.opts.maxIndirectSize);
      }
      if (take <= 0 || (take < end - at && !hole.opts.splitAllowed)) break;

      // Cutting the last blocker at the range end plants a fresh boundary that later
      // costs its own stage+land pair. When its small tail past the range fits in the
      // same hole (bounded by the range width so the staging pool stays balanced) and
      // the blocker has to move anyway, take the whole blocker in this one move.
      if (at + take === targetEnd && blockerEnd > targetEnd && blocker.shouldBeMoved()) {
        const tail = blockerEnd - targetEnd;
        let extended = take + tail;
        if (!hole.local && hole.opts.maxIndirectSize) {
          extended = Math.min(extended, hole.opts.maxIndirectSize);
        }
        if (extended === take + tail && extended <= hole.size
          && tail <= targetEnd - targetStart) {
          take = extended;
          end = blockerEnd;
        }
      }

      moves.push(makeMove(blocker, blocker.pv_name, at, hole.set, hole.start, take, 'indirect'));
      hole.start += take;
      hole.size -= take;
      at += take;
    }

    if (at < Math.min(end, targetEnd)) {
      cleared = at;
      break;
    }
    if (at < end) break;
  }

  const landed = cleared - targetStart;
  if (landed <= 0) return null;
  if (landed < segment.pv_size && !pvOption(pvOptions, segment.target_pv_name).splitAllowed) return null;

  const type = landed === segment.pv_size ? 'full' : 'partial';
  moves.push(makeMove(segment, segment.pv_name, segment.pv_start, segment.target_pv_name, targetStart, landed, type));

  return { moves };
}

function directMoveViaFree2(segment, segments, pvOptions) {
  const blocking = findBlockingExtent(segments, segment.target_pv_name, segment.target_pv_start, segment.pv_size, segment);
  if (!blocking) return null;

  const size = blocking.overlapEnd - blocking.overlapStart;
  const exclude = { set: segment.target_pv_name, start: segment.target_pv_start, end: segment.target_pv_start + segment.pv_size };
  const free = findLargestFreeSpace(segments, size, blocking.from_set, pvOptions, exclude);
  if (!free) return null;

  // Filling the staging space is only safe when `segment` can then direct-move into
  // the hole this stage opens up; when it can't (e.g. local moves are banned on its PV,
  // so it too must route through staging), keep half the space free for its own leg of
  // the trip - otherwise the plan either deadlocks with everything parked and nowhere
  // left to stage, or degrades into slivers of whatever little space was left over.
  const landable = directAllowed(pvOptions, segment.pv_name, segment.target_pv_name);
  if (!landable) {
    const half = Math.floor(free.total / 2);
    if (half > 0 && free.size > half && (half >= size || pvOption(pvOptions, free.set).splitAllowed)) {
      free.size = half;
    }
  }

  const move = makeMove(blocking.segment, blocking.from_set, blocking.overlapStart, free.set, free.start, free.size, 'indirect');

  return { moves: [move] };
}

// Best-fit free space search: unlike findIndirectSpace (first-fit), scans every
// candidate and keeps the largest usable chunk, so a swap can move as much as possible
// in one hop instead of being capped by whichever free extent happens to be found first.
// `total` on the result sums every eligible candidate's raw capacity, so callers can
// tell when the returned chunk would consume the last of the staging space.
function findLargestFreeSpace(segments, size, sourceSet, pvOptions, exclude = null) {
  let best = null;
  let total = 0;

  for (const seg of segmentIndex(segments).free) {
    if (exclude && seg.pv_name === exclude.set) {
      const segEnd = seg.pv_start + seg.pv_size;
      if (seg.pv_start < exclude.end && segEnd > exclude.start) continue;
    }

    const opts = pvOption(pvOptions, seg.pv_name);
    const local = seg.pv_name === sourceSet;

    if (local ? !opts.localAllowed : !opts.indirectAllowed) continue;

    total += seg.pv_size;

    let take = seg.pv_size;
    if (!local && opts.maxIndirectSize) {
      take = Math.min(take, opts.maxIndirectSize);
    }
    take = Math.min(take, size);

    if (take <= 0) continue;
    if (take < size && !opts.splitAllowed) continue;

    if (!best || take > best.size) {
      best = { set: seg.pv_name, start: seg.pv_start, size: take };
    }
  }

  if (best) best.total = total;
  return best;
}

// Chain: blocking -> free, segment -> blocking's old spot, staged blocking -> segment's old spot.
function buildSwapChain(segment, blocking, free) {
  const size = free.size;
  const type = size === segment.pv_size ? 'full' : 'partial';

  const moves = [
    makeMove(blocking.segment, blocking.from_set, blocking.overlapStart, free.set, free.start, size, 'indirect'),
    makeMove(segment, segment.pv_name, segment.pv_start, segment.target_pv_name, blocking.overlapStart, size, type),
    makeMove(blocking.segment, free.set, free.start, segment.pv_name, segment.pv_start, size, 'indirect'),
  ];

  return { moves };
}

function swapMove2(segment, segments, pvOptions) {
  const blocking = findBlockingExtent(segments, segment.target_pv_name, segment.target_pv_start, segment.pv_size, segment);
  if (!blocking) return null;

  if (!directAllowed(pvOptions, segment.pv_name, segment.target_pv_name)) return null;

  const overlapSize = blocking.overlapEnd - blocking.overlapStart;
  const maxSize = Math.min(overlapSize, segment.pv_size);

  const exclude = { set: segment.target_pv_name, start: segment.target_pv_start, end: segment.target_pv_start + segment.pv_size };
  const free = findIndirectSpace(segments, maxSize, blocking.from_set, pvOptions, exclude);
  if (!free) return null;

  if (!directAllowed(pvOptions, free.set, segment.pv_name)) return null;

  return buildSwapChain(segment, blocking, free);
}

// Same chain as swapMove2 (A -> B's spot, B -> free, free -> A's old spot), but picks the
// largest available free space instead of the first fit, so the chain moves the biggest
// chunk it can in a single hop.
function swapMoveWithHalfFree2(segment, segments, pvOptions) {
  const blocking = findBlockingExtent(segments, segment.target_pv_name, segment.target_pv_start, segment.pv_size, segment);
  if (!blocking) return null;

  if (!directAllowed(pvOptions, segment.pv_name, segment.target_pv_name)) return null;

  const overlapSize = blocking.overlapEnd - blocking.overlapStart;
  const maxSize = Math.min(overlapSize, segment.pv_size);

  const exclude = { set: segment.target_pv_name, start: segment.target_pv_start, end: segment.target_pv_start + segment.pv_size };
  const free = findLargestFreeSpace(segments, maxSize, blocking.from_set, pvOptions, exclude);
  if (!free) return null;

  if (!directAllowed(pvOptions, free.set, segment.pv_name)) return null;

  return buildSwapChain(segment, blocking, free);
}

// A local pvmove (same source/dest PV) reshuffles the same disk twice over, so it's
// costed higher per extent than a move that actually relocates data to another PV.
function calculateMoveCost(move) {
  return move.size * (move.from_set === move.to_set ? 3 : 1);
}

// Lowest cost per extent moved wins (so local 3x moves still lose to cross-PV ones),
// ties broken by the largest attempt - comparing total cost instead would
// systematically favour the smallest possible move each iteration and explode the
// move count.
function betterAttempt(attempt, best) {
  if (!best) return true;
  if (attempt.cost * best.size !== best.cost * attempt.size) {
    return attempt.cost * best.size < best.cost * attempt.size;
  }
  return attempt.size > best.size;
}

// Run `strategy` against every pending segment and keep the best successful attempt
// per betterAttempt. Strategies only describe their moves; nothing is executed during
// the search.
function pickLongest(pending, strategy, currentState, ...rest) {
  let best = null;

  for (const segment of pending) {
    const attempt = strategy(segment, currentState, ...rest);
    if (!attempt) continue;

    attempt.cost = attempt.moves.reduce((sum, move) => sum + calculateMoveCost(move), 0);
    attempt.size = attempt.moves.reduce((sum, move) => sum + move.size, 0);

    if (betterAttempt(attempt, best)) {
      best = attempt;
    }
  }

  return best;
}

function executeMoves(segments, moves) {
  for (const move of moves) {
    segments = performMove(segments, {
      source_pv_name: move.from_set, source_pv_start: move.from_start,
      target_pv_name: move.to_set, target_pv_start: move.to_start,
      size: move.size,
    }, move.type);
  }

  return segments;
}

// No separate move queue: pending work is just whichever segments still
// shouldBeMoved(), recomputed fresh from `source` on every call - performMove already
// keeps target_pv_name/target_pv_start (and pending/complete) correctly subdivided
// across split pieces, so there's nothing left to track by hand. Only the winning
// attempt's moves are executed (and thereby validated) via performMove.
function planMoves(source, pvOptions = {}) {
  const pending = source.filter(segment => segment.shouldBeMoved());
  if (pending.length === 0) {
    return { newReport: source, moves: [], final: true };
  }

  // Direct landings commute: each consumes only free space overlapping its own target
  // range, and target ranges of distinct pending segments are disjoint, so every
  // landing available in this state is taken in one iteration instead of burning an
  // iteration per landing (tier 1 would short-circuit until none were left anyway).
  const landings = [];
  for (const segment of pending) {
    const direct = directMove2(segment, source, pvOptions);
    if (direct) landings.push(...direct.moves);
  }
  let attempt = landings.length > 0 ? { moves: landings } : null;

  // clearTargetAndLand2 and directMoveViaFree2 compete in one tier: a large fresh
  // staging chain may pre-empt a small clear-and-land, which keeps the staging
  // granularity from collapsing to the smallest chunk in flight - the small chunks
  // still land promptly through directMove2 whenever their target frees up.
  if (!attempt) {
    attempt = pickLongest(pending, clearTargetAndLand2, source, pvOptions);
    const stage = pickLongest(pending, directMoveViaFree2, source, pvOptions);
    if (stage && (!attempt || betterAttempt(stage, attempt))) attempt = stage;
  }

  if (!attempt) {
    attempt = pickLongest(pending, swapMoveWithHalfFree2, source, pvOptions);
  }

  if (attempt) {
    return { newReport: executeMoves(source, attempt.moves), moves: attempt.moves, final: false };
  }

  return { newReport: source, moves: [], final: true };
}

function planAllMoves(segments, pvOptions = {}, maxIterations = 20000) {
  let report = Segment.clone(segments);
  const moves = [];
  let iterations = 0;
  let final = false;

  while (!final && iterations < maxIterations) {
    const r = planMoves(report, pvOptions);
    report = r.newReport;
    moves.push(...r.moves);
    final = r.final;
    iterations++;
  }

  const finalQueue = report.filter(segment => segment.shouldBeMoved());

  return { finalMoves: moves, finalIterations: iterations, finalReport: report, finalQueue };
}
