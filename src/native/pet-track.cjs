'use strict';
// Ramo Pet — the tracker.
//
// Phase 4. Once the detector has found the thing and the model has picked it,
// there is no reason for the model to look at the screen again every frame.
// This file owns the box while the pet is showing it:
//
//   pick (VLM)  ->  track (detector alone)  ->  the mark follows the thing
//
// The VLM wakes only on a lost or changed target: track loss, a mismatched
// class, a low-confidence streak or a bigger jump than any motion error
// explains. Until then, no model call happens.
//
// The tracker is deliberately small. It is a two-stage IoU match (high and
// low confidence detections) with a velocity estimate, a grace period that
// keeps the box alive while the target is out of view, and linear
// interpolation for the frames in between. Every number is deterministic, so
// this file can be checked without a screen or a model.

const HIGH = 0.3;   // detections at or above this are real candidates
const LOW = 0.1;    // between LOW and HIGH, the track believes them, not a new object

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (overlap <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - overlap;
  return union > 0 ? overlap / union : 0;
}

function centreOf(box) {
  return {x: box.x + box.w / 2, y: box.y + box.h / 2};
}

// A single track. The seed is the detector's own box for the picked target,
// in the capture's pixels, plus the class the target was picked as.
class Track {
  constructor(seed, id) {
    this.id = id;
    this.cls = seed.cls;
    this.box = {x: seed.x, y: seed.y, w: seed.w, h: seed.h};
    this.vx = 0;
    this.vy = 0;
    this.conf = seed.conf || 1;
    this.seen = 1;
    this.lostMs = 0;
    this.lowStreak = 0;
    this.lastSeenAt = seed.now;
    this.startedAt = seed.now;
    this.lastMatchedAt = seed.now;
    this.lastPolygon = Array.isArray(seed.polygon) ? seed.polygon : null;
    this.classesSeen = new Map([[seed.cls, 1]]);
    this.events = [];
  }

  ageMs(now) {
    return now - this.startedAt;
  }

  // The box the target was last where the detector saw it, moved forward by
  // what the target was doing since.
  predicted(now) {
    const dt = (now - this.lastSeenAt) / 1000;
    if (!(dt > 0)) return {...this.box};
    return {
      x: this.box.x + this.vx * dt,
      y: this.box.y + this.vy * dt,
      w: this.box.w,
      h: this.box.h
    };
  }
}

// The tracker itself. One decision per update(): the box to draw (or none),
// and whether the VLM has to be woken.
class Tracker {
  // options:
  //   graceMs        how long the box survives on motion prediction alone
  //   wakeLossMs     a track lost for longer than this wakes the model
  //   wakeLowConfs    a streak of this many low-confidence frames wakes it
  //   wakeDriftIou    a match worse than this wakes it (the target moved too far)
  constructor(seed, id, options = {}) {
    this.track = new Track(seed, id || 1);
    this.graceMs = Math.max(100, Number(options.graceMs) || 500);
    this.wakeLossMs = Math.max(500, Number(options.wakeLossMs) || 1000);
    this.wakeLowConfs = Math.max(2, Number(options.wakeLowConfs) || 3);
    this.wakeDriftIou = Number.isFinite(options.wakeDriftIou) ? options.wakeDriftIou : 0.3;
    this.wakeClassMismatch = options.wakeClassMismatch !== false;
    this.wake = null;
  }

  // One frame. `detections` are {x, y, w, h, conf, cls, polygon} in capture
  // pixels. `now` is a timestamp in ms.
  update(detections, now) {
    this.wake = null;
    const track = this.track;
    const predicted = track.predicted(now);
    const dt = (now - track.lastSeenAt) / 1000;

    // Stage 1: high-confidence detections against the predicted box.
    const high = [];
    const low = [];
    for (const det of detections || []) {
      if (!det || !(det.w > 0) || !(det.h > 0)) continue;
      if (det.conf >= HIGH) high.push(det);
      else if (det.conf >= LOW) low.push(det);
    }
    const bestOf = (pool, gate) => {
      let best = null;
      let score = -1;
      for (const det of pool) {
        const box = {x: det.x, y: det.y, w: det.w, h: det.h};
        const overlap = iou(predicted, box);
        if (overlap < gate) continue;
        // Overlap first, confidence as the tie-breaker.
        const key = overlap * 2 + det.conf;
        if (key > score) { score = key; best = {det, box, overlap}; }
      }
      return best;
    };
    let match = bestOf(high, 0.1);
    const fromLow = !match;
    if (!match) match = bestOf(low, 0.1);
    if (!match) {
      // Nothing found. The box survives on the motion estimate for the grace
      // period, interpolated between where it was last seen and where the
      // motion says it must be by now.
      track.lostMs = now - track.lastMatchedAt;
      if (track.lostMs > this.wakeLossMs) {
        this.wake = 'lost';
        return this.state(false, predicted, now);
      }
      if (track.lostMs > this.graceMs) {
        // Between the grace period and the wake period, the mark is drawn
        // from the prediction alone.
        return this.state(true, predicted, now, {predicted: true, interpolated: dt > 0});
      }
      return this.state(true, predicted, now, {predicted: true, interpolated: dt > 0});
    }
    const box = match.box;
    const conf = match.det.conf;
    const cls = match.det.cls;
    if (Array.isArray(match.det.polygon)) track.lastPolygon = match.det.polygon;
    if (match.overlap < this.wakeDriftIou) this.wake = this.wake || 'drift';
    if (this.wakeClassMismatch && cls !== track.cls) {
      track.classesSeen.set(cls, (track.classesSeen.get(cls) || 0) + 1);
      if ((track.classesSeen.get(cls) || 0) >= 3) this.wake = this.wake || 'class-change';
    }
    if (conf < HIGH) {
      track.lowStreak += 1;
      if (track.lowStreak >= this.wakeLowConfs) this.wake = this.wake || 'low-confidence';
    } else {
      track.lowStreak = 0;
    }
    // The velocity is measured between successive sightings, smoothed so one
    // imperfect frame does not fling the mark across the screen.
    if (dt > 0) {
      const vx = (box.x + box.w / 2 - (track.box.x + track.box.w / 2)) / dt;
      const vy = (box.y + box.h / 2 - (track.box.y + track.box.h / 2)) / dt;
      track.vx = track.vx * 0.6 + vx * 0.4;
      track.vy = track.vy * 0.6 + vy * 0.4;
    }
    track.box = box;
    track.conf = conf;
    track.seen += 1;
    track.lostMs = 0;
    track.lastSeenAt = now;
    track.lastMatchedAt = now;
    // Interpolated position for the overlay when the sighting came from a
    // lower-confidence pass.
    return this.state(true, box, now, {lowConfidence: fromLow, interpolated: false, overlap: match.overlap, conf});
  }

  state(visible, box, now, extra = {}) {
    return {
      visible,
      box: visible ? box : null,
      conf: this.track.conf,
      cls: this.track.cls,
      polygon: Array.isArray(this.track.lastPolygon) ? this.track.lastPolygon : null,
      trackId: this.track.id,
      lostMs: this.track.lostMs,
      seen: this.track.seen,
      wake: this.wake,
      ...extra
    };
  }
}

module.exports = {
  Track,
  Tracker,
  iou,
  HIGH,
  LOW
};
