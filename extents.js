class ExtentSet {
  constructor(set = "") {
    this.extents = []; // Array of { start, size }
    this.set = set;
    this.indirectAllowed = true; // Allow indirect moves by default
    this.localAllowed = true; // Allow local moves by default
    this.splitAllowed = true; // Allow splitting extents by default
  }

  // Add and immediately merge
  add(start, size) {
    if (size <= 0) return;
    this.extents.push({ start, size });
    this.merge();
  }

  addExtents(extents) {
    for (const ext of extents) {
      this.add(ext.start, ext.size);
    }
  }

  // Remove a region from extents
  remove(start, size) {
    if (size <= 0) return { start: 0, size: 0 };

    const end = start + size;

    for (let i = 0; i < this.extents.length; i++) {
      let ext = this.extents[i];
      const extEnd = ext.start + ext.size;

      if (extEnd < start)
        continue; // extent ends before the range to remove
      if (start < ext.start)
        break; // failure, as we have no more extents to check
      if (end > extEnd)
        return false; // failure, as we cannot remove more than the extent size

      if (end < extEnd) {
        const newExt = {
          start: end,
          size: extEnd - end
        };
        this.extents.splice(i + 1, 0, newExt);
      }

      if (start === ext.start) {
        this.extents.splice(i, 1);
      } else {
        ext.size = start - ext.start;
      }

      return { start: start, size: size, set: this.set };
    }

    return false; // no extent found to remove
  }

  // Check if a range is used (overlaps any extent)
  isUsed(start, size) {
    const end = start + size;
    for (const ext of this.extents) {
      const extStart = ext.start;
      const extEnd = ext.start + ext.size;
      if (start < extEnd && end > extStart) {
        return true;
      }
    }
    return false;
  }

  findOverlap(start, size) {
    if (size <= 0) return null;

    for (const ext of this.extents) {
      const overlapStart = Math.max(ext.start, start);
      const overlapEnd = Math.min(ext.start + ext.size, start + size);

      if (overlapStart < ext.start + ext.size && overlapEnd > ext.start) {
        return {
          start: overlapStart,
          end: overlapEnd,
          size: overlapEnd - overlapStart,
          isStart: overlapStart == start,
          isEnd: overlapEnd == start + size
        };
      }
    }
    return null;
  }

  // First-fit allocation
  find(size) {
    for (let i = 0; i < this.extents.length; i++) {
      const ext = this.extents[i];
      if (ext.size >= size) {
        return { ...ext, set: this.set };
      }
    }
    return null;
  }

  // Sort and merge adjacent/overlapping extents
  merge() {
    if (this.extents.length <= 1) return;

    this.extents.sort((a, b) => a.start - b.start);

    for (let i = 1; i < this.extents.length; ) {
      const prev = this.extents[i - 1];
      const next = this.extents[i];

      if (prev.start + prev.size < next.start) {
        i++;
        continue;
      }

      prev.size = Math.max(prev.size, next.start + next.size - prev.start);
      this.extents.splice(i, 1);
    }
  }

  totalSize() {
    return this.extents.reduce((sum, e) => sum + e.size, 0);
  }

  // Debug
  dump(label = "") {
    console.log(`${label} extents (${this.set}):`);
    for (const ext of this.extents) {
      console.log(`  [${ext.start}, ${ext.start + ext.size})`);
    }
  }
}

class ExtentSetsWithNames {
  constructor() {
    this.extentSets = {}; // Map of name to ExtentSet
  }

  set(name) {
    name = name || '';
    return this.extentSets[name] || (this.extentSets[name] = new ExtentSet(name));
  }

  add(name, start, size) {
    return this.set(name).add(start, size);
  }

  addExtents(extents) {
    for (const ext of extents) {
      this.add(ext.from_set, ext.from_start, ext.size);
    }
  }

  remove(name, start, size) {
    return this.set(name).remove(start, size);
  }

  isUsed(name, start, size) {
    return this.set(name).isUsed(start, size);
  }

  findOverlap(name, start, size) {
    return this.set(name).findOverlap(start, size);
  }

  find(name, size, selectedSets = null) {
    for (const setName in this.extentSets) {
      if (setName === name) continue; // skip the target set
      if (selectedSets && !selectedSets.includes(setName)) continue; // skip if not in selected sets
      const found = this.extentSets[setName].find(size);
      if (found) return found;
    }
    if (selectedSets && !selectedSets.includes(name))
      return null; // No suitable extent found
    return this.set(name).find(size);
  }

  merge(name) {
    return this.set(name).merge();
  }

  dump(label = '') {
    for (const name in this.extentSets) {
      this.extentSets[name].dump(label);
    }
  }
}
