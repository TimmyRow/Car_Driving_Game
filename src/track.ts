export const roadHalfWidth = 9;
export type TrackId = "riviera" | "canyon" | "alpine";
export type TrackPoint = { x: number; y: number; z: number };
export type TrackSample = TrackPoint & { heading: number; curvature: number };
export interface TrackDefinition {
  id: TrackId;
  theme: TrackId;
  name: string;
  region: string;
  description: string;
  accent: string;
  length: number;
  points: TrackPoint[];
  sample(distance: number, lateral?: number): TrackSample;
  lighting: {
    horizon: string;
    zenith: string;
    fog: string;
    sun: string;
    direction: [number, number, number];
    exposure: number;
    density: number;
  };
}
const resolution = 4096;
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
function buildTrack(
  meta: Omit<TrackDefinition, "length" | "points" | "sample">,
  controls: number[][],
  scale: number,
): TrackDefinition {
  const pts = controls.map((p) => [p[0] * scale, p[1], p[2] * scale]);
  function spline(t: number): TrackPoint {
    const n = pts.length,
      i = Math.floor(t) % n,
      f = t - Math.floor(t);
    const a = pts[(i + n - 1) % n],
      b = pts[i],
      c = pts[(i + 1) % n],
      d = pts[(i + 2) % n];
    const axis = (j: number) =>
      0.5 *
      (2 * b[j] +
        (-a[j] + c[j]) * f +
        (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * f * f +
        (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * f * f * f);
    return { x: axis(0), y: axis(1), z: axis(2) };
  }
  const points = Array.from({ length: resolution + 1 }, (_, i) =>
    spline((i / resolution) * pts.length),
  );
  const lengths = new Float64Array(resolution + 1);
  for (let i = 1; i <= resolution; i++) {
    const a = points[i - 1],
      b = points[i];
    lengths[i] = lengths[i - 1] + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  const length = lengths[resolution];
  function point(distance: number): TrackPoint {
    const s = ((distance % length) + length) % length;
    let lo = 0,
      hi = resolution;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (lengths[m] <= s) lo = m;
      else hi = m;
    }
    const f = (s - lengths[lo]) / (lengths[hi] - lengths[lo]),
      a = points[lo],
      b = points[hi];
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
    };
  }
  function sample(distance: number, lateral = 0): TrackSample {
    const p = point(distance),
      before = point(distance - 2),
      after = point(distance + 2);
    const heading = Math.atan2(after.x - before.x, after.z - before.z);
    const a = Math.atan2(p.x - before.x, p.z - before.z),
      b = Math.atan2(after.x - p.x, after.z - p.z);
    return {
      x: p.x + Math.cos(heading) * lateral,
      y: p.y,
      z: p.z - Math.sin(heading) * lateral,
      heading,
      curvature: angle(b - a) / 2,
    };
  }
  return { ...meta, length, points, sample };
}
export const TRACKS: TrackDefinition[] = [
  buildTrack(
    {
      id: "riviera",
      theme: "riviera",
      name: "Riviera Run",
      region: "THE SUN COAST",
      description:
        "Cliffside sweepers, a marina promenade and open Mediterranean sky.",
      accent: "#55d6ca",
      lighting: {
        horizon: "#93c8d4",
        zenith: "#246ba1",
        fog: "#a3c9d6",
        sun: "#fff1d2",
        direction: [-0.58, 0.54, -0.61],
        exposure: 0.9,
        density: 0.00032,
      },
    },
    [
      [0, 12, -180],
      [0, 13, 0],
      [24, 18, 165],
      [115, 28, 280],
      [255, 32, 242],
      [340, 23, 118],
      [268, 17, -44],
      [306, 14, -218],
      [198, 10, -356],
      [45, 10, -370],
      [-66, 11, -285],
    ],
    1.82,
  ),
  buildTrack(
    {
      id: "canyon",
      theme: "canyon",
      name: "Ember Canyon",
      region: "THE REDLANDS",
      description:
        "High desert straights, sandstone arches and a twisting canyon pass.",
      accent: "#f6a367",
      lighting: {
        horizon: "#e5b59a",
        zenith: "#738ead",
        fog: "#d3af93",
        sun: "#ffd6a0",
        direction: [-0.65, 0.44, 0.38],
        exposure: 0.88,
        density: 0.00032,
      },
    },
    [
      [-190, 21, -290],
      [-260, 27, -50],
      [-210, 48, 210],
      [-40, 65, 340],
      [165, 56, 380],
      [290, 44, 265],
      [235, 26, 70],
      [345, 20, -95],
      [290, 30, -290],
      [110, 39, -380],
      [-45, 28, -350],
    ],
    1.84,
  ),
  buildTrack(
    {
      id: "alpine",
      theme: "alpine",
      name: "Aster Ridge",
      region: "THE HIGH COUNTRY",
      description:
        "Mountain switchbacks, pine valleys and a sweeping high viaduct.",
      accent: "#b9d8f0",
      lighting: {
        horizon: "#d0dce6",
        zenith: "#537da9",
        fog: "#c0d2df",
        sun: "#fff2dd",
        direction: [0.55, 0.6, -0.45],
        exposure: 0.92,
        density: 0.00029,
      },
    },
    [
      [-150, 48, -350],
      [-235, 52, -125],
      [-290, 77, 105],
      [-175, 95, 340],
      [10, 88, 410],
      [160, 66, 285],
      [305, 43, 325],
      [400, 37, 105],
      [325, 65, -100],
      [220, 91, -285],
      [30, 71, -390],
    ],
    1.72,
  ),
];
export function getTrack(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
export let activeTrack = TRACKS[0];
export let trackLength = activeTrack.length;
export let trackPoints = activeTrack.points;
export function selectTrack(id: TrackId) {
  activeTrack = getTrack(id);
  trackLength = activeTrack.length;
  trackPoints = activeTrack.points;
  return activeTrack;
}
export function sampleTrack(distance: number, lateral = 0) {
  return activeTrack.sample(distance, lateral);
}
