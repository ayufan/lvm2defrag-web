let loadedReport = [];

function resetPVs() {
  const container = document.getElementById('pvContainer');
  container.innerHTML = '';
}

function enumPVElems() {
  return document.getElementsByClassName('pv-lvs');
}

function createOrUpdatePV(pvName) {
  const pvId = `pv-${safeId(pvName)}`;

  let list = document.getElementById(pvId);
  if (!list) {
    const container = document.getElementById('pvContainer');

    const div = document.createElement('div');
    div.className = 'pv';
    div.innerHTML = `
      <h3>${pvName}</h3>
      <label><input type="checkbox" class="use-split" data-pv="${pvName}" checked /> Allow to split segments</label><br/>
      <label><input type="checkbox" class="use-local" data-pv="${pvName}" /> Accept local moves</label><br/>
      <label><input type="checkbox" class="use-indirect" data-pv="${pvName}" checked /> Accept indirect moves</label><br/>
      <button onclick="sortPVSegments('${pvName}')" style="font-size: 12px; padding: 2px 6px;">Sort Segments</button>
      <hr/>
    `;

    list = document.createElement('div');
    list.id = pvId;
    list.className = 'pv-lvs';
    list.dataset.pv_name = pvName;

    div.appendChild(list);
    container.appendChild(div);

    // Add event listeners to checkboxes for persistence
    div.querySelector('.use-indirect').addEventListener('change', saveSettings);
    div.querySelector('.use-local').addEventListener('change', saveSettings);
    div.querySelector('.use-split').addEventListener('change', saveSettings);

    list.sortable = new Sortable(list, {
      group: 'segments',
      animation: 150,
      onEnd: evt => {
        const item = evt.item;
        const pv_size = parseInt(item.dataset.pv_size);

        const nextEl = item.previousElementSibling || item.nextElementSibling;
        let freeSpace = 0;
        for (let el = nextEl; el; el = el.nextElementSibling) {
          if (el.dataset.lv_name)
            break;
          freeSpace += parseInt(el.dataset.pv_size);
        }

        document.getElementById('errorMessage').innerText = '';

        if (pv_size > freeSpace) {
          if (evt.from == evt.to) {
            updatePVs();
            saveUserJSON();
            return;
          }
          document.getElementById('errorMessage').innerText = '❌ Not enough free space';
          evt.from.insertBefore(item, evt.from.children[evt.oldIndex]);
          return;
        }

        let left_size = pv_size;
        for (let el = nextEl; el && left_size > 0; el = el.nextElementSibling) {
          if (el.dataset.lv_name)
            break;
          const size = parseInt(el.dataset.pv_size);
          if (left_size > size) {
            el.dataset.pv_size = 0;
            left_size -= size;
          } else {
            el.dataset.pv_size = size - left_size;
            left_size = 0;
          }
        }

        createLVFreeSegment(
          item.dataset.target_pv_name,
          parseInt(item.dataset.target_pv_start),
          pv_size - left_size);
        updatePVs();
        saveUserJSON();
      }
    });
  }

  return list;
}

function updatePVs() {
  for (const elem of enumPVElems()) {
    const pv_name = elem.dataset.pv_name;
    let pv_start = 0;

    for (let i = 0; i < elem.children.length; i++) {
      let ext = elem.children[i];
      let pv_size = parseInt(ext.dataset.pv_size);

      ext.dataset.target_pv_start = pv_start;
      ext.dataset.target_pv_name = pv_name;

      if (ext.dataset.lv_name) {
        if (ext.dataset.pv_name !== pv_name || parseInt(ext.dataset.pv_start) !== pv_start) {
          ext.classList.add('moved');
        } else {
          ext.classList.remove('moved');
        }
      } else {
        ext.dataset.pv_start = pv_start;
        ext.dataset.pv_name = pv_name;

        if (i != 0 && !elem.children[i-1].dataset.lv_name) {
          ext.remove();
          ext = elem.children[i-1];
          ext.dataset.pv_size = parseInt(ext.dataset.pv_size) + pv_size;
          i--;
        } else if (pv_size <= 0) {
          ext.remove();
          i--;
        }
        ext.innerText = `free:${ext.dataset.pv_size}`;
      }

      pv_start += pv_size;
    }
  }
}

function insertLVtoPV(pvName, item) {
  const list = createOrUpdatePV(pvName);
  const target_pv_start = parseInt(item.dataset.target_pv_start);
  for(const d of list.children) {
    if (parseInt(d.dataset.target_pv_start) > target_pv_start) {
      list.insertBefore(item, d);
      return;
    }
  }
  list.appendChild(item);
}

function createLVFreeSegment(pvName, pv_start, pv_size) {
  const d = document.createElement('div');
  d.className = 'segment free';
  d.innerText = `free:${pv_size}`;
  d.draggable = false;
  d.dataset.segtype = 'free';
  d.dataset.pv_start = pv_start;
  d.dataset.pv_size = pv_size;
  d.dataset.pv_name = pvName;
  d.dataset.target_pv_name = pvName;
  d.dataset.target_pv_start = pv_start;
  insertLVtoPV(pvName, d);
}

// `targetPvName`/`targetPvStart` control where this segment is inserted into the DOM
// (its visual slot) - independent of segment.target_pv_name/target_pv_start, which is
// the lib's planned-destination concept. Callers restoring a saved drag arrangement
// pass the saved slot; callers rendering a real position (fresh parse, move-by-move
// snapshots) omit them so the segment lands at its own current pv_name/pv_start.
function createLVSegment(pvName, segment, targetPvName = null, targetPvStart = null) {
  const lv_name = segment.lv_name;
  const start_pe = parseInt(segment.lv_start);
  const lv_size = parseInt(segment.lv_size);
  const pv_start = parseInt(segment.pv_start);
  const pv_size = parseInt(segment.pv_size);
  const lv_index = parseInt(segment.lv_index);

  targetPvName = targetPvName || pvName;
  targetPvStart = targetPvStart !== null ? targetPvStart : pv_start;

  const d = document.createElement('div');
  d.className = 'segment';
  d.innerText = `${lv_name} #${lv_index}:${pv_size}`;
  d.style.borderLeftColor = hashColor(lv_name);
  d.style.background = hashColor(lv_name);
  d.draggable = true;
  d.dataset.segtype = segment.segtype;
  d.dataset.lv_name = lv_name;
  d.dataset.lv_start = start_pe;
  d.dataset.lv_size = lv_size;
  d.dataset.pv_name = segment.pv_name;
  d.dataset.pv_start = pv_start;
  d.dataset.pv_size = pv_size;
  d.dataset.target_pv_name = targetPvName;
  d.dataset.target_pv_start = targetPvStart;
  d.dataset.lv_index = lv_index;
  insertLVtoPV(targetPvName, d);
}

function dumpPVs() {
  const output = [];

  for (const pvElem of enumPVElems()) {
    for (const el of pvElem.children) {
      const segment = {
        segtype: el.dataset.segtype,
        pv_name: el.dataset.pv_name,
        pv_start: parseInt(el.dataset.pv_start),
        pv_size: parseInt(el.dataset.pv_size)
      };

      // Add additional data for LV segments to enable proper restoration. target_pv_name/
      // target_pv_start (the segment's current DOM slot) are only included when it's
      // actually `.moved` - a pristine dump (nothing dragged) must carry no target
      // fields at all, since it doubles as Segment.scheduleMove's untouched baseline
      // and scheduleMove rejects segments that already have a target set.
      if (el.dataset.lv_name) {
        segment.lv_index = el.dataset.lv_index;
        segment.lv_name = el.dataset.lv_name;
        segment.lv_start = parseInt(el.dataset.lv_start);
        segment.lv_size = parseInt(el.dataset.lv_size);

        if (el.classList.contains('moved')) {
          segment.target_pv_name = el.dataset.target_pv_name;
          segment.target_pv_start = parseInt(el.dataset.target_pv_start);
        }
      }

      output.push(segment);
    }
  }

  return output;
}

function sortPVSegments(pvName) {
  const list = document.getElementById(`pv-${safeId(pvName)}`);
  if (!list) return;

  for (let i = 1; i < list.children.length; i++) {
    const el = list.children[i];
    const el_lv_name = el.dataset.lv_name;
    const el_lv_start = parseInt(el.dataset.lv_start);
    let same_prev_lv = false;

    for (let j = 0; j < i; j++) {
      const prev = list.children[j];
      const prev_lv_name = prev.dataset.lv_name;
      const prev_lv_start = parseInt(prev.dataset.lv_start);

      const same_lv = el_lv_name === prev_lv_name;

      // Move before the first segment with a higher start or after the same LV
      if (same_lv ? el_lv_start < prev_lv_start : same_prev_lv) {
        list.insertBefore(el, prev);
        break;
      }

      same_prev_lv = same_lv;
    }
  }

  // Update PV positions and save state
  updatePVs();
  saveUserJSON();
}

// `restoreTarget` re-inserts LV segments at their saved DOM slot (segment.target_pv_name/
// target_pv_start) - only correct for restoring a previously dumped drag arrangement
// (dumpPVs() output round-tripped through localStorage). Real segment lists (fresh
// parses, move-by-move simulation snapshots) also carry target_pv_name/target_pv_start
// - the lib's planned-destination, not a DOM slot - so those must render at the
// segment's own current pv_name/pv_start instead, which is the default.
function setPVs(segments, restoreTarget = false) {
  resetPVs();
  for (const segment of segments) {
    if (segment.segtype !== 'free') {
      if (restoreTarget) {
        createLVSegment(segment.pv_name, segment, segment.target_pv_name, segment.target_pv_start);
      } else {
        createLVSegment(segment.pv_name, segment);
      }
    } else {
      createLVFreeSegment(segment.pv_name, segment.pv_start, segment.pv_size);
    }
  }
  updatePVs();
  restoreSettings();
}
