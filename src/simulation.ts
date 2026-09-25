import RAPIER from "@dimforge/rapier3d-compat";
import { roadHalfWidth, sampleTrack, trackLength } from "./track";

export interface Controls {
  steer: number;
  throttle: boolean;
  brake: boolean;
  nitro: boolean;
}
export type RaceMode = "race" | "time-trial";
export type Difficulty = "rookie" | "pro" | "expert";
export interface Vehicle {
  id: number;
  name: string;
  color: string;
  distance: number;
  offset: number;
  speed: number;
  yaw: number;
  drifting: boolean;
  boosting: boolean;
  nitro: number;
  finished: boolean;
  crashTimer: number;
  crashDuration: number;
  crashSide: number;
  /** Current visual forward displacement in meters; already eased, zero after recovery. */
  crashTravel: number;
  invulnerable: number;
}
export interface CollisionEvent {
  id: number;
  kind: "hit" | "takedown" | "wreck";
  attackerId: number;
  victimId: number;
  distance: number;
  offset: number;
  intensity: number;
  speed: number;
  side: number;
}
export interface OnlinePlayer {
  name: string;
  color: string;
}
export interface OnlineDriverStats {
  id: 0 | 1;
  position: number;
  lap: number;
  bestLap: number;
  lastLap: number;
  driftScore: number;
  impact: number;
  takedowns: number;
  finishTime: number | null;
  dnf: boolean;
}
/** Wire IDs always remain host=0 and guest=1, regardless of the receiving view. */
export interface OnlineSnapshot {
  version: 1;
  phase: Simulation["phase"];
  elapsed: number;
  countdown: number;
  totalLaps: number;
  difficulty: Difficulty;
  raceComplete: boolean;
  finishGraceRemaining: number | null;
  vehicles: [Vehicle, Vehicle];
  drivers: [OnlineDriverStats, OnlineDriverStats];
  collisionEvents: CollisionEvent[];
}
export interface Simulation {
  player: Vehicle;
  rivals: Vehicle[];
  phase: "ready" | "countdown" | "racing" | "finished";
  elapsed: number;
  countdown: number;
  position: number;
  lap: number;
  totalLaps: number;
  bestLap: number;
  lastLap: number;
  driftScore: number;
  impact: number;
  takedowns: number;
  collisionEvents: CollisionEvent[];
  difficulty: Difficulty;
  online: boolean;
  raceComplete: boolean;
  finishGraceRemaining: number | null;
  reset(mode?: RaceMode, difficulty?: Difficulty, laps?: 1 | 2 | 3): void;
  resetOnline(players: [OnlinePlayer, OnlinePlayer], laps?: 1 | 2 | 3): void;
  start(): void;
  step(dt: number, input: Controls): void;
  stepOnline(dt: number, inputs: [Controls, Controls]): void;
  getOnlineSnapshot(): OnlineSnapshot;
  applyOnlineSnapshot(snapshot: OnlineSnapshot, localPlayerId: 0 | 1): void;
  dispose(): void;
}

const FIXED_DT = 1 / 120;
const DIFFICULTIES = {
  rookie: {
    pace: 79,
    spread: 1.15,
    acceleration: 12.8,
    anticipation: 23,
    reaction: 0.65,
    lateral: 3.4,
    boostSpeed: 8,
    boostAcceleration: 19,
    boostDuration: 1.3,
    boostCooldown: 13,
    recharge: 0.021,
    curvePenalty: 2.8,
  },
  pro: {
    pace: 85.2,
    spread: 0.65,
    acceleration: 15.2,
    anticipation: 35,
    reaction: 0.28,
    lateral: 4.8,
    boostSpeed: 10,
    boostAcceleration: 23,
    boostDuration: 1.75,
    boostCooldown: 9,
    recharge: 0.026,
    curvePenalty: 2,
  },
  expert: {
    pace: 87.4,
    spread: 0.42,
    acceleration: 16.5,
    anticipation: 48,
    reaction: 0.12,
    lateral: 6,
    boostSpeed: 13,
    boostAcceleration: 27,
    boostDuration: 2.1,
    boostCooldown: 6.5,
    recharge: 0.029,
    curvePenalty: 1.4,
  },
};
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const approach = (a: number, b: number, rate: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-rate * dt));
let physicsReady: Promise<void> | undefined;
interface Driver {
  car: Vehicle;
  body: RAPIER.RigidBody;
  steer: number;
  slide: number;
  hitWall: boolean;
  boostExhausted: boolean;
  finishTime: number;
  dnf: boolean;
  position: number;
  lap: number;
  nextLapDistance: number;
  lapStartedAt: number;
  bestLap: number;
  lastLap: number;
  driftScore: number;
  impact: number;
  takedowns: number;
  targetLane: number;
  contactCooldown: number;
  velocityX: number;
  velocityZ: number;
  crashStartOffset: number;
  crashTargetOffset: number;
  recoverySpeed: number;
  crashThrow: number;
  ramMomentumTimer: number;
  ramSpeedFloor: number;
  aiDecisionCooldown: number;
  aiBoostRemaining: number;
  aiBoostCooldown: number;
}

/** Road coordinates keep the physics world compact and separate from the render graph.
 * Rapier resolves real solid-body car contacts and guardrails; the drivetrain supplies
 * longitudinal velocity and tire grip supplies lateral velocity at a fixed 120 Hz. */
export async function createSimulation(): Promise<Simulation> {
  physicsReady ??= RAPIER.init();
  await physicsReady;
  let world: RAPIER.World;
  let events: RAPIER.EventQueue;
  let drivers: Driver[] = [];
  let colliderDrivers = new Map<number, Driver>();
  let mode: RaceMode = "race";
  let accumulator = 0;
  let finishDeadline: number | null = null;
  let displaySnapshot: OnlineSnapshot | null = null;
  let disposed = false;
  let nextCollisionId = 1;
  const contactCooldowns = new Map<string, number>();

  const sim: Simulation = {
    player: makeVehicle(0, "YOU", "#f4fa4a", -23, 3.7),
    rivals: [],
    phase: "ready",
    elapsed: 0,
    countdown: 3,
    position: 6,
    lap: 1,
    totalLaps: 2,
    bestLap: 0,
    lastLap: 0,
    driftScore: 0,
    impact: 0,
    takedowns: 0,
    collisionEvents: [],
    difficulty: "pro",
    online: false,
    raceComplete: false,
    finishGraceRemaining: null,
    reset: resetRace,
    resetOnline(players, laps = 2) {
      resetRace("race", undefined, laps, players);
    },
    start() {
      if (!disposed && !displaySnapshot && sim.phase === "ready")
        sim.phase = "countdown";
    },
    step(dt, input) {
      if (!sim.online) advance(dt, [input]);
    },
    stepOnline(dt, inputs) {
      if (sim.online) advance(dt, inputs);
    },
    getOnlineSnapshot() {
      if (displaySnapshot) return cloneSnapshot(displaySnapshot);
      if (!sim.online)
        throw new Error(
          "Call resetOnline before requesting an online snapshot",
        );
      return {
        version: 1,
        phase: sim.phase,
        elapsed: sim.elapsed,
        countdown: sim.countdown,
        totalLaps: sim.totalLaps,
        difficulty: sim.difficulty,
        raceComplete: sim.raceComplete,
        finishGraceRemaining: sim.finishGraceRemaining,
        vehicles: [{ ...drivers[0].car }, { ...drivers[1].car }],
        drivers: [driverStats(drivers[0]), driverStats(drivers[1])],
        collisionEvents: sim.collisionEvents.map((event) => ({ ...event })),
      };
    },
    applyOnlineSnapshot(snapshot, localPlayerId) {
      if (disposed) return;
      displaySnapshot = cloneSnapshot(snapshot);
      const remoteId = localPlayerId === 0 ? 1 : 0;
      const stats = snapshot.drivers[localPlayerId];
      mode = "race";
      accumulator = 0;
      Object.assign(sim, {
        online: true,
        phase: snapshot.phase,
        elapsed: snapshot.elapsed,
        countdown: snapshot.countdown,
        totalLaps: snapshot.totalLaps,
        difficulty: snapshot.difficulty,
        raceComplete: snapshot.raceComplete,
        finishGraceRemaining: snapshot.finishGraceRemaining,
        player: { ...snapshot.vehicles[localPlayerId], id: 0 },
        rivals: [{ ...snapshot.vehicles[remoteId], id: 1 }],
        position: stats.position,
        lap: stats.lap,
        bestLap: stats.bestLap,
        lastLap: stats.lastLap,
        driftScore: stats.driftScore,
        impact: stats.impact,
        takedowns: stats.takedowns,
        collisionEvents: snapshot.collisionEvents.map((event) => {
          const attackerId = event.attackerId === localPlayerId ? 0 : 1;
          return {
            ...event,
            attackerId,
            victimId: event.victimId === localPlayerId ? 0 : 1,
            kind:
              event.kind === "hit"
                ? "hit"
                : attackerId === 0
                  ? "takedown"
                  : "wreck",
          };
        }),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      events.free();
      world.free();
      drivers = [];
      colliderDrivers.clear();
    },
  };

  function advance(dt: number, inputs: Controls[]) {
    if (
      disposed ||
      displaySnapshot ||
      sim.phase === "ready" ||
      sim.phase === "finished" ||
      !Number.isFinite(dt) ||
      dt <= 0
    )
      return;
    // A tab resuming after suspension must not fast-forward an entire race.
    accumulator += Math.min(dt, 0.25);
    const controls = inputs.map((input) => ({
      steer: clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1),
      throttle: !!input.throttle,
      brake: !!input.brake,
      nitro: !!input.nitro,
    }));
    while (accumulator + 1e-10 >= FIXED_DT) {
      accumulator -= FIXED_DT;
      if (sim.phase === "countdown") {
        sim.countdown = Math.max(0, sim.countdown - FIXED_DT);
        if (sim.countdown < 1e-8) {
          sim.countdown = 0;
          sim.phase = "racing";
        }
      } else if (sim.phase === "racing") tick(controls);
      else {
        accumulator = 0;
        break;
      }
    }
  }

  function resetRace(
    nextMode?: RaceMode,
    nextDifficulty?: Difficulty,
    laps?: 1 | 2 | 3,
    players?: [OnlinePlayer, OnlinePlayer],
  ) {
    if (disposed) return;
    mode = nextMode ?? mode;
    sim.online = !!players;
    displaySnapshot = null;
    finishDeadline = null;
    sim.difficulty = nextDifficulty ?? sim.difficulty;
    const raceLaps =
      laps ??
      (nextMode === undefined ? sim.totalLaps : mode === "race" ? 2 : 1);
    if (world) world.free();
    if (events) events.free();
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = FIXED_DT;
    events = new RAPIER.EventQueue(true);
    colliderDrivers = new Map();
    accumulator = 0;
    nextCollisionId = 1;
    contactCooldowns.clear();
    sim.player = players
      ? makeVehicle(0, players[0].name, players[0].color, -8, 3.7)
      : makeVehicle(0, "YOU", "#f4fa4a", -23, 3.7);
    sim.rivals = players
      ? [makeVehicle(1, players[1].name, players[1].color, -8, -3.7)]
      : mode === "race"
        ? [
            makeVehicle(1, "NOVA", "#fa633b", -2, -3.7),
            makeVehicle(2, "SORA", "#69cced", -3, 3.7),
            makeVehicle(3, "JUNO", "#ded6c9", -9.5, -3.7),
            makeVehicle(4, "ATLAS", "#9978dc", -10.5, 3.7),
            makeVehicle(5, "RIO", "#ef578e", -17, -3.7),
          ]
        : [];
    Object.assign(sim, {
      phase: "ready",
      elapsed: 0,
      countdown: 3,
      position: players ? 1 : sim.rivals.length + 1,
      lap: 1,
      totalLaps: raceLaps,
      bestLap: 0,
      lastLap: 0,
      driftScore: 0,
      impact: 0,
      takedowns: 0,
      collisionEvents: [],
      raceComplete: false,
      finishGraceRemaining: null,
    });
    // Cars are free to translate in the road plane. Rotation is visual tire slip,
    // while rectangular contact patches prevent unstable flips and hard snagging.
    drivers = [sim.player, ...sim.rivals].map((car) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(car.offset, 0, car.distance)
          .enabledTranslations(true, false, true)
          .lockRotations()
          .setCcdEnabled(true)
          .setCanSleep(false),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(1.015, 0.6, 2.18)
          .setMass(1300)
          .setFriction(0.035)
          .setRestitution(0.12)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      const driver: Driver = {
        car,
        body,
        steer: 0,
        slide: 0,
        hitWall: false,
        boostExhausted: false,
        finishTime: Infinity,
        dnf: false,
        position: players ? 1 : car.id === 0 ? sim.rivals.length + 1 : car.id,
        lap: 1,
        nextLapDistance: trackLength,
        lapStartedAt: 0,
        bestLap: 0,
        lastLap: 0,
        driftScore: 0,
        impact: 0,
        takedowns: 0,
        targetLane: car.offset,
        contactCooldown: 0,
        velocityX: 0,
        velocityZ: 0,
        crashStartOffset: car.offset,
        crashTargetOffset: car.offset,
        recoverySpeed: 0,
        crashThrow: 0,
        ramMomentumTimer: 0,
        ramSpeedFloor: 0,
        aiDecisionCooldown:
          DIFFICULTIES[sim.difficulty].reaction + car.id * 0.12,
        aiBoostRemaining: 0,
        aiBoostCooldown: 2 + car.id * 0.7,
      };
      colliderDrivers.set(collider.handle, driver);
      return driver;
    });
    const wallLength = trackLength * 3 + 300;
    for (const side of [-1, 1]) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 2, wallLength / 2)
          .setTranslation(side * (roadHalfWidth + 0.5), 0, wallLength / 2 - 100)
          .setFriction(0.01)
          .setRestitution(0.12),
      );
    }
  }

  function tick(inputs: Controls[]) {
    const dt = FIXED_DT;
    const previousTime = sim.elapsed;
    sim.elapsed += dt;
    const oldDistances = drivers.map((d) => d.car.distance);
    for (const driver of drivers) {
      driver.contactCooldown = Math.max(0, driver.contactCooldown - dt);
      driver.ramMomentumTimer = Math.max(0, driver.ramMomentumTimer - dt);
      driver.car.invulnerable = Math.max(0, driver.car.invulnerable - dt);
      driver.impact = Math.max(0, driver.impact - dt * 2.8);
      if (driver.car.finished) {
        // Finishers clear the line and cannot become a stationary roadblock.
        driver.car.distance += driver.car.speed * dt;
        continue;
      }
      if (driver.car.crashTimer > 0) {
        updateCrash(driver, dt);
        continue;
      }
      if (sim.online || driver.car.id === 0)
        drivePlayer(driver, inputs[driver.car.id], dt);
      else driveRival(driver, dt);
      const velocity = driver.body.linvel();
      driver.velocityX = velocity.x;
      driver.velocityZ = velocity.z;
    }
    world.step(events);
    events.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const da = colliderDrivers.get(a);
      const db = colliderDrivers.get(b);
      if (da && db) handleCarContact(da, db);
      for (const contact of [da, db]) {
        if (
          contact &&
          (sim.online || contact.car.id === 0) &&
          contact.contactCooldown <= 0 &&
          contact.car.speed > 8
        ) {
          contact.impact = Math.max(contact.impact, da && db ? 0.5 : 0.72);
          contact.contactCooldown = 0.28;
        }
      }
    });
    drivers.forEach((driver, index) => {
      const car = driver.car;
      if (car.finished || car.crashTimer > 0) return;
      const pos = driver.body.translation();
      const velocity = driver.body.linvel();
      car.distance = pos.z;
      car.offset = pos.x;
      car.speed = Math.max(0, velocity.z);
      // Preserve a successful knockout's momentum even if another contact manifold
      // in the same physics step applied a second solver impulse to the attacker.
      if (driver.ramMomentumTimer > 0 && !inputs[car.id]?.brake) {
        car.speed = Math.max(car.speed, driver.ramSpeedFloor);
        driver.body.setLinvel({ x: velocity.x, y: 0, z: car.speed }, true);
      }
      // A glancing rail contact scrubs speed once, then permits an immediate recovery.
      const atWall = Math.abs(car.offset) > roadHalfWidth - 1.07;
      if (atWall && !driver.hitWall && car.speed > 12) {
        car.speed *= sim.online || car.id === 0 ? 0.84 : 0.91;
        driver.body.setLinvel({ x: velocity.x, y: 0, z: car.speed }, true);
      }
      if (atWall) driver.hitWall = true;
      else if (Math.abs(car.offset) < roadHalfWidth - 1.5)
        driver.hitWall = false;
      const finishDistance = trackLength * sim.totalLaps;
      if (car.distance >= finishDistance) {
        const fraction = clamp(
          (finishDistance - oldDistances[index]) /
            Math.max(0.001, car.distance - oldDistances[index]),
          0,
          1,
        );
        const crossedAt = previousTime + fraction * dt;
        if (
          sim.online &&
          finishDeadline !== null &&
          crossedAt > finishDeadline + 1e-8
        )
          return;
        driver.finishTime = crossedAt;
        if (sim.online)
          finishDeadline = Math.min(finishDeadline ?? Infinity, crossedAt + 30);
        car.finished = true;
        car.distance = finishDistance;
        car.boosting = false;
        car.drifting = false;
        driver.body.setTranslation(
          { x: car.offset, y: 0, z: car.distance },
          true,
        );
        driver.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        driver.body.setEnabled(false);
      }
    });
    drivers.forEach((driver, index) => {
      const car = driver.car;
      if (
        !driver.dnf &&
        driver.nextLapDistance <= trackLength * sim.totalLaps &&
        (car.finished ||
          driver.nextLapDistance < trackLength * sim.totalLaps) &&
        car.crashTimer <= 0 &&
        car.distance >= driver.nextLapDistance
      ) {
        const fraction = clamp(
          (driver.nextLapDistance - oldDistances[index]) /
            Math.max(0.001, car.distance - oldDistances[index]),
          0,
          1,
        );
        const crossedAt = car.finished
          ? driver.finishTime
          : previousTime + fraction * dt;
        driver.lastLap = crossedAt - driver.lapStartedAt;
        driver.bestLap =
          driver.bestLap > 0
            ? Math.min(driver.bestLap, driver.lastLap)
            : driver.lastLap;
        driver.lapStartedAt = crossedAt;
        driver.nextLapDistance += trackLength;
        driver.lap = Math.min(sim.totalLaps, driver.lap + 1);
      }
    });
    if (
      sim.online &&
      finishDeadline !== null &&
      sim.elapsed >= finishDeadline
    ) {
      for (const driver of drivers) {
        if (driver.car.finished) continue;
        driver.dnf = true;
        driver.car.finished = true;
        driver.car.boosting = false;
        driver.car.drifting = false;
        driver.car.speed = 0;
        driver.body.setEnabled(false);
      }
    }
    for (const driver of drivers) {
      driver.position =
        1 +
        drivers.filter((other) => {
          if (other === driver) return false;
          if (Number.isFinite(driver.finishTime))
            return other.finishTime < driver.finishTime;
          return (
            Number.isFinite(other.finishTime) ||
            other.car.distance > driver.car.distance
          );
        }).length;
    }
    sim.raceComplete = sim.online
      ? drivers.every((driver) => driver.car.finished)
      : sim.player.finished;
    if (sim.raceComplete) {
      sim.elapsed = sim.online
        ? drivers.some((driver) => driver.dnf)
          ? finishDeadline!
          : Math.max(...drivers.map((driver) => driver.finishTime))
        : drivers[0].finishTime;
      sim.phase = "finished";
    }
    sim.finishGraceRemaining =
      finishDeadline === null
        ? null
        : Math.max(0, finishDeadline - sim.elapsed);
    const local = drivers[0];
    sim.position = local.position;
    sim.lap = local.lap;
    sim.bestLap = local.bestLap;
    sim.lastLap = local.lastLap;
    sim.driftScore = local.driftScore;
    sim.impact = local.impact;
    sim.takedowns = local.takedowns;
  }

  function driverStats(driver: Driver): OnlineDriverStats {
    return {
      id: driver.car.id as 0 | 1,
      position: driver.position,
      lap: driver.lap,
      bestLap: driver.bestLap,
      lastLap: driver.lastLap,
      driftScore: driver.driftScore,
      impact: driver.impact,
      takedowns: driver.takedowns,
      finishTime: Number.isFinite(driver.finishTime) ? driver.finishTime : null,
      dnf: driver.dnf,
    };
  }

  function contactKey(a: Driver, b: Driver) {
    return `${Math.min(a.car.id, b.car.id)}:${Math.max(a.car.id, b.car.id)}`;
  }

  function handleCarContact(a: Driver, b: Driver) {
    if (
      a.car.finished ||
      b.car.finished ||
      a.car.crashTimer > 0 ||
      b.car.crashTimer > 0
    )
      return;
    const key = contactKey(a, b);
    if ((contactCooldowns.get(key) ?? 0) > sim.elapsed) return;
    const dx = b.car.offset - a.car.offset;
    const dz = b.car.distance - a.car.distance;
    const sideContact = Math.abs(dx) > 1.35 && Math.abs(dz) < 3.4;
    let attacker: Driver;
    let victim: Driver;
    let closing: number;
    if (sideContact) {
      const direction = Math.sign(dx) || 1;
      const towardA = a.velocityX * direction;
      const towardB = -b.velocityX * direction;
      attacker =
        a.car.boosting !== b.car.boosting
          ? a.car.boosting
            ? a
            : b
          : towardA >= towardB
            ? a
            : b;
      victim = attacker === a ? b : a;
      closing = Math.max(0, towardA + towardB);
    } else {
      attacker = dz >= 0 ? a : b;
      victim = attacker === a ? b : a;
      closing = Math.max(0, attacker.velocityZ - victim.velocityZ);
    }
    if (closing < 0.8) return;
    contactCooldowns.set(key, sim.elapsed + 0.65);
    const speed = attacker.velocityZ;
    const intensity = clamp(
      closing / (sideContact ? 10 : 28) + speed * 0.0015,
      0.15,
      1,
    );
    const boostedRam =
      attacker.car.boosting && speed > 25 && closing > (sideContact ? 5 : 9);
    const hardImpact =
      speed > (sideContact ? 48 : 42) && closing > (sideContact ? 7.5 : 18);
    const canWreck = victim.car.invulnerable <= 0 && (boostedRam || hardImpact);
    const side =
      Math.sign(victim.car.offset - attacker.car.offset) ||
      Math.sign(victim.car.offset) ||
      (victim.car.id % 2 ? -1 : 1);
    if (canWreck) {
      beginCrash(victim, side, speed);
      attacker.ramSpeedFloor = speed * (attacker.car.boosting ? 0.96 : 0.86);
      attacker.ramMomentumTimer = attacker.car.boosting ? 0.32 : 0.12;
      const av = attacker.body.linvel();
      attacker.body.setLinvel(
        {
          x: av.x - side * 0.8,
          y: 0,
          z: Math.max(av.z, attacker.ramSpeedFloor),
        },
        true,
      );
      if (sim.online || attacker.car.id === 0) {
        attacker.takedowns++;
        attacker.car.nitro = Math.min(1, attacker.car.nitro + 0.12);
        attacker.impact = Math.max(attacker.impact, 0.7);
      }
      if (sim.online || victim.car.id === 0) victim.impact = 1;
    } else {
      // Rapier supplies the solid contact response. A small lateral impulse makes a
      // rubbing panel or rear bump legible and gives both drivers room to recover.
      const vv = victim.body.linvel();
      const av = attacker.body.linvel();
      const shove = 1.3 + intensity * 2.2;
      victim.body.setLinvel(
        { x: clamp(vv.x + side * shove, -14, 14), y: 0, z: Math.max(0, vv.z) },
        true,
      );
      attacker.body.setLinvel(
        { x: av.x - side * shove * 0.25, y: 0, z: Math.max(0, av.z) },
        true,
      );
    }
    sim.collisionEvents.push({
      id: nextCollisionId++,
      kind: canWreck ? (attacker.car.id === 0 ? "takedown" : "wreck") : "hit",
      attackerId: attacker.car.id,
      victimId: victim.car.id,
      distance: victim.car.distance,
      offset: victim.car.offset,
      intensity,
      speed,
      side,
    });
    if (sim.collisionEvents.length > 32)
      sim.collisionEvents.splice(0, sim.collisionEvents.length - 32);
  }

  function beginCrash(driver: Driver, side: number, impactSpeed: number) {
    const car = driver.car;
    car.crashDuration = 1.6;
    car.crashTimer = car.crashDuration;
    car.crashSide = side;
    car.crashTravel = 0;
    driver.crashThrow = clamp(
      Math.max(driver.velocityZ, impactSpeed * 0.8) * 0.9,
      20,
      65,
    );
    driver.ramMomentumTimer = 0;
    driver.aiBoostRemaining = 0;
    driver.crashStartOffset = car.offset;
    driver.crashTargetOffset = clamp(
      car.offset + side * 3.2,
      -roadHalfWidth + 1.4,
      roadHalfWidth - 1.4,
    );
    driver.recoverySpeed = clamp(
      Math.max(car.speed, driver.velocityZ) * 0.58,
      28,
      48,
    );
    car.speed *= 0.4;
    car.boosting = false;
    car.drifting = false;
    driver.slide = 0;
    driver.steer = 0;
    driver.body.setEnabled(false);
    // Logical distance freezes while wrecked. Renderers can tumble/throw the car
    // using crashTimer and crashSide without awarding a false lap or finish.
    driver.body.setTranslation({ x: car.offset, y: 0, z: car.distance }, true);
    driver.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  function updateCrash(driver: Driver, dt: number) {
    const car = driver.car;
    car.crashTimer = Math.max(0, car.crashTimer - dt);
    const progress = clamp(1 - car.crashTimer / car.crashDuration, 0, 1);
    const eased = 1 - (1 - progress) ** 2;
    car.crashTravel =
      (driver.crashThrow * (1 - Math.exp(-progress * 2.4))) /
      (1 - Math.exp(-2.4));
    car.offset =
      driver.crashStartOffset +
      (driver.crashTargetOffset - driver.crashStartOffset) * eased;
    car.speed = approach(car.speed, 0, 4, dt);
    car.yaw = car.crashSide * Math.sin(progress * Math.PI) * 0.65;
    if (car.crashTimer > 1e-8) return;
    const lanes = [-6.4, -4.25, -2.1, 0, 2.1, 4.25, 6.4];
    const lane = lanes
      .filter((offset) =>
        drivers.every(
          (other) =>
            other === driver ||
            other.car.finished ||
            other.car.crashTimer > 0 ||
            Math.abs(other.car.offset - offset) > 2.6 ||
            Math.abs(other.car.distance - car.distance) >
              Math.max(
                10,
                Math.abs(other.car.speed - driver.recoverySpeed) * 0.3 + 6,
              ),
        ),
      )
      .sort(
        (a, b) =>
          Math.abs(a - driver.crashStartOffset) -
          Math.abs(b - driver.crashStartOffset),
      )[0];
    if (lane === undefined) {
      // Stay non-solid until there is room instead of respawning inside a pack.
      car.crashTimer = dt;
      return;
    }
    car.crashTimer = 0;
    car.crashTravel = 0;
    car.offset = lane;
    car.yaw = 0;
    car.speed = driver.recoverySpeed;
    car.invulnerable = 1.5;
    driver.targetLane = lane;
    driver.hitWall = false;
    driver.contactCooldown = 0.3;
    driver.body.setTranslation({ x: lane, y: 0, z: car.distance }, true);
    driver.body.setLinvel({ x: 0, y: 0, z: car.speed }, true);
    driver.body.setEnabled(true);
    driver.velocityX = 0;
    driver.velocityZ = car.speed;
  }

  function drivePlayer(driver: Driver, input: Controls, dt: number) {
    const car = driver.car;
    const curvature = sampleTrack(car.distance).curvature;
    driver.steer = approach(driver.steer, input.steer, 13, dt);
    const driftRequested =
      input.brake && Math.abs(driver.steer) > 0.17 && car.speed > 20;
    driver.slide = approach(
      driver.slide,
      driftRequested ? 1 : 0,
      driftRequested ? 8 : 4.5,
      dt,
    );
    car.drifting = driver.slide > 0.3 && car.speed > 18;
    if (!input.nitro) driver.boostExhausted = false;
    car.boosting =
      input.nitro &&
      !input.brake &&
      input.throttle &&
      !driver.boostExhausted &&
      car.nitro > 0.006 &&
      car.speed > 7;
    if (car.boosting) {
      car.nitro = Math.max(0, car.nitro - dt * 0.235);
      if (car.nitro <= 0.006) driver.boostExhausted = true;
    } else {
      const regeneration =
        car.speed > 8
          ? 0.026 + (car.drifting ? 0.165 * Math.abs(driver.steer) : 0)
          : 0;
      car.nitro = Math.min(1, car.nitro + dt * regeneration);
    }
    if (car.drifting)
      driver.driftScore += dt * car.speed * Math.abs(driver.steer) * 1.7;

    const topSpeed = car.boosting ? 109 : 83;
    const accelerator = input.throttle || driftRequested;
    let acceleration = accelerator
      ? (car.boosting ? 31 : 21) * (1 - (car.speed / topSpeed) ** 2)
      : -2.4;
    acceleration -= 0.45 + car.speed * car.speed * 0.000055;
    if (input.brake) acceleration -= driftRequested ? 8.5 : 36;
    acceleration -= driver.slide * 1.5;
    if (driver.hitWall && Math.sign(input.steer) === Math.sign(car.offset))
      acceleration -= 6;
    const speed = clamp(car.speed + acceleration * dt, 0, 114);

    const steeringAuthority =
      (5.4 + 6.5 * Math.min(speed / 85, 1)) * Math.min(speed / 9, 1);
    const centerAssist = Math.abs(input.steer) < 0.08 ? -car.offset * 0.12 : 0;
    const curveSlip =
      -curvature * speed * speed * (0.006 + driver.slide * 0.008);
    // Handbrake rotation creates slip and boost charge without amplifying a held
    // digital steering key into an immediate rail hit. Tire grip still recovers slowly.
    const targetLateral =
      driver.steer * steeringAuthority * (1 - driver.slide * 0.28) +
      curveSlip +
      centerAssist;
    const grip = 8.4 - driver.slide * 5.2;
    let lateral = approach(driver.body.linvel().x, targetLateral, grip, dt);
    lateral = clamp(lateral, -17.5, 17.5);
    const targetYaw =
      Math.atan2(lateral, Math.max(14, speed)) +
      driver.steer * driver.slide * 0.34;
    car.yaw = approach(car.yaw, targetYaw, 10, dt);
    driver.body.setLinvel({ x: lateral, y: 0, z: speed }, true);
  }

  function driveRival(driver: Driver, dt: number) {
    const car = driver.car;
    const tuning = DIFFICULTIES[sim.difficulty];
    const curvature = Math.abs(sampleTrack(car.distance + 26).curvature);
    let targetSpeed =
      (tuning.pace - car.id * tuning.spread) *
      clamp(1 - curvature * tuning.curvePenalty, 0.78, 1);
    // Rivals plan ahead and yield space. Their speed advantage never changes based on
    // race position, and they never teleport, draft through the player, or steal boost.
    let desiredLane = driver.targetLane;
    let blocked = false;
    let passingOpportunity = false;
    driver.aiDecisionCooldown = Math.max(0, driver.aiDecisionCooldown - dt);
    driver.aiBoostCooldown = Math.max(0, driver.aiBoostCooldown - dt);
    for (const other of drivers) {
      if (other === driver || other.car.finished || other.car.crashTimer > 0)
        continue;
      const gap = other.car.distance - car.distance;
      if (gap > 0 && gap < 70 && Math.abs(other.car.offset - car.offset) > 2.7)
        passingOpportunity = true;
      if (
        gap > 0 &&
        gap < tuning.anticipation &&
        Math.abs(other.car.offset - car.offset) < 2.7
      ) {
        blocked = true;
        targetSpeed = Math.min(
          targetSpeed,
          other.car.speed + Math.max(0, (gap - 6.5) * 0.75),
        );
        if (driver.aiDecisionCooldown > 0) continue;
        driver.aiDecisionCooldown = tuning.reaction;
        const options = [-5.3, -2.65, 0, 2.65, 5.3].filter((lane) =>
          drivers.every(
            (check) =>
              check === driver ||
              check.car.finished ||
              check.car.crashTimer > 0 ||
              (Math.abs(check.car.distance - car.distance) > 10 &&
                (Math.abs(check.car.distance - car.distance) >
                  tuning.anticipation * 0.65 ||
                  Math.abs(check.car.offset - lane) > 2.65)) ||
              (Math.abs(check.car.offset - lane) > 2.65 &&
                (check.car.offset < Math.min(lane, car.offset) - 2.3 ||
                  check.car.offset > Math.max(lane, car.offset) + 2.3)),
          ),
        );
        if (options.length)
          desiredLane = options.sort((a, b) => laneScore(b) - laneScore(a))[0];
      }
    }
    driver.targetLane = desiredLane;
    const clearForBoost =
      !blocked &&
      curvature < (sim.difficulty === "expert" ? 0.006 : 0.0045) &&
      car.speed > 55;
    if (
      driver.aiBoostRemaining <= 0 &&
      driver.aiBoostCooldown <= 0 &&
      clearForBoost &&
      car.nitro >= 0.4 &&
      (passingOpportunity || sim.elapsed > 7 + car.id)
    ) {
      driver.aiBoostRemaining = Math.min(
        tuning.boostDuration,
        car.nitro / 0.235,
      );
    }
    car.boosting =
      driver.aiBoostRemaining > 0 && clearForBoost && car.nitro > 0.006;
    if (car.boosting) {
      targetSpeed += tuning.boostSpeed;
      car.nitro = Math.max(0, car.nitro - dt * 0.235);
      driver.aiBoostRemaining = Math.max(0, driver.aiBoostRemaining - dt);
    } else car.nitro = Math.min(1, car.nitro + dt * tuning.recharge);
    if (driver.aiBoostRemaining > 0 && (!clearForBoost || car.nitro <= 0.006))
      driver.aiBoostRemaining = 0;
    if (driver.aiBoostRemaining <= 0 && car.boosting)
      driver.aiBoostCooldown = tuning.boostCooldown + car.id * 0.3;
    if (!clearForBoost && driver.aiBoostCooldown <= 0)
      driver.aiBoostCooldown = 0.6;
    const acceleration = clamp(
      (targetSpeed - car.speed) * 1.2,
      -23,
      (car.boosting ? tuning.boostAcceleration : tuning.acceleration) +
        car.id * 0.12,
    );
    const lateralTarget = clamp(
      (desiredLane - car.offset) * 1.8,
      -tuning.lateral,
      tuning.lateral,
    );
    const lateral = approach(driver.body.linvel().x, lateralTarget, 6, dt);
    car.yaw = approach(
      car.yaw,
      Math.atan2(lateral, Math.max(12, car.speed)),
      8,
      dt,
    );
    driver.body.setLinvel(
      { x: lateral, y: 0, z: Math.max(0, car.speed + acceleration * dt) },
      true,
    );
    function laneScore(lane: number) {
      let freeAhead = tuning.anticipation;
      for (const other of drivers) {
        if (other === driver || other.car.finished || other.car.crashTimer > 0)
          continue;
        const gap = other.car.distance - car.distance;
        if (gap > -4 && Math.abs(other.car.offset - lane) < 2.65)
          freeAhead = Math.min(freeAhead, Math.max(0, gap));
      }
      return (
        freeAhead -
        Math.abs(lane - car.offset) * (sim.difficulty === "rookie" ? 5 : 1.8)
      );
    }
  }

  sim.reset();
  return sim;
}

function cloneSnapshot(snapshot: OnlineSnapshot): OnlineSnapshot {
  return {
    ...snapshot,
    vehicles: [{ ...snapshot.vehicles[0] }, { ...snapshot.vehicles[1] }],
    drivers: [{ ...snapshot.drivers[0] }, { ...snapshot.drivers[1] }],
    collisionEvents: snapshot.collisionEvents.map((event) => ({ ...event })),
  };
}

function makeVehicle(
  id: number,
  name: string,
  color: string,
  distance: number,
  offset: number,
): Vehicle {
  return {
    id,
    name,
    color,
    distance,
    offset,
    speed: 0,
    yaw: 0,
    drifting: false,
    boosting: false,
    nitro: 0.72,
    finished: false,
    crashTimer: 0,
    crashDuration: 1.6,
    crashSide: 1,
    crashTravel: 0,
    invulnerable: 0,
  };
}
