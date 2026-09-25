import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRACKS,
  activeTrack,
  getTrack,
  selectTrack,
  trackLength,
  trackPoints,
  sampleTrack,
  roadHalfWidth,
} from "../src/track";
import { createSimulation, type Simulation } from "../src/simulation";

const input = { steer: 0, throttle: true, brake: false, nitro: false };
function finish(sim: Simulation) {
  sim.start();
  const limit = Math.ceil(((trackLength * sim.totalLaps) / 45 + 25) * 60);
  for (let frame = 0; frame < limit && sim.phase !== "finished"; frame++) {
    sim.step(1 / 60, input);
    assert.ok(
      Number.isFinite(sim.player.distance) &&
        Number.isFinite(sim.player.offset),
    );
    if (sim.player.distance < trackLength * sim.totalLaps)
      assert.equal(sim.player.finished, false);
  }
  assert.equal(sim.phase, "finished");
  assert.equal(sim.player.distance, trackLength * sim.totalLaps);
  assert.equal(sim.lap, sim.totalLaps);
  assert.ok(sim.elapsed > (trackLength * sim.totalLaps) / 115);
  assert.ok(sim.lastLap > 0 && sim.bestLap > 0);
}

test("all larger circuits are finite, closed, continuous and expose correct live sampling", () => {
  try {
    assert.deepEqual(
      TRACKS.map((track) => track.id),
      ["riviera", "canyon", "alpine"],
    );
    for (const track of TRACKS) {
      assert.ok(track.length > 3000 && track.length < 5000);
      selectTrack(track.id);
      assert.equal(activeTrack, track);
      assert.equal(trackLength, track.length);
      assert.equal(trackPoints, track.points);
      assert.equal(getTrack(track.id), track);
      const first = track.sample(0),
        last = track.sample(track.length);
      assert.ok(
        Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) <
          0.00001,
      );
      for (let i = -1; i <= 256; i++) {
        const distance = (i * track.length) / 256;
        const center = sampleTrack(distance),
          before = sampleTrack(distance - 1),
          after = sampleTrack(distance + 1);
        assert.ok(Object.values(center).every(Number.isFinite));
        assert.ok(
          Math.abs(center.curvature) * roadHalfWidth < 1,
          "road edge folds over inside a tight turn",
        );
        const tangent = Math.atan2(after.x - before.x, after.z - before.z);
        assert.ok(
          Math.abs(
            Math.atan2(
              Math.sin(tangent - center.heading),
              Math.cos(tangent - center.heading),
            ),
          ) < 0.03,
        );
        const wrapped = track.sample(distance + track.length);
        assert.ok(
          Math.hypot(
            center.x - wrapped.x,
            center.y - wrapped.y,
            center.z - wrapped.z,
          ) < 0.00001,
        );
        const left = sampleTrack(distance, -roadHalfWidth),
          right = sampleTrack(distance, roadHalfWidth);
        assert.ok(
          Math.abs(
            Math.hypot(left.x - right.x, left.z - right.z) - roadHalfWidth * 2,
          ) < 0.00001,
        );
        assert.ok(
          Math.hypot(
            after.x - before.x,
            after.y - before.y,
            after.z - before.z,
          ) < 2.1,
        );
      }
    }
  } finally {
    selectTrack("riviera");
  }
});

test("one-lap career races finish correctly on every selected circuit", async () => {
  try {
    for (const track of TRACKS) {
      selectTrack(track.id);
      const sim = await createSimulation();
      try {
        sim.reset("race", "rookie", 1);
        assert.equal(sim.totalLaps, 1);
        assert.equal(sim.rivals.length, 5);
        finish(sim);
        assert.equal(sim.elapsed, sim.lastLap);
        const result = sim.elapsed;
        sim.step(0.1, input);
        assert.equal(sim.elapsed, result);
      } finally {
        sim.dispose();
      }
    }
  } finally {
    selectTrack("riviera");
  }
});

test("lap selection survives restart, mode defaults reset it, and three-lap progress finishes exactly", async () => {
  selectTrack("riviera");
  const sim = await createSimulation();
  try {
    sim.reset("race", "pro", 1);
    sim.reset();
    assert.equal(sim.totalLaps, 1);
    sim.reset("race");
    assert.equal(sim.totalLaps, 2);
    sim.reset("time-trial", "rookie", 3);
    sim.reset();
    assert.equal(sim.totalLaps, 3);
    finish(sim);
    assert.equal(sim.player.distance, trackLength * 3);
    assert.equal(sim.rivals.length, 0);
    sim.reset("time-trial");
    assert.equal(sim.totalLaps, 1);
  } finally {
    sim.dispose();
    selectTrack("riviera");
  }
});
