// Segment (defined in lib/segment.js, loaded before this file) models one extent range and
// owns the subdivide/find/move-state primitives; this file only sequences those into
// one atomic move.

// Shared globally (also relied on by pvs.js's parsePVSReport): fresh-parsed segments
// never carry target_pv_name, so this simpler position model is compatible there too.
function orderSegments(segments) {
  const lvs = {};

  segments.sort((a, b) => {
    const ret = a.pv_name.localeCompare(b.pv_name);
    if (ret !== 0) return ret;
    return a.pv_start - b.pv_start;
  });

  // Reduce segments
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    if (prev.segtype !== curr.segtype) continue;
    if (prev.pv_name !== curr.pv_name) continue;
    if (prev.pv_start + prev.pv_size !== curr.pv_start) continue;
    if (prev.lv_name !== curr.lv_name) continue;

    if (prev.lv_name && prev.lv_start + prev.lv_size !== curr.lv_start) continue;

    if (prev.target_pv_name !== curr.target_pv_name) continue;
    if (prev.target_pv_name !== undefined && prev.target_pv_start + prev.pv_size !== curr.target_pv_start) continue;

    // Merge
    prev.pv_size += curr.pv_size;
    if (prev.lv_name) {
      prev.lv_size = prev.pv_size;
    }
    segments.splice(i, 1);
    i--;
  }

  segments.forEach(segment => {
    if (!segment.lv_name) return;
    if (!lvs[segment.lv_name])
      lvs[segment.lv_name] = [];
    lvs[segment.lv_name].push(segment);
  });
  for (const lv in lvs) {
    lvs[lv].sort((a, b) => a.lv_start - b.lv_start);
    lvs[lv].forEach((seg, i) => {
      if (!seg.index)
        seg.lv_index = i + 1;
    });
  }
  return segments;
}

// `performMove` is this file's only other name.
//
// Clones `segments` up front so the caller's array/objects are never mutated - callers
// don't need to (and shouldn't) pass in their own defensive clone.
function performMove(segments, move, type) {
  segments = Segment.clone(segments);

  const { source_pv_name, source_pv_start, target_pv_name, target_pv_start, size } = move;

  function assertNoOverlaps(segments) {
    const byPv = {};
    for (const segment of segments) {
      (byPv[segment.pv_name] = byPv[segment.pv_name] || []).push(segment);
    }

    for (const pv_name in byPv) {
      const list = byPv[pv_name].slice().sort((a, b) => a.pv_start - b.pv_start);
      for (let i = 1; i < list.length; i++) {
        if (list[i - 1].pv_start + list[i - 1].pv_size > list[i].pv_start) {
          throw new Error(
            `performMove produced overlapping segments on ${pv_name}: ` +
            `[${list[i - 1].pv_start},${list[i - 1].pv_start + list[i - 1].pv_size}) and ` +
            `[${list[i].pv_start},${list[i].pv_start + list[i].pv_size})`
          );
        }
      }
    }
  }

  const sourceSegment = Segment.find(segments, source_pv_name, source_pv_start, size, false);
  const targetSegment = Segment.find(segments, target_pv_name, target_pv_start, size, true);

  if (!sourceSegment || !targetSegment) {
    throw new Error(
      `Failed to find segments for move ${JSON.stringify({ source_pv_name, source_pv_start, target_pv_name, target_pv_start, size, type })}: ` +
      `source=${JSON.stringify(sourceSegment)} target=${JSON.stringify(targetSegment)}`
    );
  }

  const source = sourceSegment.subdivide(source_pv_start, size);
  const target = targetSegment.subdivide(target_pv_start, size);

  if (!source || !target) {
    throw new Error(
      `Failed to split segments for move ${JSON.stringify({ source_pv_name, source_pv_start, target_pv_name, target_pv_start, size, type })}: ` +
      `source=${JSON.stringify(sourceSegment)} target=${JSON.stringify(targetSegment)}`
    );
  }

  segments.push(...source.output);
  segments.push(...target.output);

  target.middle.segtype = source.middle.segtype;
  target.middle.lv_name = source.middle.lv_name;
  target.middle.lv_start = source.middle.lv_start;
  target.middle.lv_size = source.middle.lv_size;
  target.middle.lv_index = source.middle.lv_index;
  if (source.middle.name !== undefined) target.middle.name = source.middle.name;
  if (type !== undefined) target.middle.move_type = type;
  if (source.middle.target_pv_name !== undefined) {
    target.middle.target_pv_name = source.middle.target_pv_name;
    target.middle.target_pv_start = source.middle.target_pv_start;
  } else {
    delete target.middle.target_pv_name;
    delete target.middle.target_pv_start;
  }

  source.middle.segtype = 'free';
  delete source.middle.lv_name;
  delete source.middle.lv_start;
  delete source.middle.lv_size;
  delete source.middle.lv_index;
  delete source.middle.name;
  delete source.middle.move_type;
  delete source.middle.target_pv_name;
  delete source.middle.target_pv_start;
  delete source.middle.pending;
  delete source.middle.complete;

  segments.push(source.middle);
  segments.push(target.middle);

  const result = orderSegments(segments);
  result.forEach(segment => segment.updateMoveState());
  assertNoOverlaps(result);
  return result;
}
