import type { OnlineSnapshot } from "./simulation";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const integer = (value: unknown, min: number, max: number): value is number =>
  number(value, min, max) && Number.isSafeInteger(value);
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const driverId = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const time = (value: unknown) => number(value, 0, 3600);
const distance = (value: unknown) => number(value, -10000, 1000000);
const name = (value: unknown) =>
  typeof value === "string" && /^[\p{L}\p{N} _.-]{1,32}$/u.test(value);

/** Pure wire validation shared by browser transport and room API; no physics runtime. */
export function validOnlineSnapshot(value: unknown): value is OnlineSnapshot {
  if (
    !object(value) ||
    value.version !== 1 ||
    !["ready", "countdown", "racing", "finished"].includes(
      value.phase as string,
    ) ||
    !["rookie", "pro", "expert"].includes(value.difficulty as string) ||
    !time(value.elapsed) ||
    !number(value.countdown, -0.02, 3) ||
    !integer(value.totalLaps, 1, 3) ||
    !bool(value.raceComplete) ||
    !(
      value.finishGraceRemaining === null ||
      number(value.finishGraceRemaining, 0, 30)
    ) ||
    !Array.isArray(value.vehicles) ||
    value.vehicles.length !== 2 ||
    !Array.isArray(value.drivers) ||
    value.drivers.length !== 2 ||
    !Array.isArray(value.collisionEvents) ||
    value.collisionEvents.length > 64
  )
    return false;

  for (let id = 0; id < 2; id++) {
    const vehicle: unknown = value.vehicles[id],
      stats: unknown = value.drivers[id];
    if (
      !object(vehicle) ||
      vehicle.id !== id ||
      !name(vehicle.name) ||
      typeof vehicle.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(vehicle.color) ||
      !distance(vehicle.distance) ||
      !number(vehicle.offset, -50, 50) ||
      !number(vehicle.speed, 0, 250) ||
      !number(vehicle.yaw, -Math.PI * 20, Math.PI * 20) ||
      !number(vehicle.nitro, 0, 1) ||
      !bool(vehicle.drifting) ||
      !bool(vehicle.boosting) ||
      !bool(vehicle.finished) ||
      !number(vehicle.crashTimer, 0, 10) ||
      !number(vehicle.crashDuration, 0, 10) ||
      (vehicle.crashTimer > 0 &&
        (vehicle.crashDuration <= 0 ||
          vehicle.crashTimer > vehicle.crashDuration + 0.05)) ||
      !number(vehicle.crashSide, -1, 1) ||
      !number(vehicle.crashTravel, 0, 100) ||
      !number(vehicle.invulnerable, 0, 30)
    )
      return false;
    if (
      !object(stats) ||
      stats.id !== id ||
      !integer(stats.position, 1, 2) ||
      !integer(stats.lap, 1, value.totalLaps) ||
      !time(stats.bestLap) ||
      !time(stats.lastLap) ||
      !number(stats.driftScore, 0, 100000000) ||
      !number(stats.impact, 0, 2) ||
      !integer(stats.takedowns, 0, 1000000) ||
      !(stats.finishTime === null || time(stats.finishTime)) ||
      !bool(stats.dnf)
    )
      return false;
  }
  for (const event of value.collisionEvents) {
    if (
      !object(event) ||
      !integer(event.id, 1, Number.MAX_SAFE_INTEGER) ||
      !["hit", "takedown", "wreck"].includes(event.kind as string) ||
      !driverId(event.attackerId) ||
      !driverId(event.victimId) ||
      event.attackerId === event.victimId ||
      !distance(event.distance) ||
      !number(event.offset, -50, 50) ||
      !number(event.intensity, 0, 1) ||
      !number(event.speed, 0, 250) ||
      !number(event.side, -1, 1)
    )
      return false;
  }
  return true;
}
