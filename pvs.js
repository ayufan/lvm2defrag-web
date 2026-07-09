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
