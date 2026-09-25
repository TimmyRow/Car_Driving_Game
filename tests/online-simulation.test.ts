import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSimulation,
  type Controls,
  type OnlinePlayer,
  type OnlineSnapshot,
  type Simulation,
  type Vehicle,
} from "../src/simulation";
import { trackLength } from "../src/track";

const players: [OnlinePlayer, OnlinePlayer] = [
  { name: "HOST", color: "#fa633b" },
  { name: "GUEST", color: "#69cced" },
];
const throttle: Controls = {
  steer: 0,
  throttle: true,
  brake: false,
  nitro: false,
};
const stopped: Controls = { ...throttle, throttle: false, brake: true };
const idle: Controls = { ...throttle, throttle: false };
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
function lane(car: Vehicle, offset: number, boost = false): Controls {
  return {
    ...throttle,
    steer: clamp((offset - car.offset) * 0.7),
    nitro: boost,
  };
}
function run(
  sim: Simulation,
  seconds: number,
  inputs: [Controls, Controls],
  dt = 1 / 60,
) {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.stepOnline(dt, inputs);
}
function launch(sim: Simulation) {
  sim.start();
  run(sim, 3, [throttle, throttle]);
  assert.equal(sim.phase, "racing");
}

test("online reset creates two equal human starts and independently obeys both input streams", async () => {
  const sim = await createSimulation();
  try {
    sim.resetOnline(players, 1);
    assert.equal(sim.online, true);
    assert.equal(sim.totalLaps, 1);
    assert.equal(sim.rivals.length, 1);
    assert.equal(sim.player.name, "HOST");
    assert.equal(sim.rivals[0].name, "GUEST");
    assert.equal(sim.player.distance, sim.rivals[0].distance);
    const grid = sim.player.distance;
    run(sim, 1, [throttle, throttle]);
    assert.equal(sim.player.distance, grid);
    sim.start();
    run(sim, 2.5, [throttle, throttle]);
    assert.equal(sim.phase, "countdown");
    assert.equal(sim.rivals[0].distance, grid);
    run(sim, 0.5, [throttle, throttle]);
    run(sim, 4, [idle, throttle]);
    assert.equal(sim.player.distance, grid);
    assert.ok(sim.rivals[0].distance > grid + 100);
    assert.ok(sim.rivals[0].speed > 50);
    run(sim, 2, [throttle, stopped]);
    assert.ok(sim.player.speed > 30);
    assert.ok(
      sim.rivals[0].speed < 1,
      "guest must brake like a human, not resume AI racing",
    );
    assert.equal(sim.getOnlineSnapshot().drivers[1].finishTime, null);
    sim.reset("race");
    assert.equal(sim.online, false);
    assert.equal(sim.raceComplete, false);
    assert.equal(sim.finishGraceRemaining, null);
    assert.equal(sim.rivals.length, 5);
    assert.equal(sim.player.name, "YOU");
  } finally {
    sim.dispose();
  }
});

test("two-human fixed-step trajectories, nitro and separate drift scores agree at 30/60/120 Hz", async () => {
  const simulations = await Promise.all([
    createSimulation(),
    createSimulation(),
    createSimulation(),
  ]);
  try {
    for (let index = 0; index < simulations.length; index++) {
      const sim = simulations[index];
      const dt = [1 / 30, 1 / 60, 1 / 120][index];
      sim.resetOnline(players, 1);
      sim.start();
      run(sim, 3, [throttle, throttle], dt);
      run(sim, 6, [throttle, throttle], dt);
      run(sim, 0.6, [throttle, { ...throttle, steer: -0.6, brake: true }], dt);
      run(
        sim,
        2,
        [
          { ...throttle, nitro: true },
          { ...throttle, nitro: true },
        ],
        dt,
      );
      const snapshot = sim.getOnlineSnapshot();
      assert.equal(snapshot.drivers[0].driftScore, 0);
      assert.ok(snapshot.drivers[1].driftScore > 20);
      assert.ok(
        snapshot.vehicles.every((car) => car.nitro > 0 && car.nitro < 0.6),
      );
    }
    const reference = simulations[0].getOnlineSnapshot();
    for (const sim of simulations.slice(1)) {
      const snapshot = sim.getOnlineSnapshot();
      for (const id of [0, 1] as const) {
        assert.ok(
          Math.abs(
            snapshot.vehicles[id].distance - reference.vehicles[id].distance,
          ) < 0.005,
        );
        assert.ok(
          Math.abs(
            snapshot.vehicles[id].offset - reference.vehicles[id].offset,
          ) < 0.005,
        );
        assert.ok(
          Math.abs(
            snapshot.drivers[id].driftScore - reference.drivers[id].driftScore,
          ) < 0.00001,
        );
      }
    }
  } finally {
    simulations.forEach((sim) => sim.dispose());
  }
});

test("guest hard slam uses shared collisions, rewards and recovery, and snapshots remap only the display", async () => {
  const host = await createSimulation();
  const guest = await createSimulation();
  try {
    host.resetOnline(players, 1);
    launch(host);
    for (
      let frame = 0;
      frame < 12 * 120 &&
      !host.collisionEvents.some((event) => event.kind !== "hit");
      frame++
    ) {
      host.stepOnline(1 / 120, [
        host.elapsed < 3 ? lane(host.player, 3.7) : stopped,
        host.elapsed < 2 ? idle : lane(host.rivals[0], 3.7, true),
      ]);
    }
    const event = host.collisionEvents.find((item) => item.kind !== "hit");
    assert.ok(event, "a fast human guest must be able to slam a braking host");
    assert.equal(event.attackerId, 1);
    assert.equal(event.victimId, 0);
    assert.equal(
      event.kind,
      "wreck",
      "host wire IDs and host-relative event kinds stay stable",
    );
    assert.ok(host.player.crashTimer > 1.5);
    assert.ok(host.rivals[0].speed >= event.speed * 0.959);
    const wire: OnlineSnapshot = JSON.parse(
      JSON.stringify(host.getOnlineSnapshot()),
    );
    assert.equal(wire.drivers[0].takedowns, 0);
    assert.equal(wire.drivers[1].takedowns, 1);
    assert.ok(wire.drivers[1].impact > 0);
    guest.applyOnlineSnapshot(wire, 1);
    assert.equal(guest.player.name, "GUEST");
    assert.equal(guest.player.id, 0);
    assert.equal(guest.rivals[0].id, 1);
    assert.equal(guest.rivals[0].name, "HOST");
    assert.equal(guest.rivals[0].crashTimer, host.player.crashTimer);
    assert.equal(guest.takedowns, 1);
    assert.equal(guest.collisionEvents.at(-1)?.kind, "takedown");
    assert.equal(guest.collisionEvents.at(-1)?.attackerId, 0);
    assert.equal(guest.collisionEvents.at(-1)?.victimId, 1);
    assert.deepEqual(
      guest.getOnlineSnapshot(),
      wire,
      "wire snapshots retain global IDs even in guest view",
    );
    const displayed = JSON.stringify([
      guest.player,
      guest.rivals,
      guest.elapsed,
    ]);
    guest.step(0.25, throttle);
    guest.stepOnline(0.25, [throttle, throttle]);
    assert.equal(
      JSON.stringify([guest.player, guest.rivals, guest.elapsed]),
      displayed,
      "guest display must not simulate another authority",
    );
    wire.vehicles[1].speed = -999;
    wire.drivers[1].takedowns = -999;
    wire.collisionEvents[0].attackerId = 99;
    assert.ok(guest.player.speed > 0);
    assert.equal(guest.getOnlineSnapshot().drivers[1].takedowns, 1);
    assert.equal(host.getOnlineSnapshot().drivers[1].takedowns, 1);
    const crashDistance = host.player.distance;
    run(host, 1, [stopped, throttle]);
    assert.equal(
      host.player.distance,
      crashDistance,
      "visual throw cannot award race progress",
    );
    run(host, 0.7, [stopped, throttle]);
    assert.equal(host.player.crashTimer, 0);
    assert.ok(host.player.invulnerable > 1.2);
    host.resetOnline(players, 2);
    assert.equal(host.collisionEvents.length, 0);
    assert.ok(
      host
        .getOnlineSnapshot()
        .drivers.every(
          (driver) =>
            driver.takedowns === 0 && driver.finishTime === null && !driver.dnf,
        ),
    );
    guest.reset("time-trial");
    launchOffline(guest);
    assert.ok(guest.player.distance > -23, "reset removes display-only mode");
  } finally {
    host.dispose();
    guest.dispose();
  }
});

function launchOffline(sim: Simulation) {
  sim.start();
  for (let frame = 0; frame < 4 * 60; frame++) sim.step(1 / 60, throttle);
}

test("host finishing first leaves the guest racing and records both exact independent finish times", async () => {
  const sim = await createSimulation();
  const guest = await createSimulation();
  try {
    sim.resetOnline(players, 1);
    launch(sim);
    const limit = Math.ceil((trackLength / 45 + 20) * 60);
    for (let frame = 0; frame < limit && !sim.player.finished; frame++) {
      sim.stepOnline(1 / 60, [
        lane(sim.player, 3.7, sim.elapsed > 4 && sim.elapsed < 7),
        sim.elapsed < 4 ? idle : lane(sim.rivals[0], -3.7),
      ]);
    }
    const first = sim.getOnlineSnapshot();
    assert.equal(first.vehicles[0].finished, true);
    assert.equal(first.vehicles[1].finished, false);
    assert.equal(first.phase, "racing");
    assert.equal(first.raceComplete, false);
    assert.ok(first.drivers[0].finishTime !== null);
    assert.equal(first.drivers[1].finishTime, null);
    assert.ok(first.finishGraceRemaining! > 29.9);
    assert.equal(first.drivers[0].position, 1);
    const guestDistance = sim.rivals[0].distance;
    const elapsed = sim.elapsed;
    for (let frame = 0; frame < 30; frame++)
      sim.stepOnline(1 / 60, [stopped, lane(sim.rivals[0], -3.7)]);
    assert.ok(sim.elapsed > elapsed + 0.49);
    assert.ok(sim.rivals[0].distance > guestDistance + 30);
    assert.equal(
      sim.getOnlineSnapshot().drivers[0].finishTime,
      first.drivers[0].finishTime,
    );
    for (let frame = 0; frame < 30 * 60 && !sim.raceComplete; frame++)
      sim.stepOnline(1 / 60, [stopped, lane(sim.rivals[0], -3.7)]);
    const result = sim.getOnlineSnapshot();
    assert.equal(result.phase, "finished");
    assert.equal(result.raceComplete, true);
    assert.ok(
      result.drivers.every(
        (driver) => driver.finishTime !== null && !driver.dnf,
      ),
    );
    assert.ok(result.drivers[1].finishTime! > result.drivers[0].finishTime!);
    assert.equal(result.elapsed, result.drivers[1].finishTime);
    assert.equal(result.drivers[0].lastLap, result.drivers[0].finishTime);
    assert.equal(result.drivers[1].lastLap, result.drivers[1].finishTime);
    assert.equal(result.drivers[1].position, 2);
    guest.applyOnlineSnapshot(JSON.parse(JSON.stringify(result)), 1);
    assert.equal(guest.position, 2);
    assert.equal(guest.lastLap, result.drivers[1].lastLap);
    assert.equal(guest.phase, "finished");
    run(sim, 2, [throttle, throttle]);
    assert.deepEqual(
      sim.getOnlineSnapshot(),
      result,
      "complete races must be immutable until reset",
    );
  } finally {
    sim.dispose();
    guest.dispose();
  }
});

test("finish grace expires after exactly 30 seconds and marks the non-finisher DNF without false lap credit", async () => {
  const sim = await createSimulation();
  try {
    sim.resetOnline(players, 1);
    launch(sim);
    // Guest wins this case so both ordering and grace logic are symmetric.
    for (
      let frame = 0;
      frame < (trackLength / 45 + 65) * 60 && !sim.raceComplete;
      frame++
    )
      sim.stepOnline(1 / 60, [
        idle,
        lane(sim.rivals[0], -3.7, sim.elapsed > 4 && sim.elapsed < 7),
      ]);
    const result = sim.getOnlineSnapshot();
    assert.equal(result.phase, "finished");
    assert.equal(result.finishGraceRemaining, 0);
    assert.equal(result.drivers[0].dnf, true);
    assert.equal(result.drivers[0].finishTime, null);
    assert.equal(result.drivers[0].position, 2);
    assert.equal(result.drivers[0].lastLap, 0);
    assert.equal(result.vehicles[0].distance, -8);
    assert.equal(result.drivers[1].dnf, false);
    assert.equal(result.drivers[1].position, 1);
    assert.ok(result.drivers[1].finishTime !== null);
    assert.equal(result.elapsed, result.drivers[1].finishTime! + 30);
    assert.equal(result.drivers[1].lastLap, result.drivers[1].finishTime);
    assert.deepEqual(
      JSON.parse(JSON.stringify(result)),
      result,
      "wire result contains no Infinity or undefined",
    );
  } finally {
    sim.dispose();
  }
});
