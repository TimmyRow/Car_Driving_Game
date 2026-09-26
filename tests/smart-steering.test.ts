import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSimulation,
  type Controls,
  type Vehicle,
} from "../src/simulation";
import { smartControls } from "../src/smart-steering";
import { TRACKS, selectTrack, sampleTrack } from "../src/track";

const idle: Controls = {
  steer: 0,
  throttle: false,
  brake: false,
  nitro: false,
};
const assist = (car: Vehicle, input = idle, lane = 0) =>
  smartControls(car, input, true, sampleTrack(car.distance).curvature, lane);

test("Smart Steering yields to manual steering and braking, leaves off inputs unchanged, and never spends nitro itself", () => {
  const car = { offset: 7, speed: 80, yaw: 0.15, drifting: false };
  assert.deepEqual(smartControls(car, idle, false, 0.003), idle);
  assert.equal(smartControls(car, idle, true, 0.003).throttle, true);
  assert.equal(smartControls(car, idle, true, 0.003).nitro, false);
  for (const steer of [-1, 1]) {
    assert.equal(
      smartControls(car, { ...idle, steer }, true, 0.003).steer,
      steer,
    );
  }
  assert.deepEqual(
    smartControls(car, { ...idle, brake: true, nitro: true }, true, 0.003),
    { ...idle, brake: true },
  );
});

for (const track of TRACKS) {
  test(`${track.name}: zero-button driving finishes a complete lap without hitting a barrier`, async () => {
    selectTrack(track.id);
    const sim = await createSimulation();
    try {
      sim.reset("time-trial", "pro", 1);
      sim.start();
      let settledError = 0;
      for (
        let frame = 0;
        frame < 100 * 60 && sim.phase !== "finished";
        frame++
      ) {
        sim.step(1 / 60, assist(sim.player));
        assert.ok(Math.abs(sim.player.offset) < 7.9);
        assert.equal(sim.player.crashTimer, 0);
        if (sim.elapsed > 4)
          settledError = Math.max(settledError, Math.abs(sim.player.offset));
      }
      assert.equal(sim.phase, "finished");
      assert.ok(settledError < 0.1, `center error ${settledError}`);
    } finally {
      sim.dispose();
      selectTrack("riviera");
    }
  });

  test(`${track.name}: two assisted humans finish with delayed guest observations and independent lanes`, async () => {
    selectTrack(track.id);
    const sim = await createSimulation();
    try {
      sim.resetOnline(
        [
          { name: "HOST", color: "#f05b27" },
          { name: "GUEST", color: "#12b7c1" },
        ],
        1,
      );
      sim.start();
      const history = Array.from({ length: 6 }, () => ({ ...sim.rivals[0] }));
      for (let frame = 0; frame < 100 * 60 && !sim.raceComplete; frame++) {
        const observed = history.shift()!;
        history.push({ ...sim.rivals[0] });
        sim.stepOnline(1 / 60, [
          assist(sim.player, idle, 2.8),
          assist(observed, idle, -2.8),
        ]);
        assert.equal(sim.collisionEvents.length, 0);
      }
      assert.equal(sim.raceComplete, true);
      for (const driver of sim.getOnlineSnapshot().drivers) {
        assert.equal(driver.dnf, false);
        assert.ok(driver.finishTime && driver.finishTime > 30);
      }
    } finally {
      sim.dispose();
      selectTrack("riviera");
    }
  });
}

test("releasing manual steering near either barrier returns to the road on all routes", async () => {
  for (const track of TRACKS)
    for (const side of [-1, 1]) {
      selectTrack(track.id);
      const sim = await createSimulation();
      try {
        sim.reset("time-trial", "pro", 1);
        sim.start();
        for (let frame = 0; frame < 9 * 60; frame++)
          sim.step(1 / 60, assist(sim.player));
        for (
          let frame = 0;
          frame < 4 * 60 && sim.player.offset * side < 6.8;
          frame++
        )
          sim.step(
            1 / 60,
            assist(sim.player, { ...idle, steer: side, nitro: true }),
          );
        assert.ok(sim.player.offset * side >= 6.8);
        for (let frame = 0; frame < 4 * 60; frame++) {
          sim.step(1 / 60, assist(sim.player));
          assert.ok(
            Math.abs(sim.player.offset) < 7.9,
            `${track.id}, side ${side}, offset ${sim.player.offset}`,
          );
        }
        assert.ok(Math.abs(sim.player.offset) < 0.2);
      } finally {
        sim.dispose();
        selectTrack("riviera");
      }
    }
});
