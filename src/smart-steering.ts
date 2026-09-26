import type { Controls, Vehicle } from "./simulation";

/** Local driving assistance: it only produces normal controls, never moves a car. */
export function smartControls(
  car: Pick<Vehicle, "offset" | "speed" | "yaw" | "drifting">,
  manual: Controls,
  enabled: boolean,
  curvature: number,
  targetLane = 0,
): Controls {
  if (!enabled) return { ...manual };
  if (manual.brake) return { ...manual, throttle: false, nitro: false };
  if (Math.abs(manual.steer) > 0.05) return { ...manual, throttle: true };
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const speed = clamp(car.speed, 0, 114);
  const authority = Math.max(
    4,
    (5.4 + 6.5 * Math.min(speed / 85, 1)) * Math.min(speed / 9, 1),
  );
  // Yaw estimates sideways motion without reading private Rapier state. During
  // a drift it also contains body rotation, so don't mistake that for velocity.
  const lateral = car.drifting
    ? 0
    : clamp(Math.tan(clamp(car.yaw, -0.3, 0.3)) * Math.max(14, speed), -10, 10);
  const desired = clamp(
    1.4 * (clamp(targetLane, -3.2, 3.2) - car.offset) - lateral * 0.35,
    -4.5,
    4.5,
  );
  let steer = clamp(
    (desired + curvature * speed * speed * 0.006) / authority,
    -0.65,
    0.65,
  );
  // Recover promptly after the player releases steering near a barrier.
  const predicted = car.offset + lateral * 0.25;
  if (Math.abs(predicted) > 6.5) steer = -Math.sign(predicted);
  return {
    ...manual,
    steer,
    throttle: true,
  };
}
