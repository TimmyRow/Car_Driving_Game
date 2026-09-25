import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSimulation,
  type Controls,
  type Simulation,
} from "../src/simulation";
import { roadHalfWidth, trackLength } from "../src/track";

const throttle: Controls = {
  steer: 0,
  throttle: true,
  brake: false,
  nitro: false,
};
function run(sim: Simulation, seconds: number, input = throttle, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.step(dt, input);
}
function launch(sim: Simulation) {
  sim.start();
  run(sim, 3);
  assert.equal(sim.phase, "racing");
}

test("countdown gates motion; pause/no-step freezes time; reset clears race state and respects mode", async () => {
  const sim = await createSimulation();
  try {
    const grid = sim.player.distance;
    run(sim, 2);
    assert.equal(sim.phase, "ready");
    assert.equal(sim.player.distance, grid);
    sim.start();
    run(sim, 2.5);
    assert.equal(sim.phase, "countdown");
    assert.equal(sim.elapsed, 0);
    assert.equal(sim.player.distance, grid);
    run(sim, 0.5);
    assert.equal(sim.phase, "racing");
    assert.equal(sim.elapsed, 0);
    run(sim, 4);
    assert.ok(sim.player.speed > 40);
    assert.ok(sim.player.distance > grid);
    sim.reset("time-trial");
    assert.equal(sim.phase, "ready");
    assert.equal(sim.rivals.length, 0);
    assert.equal(sim.totalLaps, 1);
    assert.equal(sim.elapsed, 0);
    assert.equal(sim.driftScore, 0);
    assert.equal(sim.impact, 0);
    assert.equal(sim.bestLap, 0);
    assert.equal(sim.player.speed, 0);
    assert.equal(sim.player.nitro, 0.72);
    sim.reset();
    assert.equal(sim.totalLaps, 1);
    sim.reset("race");
    assert.equal(sim.rivals.length, 5);
    assert.equal(sim.totalLaps, 2);
    assert.equal(sim.position, 6);
  } finally {
    sim.dispose();
  }
});

test("fixed substeps keep 30/60/120 Hz control trajectories equivalent", async () => {
  const simulations = await Promise.all([
    createSimulation(),
    createSimulation(),
    createSimulation(),
  ]);
  try {
    for (let i = 0; i < simulations.length; i++) {
      const sim = simulations[i];
      const dt = [1 / 30, 1 / 60, 1 / 120][i];
      sim.reset("time-trial");
      sim.start();
      run(sim, 3, throttle, dt);
      run(sim, 6, throttle, dt);
      run(sim, 0.6, { ...throttle, steer: -0.6, brake: true }, dt);
      run(sim, 0.6, { ...throttle, steer: 0.5 }, dt);
      run(sim, 3, { ...throttle, nitro: true }, dt);
    }
    for (const sim of simulations.slice(1)) {
      assert.ok(
        Math.abs(sim.player.distance - simulations[0].player.distance) < 0.005,
      );
      assert.ok(
        Math.abs(sim.player.offset - simulations[0].player.offset) < 0.005,
      );
      assert.ok(
        Math.abs(sim.player.nitro - simulations[0].player.nitro) < 0.00001,
      );
    }
  } finally {
    simulations.forEach((s) => s.dispose());
  }
});

test("nitro gives real speed, drains cleanly, and driving and drifting recharge it", async () => {
  const sim = await createSimulation();
  try {
    sim.reset("time-trial");
    launch(sim);
    run(sim, 12);
    const normalSpeed = sim.player.speed;
    run(sim, 2, { ...throttle, nitro: true });
    assert.equal(sim.player.boosting, true);
    assert.ok(sim.player.speed > normalSpeed + 9);
    const chargeAfterBoost = sim.player.nitro;
    run(sim, 2);
    assert.ok(sim.player.nitro > chargeAfterBoost);
    const chargeBeforeDrift = sim.player.nitro;
    run(sim, 0.75, { ...throttle, steer: 0.8, brake: true });
    assert.equal(sim.player.drifting, true);
    assert.ok(sim.driftScore > 20);
    assert.ok(sim.player.nitro > chargeBeforeDrift + 0.035);
    run(sim, 8, { ...throttle, nitro: true });
    assert.equal(sim.player.boosting, false);
    assert.ok(sim.player.nitro >= 0 && sim.player.nitro <= 1);
    run(sim, 1);
    assert.equal(sim.player.drifting, false);
  } finally {
    sim.dispose();
  }
});

test("a short held keyboard drift creates slip and charge without immediately reaching the rail", async () => {
  const sim = await createSimulation();
  try {
    sim.reset("time-trial");
    launch(sim);
    run(sim, 6);
    const startCharge = sim.player.nitro;
    run(sim, 0.9, { ...throttle, steer: 1, brake: true });
    assert.equal(sim.player.drifting, true);
    assert.ok(sim.player.yaw > 0.3);
    assert.ok(
      sim.player.offset < roadHalfWidth - 1.4,
      `drift immediately reached rail: ${sim.player.offset}`,
    );
    assert.ok(sim.player.nitro > startCharge + 0.07);
    assert.ok(sim.driftScore > 50);
    run(sim, 0.6, { ...throttle, steer: -0.5 });
    assert.ok(sim.player.offset < roadHalfWidth - 1.2);
    assert.equal(sim.player.drifting, false);
  } finally {
    sim.dispose();
  }
});

test("solid rails contain hard steering, signal impact and allow immediate recovery", async () => {
  const sim = await createSimulation();
  try {
    sim.reset("time-trial");
    launch(sim);
    run(sim, 5);
    let maximumImpact = 0;
    for (let i = 0; i < 240; i++) {
      sim.step(1 / 60, { ...throttle, steer: 1 });
      maximumImpact = Math.max(maximumImpact, sim.impact);
      assert.ok(Number.isFinite(sim.player.distance));
      assert.ok(sim.player.offset < roadHalfWidth - 0.95);
    }
    assert.ok(maximumImpact > 0.4);
    const wallOffset = sim.player.offset;
    run(sim, 0.7, { ...throttle, steer: -1 });
    assert.ok(sim.player.offset < wallOffset - 2);
    assert.ok(sim.player.speed > 25);
  } finally {
    sim.dispose();
  }
});

test("rear-end car contact transfers speed without tunneling; an open lane and nitro permit overtaking", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let maximumImpact = 0;
    let contactSamples = 0;
    for (let frame = 0; frame < 60 * 1.5; frame++) {
      const target = sim.rivals[3];
      const steer = Math.max(
        -1,
        Math.min(1, (target.offset - sim.player.offset) * 0.6),
      );
      sim.step(1 / 60, { ...throttle, steer });
      maximumImpact = Math.max(maximumImpact, sim.impact);
      const gap = target.distance - sim.player.distance;
      if (
        Math.abs(target.offset - sim.player.offset) < 0.6 &&
        gap > 0 &&
        gap < 5
      ) {
        assert.ok(
          gap > 4.25,
          `overlapping longitudinal collision boxes: ${gap}`,
        );
        contactSamples++;
      }
    }
    assert.ok(maximumImpact > 0.4);
    assert.ok(contactSamples > 10);
    assert.ok(sim.player.speed > 15);
    assert.equal(sim.takedowns, 0);
    assert.ok(sim.rivals.every((r) => r.crashTimer === 0));
    for (let frame = 0; frame < 60 * 6; frame++) {
      sim.step(1 / 60, {
        ...throttle,
        steer: Math.max(-1, Math.min(1, (6.1 - sim.player.offset) * 0.3)),
        nitro: true,
      });
    }
    assert.ok(sim.player.distance > sim.rivals[3].distance);
  } finally {
    sim.dispose();
  }
});

test("a deliberate nitro ram creates one takedown, a visible wreck, and a safe protected recovery", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    // Play a real approach: follow the front-left rival, then boost to close its gap.
    let frame = 0;
    while (sim.takedowns === 0 && frame < 60 * 15) {
      const target = sim.rivals[0];
      sim.step(1 / 60, {
        ...throttle,
        steer: Math.max(
          -1,
          Math.min(1, (target.offset - sim.player.offset) * 0.5),
        ),
        nitro: frame > 300,
      });
      frame++;
    }
    const event = sim.collisionEvents.find((e) => e.kind === "takedown");
    assert.ok(event);
    assert.equal(event.attackerId, 0);
    assert.equal(sim.takedowns, 1);
    const victim = sim.rivals.find((r) => r.id === event.victimId)!;
    assert.ok(victim.crashTimer > 1);
    assert.equal(victim.crashDuration, 1.1);
    assert.ok(Math.abs(victim.crashSide) === 1);
    assert.ok(event.intensity > 0.5);
    const crashDistance = victim.distance;
    const crashOffset = victim.offset;
    run(sim, 0.5);
    assert.equal(victim.distance, crashDistance);
    assert.ok(Math.abs(victim.offset - crashOffset) > 0.3);
    assert.equal(
      sim.collisionEvents.filter(
        (e) => e.kind === "takedown" && e.victimId === victim.id,
      ).length,
      1,
    );
    let recoveryGuard = 0;
    while (victim.crashTimer > 0 && recoveryGuard++ < 240)
      sim.step(1 / 120, throttle);
    assert.equal(victim.crashTimer, 0);
    assert.ok(victim.invulnerable >= 1.49);
    assert.ok(victim.speed >= 28);
    assert.ok(Math.abs(victim.offset) < roadHalfWidth - 1.1);
    for (const other of [sim.player, ...sim.rivals]) {
      if (other !== victim && other.crashTimer === 0 && !other.finished) {
        assert.ok(
          Math.abs(other.offset - victim.offset) > 2.0 ||
            Math.abs(other.distance - victim.distance) > 4.4,
        );
      }
    }
    const recoveredDistance = victim.distance;
    run(sim, 0.4);
    assert.ok(victim.distance > recoveredDistance + 5);
    sim.reset();
    assert.equal(sim.takedowns, 0);
    assert.deepEqual(sim.collisionEvents, []);
    assert.ok(
      [sim.player, ...sim.rivals].every(
        (v) => v.crashTimer === 0 && v.invulnerable === 0,
      ),
    );
  } finally {
    sim.dispose();
  }
});

test("protection blocks a hard follow-up wreck and contact cooldown prevents duplicate hit events", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    // Recreate an incoming high-speed car against the real start-grid collision bodies.
    sim.player.speed = 82;
    const protectedRival = sim.rivals[3];
    protectedRival.invulnerable = 1.5;
    run(sim, 0.4, { ...throttle, nitro: true });
    const contact = sim.collisionEvents.filter(
      (e) => e.attackerId === 0 && e.victimId === protectedRival.id,
    );
    assert.equal(contact.length, 1);
    assert.equal(contact[0].kind, "hit");
    assert.equal(protectedRival.crashTimer, 0);
    assert.ok(protectedRival.invulnerable > 1);
    run(sim, 0.2, { ...throttle, nitro: true });
    assert.equal(
      sim.collisionEvents.filter(
        (e) => e.attackerId === 0 && e.victimId === protectedRival.id,
      ).length,
      1,
    );
    assert.ok(sim.collisionEvents.length <= 32);
    assert.equal(
      new Set(sim.collisionEvents.map((e) => e.id)).size,
      sim.collisionEvents.length,
    );
  } finally {
    sim.dispose();
  }
});

test("a boosted side ram can take down an adjacent car without a rear-end impact", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let ram = false;
    let frame = 0;
    const target = sim.rivals[1];
    while (sim.takedowns === 0 && frame++ < 60 * 10) {
      if (
        !ram &&
        sim.player.speed > 35 &&
        Math.abs(sim.player.distance - target.distance) < 2.8 &&
        Math.abs(sim.player.offset - target.offset) > 2.05
      )
        ram = true;
      const desiredLane = ram ? target.offset : 6.1;
      sim.step(1 / 60, {
        ...throttle,
        steer: Math.max(
          -1,
          Math.min(1, (desiredLane - sim.player.offset) * (ram ? 1 : 0.25)),
        ),
        nitro: ram,
      });
    }
    const event = sim.collisionEvents.find((e) => e.kind === "takedown");
    assert.ok(event);
    assert.equal(event.victimId, target.id);
    assert.ok(Math.abs(sim.player.distance - target.distance) < 3.4);
    assert.ok(Math.abs(sim.player.offset - target.offset) > 1.35);
    assert.ok(target.crashTimer > 1);
  } finally {
    sim.dispose();
  }
});

test("a hard rival impact can wreck the player, freeze lap progress, and recover without a combo", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let frame = 0;
    while (sim.player.crashTimer === 0 && frame < 60 * 12) {
      const rival = sim.rivals[1];
      // A real-input approach followed by abrupt braking lets a fast rival hit us.
      const braking = frame > 210;
      sim.step(1 / 60, {
        steer: braking
          ? 0
          : Math.max(-1, Math.min(1, (rival.offset - sim.player.offset) * 0.5)),
        throttle: !braking,
        brake: braking,
        nitro: !braking,
      });
      frame++;
    }
    assert.ok(sim.player.crashTimer > 0);
    const event = sim.collisionEvents.find(
      (e) => e.kind === "wreck" && e.victimId === 0,
    );
    assert.ok(event);
    assert.ok(sim.impact >= 0.95);
    const crashDistance = sim.player.distance;
    const lap = sim.lap;
    run(sim, 0.5, { ...throttle, nitro: true });
    assert.equal(sim.player.distance, crashDistance);
    assert.equal(sim.lap, lap);
    assert.equal(sim.player.finished, false);
    assert.equal(sim.player.boosting, false);
    let guard = 0;
    while (sim.player.crashTimer > 0 && guard++ < 240)
      sim.step(1 / 120, throttle);
    assert.equal(sim.player.crashTimer, 0);
    assert.ok(sim.player.invulnerable >= 1.49);
    run(sim, 0.5);
    assert.ok(sim.player.distance > crashDistance + 10);
    assert.equal(
      sim.collisionEvents.filter((e) => e.kind === "wreck" && e.victimId === 0)
        .length,
      1,
    );
  } finally {
    sim.dispose();
  }
});

test("crash events, recovery and protection are identical at 30/60/120 Hz", async () => {
  const simulations = await Promise.all([
    createSimulation(),
    createSimulation(),
    createSimulation(),
  ]);
  try {
    for (let i = 0; i < simulations.length; i++) {
      const sim = simulations[i];
      const dt = [1 / 30, 1 / 60, 1 / 120][i];
      sim.start();
      run(sim, 3, throttle, dt);
      sim.player.speed = 82;
      run(sim, 1.8, { ...throttle, nitro: true }, dt);
      assert.equal(sim.takedowns, 1);
      assert.ok(sim.rivals[3].invulnerable > 0);
    }
    for (const sim of simulations.slice(1)) {
      assert.deepEqual(sim.collisionEvents, simulations[0].collisionEvents);
      assert.equal(sim.takedowns, simulations[0].takedowns);
      assert.ok(
        Math.abs(sim.player.distance - simulations[0].player.distance) < 0.005,
      );
      assert.ok(
        Math.abs(sim.rivals[3].distance - simulations[0].rivals[3].distance) <
          0.005,
      );
      assert.ok(
        Math.abs(
          sim.rivals[3].invulnerable - simulations[0].rivals[3].invulnerable,
        ) < 0.00001,
      );
    }
  } finally {
    simulations.forEach((s) => s.dispose());
  }
});

test("hands-off acceleration can finish but cannot win against the rival field", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let guard = 0;
    while (sim.phase === "racing" && guard++ < 60 * 75)
      sim.step(1 / 60, throttle);
    assert.equal(sim.phase, "finished");
    assert.ok(sim.position > 1);
    assert.ok(sim.elapsed < 60);
    assert.ok(sim.player.speed > 70);
  } finally {
    sim.dispose();
  }
});

test("rivals who finish first clear the line so a following player can finish normally", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let guard = 0;
    while (sim.phase === "racing" && guard++ < 60 * 75) {
      sim.step(1 / 60, {
        ...throttle,
        steer: Math.max(-1, Math.min(1, (-0.4 - sim.player.offset) * 0.2)),
      });
    }
    assert.equal(sim.phase, "finished");
    assert.ok(
      sim.elapsed < 65,
      `blocked at finish line for ${sim.elapsed.toFixed(1)}s`,
    );
    assert.ok(
      sim.rivals
        .filter((r) => r.finished)
        .every((r) => r.distance >= trackLength * 2),
    );
  } finally {
    sim.dispose();
  }
});

test("two-lap race finishes with attainable victory and immutable final timing; restart is fresh", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let guard = 0;
    while (sim.phase === "racing" && guard++ < 60 * 180) {
      // A conservative lane choice avoids the grid pack while driving a clean race.
      const steer = Math.max(-1, Math.min(1, (6.1 - sim.player.offset) * 0.25));
      sim.step(1 / 60, { ...throttle, steer, nitro: sim.player.nitro > 0.45 });
    }
    assert.equal(sim.phase, "finished");
    assert.equal(sim.player.finished, true);
    assert.equal(sim.lap, 2);
    assert.equal(sim.player.distance, trackLength * 2);
    assert.ok(sim.bestLap > 5 && sim.lastLap > 5);
    assert.ok(sim.elapsed >= sim.bestLap + sim.lastLap - 0.01);
    assert.equal(sim.position, 1);
    const finalElapsed = sim.elapsed;
    const finalDistance = sim.player.distance;
    run(sim, 20);
    assert.equal(sim.elapsed, finalElapsed);
    assert.equal(sim.player.distance, finalDistance);
    sim.reset();
    assert.equal(sim.player.finished, false);
    assert.equal(sim.lap, 1);
    assert.equal(sim.lastLap, 0);
    assert.equal(sim.rivals.length, 5);
    assert.ok(sim.rivals.every((r) => !r.finished && r.speed === 0));
  } finally {
    sim.dispose();
  }
});

test("time trial completes exactly one lap, and braking can stop then accelerate again", async () => {
  const sim = await createSimulation();
  try {
    sim.reset("time-trial");
    launch(sim);
    run(sim, 6);
    run(sim, 3, { ...throttle, throttle: false, brake: true });
    assert.equal(sim.player.speed, 0);
    run(sim, 3);
    assert.ok(sim.player.speed > 30);
    let guard = 0;
    while (sim.phase === "racing" && guard++ < 60 * 120)
      sim.step(1 / 60, throttle);
    assert.equal(sim.phase, "finished");
    assert.equal(sim.lap, 1);
    assert.equal(sim.position, 1);
    assert.equal(sim.player.distance, trackLength);
    assert.equal(sim.bestLap, sim.lastLap);
    assert.equal(sim.elapsed, sim.lastLap);
  } finally {
    sim.dispose();
  }
});
