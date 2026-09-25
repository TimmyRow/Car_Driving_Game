import RAPIER from "@dimforge/rapier3d-compat";
import { roadHalfWidth, sampleTrack, trackLength } from "./track";

export interface Controls {
  steer: number;
  throttle: boolean;
  brake: boolean;
  nitro: boolean;
}
export type RaceMode = "race" | "time-trial";
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
  reset(mode?: RaceMode): void;
  start(): void;
  step(dt: number, input: Controls): void;
  dispose(): void;
}

const FIXED_DT = 1 / 120;
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
  targetLane: number;
  contactCooldown: number;
  velocityX: number;
  velocityZ: number;
  crashStartOffset: number;
  crashTargetOffset: number;
  recoverySpeed: number;
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
  let nextLapDistance = trackLength;
  let lapStartedAt = 0;
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
    reset(nextMode) {
      if (disposed) return;
      mode = nextMode ?? mode;
      if (world) world.free();
      if (events) events.free();
      world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      world.timestep = FIXED_DT;
      events = new RAPIER.EventQueue(true);
      colliderDrivers = new Map();
      accumulator = 0;
      nextLapDistance = trackLength;
      lapStartedAt = 0;
      nextCollisionId = 1;
      contactCooldowns.clear();
      sim.player = makeVehicle(0, "YOU", "#f4fa4a", -23, 3.7);
      sim.rivals =
        mode === "race"
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
        position: sim.rivals.length + 1,
        lap: 1,
        totalLaps: mode === "race" ? 2 : 1,
        bestLap: 0,
        lastLap: 0,
        driftScore: 0,
        impact: 0,
        takedowns: 0,
        collisionEvents: [],
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
          targetLane: car.offset,
          contactCooldown: 0,
          velocityX: 0,
          velocityZ: 0,
          crashStartOffset: car.offset,
          crashTargetOffset: car.offset,
          recoverySpeed: 0,
        };
        colliderDrivers.set(collider.handle, driver);
        return driver;
      });
      const wallLength = trackLength * 3 + 300;
      for (const side of [-1, 1]) {
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.5, 2, wallLength / 2)
            .setTranslation(
              side * (roadHalfWidth + 0.5),
              0,
              wallLength / 2 - 100,
            )
            .setFriction(0.01)
            .setRestitution(0.12),
        );
      }
    },
    start() {
      if (!disposed && sim.phase === "ready") sim.phase = "countdown";
    },
    step(dt, input) {
      if (
        disposed ||
        sim.phase === "ready" ||
        sim.phase === "finished" ||
        !Number.isFinite(dt) ||
        dt <= 0
      )
        return;
      // A tab resuming after suspension must not fast-forward an entire race.
      accumulator += Math.min(dt, 0.25);
      const controls = {
        ...input,
        steer: clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1),
      };
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

  function tick(input: Controls) {
    const dt = FIXED_DT;
    const previousDistance = sim.player.distance;
    const previousTime = sim.elapsed;
    sim.elapsed += dt;
    sim.impact = Math.max(0, sim.impact - dt * 2.8);
    const oldDistances = drivers.map((d) => d.car.distance);
    for (const driver of drivers) {
      driver.contactCooldown = Math.max(0, driver.contactCooldown - dt);
      driver.car.invulnerable = Math.max(0, driver.car.invulnerable - dt);
      if (driver.car.finished) {
        // Finishers clear the line and cannot become a stationary roadblock.
        driver.car.distance += driver.car.speed * dt;
        continue;
      }
      if (driver.car.crashTimer > 0) {
        updateCrash(driver, dt);
        continue;
      }
      if (driver.car.id === 0) drivePlayer(driver, input, dt);
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
      const playerContact =
        da?.car.id === 0 ? da : db?.car.id === 0 ? db : undefined;
      if (
        playerContact &&
        playerContact.contactCooldown <= 0 &&
        playerContact.car.speed > 8
      ) {
        sim.impact = Math.max(sim.impact, da && db ? 0.5 : 0.72);
        playerContact.contactCooldown = 0.28;
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
      // A glancing rail contact scrubs speed once, then permits an immediate recovery.
      const atWall = Math.abs(car.offset) > roadHalfWidth - 1.07;
      if (atWall && !driver.hitWall && car.speed > 12) {
        car.speed *= car.id === 0 ? 0.84 : 0.91;
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
        driver.finishTime = previousTime + fraction * dt;
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
    if (sim.player.crashTimer <= 0 && sim.player.distance >= nextLapDistance) {
      const fraction = clamp(
        (nextLapDistance - previousDistance) /
          Math.max(0.001, sim.player.distance - previousDistance),
        0,
        1,
      );
      const crossedAt = sim.player.finished
        ? drivers[0].finishTime
        : previousTime + fraction * dt;
      sim.lastLap = crossedAt - lapStartedAt;
      sim.bestLap =
        sim.bestLap > 0 ? Math.min(sim.bestLap, sim.lastLap) : sim.lastLap;
      lapStartedAt = crossedAt;
      nextLapDistance += trackLength;
      sim.lap = Math.min(sim.totalLaps, sim.lap + 1);
    }
    sim.position =
      1 +
      drivers
        .slice(1)
        .filter((d) =>
          sim.player.finished
            ? d.finishTime < drivers[0].finishTime
            : d.car.distance > sim.player.distance,
        ).length;
    if (sim.player.finished) {
      sim.elapsed = drivers[0].finishTime;
      sim.phase = "finished";
    }
  }

  function handleCarContact(a: Driver, b: Driver) {
    if (
      a.car.finished ||
      b.car.finished ||
      a.car.crashTimer > 0 ||
      b.car.crashTimer > 0
    )
      return;
    const key = `${Math.min(a.car.id, b.car.id)}:${Math.max(a.car.id, b.car.id)}`;
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
      attacker.car.boosting && speed > 42 && closing > (sideContact ? 2 : 4);
    const hardImpact =
      speed > (sideContact ? 48 : 42) && closing > (sideContact ? 7.5 : 18);
    const canWreck = victim.car.invulnerable <= 0 && (boostedRam || hardImpact);
    const side =
      Math.sign(victim.car.offset - attacker.car.offset) ||
      Math.sign(victim.car.offset) ||
      (victim.car.id % 2 ? -1 : 1);
    if (canWreck) {
      beginCrash(victim, side);
      const av = attacker.body.linvel();
      attacker.body.setLinvel(
        {
          x: av.x - side * 0.8,
          y: 0,
          z: Math.max(av.z, speed * (attacker.car.boosting ? 0.94 : 0.82)),
        },
        true,
      );
      if (attacker.car.id === 0) {
        sim.takedowns++;
        attacker.car.nitro = Math.min(1, attacker.car.nitro + 0.12);
        sim.impact = Math.max(sim.impact, 0.7);
      }
      if (victim.car.id === 0) sim.impact = 1;
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
    });
    if (sim.collisionEvents.length > 32)
      sim.collisionEvents.splice(0, sim.collisionEvents.length - 32);
  }

  function beginCrash(driver: Driver, side: number) {
    const car = driver.car;
    car.crashDuration = 1.1;
    car.crashTimer = car.crashDuration;
    car.crashSide = side;
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
      sim.driftScore += dt * car.speed * Math.abs(driver.steer) * 1.7;

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
    const curvature = Math.abs(sampleTrack(car.distance + 26).curvature);
    let targetSpeed =
      (84.8 - car.id * 0.72) * clamp(1 - curvature * 2, 0.78, 1);
    // Rivals plan ahead and yield space. Their speed advantage never changes based on
    // race position, and they never teleport, draft through the player, or steal boost.
    let desiredLane = driver.targetLane;
    let blocked = false;
    for (const other of drivers) {
      if (other === driver || other.car.finished || other.car.crashTimer > 0)
        continue;
      const gap = other.car.distance - car.distance;
      if (
        gap > 0 &&
        gap < 28 &&
        Math.abs(other.car.offset - car.offset) < 2.7
      ) {
        blocked = true;
        targetSpeed = Math.min(
          targetSpeed,
          other.car.speed + Math.max(0, (gap - 6.5) * 0.75),
        );
        const options = [-5.3, -2.65, 0, 2.65, 5.3].filter((lane) =>
          drivers.every(
            (check) =>
              check === driver ||
              check.car.crashTimer > 0 ||
              Math.abs(check.car.distance - car.distance) > 24 ||
              Math.abs(check.car.offset - lane) > 2.65,
          ),
        );
        if (options.length)
          desiredLane = options.sort(
            (a, b) => Math.abs(a - car.offset) - Math.abs(b - car.offset),
          )[0];
      }
    }
    driver.targetLane = desiredLane;
    car.boosting =
      !blocked &&
      curvature < 0.0035 &&
      car.nitro > 0.15 &&
      car.speed > 62 &&
      Math.sin(sim.elapsed * 0.32 + car.id * 3) > 0.84;
    if (car.boosting) {
      targetSpeed += 8;
      car.nitro = Math.max(0, car.nitro - dt * 0.2);
    } else car.nitro = Math.min(1, car.nitro + dt * 0.026);
    const acceleration = clamp(
      (targetSpeed - car.speed) * 1.2,
      -23,
      13.5 + car.id * 0.15,
    );
    const lateralTarget = clamp((desiredLane - car.offset) * 1.8, -4.5, 4.5);
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
  }

  sim.reset();
  return sim;
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
    crashDuration: 1.1,
    crashSide: 1,
    invulnerable: 0,
  };
}
