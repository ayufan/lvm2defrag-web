// Segment: one extent of a PV, either free space or part of an LV. Fields:
// {segtype, pv_name, pv_start, pv_size, lv_name?, lv_start?, lv_size?, lv_index?,
// target_pv_name?, target_pv_start?, pending?, complete?}. pv_name/pv_start is always
// the extent's real, current position. target_pv_name/target_pv_start, when present,
// is the extent's ultimate intended position; pending and complete are derived from
// comparing the two and are recomputed by updateMoveState, never set directly.

class Segment {
  constructor(data) {
    Object.assign(this, data);
    this.updateMoveState();
  }

  static clone(segments) {
    return segments.map(segment => new Segment(segment));
  }

  // Finds and removes the first segment on `pv_name` that fully contains
  // [pv_start, pv_start + pv_size); `free` selects free vs occupied space.
  static find(segments, pv_name, pv_start, pv_size, free) {
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.pv_name !== pv_name) continue;
      if (free ? segment.lv_name : !segment.lv_name) continue;

      if (pv_start >= segment.pv_start && pv_start + pv_size <= segment.pv_start + segment.pv_size) {
        segments.splice(i, 1);
        return segment;
      }
    }

    return null;
  }

  // Subdivides whichever occupied segment(s) on `pv_name` cover [pv_start, pv_start +
  // pv_size) - which may span more than one segment - and assigns each carved-out slice
  // a target_pv_name/target_pv_start offset to match its position within the range.
  // Mutates `segments` in place (same find-and-splice-back shape as `find`) and returns
  // the newly-targeted slices, in range order. Throws if the range isn't fully covered
  // by occupied segments (gaps, free space, or running past the end), or if any covering
  // segment already has a target_pv_name/target_pv_start (scheduling it twice).
  static scheduleMove(segments, pv_name, pv_start, pv_size, target_pv_name, target_pv_start) {
    const rangeEnd = pv_start + pv_size;
    const scheduled = [];
    let covered = pv_start;

    while (covered < rangeEnd) {
      const index = segments.findIndex(seg =>
        seg.pv_name === pv_name && seg.lv_name && seg.pv_start <= covered && seg.pv_start + seg.pv_size > covered
      );

      if (index === -1) {
        throw new Error(
          `scheduleMove range not fully covered by occupied segments ` +
          `${JSON.stringify({ pv_name, pv_start, pv_size, target_pv_name, target_pv_start })}: stuck at ${covered}`
        );
      }

      const segment = segments[index];

      if (segment.target_pv_name !== undefined || segment.target_pv_start !== undefined) {
        throw new Error(
          `Segment ${segment.pv_name}:${segment.pv_start} already has a target_pv_name/target_pv_start set ` +
          `(${segment.target_pv_name}:${segment.target_pv_start})`
        );
      }

      segments.splice(index, 1);

      const sliceStart = covered;
      const sliceEnd = Math.min(rangeEnd, segment.pv_start + segment.pv_size);
      const split = segment.subdivide(sliceStart, sliceEnd - sliceStart);

      if (!split) {
        throw new Error(
          `Failed to subdivide segment for scheduleMove ${JSON.stringify({ pv_name, pv_start, pv_size, target_pv_name, target_pv_start })}`
        );
      }

      split.middle.target_pv_name = target_pv_name;
      split.middle.target_pv_start = target_pv_start + (sliceStart - pv_start);
      split.middle.updateMoveState();

      segments.push(...split.output);
      segments.push(split.middle);
      scheduled.push(split.middle);

      covered = sliceEnd;
    }

    return scheduled;
  }

  clone() {
    return new Segment({ ...this });
  }

  isFree() {
    return !this.lv_name;
  }

  shouldBeMoved() {
    return !this.isFree()
      && this.target_pv_name !== undefined
      && this.target_pv_start !== undefined
      && (this.pv_name !== this.target_pv_name || this.pv_start !== this.target_pv_start);
  }

  updateMoveState() {
    if (this.target_pv_name === undefined || this.target_pv_start === undefined) {
      delete this.pending;
      delete this.complete;
      return this;
    }

    if (this.pv_name === this.target_pv_name && this.pv_start === this.target_pv_start) {
      this.complete = true;
      delete this.pending;
    } else {
      this.pending = true;
      delete this.complete;
    }

    return this;
  }

  // Carves [pv_start, pv_start + pv_size) out of this segment, returning
  // { middle, output } where middle is the requested slice and output holds the 0-2
  // leftover before/after slivers. Returns null if the range isn't fully contained.
  subdivide(pv_start, pv_size) {
    if (pv_start < this.pv_start || this.pv_start + this.pv_size < pv_start + pv_size) {
      return null;
    }

    const output = [];
    const middle = this.clone();

    if (pv_start > this.pv_start) {
      if (middle.lv_size !== undefined && middle.lv_size !== middle.pv_size) {
        return null;
      }
      const before = middle.clone();
      before.pv_size = pv_start - this.pv_start;
      if (before.lv_size !== undefined)
        before.lv_size = before.pv_size;
      middle.pv_size -= before.pv_size;
      middle.pv_start += before.pv_size;
      if (middle.lv_start !== undefined)
        middle.lv_start += before.pv_size;
      if (middle.lv_size !== undefined)
        middle.lv_size -= before.pv_size;
      if (middle.target_pv_start !== undefined)
        middle.target_pv_start += before.pv_size;
      output.push(before);
    }

    if (pv_start + pv_size < this.pv_start + this.pv_size) {
      if (middle.lv_size !== undefined && middle.lv_size !== middle.pv_size) {
        return null;
      }
      const after = middle.clone();
      after.pv_start = pv_start + pv_size;
      after.pv_size = (this.pv_start + this.pv_size) - after.pv_start;
      if (after.lv_size !== undefined)
        after.lv_size = after.pv_size;
      if (after.lv_start !== undefined)
        after.lv_start += pv_size;
      if (after.target_pv_start !== undefined)
        after.target_pv_start += pv_size;
      middle.pv_size -= after.pv_size;
      if (middle.lv_size !== undefined)
        middle.lv_size -= after.pv_size;
      output.push(after);
    }

    middle.updateMoveState();
    output.forEach(segment => segment.updateMoveState());

    return { middle, output };
  }
}
