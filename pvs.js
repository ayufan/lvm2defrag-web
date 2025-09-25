function parsePVSReport(report) {
  const input = JSON.parse(report);
  const entries = input.report[0].pv;
  const lvSegments = {};

  entries.sort((a, b) => {
    const ret = a.pv_name.localeCompare(b.pv_name);
    if (ret !== 0) return ret;
    return parseInt(a.pvseg_start) - parseInt(b.pvseg_start);
  });

  entries.forEach(entry => {
    if (!entry.lv_name) return;
    if (!lvSegments[entry.lv_name])
      lvSegments[entry.lv_name] = [];
    lvSegments[entry.lv_name].push(entry);
  });
  for(const lv in lvSegments) {
    lvSegments[lv].sort((a, b) => a.seg_start_pe - b.seg_start_pe);
    lvSegments[lv].forEach((seg, i) => {
      seg.index = i + 1;
    });
  }

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
      segment.index = entry.index;
    }

    output.push(segment);
  });

  return output;
}
