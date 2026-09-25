import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSimulation,
  type Controls,
  type Simulation,
  type Difficulty,
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
const raceTimeBudget = (sim: Simulation) => trackLength * sim.totalLaps / 45 + 20;

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
    sim.reset("race", "rookie");
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
        nitro: frame > 360,
      });
      frame++;
    }
    const event = sim.collisionEvents.find((e) => e.kind === "takedown");
    assert.ok(event);
    assert.equal(event.attackerId, 0);
    assert.equal(sim.takedowns, 1);
    const victim = sim.rivals.find((r) => r.id === event.victimId)!;
    assert.ok(victim.crashTimer > 1);
    assert.equal(victim.crashDuration, 1.6);
    assert.ok(Math.abs(victim.crashSide) === 1);
    assert.ok(event.intensity > 0.5);
    const crashDistance = victim.distance;
    const crashOffset = victim.offset;
    run(sim, 0.5);
    assert.equal(victim.distance, crashDistance);
    assert.ok(victim.crashTravel > 8 && victim.crashTravel <= 65);
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
    assert.equal(victim.crashTravel, 0);
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
    sim.reset("race", "rookie");
    launch(sim);
    let ram = false;
    let frame = 0;
    const target = sim.rivals[1];
    while (sim.takedowns === 0 && frame++ < 60 * 10) {
      if (
        !ram &&
        sim.player.speed > 35 &&
        Math.abs(sim.player.distance - target.distance) < 4 &&
        Math.abs(sim.player.offset - target.offset) > 2.05
      )
        ram = true;
      const desiredLane = ram ? target.offset : 6.8;
      sim.step(1 / 60, {
        ...throttle,
        steer: Math.max(
          -1,
          Math.min(1, (desiredLane - sim.player.offset) * (ram ? 1 : 0.4)),
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
    sim.reset("race", "rookie");
    launch(sim);
    let frame = 0;
    while (sim.player.crashTimer === 0 && frame < 60 * 12) {
      const rival = sim.rivals[0];
      // A real-input approach followed by abrupt braking lets a fast rival hit us.
      const braking = frame > 180;
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
    while (sim.phase === "racing" && guard++ < 60 * raceTimeBudget(sim))
      sim.step(1 / 60, throttle);
    assert.equal(sim.phase, "finished");
    assert.ok(sim.position > 1);
    assert.ok(sim.elapsed < raceTimeBudget(sim));
    assert.ok(Number.isFinite(sim.player.speed));
  } finally {
    sim.dispose();
  }
});

test("rivals who finish first clear the line so a following player can finish normally", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let guard = 0;
    while (sim.phase === "racing" && guard++ < 60 * raceTimeBudget(sim)) {
      sim.step(1 / 60, {
        ...throttle,
        steer: Math.max(-1, Math.min(1, (-0.4 - sim.player.offset) * 0.2)),
      });
    }
    assert.equal(sim.phase, "finished");
    assert.ok(
      sim.elapsed < raceTimeBudget(sim),
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

test("two-lap rookie race finishes with attainable victory and immutable final timing; restart is fresh", async () => {
  const sim = await createSimulation();
  try {
    sim.reset("race", "rookie");
    launch(sim);
    let guard = 0;
    let boost = true;
    while (sim.phase === "racing" && guard++ < 60 * raceTimeBudget(sim)) {
      // A conservative lane choice avoids the grid pack while driving a clean race.
      const steer = Math.max(-1, Math.min(1, (6.2 - sim.player.offset) * 0.4));
      if (sim.player.nitro > 0.4) boost = true;
      if (sim.player.nitro < 0.02) boost = false;
      sim.step(1 / 60, { ...throttle, steer, nitro: boost });
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
    while (sim.phase === "racing" && guard++ < 60 * raceTimeBudget(sim))
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

test("difficulty persists and raises rival pace with finite timed nitro", async () => {
  const finishTimes: number[] = [];
  for (const difficulty of ["rookie", "pro", "expert"] as Difficulty[]) {
    const sim = await createSimulation();
    try {
      assert.equal(sim.difficulty, "pro");
      sim.reset("time-trial", difficulty);
      sim.reset();
      assert.equal(sim.difficulty, difficulty);
      assert.equal(sim.totalLaps, 1);
      sim.reset("race");
      launch(sim);
      const boostTime = Array(5).fill(0),
        streak = Array(5).fill(0),
        longest = Array(5).fill(0);
      while (!sim.rivals.every((r) => r.finished) && sim.elapsed < raceTimeBudget(sim)) {
        sim.step(1 / 60, { ...throttle, throttle: false });
        sim.rivals.forEach((r, i) => {
          assert.ok(r.nitro >= 0 && r.nitro <= 1);
          if (r.boosting) {
            boostTime[i] += 1 / 60;
            streak[i] += 1 / 60;
          } else streak[i] = 0;
          longest[i] = Math.max(longest[i], streak[i]);
        });
        if (
          finishTimes.length ===
            ["rookie", "pro", "expert"].indexOf(difficulty) &&
          sim.rivals.some((r) => r.finished)
        )
          finishTimes.push(sim.elapsed);
      }
      assert.ok(sim.rivals.every((r) => r.finished));
      const recharge = { rookie: 0.021, pro: 0.026, expert: 0.029 }[difficulty];
      assert.ok(boostTime.every((t) => t > 2 && t * 0.235 <= 0.72 + sim.elapsed * recharge + 0.025));
      const maxBurst = { rookie: 1.3, pro: 1.75, expert: 2.1 }[difficulty];
      assert.ok(longest.every((t) => t <= maxBurst + 0.025));
    } finally {
      sim.dispose();
    }
  }
  assert.ok(finishTimes[1] < finishTimes[0] - 2);
  assert.ok(finishTimes[2] < finishTimes[1] - 1);
});

test("hard nitro rear slams retain momentum through subsequent physics steps", async () => {
  for (const incomingSpeed of [55, 82]) {
    const sim = await createSimulation();
    try {
      launch(sim);
      sim.player.speed = incomingSpeed;
      let guard = 0;
      while (sim.takedowns === 0 && guard++ < 120)
        sim.step(1 / 60, { ...throttle, nitro: true });
      const event = sim.collisionEvents.find((e) => e.kind === "takedown");
      assert.ok(event);
      assert.ok(event.speed > 25);
      assert.equal(Math.abs(event.side), 1);
      assert.ok(sim.player.speed >= event.speed * 0.9);
      const victim = sim.rivals.find((r) => r.id === event.victimId)!;
      const logicalDistance = victim.distance;
      const previousThrow = victim.crashTravel;
      run(sim, 0.2, { ...throttle, nitro: true });
      assert.ok(sim.player.speed >= event.speed * 0.9);
      assert.equal(victim.distance, logicalDistance);
      assert.ok(victim.crashTravel > previousThrow && victim.crashTravel <= 65);
    } finally {
      sim.dispose();
    }
  }
});

test("sustained boosted rubbing remains a safe solid contact and never escalates into a knockout", async () => {
  const sim = await createSimulation();
  try {
    launch(sim);
    let guard = 0;
    while (
      !sim.collisionEvents.some(
        (e) => e.kind === "hit" && e.attackerId === 0,
      ) &&
      guard++ < 180
    )
      sim.step(1 / 60, throttle);
    const hit = sim.collisionEvents.find(
      (e) => e.kind === "hit" && e.attackerId === 0,
    );
    assert.ok(hit);
    assert.equal(sim.takedowns, 0);
    const target = sim.rivals.find((r) => r.id === hit.victimId)!;
    const started = sim.elapsed;
    let boostedSamples = 0;
    while (sim.elapsed - started < 1.5) {
      sim.step(1 / 60, { ...throttle, nitro: true });
      if (sim.player.boosting) boostedSamples++;
      assert.ok(Math.abs(sim.player.distance - target.distance) < 4.5);
      assert.equal(target.crashTimer, 0);
    }
    assert.ok(boostedSamples > 60);
    assert.equal(sim.takedowns, 0);
    assert.equal(
      sim.collisionEvents.filter(
        (e) => e.kind === "takedown" && e.victimId === target.id,
      ).length,
      0,
    );
  } finally {
    sim.dispose();
  }
});
