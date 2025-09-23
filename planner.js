function overlapScore(extent, freeSets) {
  let { from_set, size, to_start, to_set } = extent;

  if (from_set == to_set && !freeSets.set(to_set).localAllowed)
    return 0;

  const overlap = freeSets.findOverlap(to_set, to_start, size);
  if (!overlap)
    return 0;

  return overlap.size;
}

function directMove(extent, freeSets, usedSets, isStart = true, isEnd = true) {
  let { from_set, from_start, size, to_start, to_set } = extent;

  if (from_set == to_set && !freeSets.set(to_set).localAllowed) {
    return { move: null, newExtents: null }; // Cannot move locally if local moves are not allowed
  }

  const overlap = freeSets.findOverlap(to_set, to_start, size);
  if (!overlap)
    return { move: null, newExtents: null }; // No free space to move

  const newExtents = [];

  if (!overlap.isStart && !overlap.isEnd) {
    if (!isStart || !isEnd || !freeSets.set(to_set).splitAllowed) {
      return { move: null, newExtents: null }; // Cannot split if not allowed
    }
  }

  if (!overlap.isStart) {
    if (!isStart) {
      return { move: null, newExtents: null }; // Cannot split at start if not allowed
    }
    const extentAtStart = { ...extent };
    extentAtStart.size = overlap.start - extent.to_start;
    from_start += extentAtStart.size;
    to_start += extentAtStart.size;
    if (extentAtStart.size > 0) {
      newExtents.push(extentAtStart);
    }
  }

  if (!overlap.isEnd) {
    if (!isEnd) {
      return { move: null, newExtents: null }; // Cannot split at end if not allowed
    }
    const extentAtEnd = { ...extent };
    const overlapMovedSize = overlap.start + overlap.size - extent.to_start;
    extentAtEnd.from_start += overlapMovedSize;
    extentAtEnd.to_start += overlapMovedSize;
    extentAtEnd.size -= overlapMovedSize; // Reduce the size of the extent
    if (extentAtEnd.size > 0) {
      newExtents.push(extentAtEnd);
    }
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

  return { move, newExtents };
}

function indirectMove(extent, freeSets, usedSets) {
  let { from_set, from_start, size, to_start, to_set, moved } = extent;

  if (moved) {
    return { move: null, newExtents: null }; // Already moved, skip further processing
  }

  const selectedSets = [];
  for (const setName in freeSets.extentSets) {
    const set = freeSets.extentSets[setName];
    if (!set.indirectAllowed) continue;
    if (setName !== from_set || set.localAllowed && setName === from_set) {
      selectedSets.push(setName);
    }
  }

  if (selectedSets.includes(to_set) && !usedSets.isUsed(to_set, to_start, size)) {
    return { move: null, newExtents: null };
  }

  const found = freeSets.find(to_set, size, selectedSets) || freeSets.find(to_set, 1024, selectedSets);
  if (!found) {
    return { move: null, newExtents: null };
  }

  const newExtents = [];

  if (found.size < size) {
    size = found.size;
    const extentAtEnd = { ...extent };
    extentAtEnd.from_start += size;
    extentAtEnd.to_start += size;
    extentAtEnd.size -= size;
    newExtents.push(extentAtEnd);
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

  const move = {
    from_set,
    from_start,
    to_set: extent.from_set,
    to_start: extent.from_start,
    size,
    name: extent.name,
    type: 'indirect',
    extent: extent
  };

  newExtents.push(extent);

  return { move, newExtents };
}

function logMoveCommand(when, move, freeSets, usedSets) {
  console.log(`\n[${when}] Moved ${move.type} '${move.name}' -> ${move.from_set}[${move.from_start}, ${move.from_start+move.size}) -> ${move.to_set}[${move.to_start}, ${move.to_start+move.size})`);
  freeSets.dump(`[${when}] Free`);
  usedSets.dump(`[${when}] Used`);
}

function planMoves(extentsToMove, freeSets, usedSets = new ExtentSetsWithNames()) {
  const queue = [...extentsToMove];
  const moves = [];
  const indirectMoves = [];
  const missedMoves = [];

  for (const ext of extentsToMove) {
    usedSets.add(ext.from_set, ext.from_start, ext.size);
  }

  let noDirectMoves = 0;

  while (queue.length > 0) {
    let retry = false;

    queue.sort((a, b) => overlapScore(b, freeSets) - overlapScore(a, freeSets)); // Sort indirect queue by start position

    // Process many direct queue
    while (queue.length > 0) {
      const extent = queue.pop();
      const { move, newExtents } = directMove(extent, freeSets, usedSets);
      if (!move) {
        indirectMoves.push(extent);
        continue;
      }
      if (newExtents) {
        indirectMoves.push(...newExtents);
      }
      logMoveCommand("Direct", move, freeSets, usedSets);
      moves.push(move);
      retry = true;
      noDirectMoves = 0;
    }

    indirectMoves.sort((a, b) => a.size - b.size); // Sort indirect queue by start position

    // Process indirect queue
    while (!retry && indirectMoves.length > 0) {
      const extent = indirectMoves.pop();
      const { move, newExtents } = indirectMove(extent, freeSets, usedSets);
      if (!move) {
        missedMoves.push(extent);
        continue;
      }
      if (newExtents) {
        indirectMoves.push(...newExtents);
      }
      logMoveCommand("Indirect", move, freeSets, usedSets);
      moves.push(move);
      retry = true;
      break; // break to re-evaluate the queue
    }

    if (retry && noDirectMoves <= 2) {
      queue.push(...indirectMoves); // retry with the remaining indirectMoves
      queue.push(...missedMoves); // retry with the remaining missedMoves
      indirectMoves.length = 0; // clear indirectMoves for the next round
      missedMoves.length = 0; // clear missedMoves for the next round
      noDirectMoves++;
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
