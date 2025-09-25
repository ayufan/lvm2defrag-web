function parsePVSReport(report) {
  const input = JSON.parse(report);
  const entries = input.report[0].pv;
  const output = [];

  entries.forEach(entry => {
    const segment = {
      segtype: entry.segtype,
      pv_name: entry.pv_name,
      pv_start: entry.pvseg_start,
      pv_size: entry.pvseg_size
    };

    if (entry.segtype !== 'free') {
      segment.lv_name = entry.lv_name;
      segment.lv_start = entry.seg_start_pe;
      segment.lv_size = entry.seg_size_pe;
      segment.lv_index = entry.lv_index;
    }

    output.push(segment);
  });

  return orderSegments(output);
}

function orderSegments(segments) {
  const lvs = {};

  segments.sort((a, b) => {
    const pv_name_a = a.moved_pv_name || a.pv_name;
    const pv_name_b = b.moved_pv_name || b.pv_name;
    const ret = pv_name_a.localeCompare(pv_name_b);
    if (ret !== 0) return ret;

    const pv_start_a = a.moved_pv_start || a.pv_start;
    const pv_start_b = b.moved_pv_start || b.pv_start;
    return pv_start_a - pv_start_b;
  });

  // Reduce segments
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    if (prev.segtype !== curr.segtype) continue;
    if (prev.pv_name !== curr.pv_name) continue;
    if (prev.pv_start + prev.pv_size !== curr.pv_start) continue;
    if (prev.lv_name !== curr.lv_name) continue;
    if (prev.lv_start + prev.pv_size !== curr.lv_start) continue;

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
  for(const lv in lvs) {
    lvs[lv].sort((a, b) => a.lv_start - b.lv_start);
    lvs[lv].forEach((seg, i) => {
      if (!seg.index)
        seg.lv_index = i + 1;
    });
  }
  return segments;
}

function findSegment(segments, pv_name, pv_start, pv_size, free) {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const seg_pv_name = segment.moved_pv_name || segment.pv_name;
    const seg_pv_start = segment.moved_pv_start || segment.pv_start;
    if (seg_pv_name !== pv_name) continue;

    if (free ? segment.lv_name : !segment.lv_name) {
      continue;
    }

    if (pv_start >= seg_pv_start && pv_start + pv_size <= seg_pv_start + segment.pv_size) {
      segments.splice(i, 1);
      return segment;
    }
  }

  return null;
}

function splitSegment(segment, pv_name, pv_start, pv_size) {
  const seg_pv_name = segment.pv_name;
  const seg_pv_start = segment.pv_start;

  if (seg_pv_name !== pv_name) {
    return null;
  }

  // Do not subdivide segments
  if (pv_start < seg_pv_start || seg_pv_start + segment.pv_size < pv_start + pv_size) {
    return null;
  }

  const output = [];
  const middle = {...segment};

  middle.moved_pv_name = null;
  middle.moved_pv_start = null;

  if (pv_start > seg_pv_start) {
    const before = {...middle};
    before.pv_size = pv_start - seg_pv_start;
    middle.pv_size -= before.pv_size;
    middle.pv_start += before.pv_size;
    if (middle.lv_start)
      middle.lv_start += before.pv_size;
    output.push(before);
  }

  if (pv_start + pv_size < seg_pv_start + segment.pv_size) {
    const after = {...middle};
    after.pv_start = pv_start + pv_size;
    after.pv_size = (seg_pv_start + segment.pv_size) - after.pv_start;
    if (after.lv_start)
      after.lv_start += pv_size;
    middle.pv_size -= after.pv_size;
    output.push(after);
  }

  return { middle, output };
}

function moveSegment(segments, move) {
  const sourceSegment = findSegment(segments, move.from_set, move.from_start, move.size, false);
  const targetSegment = findSegment(segments, move.to_set, move.to_start, move.size, true);

  if (!sourceSegment || !targetSegment) {
    return null;
  }

  const source = splitSegment(sourceSegment, move.from_set, move.from_start, move.size);
  const target = splitSegment(targetSegment, move.to_set, move.to_start, move.size);

  if (!source || !target) {
    return null;
  }

  segments.push(...source.output);
  segments.push(...target.output);

  target.middle.segtype = source.middle.segtype;
  target.middle.lv_name = source.middle.lv_name;
  target.middle.lv_start = source.middle.lv_start;
  target.middle.lv_index = source.middle.lv_index;
  target.middle.name = source.middle.name;

  source.middle.segtype = 'free';
  source.middle.lv_name = null;
  source.middle.lv_start = null;
  source.middle.lv_index = null;
  source.middle.name = null;

  segments.push(source.middle);
  segments.push(target.middle);

  return orderSegments(segments);
}
