class ExtentSet {
  constructor(set = "") {
    this.extents = []; // Array of { start, size }
    this.set = set;
    this.indirectAllowed = true; // Allow indirect moves by default
    this.localAllowed = true; // Allow local moves by default
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

function planMoves(extentsToMove, freeSets, usedSets = new ExtentSetsWithNames()) {
  function directMove(extent, freeSets, usedSets) {
    let { from_set, from_start, size, to_start, to_set } = extent;

    if (from_set == to_set && !freeSets.set(to_set).localAllowed) {
      return { move: null, newExtent: null }; // Cannot move locally if local moves are not allowed
    }

    const overlap = freeSets.findOverlap(to_set, to_start, size);
    if (!overlap)
      return { move: null, newExtent: null }; // No free space to move

    // Make first move to be direct
    if (overlap.isStart != overlap.isEnd && !extent.partial) {
      extent.partial = true; // Mark as partial if not already
      return { move: null, newExtent: extent }; // Cannot move if the extent is not partial
    }

    newExtent = { ...extent };

    if (overlap.isStart) {
      newExtent.from_start += overlap.size; // Adjust the start position of the extent
      newExtent.to_start += overlap.size; // Adjust the target start position
      newExtent.size -= overlap.size; // Reduce the size of the extent
    } else if (overlap.isEnd) {
      newExtent.size -= overlap.size; // Reduce the size of the extent
      from_start += overlap.size; // Adjust the start position of the extent
      to_start += overlap.size; // Adjust the target start position
    } else {
      return { move: null, newExtent: null }; // Cannot move if the overlap is not at the start or end
    }

    if (newExtent.size <= 0) {
      newExtent = null; // No size left to move
    }

    // Re-add the extent to the free set
    usedSets.remove(from_set, from_start, overlap.size);
    freeSets.add(from_set, from_start, overlap.size);

    // Re-add the extent to the used set at the target location
    freeSets.remove(to_set, to_start, overlap.size);
    usedSets.add(to_set, to_start, overlap.size);

    const move = {
      from_set,
      from_start,
      to_set,
      to_start,
      size: overlap.size,
      name: extent.name,
      type: overlap.size == extent.size ? 'full' : 'partial',
      extent
    };

    return { move, newExtent };
  }

  function indirectMove(extent, freeSets, usedSets) {
    const { from_set, from_start, size, to_start, to_set, moved } = extent;

    if (moved) {
      return null; // Already moved, skip further processing
    }

    const selectedSets = [];
    for (const setName in freeSets.extentSets) {
      const set = freeSets.extentSets[setName];
      if (set.indirectAllowed && setName !== from_set || set.localAllowed && setName === from_set) {
        selectedSets.push(setName);
      }
    }

    if (selectedSets.includes(to_set) && !usedSets.isUsed(to_set, to_start, size)) {
      return null;
    }

    const found = freeSets.find(to_set, size, selectedSets);
    if (!found) {
      return null;
    }

    // Update the extent to point to the new location
    extent.from_set = found.set;
    extent.from_start = found.start;
    extent.moved = true;

    // Re-add the extent to the free set
    usedSets.remove(from_set, from_start, size);
    freeSets.add(from_set, from_start, size);

    // Re-add the extent to the used set at the found location
    usedSets.add(extent.from_set, extent.from_start, size);
    freeSets.remove(extent.from_set, extent.from_start, size);

    return {
      from_set,
      from_start,
      to_set: extent.from_set,
      to_start: extent.from_start,
      size,
      name: extent.name,
      type: 'indirect',
      extent: extent
    };
  }

  function subdivideExtentsByFrom(queue) {
    const splitOffsets = {}; // map of names to start positions

    for (const ext of queue) {
      const { from_set, from_start } = ext;
      splitOffsets[from_set] = splitOffsets[from_set] || [];
      splitOffsets[from_set].push(from_start);
    }

    // remove duplicates and sort
    for (const set in splitOffsets) {
      splitOffsets[set] = [...new Set(splitOffsets[set])].sort((a, b) => a - b);
    }

    for (let i = 0; i < queue.length; i++) {
      const ext = queue[i];
      const { to_set, to_start, size } = ext;
      let splits = 0;

      for (const split of (splitOffsets[to_set] || [])) {
        if (split <= to_start)
          continue;
        if (to_start + size < split)
          break; // no more splits to consider

        const beforeSplit = { ...ext, size: split - to_start, name: `${ext.name} s${splits}` };
        ext.from_start += beforeSplit.size;
        ext.to_start += beforeSplit.size;
        ext.size -= beforeSplit.size;

        queue.splice(i, 0, beforeSplit);
        i++;
        splits++;
      }

      if (splits > 0) {
        ext.name = `${ext.name} s${splits}`;
      }
    }
  }

  function subdivideExtentsByTo(queue) {
    const splitOffsets = {}; // map of names to start positions

    for (const ext of queue) {
      const { to_set, to_start } = ext;
      splitOffsets[to_set] = splitOffsets[to_set] || [];
      splitOffsets[to_set].push(to_start);
    }

    // remove duplicates and sort
    for (const set in splitOffsets) {
      splitOffsets[set] = [...new Set(splitOffsets[set])].sort((a, b) => a - b);
    }

    for (let i = 0; i < queue.length; i++) {
      const ext = queue[i];
      const { from_set, from_start, size } = ext;
      let splits = 0;

      for (const split of (splitOffsets[from_set] || [])) {
        if (split <= from_start)
          continue;
        if (from_start + size < split)
          break; // no more splits to consider

        const beforeSplit = { ...ext, size: split - from_start, name: `${ext.name} s${splits}` };
        ext.from_start += beforeSplit.size;
        ext.to_start += beforeSplit.size;
        ext.size -= beforeSplit.size;

        queue.splice(i, 0, beforeSplit);
        i++;
        splits++;
      }

      if (splits > 0) {
        ext.name = `${ext.name} s${splits}`;
      }
    }
  }

  function logMoveCommand(when, move, freeSets, usedSets) {
    console.log(`\n[${when}] Moved ${move.type} '${move.name}' -> ${move.from_set}[${move.from_start}, ${move.from_start+move.size}) -> ${move.to_set}[${move.to_start}, ${move.to_start+move.size})`);
    freeSets.dump(`[${when}] Free`);
    usedSets.dump(`[${when}] Used`);
  }

  const queue = [...extentsToMove];
  const moves = [];
  const indirectMoves = [];
  const missedMoves = [];

  for (const ext of extentsToMove) {
    usedSets.add(ext.from_set, ext.from_start, ext.size);
  }

  // subdivideExtentsByFrom(queue); // Subdivide extents to allow for more granular moves
  // subdivideExtentsByTo(queue); // Subdivide extents to allow for more granular moves

  while (queue.length > 0) {
    let retry = false;

    // Process many direct queue
    while (queue.length > 0) {
      const extent = queue.pop();
      const { move, newExtent } = directMove(extent, freeSets, usedSets);
      if (!move) {
        indirectMoves.push(extent);
        continue;
      }

      if (newExtent) {
        indirectMoves.push(newExtent);
      }

      logMoveCommand("Direct", move, freeSets, usedSets);
      moves.push(move);
      retry = true; // we made a move, so we might have new opportunities
    }

    indirectMoves.sort((a, b) => a.size - b.size); // Sort indirect queue by start position

    // Process indirect queue
    while (!retry && indirectMoves.length > 0) {
      const extent = indirectMoves.pop();
      const move = indirectMove(extent, freeSets, usedSets);
      if (!move) {
        missedMoves.push(extent);
        continue;
      }
      logMoveCommand("Indirect", move, freeSets, usedSets);
      moves.push(move);
      indirectMoves.push(extent); // re-add the moved extent to partialMoves
      retry = true; // we made a move, so we might have new opportunities
      break; // break to re-evaluate the queue
    }

    if (retry) {
      queue.push(...indirectMoves); // retry with the remaining indirectMoves
      queue.push(...missedMoves); // retry with the remaining missedMoves
      indirectMoves.length = 0; // clear indirectMoves for the next round
      missedMoves.length = 0; // clear missedMoves for the next round
    }
  }

  if (indirectMoves.length > 0) {
    console.warn("Some extents could not be moved directly or indirectly:");
    for (const ext of indirectMoves) {
      console.warn(`  [${ext.from_set} ${ext.from_start}, ${ext.from_start + ext.size}) -> [${ext.to_set} ${ext.to_start}, ${ext.to_start + ext.size})`);
    }
  }

  if (missedMoves.length > 0) {
    console.warn("Some extents could not be moved at all:");
    for (const ext of missedMoves) {
      console.warn(`  [${ext.from_set} ${ext.from_start}, ${ext.from_start + ext.size}) -> [${ext.to_set} ${ext.to_start}, ${ext.to_start + ext.size})`);
    }
  }

  const failedMoves = [...indirectMoves, ...missedMoves];

  return { moves, failedMoves };
}

module.exports = {
  ExtentSet,
  ExtentSetsWithNames,
  planMoves
}
