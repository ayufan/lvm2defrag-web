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
    const ret = a.pv_name.localeCompare(b.pv_name);
    if (ret !== 0) return ret;
    return a.pv_start - b.pv_start;
  });
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
