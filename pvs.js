let pvOrder = [];
let loadedReport = [];

function resetPVs() {
  const container = document.getElementById('pvContainer');
  container.innerHTML = '';
  pvOrder = [];
}

function createOrUpdatePV(pvName) {
  const pvId = `pv-${safeId(pvName)}`;

  let list = document.getElementById(pvId);
  if (!list) {
    if (!pvOrder.includes(pvName)) {
      pvOrder.push(pvName);
    }

    const container = document.getElementById('pvContainer');

    const div = document.createElement('div');
    div.className = 'pv';
    div.innerHTML = `
      <h3>${pvName}</h3>
      <label><input type="checkbox" class="use-indirect" data-pv="${pvName}" checked /> Use for indirect moves</label><br/>
      <label><input type="checkbox" class="use-local" data-pv="${pvName}" /> Allow for local moves</label><br/>
      <label><input type="checkbox" class="use-split" data-pv="${pvName}" /> Allow to split extents</label><br/>
      <button onclick="sortPVExtents('${pvName}')" style="font-size: 12px; padding: 2px 6px;">Sort Extents</button>
      <hr/>
    `;

    list = document.createElement('div');
    list.id = pvId;
    list.dataset.pv = pvName;

    div.appendChild(list);
    container.appendChild(div);

    new Sortable(list, {
      group: 'extents',
      animation: 150,
      onEnd: evt => {
        const item = evt.item;
        const pv_size = parseInt(item.dataset.pv_size);

        const nextEl = item.previousElementSibling || item.nextElementSibling;
        let freeSpace = 0;
        for (let el = nextEl; el; el = el.nextElementSibling) {
          if (el.dataset.lv_name)
            continue;
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
            continue;
          const size = parseInt(el.dataset.pv_size);
          if (left_size > size) {
            el.dataset.pv_size = 0;
            left_size -= size;
          } else {
            el.dataset.pv_size = size - left_size;
            left_size = 0;
          }
        }

        createLVFreeExtent(
          item.dataset.moved_pv_name,
          parseInt(item.dataset.moved_pv_start),
          pv_size - left_size);
        updatePVs();
        saveUserJSON();
      }
    });
  }

  return list;
}

function updatePVs() {
  pvOrder.forEach(pv => {
    const list = document.getElementById(`pv-${safeId(pv)}`);
    let pv_start = 0;

    for (let i = 0; i < list.children.length; i++) {
      let ext = list.children[i];
      let pv_size = parseInt(ext.dataset.pv_size);

      ext.dataset.moved_pv_start = pv_start;
      ext.dataset.moved_pv_name = pv;

      if (ext.dataset.lv_name) {
        if (ext.dataset.pv_name !== pv || parseInt(ext.dataset.pv_start) !== pv_start) {
          ext.classList.add('moved');
        } else {
          ext.classList.remove('moved');
        }
      } else {
        if (i != 0 && !list.children[i-1].dataset.lv_name) {
          ext.remove();
          ext = list.children[i-1];
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
  });
}

function insertLVtoPV(pvName, item) {
  const list = createOrUpdatePV(pvName);
  const moved_pv_start = parseInt(item.dataset.moved_pv_start);
  for(const d of list.children) {
    if (parseInt(d.dataset.moved_pv_start) > moved_pv_start) {
      list.insertBefore(item, d);
      return;
    }
  }
  list.appendChild(item);
}

function createLVFreeExtent(pvName, pv_start, pv_size) {
  const d = document.createElement('div');
  d.className = 'extent free';
  d.innerText = `free:${pv_size}`;
  d.draggable = false;
  d.dataset.segtype = 'free';
  d.dataset.pv_start = pv_start;
  d.dataset.pv_size = pv_size;
  d.dataset.pv_name = pvName;
  d.dataset.moved_pv_name = pvName;
  d.dataset.moved_pv_start = pv_start;
  insertLVtoPV(pvName, d);
}

function createLVExtent(pvName, extent, movedPvName = null, movedPvStart = null) {
  const start_pe = parseInt(extent.seg_start_pe);
  const size_pe = parseInt(extent.seg_size_pe);
  const pv_start = parseInt(extent.pvseg_start);
  const pv_size = parseInt(extent.pvseg_size);
  const index = parseInt(extent.index);

  movedPvName = movedPvName || pvName;
  movedPvStart = movedPvStart !== null ? movedPvStart : pv_start;

  const list = createOrUpdatePV(pvName);
  const d = document.createElement('div');
  d.className = 'extent';
  d.innerText = `${extent.lv_name} #${index}:${size_pe}`;
  d.style.borderLeftColor = hashColor(extent.lv_name);
  d.style.background = hashColor(extent.lv_name);
  d.draggable = true;
  d.dataset.segtype = extent.segtype;
  d.dataset.lv_name = extent.lv_name;
  d.dataset.lv_start = start_pe;
  d.dataset.lv_size = size_pe;
  d.dataset.pv_name = extent.pv_name;
  d.dataset.pv_start = pv_start;
  d.dataset.pv_size = pv_size;
  d.dataset.moved_pv_name = movedPvName;
  d.dataset.moved_pv_start = movedPvStart;
  d.dataset.index = index;
  insertLVtoPV(movedPvName, d);
}

function dumpPVs() {
  const output = [];

  pvOrder.forEach(pvName => {
    const list = document.getElementById(`pv-${safeId(pvName)}`);
    for (const el of list.children) {
      const item = {
        lv_name: el.dataset.lv_name || null,
        pv_name: el.dataset.pv_name,
        pv_start: parseInt(el.dataset.pv_start),
        pv_size: parseInt(el.dataset.pv_size),
        moved_pv_name: el.dataset.moved_pv_name,
        moved_pv_start: parseInt(el.dataset.moved_pv_start)
      };

      // Add additional data for LV extents to enable proper restoration
      if (el.dataset.lv_name) {
        item.extent = {
          segtype: el.dataset.segtype,
          seg_start_pe: el.dataset.lv_start,
          seg_size_pe: el.dataset.lv_size,
          pvseg_start: el.dataset.pv_start,
          pvseg_size: el.dataset.pv_size,
          index: el.dataset.index,
          lv_name: el.dataset.lv_name,
          pv_name: el.dataset.pv_name
        };
      }

      output.push(item);
    }
  });

  return output;
}

function sortPVExtents(pvName) {
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

      // Move before the first extent with a higher start or after the same LV
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
