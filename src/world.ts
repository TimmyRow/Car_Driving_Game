import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sampleTrack, trackLength, roadHalfWidth, activeTrack } from "./track";
import {
  createRegionalWorld,
  addRivieraDistrict,
} from "./regional-environments";

const timeUniform = { value: 0 };
let terrainTexture: THREE.Texture;
let terrainNormal: THREE.Texture;
export let worldAssetsReady: Promise<void> = Promise.resolve();
const textureLoader = new THREE.TextureLoader();
let assetTasks: Promise<unknown>[] = [];
const textureCache = new Map<
  string,
  { texture: THREE.Texture; ready: Promise<void> }
>();
function bundledTexture(file: string, color = true) {
  const cached = textureCache.get(file);
  if (cached) {
    assetTasks.push(cached.ready);
    return cached.texture;
  }
  let resolve!: () => void, reject!: (reason: Error) => void;
  const ready = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  assetTasks.push(ready);
  const t = textureLoader.load(
    `${import.meta.env.BASE_URL}textures/${file}`,
    () => resolve(),
    undefined,
    () => reject(new Error(`Could not load bundled texture: ${file}`)),
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  textureCache.set(file, { texture: t, ready });
  return t;
}
const islandCenter = new THREE.Vector2();
let seed = 4187;
function rand() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function noise(x: number, z: number) {
  return (
    Math.sin(x * 0.041 + z * 0.031) * Math.cos(z * 0.056 - x * 0.02) +
    Math.sin(x * 0.113 + z * 0.07) * 0.28
  );
}
function terrainHeight(x: number, z: number, f: number, edgeY: number) {
  const dx = x - islandCenter.x,
    dz = z - islandCenter.y;
  const crest =
    37 * Math.exp(-((dx + 22) ** 2 / 4900 + (dz + 66) ** 2 / 4900)) +
    42 * Math.exp(-((dx - 34) ** 2 / 2600 + (dz - 78) ** 2 / 3600)) +
    28 * Math.exp(-((dx + 43) ** 2 / 2300 + (dz - 149) ** 2 / 3500));
  const fade = THREE.MathUtils.smoothstep(f, 0, 0.27);
  const crags =
    Math.abs(noise(x * 2.3, z * 2.3)) * 5.2 + noise(x * 0.85, z * 0.85) * 5;
  return THREE.MathUtils.lerp(edgeY, 16, f) - 0.32 + fade * (crest + crags);
}
const cream = new THREE.MeshStandardMaterial({
  color: "#e9ddc4",
  roughness: 0.86,
});
const chalk = new THREE.MeshStandardMaterial({
  color: "#f4eee3",
  roughness: 0.65,
});
const stone = new THREE.MeshStandardMaterial({
  color: "#baaa8b",
  roughness: 1,
});
const charcoal = new THREE.MeshStandardMaterial({
  color: "#283838",
  roughness: 0.74,
});
const ink = new THREE.MeshStandardMaterial({
  color: "#142a32",
  roughness: 0.6,
});
const acid = new THREE.MeshStandardMaterial({
  color: "#e9f16c",
  roughness: 0.5,
});
const windowMat = new THREE.MeshStandardMaterial({
  color: "#285362",
  metalness: 0.57,
  roughness: 0.18,
});
const terracotta = new THREE.MeshStandardMaterial({
  color: "#bd7050",
  roughness: 0.94,
});
const palmMat = new THREE.MeshStandardMaterial({
  color: "#31593c",
  roughness: 0.9,
  side: THREE.DoubleSide,
});
const wood = new THREE.MeshStandardMaterial({ color: "#867359", roughness: 1 });
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
boxGeometry.userData.shared = true;
for (const material of [
  cream,
  chalk,
  stone,
  charcoal,
  ink,
  acid,
  windowMat,
  terracotta,
  palmMat,
  wood,
])
  material.userData.shared = true;
function mesh(
  group: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
function box(
  group: THREE.Object3D,
  material: THREE.Material,
  size: number[],
  position: number[],
) {
  const m = mesh(
    group,
    boxGeometry,
    material,
    ...(position as [number, number, number]),
  );
  m.scale.set(...(size as [number, number, number]));
  return m;
}
function roadPosition(d: number, lateral: number, y = 0) {
  const p = sampleTrack(d, lateral);
  return new THREE.Vector3(p.x, p.y + y, p.z);
}
function texture(size = 512, ground = false) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const data = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * (ground ? 42 : 21);
    const shade = ground ? 219 : 72;
    data.data[i * 4] = shade + n + (ground ? 8 : 0);
    data.data[i * 4 + 1] = shade + n + (ground ? 5 : 3);
    data.data[i * 4 + 2] = shade + n - (ground ? 8 : -3);
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  if (!ground) {
    for (let i = 0; i < 38; i++) {
      const x = rand() * size,
        y = rand() * size;
      ctx.strokeStyle = `rgba(19,24,28,${0.04 + rand() * 0.12})`;
      ctx.lineWidth = 2 + rand() * 14;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + rand() * 20,
        y + 40,
        x - 10,
        y + 90,
        x + rand() * 25,
        y + 140,
      );
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const x = rand() * size,
        y = rand() * size;
      ctx.strokeStyle = "rgba(20,25,27,.15)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++)
        ctx.lineTo(x + k * 5 + (rand() - 0.5) * 12, y + k * 8);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function limestoneTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!,
    data = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const strata =
        Math.sin(y * 0.24 + Math.sin(x * 0.014) * 1.7) +
        Math.sin(y * 0.067 + Math.sin(x * 0.03) * 0.4) * 1.2;
      const pores = (rand() - 0.5) * 22,
        darkSeam =
          Math.pow(
            Math.max(0, Math.sin(y * 0.135 + Math.sin(x * 0.021) * 0.55)),
            15,
          ) * 27,
        n = strata * 10 + pores - darkSeam,
        k = (y * 512 + x) * 4;
      data.data[k] = 211 + n;
      data.data[k + 1] = 202 + n;
      data.data[k + 2] = 181 + n;
      data.data[k + 3] = 255;
    }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Geometry follows track banking/height samples; distant scenery never changes gameplay.
function ribbon(
  a: number,
  b: number,
  raise: number,
  material: THREE.Material,
  steps: number,
  alternating = false,
) {
  const vertices: number[] = [],
    uv: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const ca = new THREE.Color("#f3eee2"),
    cb = new THREE.Color("#ddea70");
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * trackLength;
    for (const lateral of [a, b]) {
      const p = sampleTrack(d, lateral);
      vertices.push(p.x, p.y + raise, p.z);
      uv.push((lateral - a) / Math.max(1, b - a), d / 20);
      if (alternating) {
        const c = Math.floor(d / 4) % 2 ? ca : cb;
        colors.push(c.r, c.g, c.b);
      }
    }
    if (i < steps) {
      const k = i * 2;
      if (b > a) indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      else indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (alternating)
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}
function cliffRibbon() {
  const pos: number[] = [],
    col: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const steps = Math.ceil(trackLength / 6);
  const bands = [-9.8, -14, -20, -32, -45, -64];
  const shades = [
    "#c5bc9c",
    "#b0b090",
    "#b5ac8e",
    "#9c9480",
    "#a7a08a",
    "#c3bfa7",
  ].map((c) => new THREE.Color(c));
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j < bands.length; j++) {
      const d = (i / steps) * trackLength;
      const p = sampleTrack(d, bands[j]);
      const variation = noise(p.x, p.z);
      const y =
        j === 0
          ? p.y - 0.12
          : j === 1
            ? p.y - 0.35
            : j === 2
              ? p.y - 3 + variation * 1.2
              : j === 3
                ? p.y - 13 + variation * 2
                : j === 4
                  ? -5 + variation * 1.4
                  : -7;
      pos.push(p.x, y, p.z);
      uv.push(p.x / 7, (p.z + y * 0.4) / 7);
      const c = shades[j].clone().multiplyScalar(1.08 + variation * 0.07);
      col.push(c.r, c.g, c.b);
      if (i < steps && j < bands.length - 1) {
        const a = i * bands.length + j,
          b = a + bands.length;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      map: terrainTexture,
      normalMap: terrainNormal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      vertexColors: true,
      roughness: 0.96,
      side: THREE.DoubleSide,
    }),
  );
}
function interiorTerrain() {
  const count = 240,
    radial = 42;
  const v: number[] = [],
    c: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  let cx = 0,
    cz = 0;
  for (let i = 0; i < count; i++) {
    const p = sampleTrack((i / count) * trackLength);
    cx += p.x / count;
    cz += p.z / count;
  }
  islandCenter.set(cx, cz);
  const low = new THREE.Color("#c8c7ae"),
    high = new THREE.Color("#e8ddc3");
  for (let r = 0; r <= radial; r++)
    for (let i = 0; i <= count; i++) {
      const p = sampleTrack((i / count) * trackLength, 10.2);
      const f = r / radial,
        x = THREE.MathUtils.lerp(p.x, cx, f),
        z = THREE.MathUtils.lerp(p.z, cz, f);
      const y = terrainHeight(x, z, f, p.y);
      v.push(x, y, z);
      uv.push(x / 7, z / 7);
      const color = low
        .clone()
        .lerp(high, THREE.MathUtils.clamp(f * 1.3 + noise(x, z) * 0.3, 0, 1));
      color.multiplyScalar(0.93 + noise(x, z) * 0.07);
      c.push(color.r, color.g, color.b);
      if (r < radial && i < count) {
        const a = r * (count + 1) + i,
          b = a + count + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      map: terrainTexture,
      normalMap: terrainNormal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      vertexColors: true,
      roughness: 0.96,
      side: THREE.DoubleSide,
    }),
  );
  m.receiveShadow = true;
  return m;
}

function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const angle = (i * Math.PI * 2) / 9,
      points: number[] = [],
      indices: number[] = [];
    const point = (t: number, side: number) => {
      const len = t * 4.6,
        w = Math.sin(t * Math.PI) * 1.04,
        h = Math.sin(t * Math.PI) * 1.3 - t * 0.7;
      return [
        Math.sin(angle) * len + Math.cos(angle) * w * side,
        h - Math.abs(side) * 0.15,
        Math.cos(angle) * len - Math.sin(angle) * w * side,
      ];
    };
    for (let j = 0; j < 12; j++) {
      const t = j / 12;
      for (const side of [-1, 1]) {
        const a = points.length / 3;
        points.push(
          ...point(t, 0),
          ...point(Math.min(1, t + 0.12), side),
          ...point(Math.min(1, t + 0.092), 0.12 * side),
        );
        indices.push(a, a + 1, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}
function labelTexture(text: string, sub: string, light = false, aspect = 4) {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = Math.round(2048 / aspect);
  const ctx = c.getContext("2d")!;
  const h = c.height,
    w = c.width;
  ctx.fillStyle = light ? "#e8ef77" : "#14272e";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = light ? "#162a30" : "#f4f1df";
  ctx.font = `900 ${Math.round(h * 0.42)}px Arial`;
  ctx.textAlign = "center";
  ctx.letterSpacing = `${Math.round(h * 0.03)}px`;
  ctx.fillText(text, w / 2, h * 0.53);
  ctx.font = `bold ${Math.round(h * 0.14)}px Arial`;
  ctx.letterSpacing = `${Math.round(h * 0.037)}px`;
  ctx.fillText(sub, w / 2, h * 0.82);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function sign(
  group: THREE.Object3D,
  text: string,
  sub: string,
  width: number,
  height: number,
  pos: number[],
  light = false,
) {
  const m = mesh(
    group,
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({
      map: labelTexture(text, sub, light, width / height),
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
    ...(pos as [number, number, number]),
  );
  return m;
}
function batchStatics(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  group.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      !(child instanceof THREE.InstancedMesh) &&
      !Array.isArray(child.material) &&
      !child.userData.keep
    ) {
      const list = batches.get(child.material) || [];
      list.push(child);
      batches.set(child.material, list);
    }
  });
  const inverse = group.matrixWorld.clone().invert();
  for (const [mat, meshes] of batches) {
    if (meshes.length < 3) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.index
        ? m.geometry.toNonIndexed()
        : m.geometry.clone();
      g.applyMatrix4(inverse.clone().multiply(m.matrixWorld));
      if (!g.attributes.uv)
        g.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute(
            new Float32Array(g.attributes.position.count * 2),
            2,
          ),
        );
      return g;
    });
    const g = mergeGeometries(geos);
    if (g) {
      meshes.forEach((m) => m.removeFromParent());
      mesh(group, g, mat);
    }
    geos.forEach((g) => g.dispose());
  }
}
function addVilla(
  group: THREE.Group,
  distance: number,
  lateral: number,
  index: number,
) {
  const p = sampleTrack(distance, lateral),
    g = new THREE.Group();
  g.position.set(p.x, p.y - 0.2, p.z);
  g.rotation.y = p.heading + 0.15;
  group.add(g);
  const w = 8 + (index % 3) * 2,
    h = 5 + (index % 2) * 3,
    depth = 7;
  box(g, stone, [w + 4, 8, depth + 5], [0, -3.95, 0]);
  box(g, chalk, [w, h, depth], [0, h / 2, 0]);
  box(g, cream, [w + 1, 0.25, depth + 1], [0, h + 0.1, 0]);
  box(g, chalk, [w * 0.5, 3, depth * 0.76], [-w * 0.18, h + 1.55, -0.1]);
  box(g, terracotta, [w * 0.6, 0.35, depth * 0.88], [-w * 0.18, h + 3.1, -0.1]);
  for (let level = 0; level < 2; level++)
    for (let x = -1; x <= 1; x++) {
      box(
        g,
        windowMat,
        [1.65, 1.6, 0.035],
        [x * w * 0.29, 1.65 + level * 2.6, -depth / 2 - 0.023],
      );
      for (const s of [-1, 1])
        box(
          g,
          palmMat,
          [0.4, 1.77, 0.12],
          [x * w * 0.29 + s * 1.01, 1.65 + level * 2.6, -depth / 2 - 0.08],
        );
    }
  box(g, chalk, [w + 1, 0.25, 2.4], [0, 2.8, -depth / 2 - 0.8]);
  box(g, wood, [w + 1, 0.08, 0.08], [0, 3.8, -depth / 2 - 1.9]);
  for (let x = -3; x <= 3; x++)
    box(g, wood, [0.055, 1, 0.055], [x * (w / 6), 3.3, -depth / 2 - 1.9]);
  box(g, wood, [w * 0.7, 0.14, 3.3], [w * 0.05, 3.3, depth / 2 + 1.5]);
  for (const s of [-1, 1])
    box(g, chalk, [0.25, 3.3, 0.25], [s * w * 0.31, 1.65, depth / 2 + 2.9]);
}
function lighthouse(group: THREE.Group) {
  const p = sampleTrack(trackLength * 0.34, -29),
    g = new THREE.Group();
  g.position.set(p.x, p.y - 4, p.z);
  group.add(g);
  mesh(g, new THREE.CylinderGeometry(5, 7, 12, 24), stone, 0, -4, 0);
  mesh(g, new THREE.CylinderGeometry(2.2, 3.1, 20, 24), chalk, 0, 10, 0);
  mesh(
    g,
    new THREE.CylinderGeometry(2.36, 2.56, 3.3, 24),
    terracotta,
    0,
    14,
    0,
  );
  mesh(g, new THREE.CylinderGeometry(3.15, 3.15, 0.45, 24), cream, 0, 20.2, 0);
  mesh(g, new THREE.CylinderGeometry(2.15, 2.15, 3, 16), windowMat, 0, 21.8, 0);
  mesh(g, new THREE.ConeGeometry(3.05, 2.2, 24), charcoal, 0, 24.4, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    box(
      g,
      ink,
      [0.06, 1.05, 0.06],
      [Math.sin(a) * 2.9, 20.9, Math.cos(a) * 2.9],
    );
  }
  const ring = mesh(
    g,
    new THREE.TorusGeometry(2.9, 0.048, 5, 32),
    ink,
    0,
    21.35,
    0,
  );
  ring.rotation.x = Math.PI / 2;
}

export function createWorld(): THREE.Group {
  seed = 4187;
  assetTasks = [];
  terrainTexture = bundledTexture("rock_3_diff_1k.webp");
  terrainNormal = bundledTexture("rock_3_nor_gl_1k.webp", false);
  const asphaltTexture = bundledTexture("asphalt_02_diff_1k.webp"),
    asphaltNormal = bundledTexture("asphalt_02_nor_gl_1k.webp", false);
  asphaltTexture.repeat.set(3, 20 / 6);
  asphaltNormal.repeat.copy(asphaltTexture.repeat);
  worldAssetsReady = Promise.all(assetTasks).then(() => undefined);
  const assets = {
    rock: terrainTexture,
    normal: terrainNormal,
    asphalt: asphaltTexture,
    asphaltNormal,
  };
  if (activeTrack.theme !== "riviera")
    return createRegionalWorld(activeTrack.theme, assets);
  const world = new THREE.Group();
  world.name = activeTrack.name;
  world.userData.theme = activeTrack.theme;
  const steps = Math.ceil(trackLength / 2.8);
  const asphalt = new THREE.MeshStandardMaterial({
    map: asphaltTexture,
    normalMap: asphaltNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    color: "#9ca5a8",
    roughness: 0.94,
    metalness: 0.02,
  });
  world.add(ribbon(-roadHalfWidth, roadHalfWidth, 0, asphalt, steps));
  const shoulderMat = new THREE.MeshStandardMaterial({
    map: texture(256, true),
    color: "#bcbca7",
    roughness: 1,
  });
  for (const s of [-1, 1]) {
    world.add(ribbon(s * 9, s * 11.6, -0.045, shoulderMat, steps));
    world.add(
      ribbon(
        s * 8.8,
        s * 9.04,
        0.025,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
        steps,
        true,
      ),
    );
    world.add(ribbon(s * 8.38, s * 8.51, 0.014, chalk, steps));
  }
  world.add(cliffRibbon(), interiorTerrain());
  // White dashes are one instanced draw call, with slightly thicker start-line grid.
  const dashCount = Math.floor(trackLength / 15);
  const dashes = new THREE.InstancedMesh(boxGeometry, chalk, dashCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < dashCount; i++) {
    const p = sampleTrack(i * 15);
    const a = sampleTrack(i * 15 - 2),
      b = sampleTrack(i * 15 + 2);
    dummy.position.set(p.x, p.y + 0.026, p.z);
    dummy.rotation.set(
      -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)),
      p.heading,
      0,
      "YXZ",
    );
    dummy.scale.set(0.14, 0.015, 4);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  dashes.receiveShadow = true;
  world.add(dashes);
  // Low sea-facing parapet, with continuous upper rail and occasional reflector posts.
  const rails = new THREE.Group();
  world.add(rails);
  for (let i = 0; i < Math.floor(trackLength / 5); i++) {
    const d = i * 5,
      p = sampleTrack(d, -10.2),
      q = sampleTrack(d + 5, -10.2),
      mid = new THREE.Vector3(p.x + q.x, p.y + q.y, p.z + q.z).multiplyScalar(
        0.5,
      );
    const barrier = box(
      rails,
      cream,
      [0.48, 0.63, Math.hypot(q.x - p.x, q.z - p.z) + 0.1],
      [mid.x, mid.y + 0.23, mid.z],
    );
    barrier.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
    if (i % 3 === 0) {
      const post = box(
        rails,
        charcoal,
        [0.075, 0.76, 0.075],
        [p.x, p.y + 0.8, p.z],
      );
      post.rotation.y = p.heading;
      const reflector = box(
        rails,
        acid,
        [0.1, 0.12, 0.045],
        [p.x, p.y + 1.16, p.z],
      );
      reflector.rotation.y = p.heading;
    }
  }
  world.add(ribbon(-10.43, -10.35, 1.05, charcoal, steps));
  // Slender lamps and trackside furniture establish scale on the grand-prix straight.
  const lampMat = new THREE.MeshStandardMaterial({
    color: "#fff3d0",
    emissive: "#ffe4ac",
    emissiveIntensity: 0.4,
  });
  for (let i = 0; i < 8; i++) {
    const p = sampleTrack(i * 34 - 100, 11.85),
      lamp = new THREE.Group();
    lamp.position.set(p.x, p.y, p.z);
    lamp.rotation.y = p.heading;
    world.add(lamp);
    mesh(
      lamp,
      new THREE.CylinderGeometry(0.065, 0.115, 7.3, 8),
      charcoal,
      0,
      3.65,
      0,
    );
    const arm = box(lamp, charcoal, [2.55, 0.08, 0.08], [-1.23, 7.25, 0]);
    arm.rotation.z = -0.06;
    box(lamp, charcoal, [0.68, 0.13, 0.31], [-2.44, 7.18, 0]);
    box(lamp, lampMat, [0.6, 0.025, 0.25], [-2.44, 7.099, 0]);
  }
  // Sea with layered wave normals and directional sun sparkle.
  const seaMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: timeUniform },
    vertexShader: `varying vec3 vWorld; void main(){vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader: `
    uniform float uTime; varying vec3 vWorld;
    void main(){vec2 p=vWorld.xz;float t=uTime*.6;
      float a=sin(p.x*.025+p.y*.017+t),b=sin(p.x*.071-p.y*.043+t*1.2),c=sin(p.x*.23+p.y*.15-t*1.7);
      vec3 n=normalize(vec3(a*.10+b*.065,1.,b*.10+c*.055));vec3 v=normalize(cameraPosition-vWorld);
      float f=pow(1.-max(dot(n,v),0.),3.);vec3 deep=vec3(.025,.37,.46),near=vec3(.06,.57,.57);
      vec3 col=mix(near,deep,clamp(length(cameraPosition.xz-p)/1300.,0.,1.));col=mix(col,vec3(.55,.78,.81),f*.72);
      vec3 h=normalize(v+normalize(vec3(-.7,.45,-.7)));float sun=pow(max(dot(n,h),0.),190.);col+=vec3(1.,.87,.58)*sun*.9;
      col+=vec3(.045,.073,.065)*(a*.3+b*.3+c*.1);gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    side: THREE.FrontSide,
  });
  const sea = mesh(
    world,
    new THREE.PlaneGeometry(8000, 8000),
    seaMaterial,
    140,
    -6,
    -40,
  );
  sea.rotation.x = -Math.PI / 2;
  sea.castShadow = false;
  sea.receiveShadow = false;
  sea.userData.keep = true;
  // Palms use one draw call for all crowns and one for all textured trunks.
  const palmCount = Math.floor(trackLength / 23),
    crowns = new THREE.InstancedMesh(palmGeometry(), palmMat, palmCount),
    trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.19, 0.32, 1, 7),
      wood,
      palmCount,
    );
  for (let i = 0; i < palmCount; i++) {
    const d = i * 23 + rand() * 8,
      lateral = i % 4 === 0 ? -(13 + rand() * 4) : 13 + rand() * 8,
      p = sampleTrack(d, lateral),
      height = 6 + rand() * 4;
    const edge = sampleTrack(d, 10.2),
      inset = Math.hypot(edge.x - islandCenter.x, edge.z - islandCenter.y);
    const baseY =
      lateral > 0
        ? terrainHeight(p.x, p.z, Math.max(0, lateral - 10.2) / inset, p.y) -
          0.12
        : p.y - 0.35 - Math.max(0, -lateral - 14) * 0.44;
    dummy.position.set(p.x, baseY + height * 0.5, p.z);
    dummy.rotation.set(
      (rand() - 0.5) * 0.08,
      rand() * 6.28,
      (rand() - 0.5) * 0.07,
    );
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, baseY + height, p.z);
    dummy.rotation.set(0, rand() * 6.28, 0);
    const size = 0.8 + rand() * 0.45;
    dummy.scale.set(size, size, size);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  }
  crowns.castShadow = true;
  trunks.castShadow = true;
  world.add(crowns, trunks);
  // Mediterranean umbrella pines break up the rising limestone interior.
  const pineParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2,
      g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(1.7 + (i % 3) * 0.1, 1.1, 1.5);
    g.translate(
      Math.cos(a) * (1.6 + (i % 2) * 0.4),
      (i % 3) * 0.33,
      Math.sin(a) * 1.7,
    );
    pineParts.push(g);
  }
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2,
      g = new THREE.IcosahedronGeometry(1, 0),
      s = 0.46 + (i % 4) * 0.14;
    g.scale(s, s * 0.7, s);
    g.translate(Math.cos(a) * 3.1, (i % 3) * 0.32, Math.sin(a) * 2.9);
    pineParts.push(g);
  }
  const pineCount = 260,
    pineLeaves = new THREE.InstancedMesh(
      mergeGeometries(pineParts)!,
      new THREE.MeshStandardMaterial({ color: "#38563d", roughness: 1 }),
      pineCount,
    ),
    pineTrunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.17, 0.3, 1, 7),
      wood,
      pineCount,
    );
  for (let i = 0; i < pineCount; i++) {
    const p = sampleTrack(rand() * trackLength, 10.2),
      f = 0.045 + rand() * 0.25,
      x = THREE.MathUtils.lerp(p.x, islandCenter.x, f),
      z = THREE.MathUtils.lerp(p.z, islandCenter.y, f);
    const y = terrainHeight(x, z, f, p.y);
    const h = 4.4 + rand() * 3,
      s = 0.8 + rand() * 0.6;
    dummy.position.set(x, y + h / 2, z);
    dummy.rotation.set(0, rand() * 6.28, 0);
    dummy.scale.set(s, h, s);
    dummy.updateMatrix();
    pineTrunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + h, z);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    pineLeaves.setMatrixAt(i, dummy.matrix);
    pineLeaves.setColorAt(i, new THREE.Color().setScalar(0.75 + rand() * 0.45));
  }
  pineLeaves.castShadow = pineTrunks.castShadow = true;
  world.add(pineLeaves, pineTrunks);
  // Rocky shoreline outcrops and scrub provide local scale without blocking the road.
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: "#f2e6cb",
    map: terrainTexture,
    normalMap: terrainNormal,
    normalScale: new THREE.Vector2(0.72, 0.72),
    roughness: 0.97,
    flatShading: true,
  });
  const boulderGeometry = new THREE.IcosahedronGeometry(1, 2);
  const boulderPositions = boulderGeometry.attributes.position;
  for (let i = 0; i < boulderPositions.count; i++) {
    const x = boulderPositions.getX(i),
      y = boulderPositions.getY(i),
      z = boulderPositions.getZ(i),
      scale = 1 + Math.sin(x * 7 + y * 11 + z * 13) * 0.09;
    boulderPositions.setXYZ(i, x * scale, y * scale, z * scale);
  }
  boulderGeometry.computeVertexNormals();
  const rockCount = 170,
    rocks = new THREE.InstancedMesh(boulderGeometry, rockMaterial, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const d = rand() * trackLength,
      lateral = -(23 + rand() * 25),
      p = sampleTrack(d, lateral);
    dummy.position.set(p.x, p.y - 8 - rand() * 10, p.z);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(2 + rand() * 5, 2 + rand() * 8, 2 + rand() * 5);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  world.add(rocks);
  const hillsideRocks = new THREE.InstancedMesh(
    boulderGeometry,
    rockMaterial,
    270,
  );
  for (let i = 0; i < 270; i++) {
    const p = sampleTrack(rand() * trackLength, 10.2),
      f = 0.02 + rand() * 0.31,
      x = THREE.MathUtils.lerp(p.x, islandCenter.x, f),
      z = THREE.MathUtils.lerp(p.z, islandCenter.y, f),
      y = terrainHeight(x, z, f, p.y);
    dummy.position.set(x, y - 0.55, z);
    dummy.rotation.set(rand() * 0.8, rand() * 6.28, rand() * 0.6);
    dummy.scale.set(1.3 + rand() * 3.2, 1.3 + rand() * 3.8, 1.4 + rand() * 4);
    dummy.updateMatrix();
    hillsideRocks.setMatrixAt(i, dummy.matrix);
  }
  hillsideRocks.castShadow = hillsideRocks.receiveShadow = true;
  world.add(hillsideRocks);
  const bushes = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    palmMat,
    200,
  );
  for (let i = 0; i < 200; i++) {
    const d = rand() * trackLength,
      lateral = 12 + rand() * 14,
      p = sampleTrack(d, lateral),
      edge = sampleTrack(d, 10.2),
      inset = Math.hypot(edge.x - islandCenter.x, edge.z - islandCenter.y);
    dummy.position.set(
      p.x,
      terrainHeight(p.x, p.z, (lateral - 10.2) / inset, p.y) + 0.2,
      p.z,
    );
    dummy.rotation.set(rand(), rand() * 6, rand());
    dummy.scale.set(1 + rand() * 2, 0.8 + rand() * 1.8, 1 + rand() * 2);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
  }
  bushes.castShadow = true;
  world.add(bushes);
  const village = new THREE.Group();
  world.add(village);
  for (let i = 0; i < 11; i++)
    addVilla(
      village,
      trackLength * (0.11 + i * 0.055),
      -(18 + ((i * 7) % 8)),
      i,
    );
  lighthouse(village);
  addRivieraDistrict(world, assets);
  // Race architecture: a purposeful lime ribbon at the start, not a floating sign.
  const start = sampleTrack(0),
    gantry = new THREE.Group();
  gantry.position.set(start.x, start.y, start.z);
  gantry.rotation.y = start.heading;
  world.add(gantry);
  for (const s of [-1, 1]) {
    box(gantry, ink, [0.8, 8.0, 1.2], [s * 10.3, 4, 0]);
    box(gantry, acid, [1.1, 2.8, 1.48], [s * 10.3, 1.4, 0]);
    box(gantry, ink, [1.8, 0.2, 2.1], [s * 10.3, 0.05, 0]);
  }
  box(gantry, ink, [21.4, 2.1, 1], [0, 7.2, 0]);
  box(gantry, acid, [21.7, 0.19, 1.15], [0, 8.3, 0]);
  const title = sign(
    gantry,
    "VELOCITY / COAST",
    "PORT LUMIÈRE  •  COASTAL EXPEDITION",
    19.4,
    1.7,
    [0, 7.24, -0.513],
    true,
  );
  title.rotation.y = Math.PI;
  sign(
    gantry,
    "VELOCITY / COAST",
    "PORT LUMIÈRE  •  COASTAL EXPEDITION",
    19.4,
    1.7,
    [0, 7.24, 0.513],
    true,
  );
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 18; c++)
      box(
        gantry,
        (r + c) % 2 ? chalk : ink,
        [1, 0.012, 0.65],
        [-8.5 + c, 0.042, r * 0.65],
      );
  for (let i = 0; i < 6; i++) {
    const d = ((i + 1) * trackLength) / 7,
      p = sampleTrack(d, 10.45),
      g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    world.add(g);
    for (const x of [-2.4, 2.4]) box(g, ink, [0.12, 3, 0.12], [x, 1.5, 0]);
    const board = sign(
      g,
      i % 2 ? "LUMIÈRE" : "COAST / 01",
      i % 2 ? "THE COAST IS YOURS" : "COASTAL EXPEDITION",
      5.7,
      1.4,
      [0, 2.4, 0],
      i % 2 === 0,
    );
    board.rotation.y = -Math.PI / 2;
  }
  // Repeated chevrons create a clear, readable racing line at tighter bends.
  const arrows = labelTexture("›  ›  ›", "", true),
    arrowMat = new THREE.MeshStandardMaterial({
      map: arrows,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
  for (let i = 0; i < 18; i++) {
    const d = (trackLength * (i + 0.5)) / 18,
      p = sampleTrack(d, -10.65),
      g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    world.add(g);
    box(g, ink, [0.08, 1.9, 0.08], [0, 0.95, 0]);
    const m = mesh(g, new THREE.PlaneGeometry(3.8, 0.95), arrowMat, 0, 1.65, 0);
    m.rotation.y = Math.PI / 2;
  }
  // On the horizon, low sculpted islands separate the sea from the sky.
  for (let i = 0; i < 7; i++) {
    const sectors = 42,
      rings = 10;
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const width = 150 + (i % 3) * 48,
      depth = 105 + (i % 2) * 48;
    const height = 65 + (i % 4) * 13,
      phase = i * 1.79;
    const summitColor = new THREE.Color("#a6b3aa"),
      shoreColor = new THREE.Color("#788f89");
    const addVertex = (x: number, z: number, radius: number) => {
      // Offset peaks form a broken ridge; the coast falls below the sea plane.
      const peaks =
        0.86 * Math.exp(-((x + 0.48) ** 2 / 0.075 + (z + 0.08) ** 2 / 0.4)) +
        1.02 * Math.exp(-((x - 0.01) ** 2 / 0.06 + (z - 0.1) ** 2 / 0.3)) +
        0.69 * Math.exp(-((x - 0.47) ** 2 / 0.055 + (z + 0.15) ** 2 / 0.27));
      const crag =
        Math.sin(x * 19 + phase) * Math.cos(z * 16 - phase) * 0.065 +
        Math.abs(Math.sin(x * 12 + z * 8 + phase)) * 0.085;
      const coast = 1 - THREE.MathUtils.smoothstep(radius, 0.55, 1);
      const elevation = Math.max(0, 0.12 + peaks + crag) * coast;
      positions.push(x * width, -7 + elevation * height, z * depth);
      const color = shoreColor
        .clone()
        .lerp(summitColor, THREE.MathUtils.clamp(elevation * 0.75, 0, 1));
      color.multiplyScalar(0.94 + crag * 0.42);
      colors.push(color.r, color.g, color.b);
    };
    addVertex(0, 0, 0);
    for (let ring = 1; ring <= rings; ring++) {
      const radius = ring / rings;
      for (let sector = 0; sector < sectors; sector++) {
        const angle = (sector / sectors) * Math.PI * 2;
        const shoreline =
          1 +
          Math.sin(angle * 3 + phase) * 0.11 +
          Math.cos(angle * 7 - phase) * 0.045;
        addVertex(
          Math.cos(angle) * radius * shoreline,
          Math.sin(angle) * radius * shoreline,
          radius,
        );
      }
    }
    for (let sector = 0; sector < sectors; sector++) {
      const next = (sector + 1) % sectors;
      indices.push(0, 1 + next, 1 + sector);
      for (let ring = 1; ring < rings; ring++) {
        const a = 1 + (ring - 1) * sectors + sector,
          b = 1 + (ring - 1) * sectors + next;
        const c = a + sectors,
          d = b + sectors;
        indices.push(a, b, c, b, d, c);
      }
    }
    const islandGeometry = new THREE.BufferGeometry();
    islandGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    islandGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    islandGeometry.setIndex(indices);
    islandGeometry.computeVertexNormals();
    const mountain = mesh(
      world,
      islandGeometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        color: "#b9c9c3",
        roughness: 1,
      }),
      -620 - i * 180,
      0,
      -650 + i * 260,
    );
    mountain.rotation.y = i * 0.62;
    mountain.castShadow = false;
  }
  batchStatics(world);
  return world;
}
export function updateWorld(time: number) {
  timeUniform.value = time;
}

/** Cached worlds may be released independently; shared photo assets stay reusable. */
export function disposeWorld(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  group.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) &&
      !(object instanceof THREE.LineSegments)
    )
      return;
    if (!object.geometry.userData.shared) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (material.userData.shared) continue;
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture && !value.userData.shared)
          textures.add(value);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  group.removeFromParent();
  group.clear();
}
