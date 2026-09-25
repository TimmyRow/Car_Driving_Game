export const roadHalfWidth = 9;
const controls = [
  [0, 12, -180],
  [0, 13, 0],
  [24, 18, 165],
  [115, 24, 280],
  [255, 26, 242],
  [340, 20, 118],
  [268, 14, -44],
  [306, 12, -218],
  [198, 10, -356],
  [45, 10, -370],
  [-66, 11, -285],
];
export type TrackPoint = { x: number; y: number; z: number };
function spline(t: number): TrackPoint {
  const n = controls.length,
    i = Math.floor(t) % n,
    f = t - Math.floor(t);
  const a = controls[(i + n - 1) % n],
    b = controls[i],
    c = controls[(i + 1) % n],
    d = controls[(i + 2) % n];
  const axis = (j: number) =>
    0.5 *
    (2 * b[j] +
      (-a[j] + c[j]) * f +
      (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * f * f +
      (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * f * f * f);
  return { x: axis(0), y: axis(1), z: axis(2) };
}
const resolution = 4096;
export const trackPoints: TrackPoint[] = Array.from(
  { length: resolution + 1 },
  (_, i) => spline((i / resolution) * controls.length),
);
const lengths = new Float64Array(resolution + 1);
for (let i = 1; i <= resolution; i++) {
  const a = trackPoints[i - 1],
    b = trackPoints[i];
  lengths[i] = lengths[i - 1] + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export const trackLength = lengths[resolution];
function point(distance: number): TrackPoint {
  const s = ((distance % trackLength) + trackLength) % trackLength;
  let lo = 0,
    hi = resolution;
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1;
    if (lengths[m] <= s) lo = m;
    else hi = m;
  }
  const f = (s - lengths[lo]) / (lengths[hi] - lengths[lo]),
    a = trackPoints[lo],
    b = trackPoints[hi];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
  };
}
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
export function sampleTrack(distance: number, lateral = 0) {
  const p = point(distance),
    before = point(distance - 2),
    after = point(distance + 2);
  const heading = Math.atan2(after.x - before.x, after.z - before.z);
  const headingA = Math.atan2(p.x - before.x, p.z - before.z),
    headingB = Math.atan2(after.x - p.x, after.z - p.z);
  return {
    x: p.x + Math.cos(heading) * lateral,
    y: p.y,
    z: p.z - Math.sin(heading) * lateral,
    heading,
    curvature: angle(headingB - headingA) / 2,
  };
}
