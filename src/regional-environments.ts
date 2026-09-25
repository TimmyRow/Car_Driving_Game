import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { activeTrack, sampleTrack, trackLength } from "./track";

export interface RegionalTextures {
  rock: THREE.Texture;
  normal: THREE.Texture;
  asphalt: THREE.Texture;
  asphaltNormal: THREE.Texture;
}
const cube = new THREE.BoxGeometry(1, 1, 1);
cube.userData.shared = true;
function add(
  g: THREE.Object3D,
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
  g.add(m);
  return m;
}
function box(g: THREE.Object3D, m: THREE.Material, s: number[], p: number[]) {
  const o = add(g, cube, m, p[0], p[1], p[2]);
  o.scale.set(s[0], s[1], s[2]);
  return o;
}
function rod(
  g: THREE.Object3D,
  m: THREE.Material,
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
) {
  const delta = b.clone().sub(a),
    o = add(g, new THREE.CylinderGeometry(r, r, delta.length(), 6), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  return o;
}
function attach(g: THREE.Group, d: number, lateral: number, y = 0) {
  const p = sampleTrack(d, lateral),
    local = new THREE.Group();
  local.position.set(p.x, p.y + y, p.z);
  local.rotation.y = p.heading;
  g.add(local);
  return local;
}
function mergeWorld(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  group.traverse((o) => {
    if (
      o instanceof THREE.Mesh &&
      !(o instanceof THREE.InstancedMesh) &&
      !Array.isArray(o.material)
    ) {
      const b = batches.get(o.material) || [];
      b.push(o);
      batches.set(o.material, b);
    }
  });
  for (const [m, meshes] of batches) {
    if (meshes.length < 3) continue;
    const geometries = meshes.map((o) => {
      const geo = o.geometry.index
        ? o.geometry.toNonIndexed()
        : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      if (!geo.attributes.uv)
        geo.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute(
            new Float32Array(geo.attributes.position.count * 2),
            2,
          ),
        );
      return geo;
    });
    // Geometry with different color attributes belongs to its own material family.
    const geo = mergeGeometries(geometries);
    if (geo) {
      for (const o of meshes) o.removeFromParent();
      add(group, geo, m);
    }
    geometries.forEach((geo) => geo.dispose());
  }
}
function boardMaterial(title: string, subtitle: string, accent: string) {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#172932";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 2048, 13);
  ctx.textAlign = "center";
  ctx.fillStyle = "#edf1e9";
  ctx.font = "900 108px Arial";
  ctx.fillText(title, 1024, 131);
  ctx.fillStyle = accent;
  ctx.font = "700 32px Arial";
  ctx.letterSpacing = "8px";
  ctx.fillText(subtitle, 1024, 203);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
}
function surface(
  a: number,
  b: number,
  raise: number,
  material: THREE.Material,
) {
  const n = Math.ceil(trackLength / 3),
    v: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * trackLength;
    for (const l of [a, b]) {
      const p = sampleTrack(d, l);
      v.push(p.x, p.y + raise, p.z);
      uv.push((l - a) / Math.abs(b - a), d / 20);
    }
    if (i < n) {
      const k = i * 2;
      ix.push(
        ...(b > a
          ? [k, k + 2, k + 1, k + 1, k + 2, k + 3]
          : [k, k + 1, k + 2, k + 1, k + 3, k + 2]),
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(ix);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}
function cragGeometry() {
  const sectors = 28,
    rings = [
      0, 0.1, 0.115, 0.29, 0.305, 0.46, 0.475, 0.64, 0.655, 0.82, 0.835, 1,
    ],
    radii = [
      1, 1.02, 0.93, 0.94, 0.85, 0.88, 0.8, 0.82, 0.73, 0.76, 0.68, 0.63,
    ],
    p: number[] = [],
    uv: number[] = [],
    color: number[] = [],
    ix: number[] = [];
  const bands = [
    "#bd875c",
    "#e5b580",
    "#ad6840",
    "#d9a272",
    "#ad6d48",
    "#e6b782",
    "#ad734f",
    "#e0ac7b",
    "#a66b47",
    "#d3a679",
    "#b97d54",
    "#ddbd91",
  ];
  for (let r = 0; r < rings.length; r++)
    for (let j = 0; j < sectors; j++) {
      const a = (j / sectors) * Math.PI * 2,
        variation =
          1 +
          Math.sin(a * 3 + 0.3) * 0.15 +
          Math.cos(a * 7 + r * 0.065) * 0.075;
      const x = Math.sin(a) * radii[r] * variation,
        z = Math.cos(a) * radii[r] * variation;
      const y =
        rings[r] +
        Math.pow(rings[r], 2) *
          (Math.sin(a * 3) * 0.095 + Math.cos(a * 5 + 0.7) * 0.055);
      p.push(x, y, z);
      uv.push((j / sectors) * 8, y * 8);
      const c = new THREE.Color(bands[r]);
      color.push(c.r, c.g, c.b);
      if (r < rings.length - 1) {
        const a = r * sectors + j,
          b = r * sectors + ((j + 1) % sectors),
          c = a + sectors,
          d = b + sectors;
        ix.push(a, b, c, b, d, c);
      }
    }
  const center = p.length / 3;
  p.push(0.06, 0.975, -0.03);
  uv.push(4, 4);
  const c = new THREE.Color("#d9b083");
  color.push(c.r, c.g, c.b);
  const top = (rings.length - 1) * sectors;
  for (let j = 0; j < sectors; j++)
    ix.push(center, top + j, top + ((j + 1) % sectors));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}
function mountainGeometry(seed: number) {
  const segments = 56,
    rings = 20,
    p: number[] = [],
    uv: number[] = [],
    rock: number[] = [],
    snow: number[] = [];
  for (let r = 0; r <= rings; r++)
    for (let j = 0; j <= segments; j++) {
      const radius = r / rings,
        a = (j / segments) * Math.PI * 2;
      const x = Math.cos(a) * radius * (1 + Math.sin(a * 5 + seed) * 0.1),
        z = Math.sin(a) * radius * (1 + Math.cos(a * 3 + seed) * 0.12);
      const peaks =
        Math.exp(-((x + 0.31) ** 2 / 0.11 + (z + 0.08) ** 2 / 0.34)) +
        0.92 * Math.exp(-((x - 0.32) ** 2 / 0.095 + (z - 0.14) ** 2 / 0.21)) +
        0.5 * Math.exp(-((x + 0.03) ** 2 / 0.13 + (z - 0.43) ** 2 / 0.075));
      const rough =
        Math.sin(x * 19 + z * 6 + seed) * Math.cos(z * 14 - x * 8) * 0.075 +
        Math.abs(Math.sin(x * 9 + seed) * Math.sin(z * 11 + seed)) * 0.08;
      const y =
        Math.max(0, 0.07 + peaks * 0.67 + rough) *
        (1 - THREE.MathUtils.smoothstep(radius, 0.61, 1));
      p.push(x, y, z);
      uv.push(x * 19, z * 19);
    }
  for (let r = 0; r < rings; r++)
    for (let j = 0; j < segments; j++) {
      const a = r * (segments + 1) + j,
        b = a + 1,
        c = a + segments + 1,
        d = c + 1;
      for (const tri of [
        [a, b, c],
        [b, d, c],
      ]) {
        const height =
            (p[tri[0] * 3 + 1] + p[tri[1] * 3 + 1] + p[tri[2] * 3 + 1]) / 3,
          x = p[tri[0] * 3],
          z = p[tri[0] * 3 + 2];
        const target =
          height > 0.43 + Math.sin(x * 11 + z * 7 + seed) * 0.025 ? snow : rock;
        target.push(...tri);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...rock, ...snow]);
  g.addGroup(0, rock.length, 0);
  g.addGroup(rock.length, snow.length, 1);
  g.computeVertexNormals();
  return g;
}

export function createRegionalWorld(
  theme: "canyon" | "alpine",
  textures: RegionalTextures,
): THREE.Group {
  const world = new THREE.Group();
  world.name = activeTrack.name;
  world.userData.theme = theme;
  let seed = theme === "canyon" ? 1337 : 9247;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const canyon = theme === "canyon",
    accent = new THREE.MeshStandardMaterial({
      color: canyon ? "#e49752" : "#81c9d6",
      roughness: 0.55,
    });
  const light = new THREE.MeshStandardMaterial({
    color: canyon ? "#e3cfaa" : "#e4e7e8",
    roughness: 0.83,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: canyon ? "#3d3531" : "#283b48",
    roughness: 0.71,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: "#64747d",
    metalness: 0.7,
    roughness: 0.43,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: canyon ? "#31525d" : "#26495c",
    metalness: 0.55,
    roughness: 0.2,
  });
  const snow = new THREE.MeshStandardMaterial({
    color: "#e5edf0",
    roughness: 0.88,
  });
  const rock = new THREE.MeshStandardMaterial({
    map: textures.rock,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: canyon ? "#e9b27c" : "#bbc8cd",
    roughness: 0.98,
  });
  const terrain = new THREE.MeshStandardMaterial({
    map: textures.rock,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    vertexColors: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const asphalt = new THREE.MeshStandardMaterial({
    map: textures.asphalt,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    color: canyon ? "#b5b2a3" : "#99a8af",
    roughness: 0.94,
  });
  const shoulder = new THREE.MeshStandardMaterial({
    color: canyon ? "#c29a71" : "#a7b6b6",
    map: textures.rock,
    roughness: 1,
  });
  world.add(surface(-9, 9, 0, asphalt));
  for (const s of [-1, 1]) {
    world.add(
      surface(s * 9, s * 11.5, -0.055, shoulder),
      surface(s * 8.35, s * 8.51, 0.016, light),
      surface(s * 8.85, s * 9.06, 0.015, accent),
    );
  }
  const dummy = new THREE.Object3D(),
    dashCount = Math.floor(trackLength / 15),
    dashes = new THREE.InstancedMesh(cube, light, dashCount);
  for (let i = 0; i < dashCount; i++) {
    const p = sampleTrack(i * 15),
      a = sampleTrack(i * 15 - 2),
      b = sampleTrack(i * 15 + 2);
    dummy.position.set(p.x, p.y + 0.025, p.z);
    dummy.rotation.set(
      -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)),
      p.heading,
      0,
      "YXZ",
    );
    dummy.scale.set(0.14, 0.014, 4.3);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  world.add(dashes);
  // Guardrails preserve uninterrupted visibility along the entire driving corridor.
  for (const side of [-1, 1])
    for (let d = 0; d < trackLength; d += 7) {
      const p = sampleTrack(d, side * 10.5),
        q = sampleTrack(d + 7, side * 10.5),
        span = Math.hypot(q.x - p.x, q.z - p.z);
      const beam = box(
        world,
        steel,
        [0.12, 0.22, Math.hypot(span, q.y - p.y) + 0.1],
        [(p.x + q.x) / 2, (p.y + q.y) / 2 + 0.68, (p.z + q.z) / 2],
      );
      beam.rotation.set(
        -Math.atan2(q.y - p.y, span),
        Math.atan2(q.x - p.x, q.z - p.z),
        0,
        "YXZ",
      );
      if (Math.floor(d / 7) % 2 === 0) {
        const post = box(world, dark, [0.1, 0.82, 0.1], [p.x, p.y + 0.35, p.z]);
        post.rotation.y = p.heading;
      }
    }
  const center = new THREE.Vector2();
  let minY = Infinity;
  for (let i = 0; i < 180; i++) {
    const p = sampleTrack((i / 180) * trackLength);
    center.x += p.x / 180;
    center.y += p.z / 180;
    minY = Math.min(minY, p.y);
  }
  const wave = (x: number, z: number) =>
    Math.sin(x * 0.024) * Math.cos(z * 0.037) +
    Math.sin(x * 0.073 + z * 0.059) * 0.28;
  const bridgeDip = (d: number) =>
    !canyon && d / trackLength > 0.18 && d / trackLength < 0.25
      ? Math.sin(((d / trackLength - 0.18) / 0.07) * Math.PI) * 34
      : 0;
  const innerHeight = (x: number, z: number, f: number, y: number, d: number) =>
    THREE.MathUtils.lerp(y, minY + 7, f) -
    0.24 +
    Math.sin(f * Math.PI) *
      ((canyon ? 16 : 24) + wave(x, z) * (canyon ? 5 : 9)) -
    bridgeDip(d) * (1 - THREE.MathUtils.smoothstep(f, 0, 0.17));
  const groundPosition = (d: number, l: number) => {
    const p = sampleTrack(d, l);
    if (l < 0)
      return new THREE.Vector3(
        p.x,
        p.y -
          0.4 -
          Math.max(0, -l - 14) * 0.23 -
          bridgeDip(d) * Math.exp(-Math.max(0, -l - 14) / 100),
        p.z,
      );
    const e = sampleTrack(d, 10.2),
      f = Math.max(0, l - 10.2) / Math.hypot(e.x - center.x, e.z - center.y);
    return new THREE.Vector3(p.x, innerHeight(p.x, p.z, f, p.y, d), p.z);
  };
  // A radial interior and outer escarpment keep the road unobstructed at every elevation.
  for (const inside of [true, false]) {
    const columns = 280,
      rows = inside ? 24 : 8,
      v: number[] = [],
      uv: number[] = [],
      colors: number[] = [],
      ix: number[] = [];
    for (let r = 0; r <= rows; r++)
      for (let i = 0; i <= columns; i++) {
        const d = (i / columns) * trackLength,
          p = sampleTrack(d, inside ? 10.4 : -(10.4 + (r / rows) * 245));
        const f = r / rows;
        const x = inside ? THREE.MathUtils.lerp(p.x, center.x, f) : p.x,
          z = inside ? THREE.MathUtils.lerp(p.z, center.y, f) : p.z;
        const outer =
          p.y -
          0.3 -
          f * 48 +
          wave(x, z) * f * 6 -
          bridgeDip(d) * (1 - f * 0.65);
        const y = inside
          ? innerHeight(x, z, f, p.y, d)
          : THREE.MathUtils.lerp(
              outer,
              minY - 50,
              THREE.MathUtils.smoothstep(f, 0.58, 1),
            );
        v.push(x, y, z);
        uv.push(x / 8, z / 8);
        const c = new THREE.Color(canyon ? "#d9ac7d" : "#b5bbaa");
        c.lerp(
          new THREE.Color(canyon ? "#f3c597" : "#d4dadd"),
          THREE.MathUtils.clamp(wave(x, z) * 0.25 + 0.3, 0, 1),
        );
        colors.push(c.r, c.g, c.b);
        if (r < rows && i < columns) {
          const a = r * (columns + 1) + i,
            b = a + columns + 1;
          ix.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    add(world, g, terrain).castShadow = false;
  }
  const floorGeometry = new THREE.PlaneGeometry(12000, 12000),
    floorUv = floorGeometry.attributes.uv;
  for (let i = 0; i < floorUv.count; i++)
    floorUv.setXY(i, floorUv.getX(i) * 1200, floorUv.getY(i) * 1200);
  const floor = add(
    world,
    floorGeometry,
    new THREE.MeshStandardMaterial({
      map: textures.rock,
      color: canyon ? "#d9ac7d" : "#b5bbaa",
      roughness: 1,
    }),
    center.x,
    minY - 50.1,
    center.y,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  const pebbleGeometry = new THREE.IcosahedronGeometry(1, 1),
    pebbles = new THREE.InstancedMesh(pebbleGeometry, rock, 260);
  for (let i = 0; i < 260; i++) {
    const d = random() * trackLength,
      l = (i % 3 === 0 ? -1 : 1) * (16.5 + random() * 46),
      p = groundPosition(d, l);
    dummy.position.copy(p);
    dummy.rotation.set(random(), random() * 6.28, random());
    dummy.scale.set(
      0.7 + random() * 2.8,
      0.5 + random() * 2.0,
      0.7 + random() * 3.5,
    );
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
  }
  pebbles.castShadow = true;
  world.add(pebbles);

  if (canyon) {
    const mesaMat = new THREE.MeshStandardMaterial({
      map: textures.rock,
      normalMap: textures.normal,
      normalScale: new THREE.Vector2(0.65, 0.65),
      vertexColors: true,
      roughness: 0.98,
      flatShading: true,
    });
    const mesaGeo = cragGeometry(),
      mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, 80);
    for (let i = 0; i < 80; i++) {
      const d = ((i + 0.3) / 80) * trackLength,
        l = (i % 3 === 0 ? -1 : 1) * (46 + random() * 70),
        p = groundPosition(d, l);
      dummy.position.copy(p).add(new THREE.Vector3(0, -3, 0));
      dummy.rotation.set(0, random() * 6.28, 0);
      dummy.scale.set(9 + random() * 16, 18 + random() * 48, 8 + random() * 18);
      dummy.updateMatrix();
      mesas.setMatrixAt(i, dummy.matrix);
    }
    mesas.castShadow = true;
    world.add(mesas);
    for (let i = 0; i < 11; i++) {
      const p = groundPosition((i / 11) * trackLength, -420 - random() * 210),
        m = add(world, mesaGeo, mesaMat, p.x, minY - 48, p.z);
      m.scale.set(75 + random() * 80, 110 + random() * 115, 60 + random() * 90);
      m.rotation.y = random() * 6.28;
      m.castShadow = false;
    }
    // Ember Gate: a real rock silhouette with clear 20m clearance over the course.
    for (const [fraction, scale] of [
      [0.31, 1],
      [0.74, 0.86],
    ]) {
      const arch = attach(world, trackLength * fraction, 0, -0.5);
      arch.scale.setScalar(scale);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-27, 0, 0),
        new THREE.Vector3(-23, 19, 1),
        new THREE.Vector3(-11, 30, 0),
        new THREE.Vector3(7, 31, -1),
        new THREE.Vector3(23, 17, 1),
        new THREE.Vector3(28, 0, 0),
      ]);
      const g = new THREE.TubeGeometry(curve, 54, 3.8, 9, false),
        p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i);
        p.setXYZ(
          i,
          x + Math.sin(y * 1.2 + z) * 0.3,
          y + Math.cos(x * 0.7) * 0.3,
          z + Math.sin(x * 0.9 + y) * 0.45,
        );
      }
      g.computeVertexNormals();
      add(arch, g, rock);
      for (const side of [-1, 1]) {
        const foot = add(arch, mesaGeo, mesaMat, side * 27, -7, 0);
        foot.scale.set(8, 12, 8);
      }
    }
    // Cacti silhouettes and low ochre scrub, kept outside the racing line.
    const cactusMaterial = new THREE.MeshStandardMaterial({
        color: "#65785a",
        roughness: 0.95,
      }),
      cactusParts: THREE.BufferGeometry[] = [];
    const stem = new THREE.CylinderGeometry(0.22, 0.3, 3.8, 7);
    stem.translate(0, 1.9, 0);
    cactusParts.push(stem);
    for (const side of [-1, 1]) {
      const branch = new THREE.CylinderGeometry(0.16, 0.2, 1.35, 7);
      branch.translate(side * 0.82, 2.8 + (side + 1) * 0.25, 0);
      cactusParts.push(branch);
      const elbow = new THREE.CylinderGeometry(0.17, 0.17, 0.95, 7);
      elbow.rotateZ(Math.PI / 2);
      elbow.translate(side * 0.44, 2.13 + (side + 1) * 0.25, 0);
      cactusParts.push(elbow);
    }
    const cacti = new THREE.InstancedMesh(
      mergeGeometries(cactusParts)!,
      cactusMaterial,
      115,
    );
    for (let i = 0; i < 115; i++) {
      const p = groundPosition(
          random() * trackLength,
          (i % 2 ? -1 : 1) * (15 + random() * 35),
        ),
        s = 0.55 + random() * 0.8;
      dummy.position.copy(p);
      dummy.rotation.set(0, random() * 6.28, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      cacti.setMatrixAt(i, dummy.matrix);
    }
    cacti.castShadow = true;
    world.add(cacti);
    const outpost = attach(world, trackLength * 0.065, 33, -1);
    box(outpost, rock, [40, 8, 27], [0, -3, 0]);
    box(outpost, light, [19, 5.5, 11], [0, 2.75, 0]);
    box(outpost, dark, [20, 0.45, 12], [0, 5.6, 0]);
    for (let i = 0; i < 5; i++)
      box(outpost, glass, [2.7, 2, 0.05], [-6 + i * 3, 3, -5.54]);
    box(outpost, accent, [20, 0.5, 0.4], [0, 4.75, -5.7]);
    const sign = add(
      outpost,
      new THREE.PlaneGeometry(17, 2.2),
      boardMaterial("EMBER / STATION", "SOLAR RESEARCH OUTPOST", "#f5b276"),
      0,
      7.3,
      -6,
    );
    sign.rotation.y = Math.PI;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 5; c++) {
        const panel = box(
          outpost,
          glass,
          [4.5, 0.15, 3.1],
          [-9 + c * 4.7, 1.6, 12 + r * 4],
        );
        panel.rotation.x = -0.42;
        box(outpost, steel, [0.12, 2, 0.12], [-9 + c * 4.7, 0.6, 12 + r * 4]);
      }
    rod(
      outpost,
      steel,
      new THREE.Vector3(13, 0, 2),
      new THREE.Vector3(13, 18, 2),
      0.12,
    );
    const dish = add(
      outpost,
      new THREE.SphereGeometry(2.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.43),
      light,
      13,
      17,
      2,
    );
    dish.rotation.x = 0.7;
    for (let i = 0; i < 4; i++) {
      const silo = add(
        outpost,
        new THREE.CylinderGeometry(1.4, 1.4, 5, 12),
        accent,
        15,
        2.5,
        -8 + i * 3.2,
      );
      silo.rotation.y = i;
    }
  } else {
    // Jagged snow faces remain separate from exposed rock so caps stay crisp white.
    for (let i = 0; i < 16; i++) {
      const d = (i / 16) * trackLength,
        p = groundPosition(d, -610 - random() * 390),
        mountain = new THREE.Mesh(mountainGeometry(i * 0.83), [rock, snow]);
      mountain.position.set(p.x, minY - 58, p.z);
      mountain.scale.set(
        270 + random() * 155,
        180 + random() * 170,
        225 + random() * 150,
      );
      mountain.rotation.y = random() * 6.28;
      mountain.castShadow = false;
      world.add(mountain);
    }
    const firPositions: number[] = [],
      firColors: number[] = [];
    const triangle = (a: number[], b: number[], c: number[], shade: number) => {
      firPositions.push(...a, ...b, ...c);
      for (let i = 0; i < 3; i++)
        firColors.push(shade * 0.75, shade, shade * 0.84);
    };
    for (let tier = 0; tier < 7; tier++)
      for (let branch = 0; branch < 7; branch++) {
        const angle = (branch / 7) * Math.PI * 2 + tier * 0.73,
          h = 1.25 + tier * 0.94,
          r = 2.6 - tier * 0.32;
        const point = (forward: number, side: number, y: number) => [
          Math.sin(angle) * forward + Math.cos(angle) * side,
          y,
          Math.cos(angle) * forward - Math.sin(angle) * side,
        ];
        const root = point(0.1, 0, h + 0.62),
          tip = point(
            r * (0.91 + 0.09 * Math.sin(branch * 3 + tier)),
            0,
            h - 0.25,
          ),
          left = point(r * 0.65, r * 0.29, h + 0.07),
          right = point(r * 0.69, -r * 0.26, h - 0.03),
          ridge = point(r * 0.56, 0, h + 0.46);
        const shade = 0.65 + tier * 0.033 + (branch % 3) * 0.06;
        triangle(root, left, ridge, shade);
        triangle(root, ridge, right, shade * 0.92);
        triangle(left, tip, ridge, shade * 0.9);
        triangle(ridge, tip, right, shade * 0.78);
        const twigLeft = point(r * 0.89, r * 0.17, h - 0.28),
          twigRight = point(r * 0.89, -r * 0.14, h - 0.31);
        triangle(left, twigLeft, tip, shade * 0.82);
        triangle(right, tip, twigRight, shade * 0.73);
      }
    const firGeometry = new THREE.BufferGeometry();
    firGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(firPositions, 3),
    );
    firGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(firColors, 3),
    );
    firGeometry.computeVertexNormals();
    const foliage = new THREE.MeshStandardMaterial({
        color: "#537366",
        vertexColors: true,
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
      fir = new THREE.InstancedMesh(firGeometry, foliage, 720),
      trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.17, 0.25, 5, 6),
        new THREE.MeshStandardMaterial({ color: "#71675b", roughness: 1 }),
        720,
      );
    for (let i = 0; i < 720; i++) {
      const d = random() * trackLength,
        l = (i % 3 === 0 ? -1 : 1) * (15 + random() * 84),
        p = groundPosition(d, l),
        s = 0.65 + random() * 1.2;
      dummy.position.copy(p);
      dummy.rotation.set(0, random() * 6.28, 0);
      dummy.scale.set(s, s * (0.9 + random() * 0.25), s);
      dummy.updateMatrix();
      fir.setMatrixAt(i, dummy.matrix);
      fir.setColorAt(i, new THREE.Color().setScalar(0.76 + random() * 0.5));
      dummy.position.y += s * 2.5;
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
    }
    fir.castShadow = trunks.castShadow = true;
    world.add(fir, trunks);
    // A high cable viaduct opens above a forested ravine.
    const bridgeStart = trackLength * 0.18,
      bridgeEnd = trackLength * 0.25;
    for (let d = bridgeStart; d < bridgeEnd; d += 7) {
      const p = sampleTrack(d),
        q = sampleTrack(d + 7),
        span = Math.hypot(q.x - p.x, q.z - p.z),
        deck = box(
          world,
          light,
          [19.8, 0.95, Math.hypot(span, q.y - p.y) + 0.13],
          [(p.x + q.x) / 2, (p.y + q.y) / 2 - 0.58, (p.z + q.z) / 2],
        );
      deck.rotation.set(
        -Math.atan2(q.y - p.y, span),
        Math.atan2(q.x - p.x, q.z - p.z),
        0,
        "YXZ",
      );
      if (Math.floor((d - bridgeStart) / 7) % 5 === 0) {
        for (const s of [-1, 1]) {
          const a = sampleTrack(d, s * 7);
          box(world, rock, [2.0, 40, 2.8], [a.x, a.y - 21, a.z]);
        }
      }
    }
    for (const fraction of [0.197, 0.232])
      for (const side of [-1, 1]) {
        const d = trackLength * fraction,
          p = sampleTrack(d, side * 11.8),
          top = new THREE.Vector3(p.x, p.y + 28, p.z);
        box(world, light, [1.05, 29, 1.5], [p.x, p.y + 14, p.z]);
        for (const shift of [-66, -44, -22, 22, 44, 66]) {
          const q = sampleTrack(d + shift, side * 9.8);
          rod(world, steel, top, new THREE.Vector3(q.x, q.y + 0.7, q.z), 0.065);
        }
        const collar = box(world, accent, [1.25, 3, 1.7], [p.x, p.y + 24, p.z]);
        collar.rotation.y = p.heading;
      }
    // Aster Observatory: pale dome, telescope slit and a geometric research terrace.
    const observatory = attach(world, trackLength * 0.6, 48, 5);
    box(observatory, rock, [39, 13, 34], [0, -5.5, 0]);
    box(observatory, light, [38, 0.65, 33], [0, 1.1, 0]);
    add(
      observatory,
      new THREE.CylinderGeometry(11.2, 11.2, 6, 36),
      light,
      0,
      4.3,
      0,
    );
    add(
      observatory,
      new THREE.SphereGeometry(11.4, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      snow,
      0,
      7.3,
      0,
    );
    const slit = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 7.5, -11.4),
      new THREE.Vector3(0, 16, -7),
      new THREE.Vector3(0, 18.8, 0),
      new THREE.Vector3(0, 16, 7),
      new THREE.Vector3(0, 7.5, 11.4),
    ]);
    add(observatory, new THREE.TubeGeometry(slit, 32, 0.52, 5, false), dark);
    const telescope = add(
      observatory,
      new THREE.CylinderGeometry(0.8, 0.95, 11, 16),
      steel,
      0,
      16,
      7.6,
    );
    telescope.rotation.x = 0.75;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2,
        w = box(
          observatory,
          glass,
          [2.6, 2, 0.1],
          [Math.sin(a) * 11.24, 4.5, Math.cos(a) * 11.24],
        );
      w.rotation.y = a;
    }
    box(observatory, dark, [10, 4, 8], [-12, 3.2, -8]);
    box(observatory, accent, [10, 0.3, 8.5], [-12, 5.35, -8]);
    const title = add(
      observatory,
      new THREE.PlaneGeometry(24, 3),
      boardMaterial(
        "ASTER / OBSERVATORY",
        "THE SKY ABOVE THE SPEED",
        "#a6d4e6",
      ),
      0,
      3.4,
      -17.02,
    );
    title.rotation.y = Math.PI;
    for (const fraction of [0.055, 0.43, 0.84]) {
      const lodge = attach(world, trackLength * fraction, -23, -0.5),
        timber = new THREE.MeshStandardMaterial({
          color: "#87735b",
          roughness: 1,
        });
      box(lodge, rock, [17, 8, 15], [0, -3.7, 0]);
      box(lodge, timber, [13, 7, 11], [0, 3.5, 0]);
      for (const s of [-1, 1]) {
        const roof = box(lodge, snow, [8.8, 0.32, 13], [s * 3.65, 8.5, 0]);
        roof.rotation.z = -s * 0.47;
      }
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 3; c++)
          box(lodge, glass, [2, 1.9, 0.04], [-4 + c * 4, 2 + r * 3, -5.53]);
      box(lodge, accent, [14, 0.25, 3], [0, 4.25, -6]);
      for (const s of [-1, 1])
        box(lodge, timber, [0.25, 4.2, 0.25], [s * 6.5, 2.1, -7]);
    }
  }

  // Every world has its own restrained circuit architecture and route marker palette.
  const start = attach(world, 0, 0),
    title = boardMaterial(
      activeTrack.name.toUpperCase(),
      canyon ? "EMBER EXPEDITION / 02" : "ASTER EXPEDITION / 03",
      canyon ? "#f5b276" : "#b3d9e8",
    );
  for (const s of [-1, 1]) {
    box(start, dark, [0.6, 8.4, 1], [s * 10.2, 4.2, 0]);
    box(start, accent, [0.8, 2.3, 1.2], [s * 10.2, 1.1, 0]);
  }
  box(start, dark, [21, 1.8, 0.65], [0, 7.6, 0]);
  add(
    start,
    new THREE.PlaneGeometry(19.7, 2.46),
    title,
    0,
    7.65,
    -0.36,
  ).rotation.y = Math.PI;
  add(start, new THREE.PlaneGeometry(19.7, 2.46), title, 0, 7.65, 0.36);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 18; c++)
      box(
        start,
        (r + c) % 2 ? light : dark,
        [1, 0.016, 0.62],
        [-8.5 + c, 0.035, r * 0.62],
      );
  for (let i = 0; i < 12; i++) {
    const d = ((i + 0.5) / 12) * trackLength,
      g = attach(world, d, -11.8);
    box(g, dark, [0.14, 2.2, 0.14], [0, 1.1, 0]);
    box(g, accent, [3, 0.8, 0.1], [0, 1.8, 0]);
    for (let j = 0; j < 3; j++) {
      const a = box(g, dark, [0.13, 0.55, 0.12], [-0.8 + j * 0.8, 1.8, -0.07]);
      a.rotation.z = -0.6;
    }
  }
  mergeWorld(world);
  return world;
}

/** Riviera's marina and promenade add a recognisable human-scale coastal district. */
export function addRivieraDistrict(
  world: THREE.Group,
  textures: RegionalTextures,
) {
  const cream = new THREE.MeshStandardMaterial({
      color: "#e8e2d2",
      roughness: 0.82,
    }),
    navy = new THREE.MeshStandardMaterial({
      color: "#224e61",
      metalness: 0.35,
      roughness: 0.45,
    }),
    coral = new THREE.MeshStandardMaterial({
      color: "#d47c57",
      roughness: 0.68,
    }),
    wood = new THREE.MeshStandardMaterial({
      color: "#a48a67",
      roughness: 0.95,
    }),
    white = new THREE.MeshStandardMaterial({
      color: "#faf6e8",
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
  const district = new THREE.Group();
  world.add(district);
  for (let d = 0; d < trackLength * 0.15; d += 12) {
    const g = attach(district, d, -14.2, -0.05);
    box(g, cream, [5.2, 0.45, 12.3], [0, -0.16, 0]);
    if (Math.floor(d / 12) % 3 === 0) {
      box(g, wood, [1.8, 0.17, 0.65], [0, 0.63, 0]);
      for (const s of [-1, 1])
        box(g, navy, [0.1, 0.6, 0.45], [s * 0.65, 0.25, 0]);
      box(g, wood, [1.8, 0.5, 0.13], [0, 0.97, 0.32]);
    }
  }
  for (let i = 0; i < 9; i++) {
    const g = attach(district, (i + 0.6) * trackLength * 0.014, -17.3);
    add(g, new THREE.CylinderGeometry(0.045, 0.055, 2.8, 7), wood, 0, 1.4, 0);
    add(
      g,
      new THREE.ConeGeometry(2.55, 0.8, 12, 1, true),
      i % 2 ? white : navy,
      0,
      3,
      0,
    );
  }
  const p = sampleTrack(trackLength * 0.095, -60),
    marina = new THREE.Group();
  marina.position.set(p.x, -4.85, p.z);
  marina.rotation.y = p.heading;
  district.add(marina);
  box(marina, wood, [7, 0.65, 150], [0, 0, 0]);
  for (const z of [-55, -20, 20, 55]) {
    box(marina, wood, [60, 0.55, 3], [-30, -0.05, z]);
    for (let x = 0; x > -58; x -= 12)
      add(
        marina,
        new THREE.CylinderGeometry(0.25, 0.33, 6, 7),
        navy,
        x,
        -2.1,
        z + 1.7,
      );
  }
  for (let i = 0; i < 13; i++) {
    const boat = new THREE.Group();
    boat.position.set(-13 - (i % 3) * 17, -0.4, -62 + Math.floor(i / 3) * 33);
    boat.rotation.y = i % 2 ? 0.1 : -0.08;
    marina.add(boat);
    const hull = add(
      boat,
      new THREE.SphereGeometry(1, 18, 10),
      i % 4 === 0 ? navy : white,
      0,
      0.2,
      0,
    );
    hull.scale.set(2.25, 0.75, 6.2);
    box(boat, wood, [3.6, 0.12, 7.8], [0, 0.71, 0]);
    box(boat, white, [2.4, 1.2, 3.1], [0, 1.3, -0.3]);
    box(boat, navy, [2.3, 0.48, 0.03], [0, 1.6, 1.27]);
    if (i % 3 !== 0) {
      add(
        boat,
        new THREE.CylinderGeometry(0.065, 0.085, 17, 8),
        cream,
        0,
        9,
        0,
      );
      const sail = new THREE.BufferGeometry();
      sail.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [0.06, 2.4, -4.8, 0.06, 17.3, 0, 0.06, 2.4, 1.1],
          3,
        ),
      );
      sail.computeVertexNormals();
      add(boat, sail, white);
      rod(
        boat,
        cream,
        new THREE.Vector3(0, 2.2, -4.8),
        new THREE.Vector3(0, 2.2, 1.1),
        0.06,
      );
    }
  }
  const crane = new THREE.Group();
  crane.position.set(2, 0.4, 62);
  marina.add(crane);
  box(crane, coral, [1.5, 24, 1.5], [0, 12, 0]);
  box(crane, coral, [34, 1.1, 1.0], [-12, 24, 0]);
  rod(
    crane,
    navy,
    new THREE.Vector3(0, 29, 0),
    new THREE.Vector3(-28, 24, 0),
    0.075,
  );
  rod(
    crane,
    navy,
    new THREE.Vector3(-26, 24, 0),
    new THREE.Vector3(-26, 8, 0),
    0.06,
  );
  box(crane, navy, [3, 2, 2.3], [1.4, 22, 0]);
  const sign = attach(district, trackLength * 0.075, -17, 0);
  add(
    sign,
    new THREE.PlaneGeometry(10, 1.3),
    boardMaterial("PORT / LUMIÈRE", "RIVIERA HARBOUR", "#79d1cf"),
    0,
    3,
    0,
  ).rotation.y = Math.PI / 2;
  // A cliffside terrace landmark contrasts with the low marina district.
  const hotel = attach(district, trackLength * 0.46, -29, -2),
    glass = new THREE.MeshStandardMaterial({
      color: "#2d6371",
      metalness: 0.5,
      roughness: 0.2,
    }),
    rock = new THREE.MeshStandardMaterial({
      map: textures.rock,
      normalMap: textures.normal,
      color: "#e2ceb0",
      roughness: 0.98,
    });
  box(hotel, rock, [30, 21, 21], [0, -9, 0]);
  for (let level = 0; level < 4; level++) {
    box(
      hotel,
      cream,
      [26 - level * 2, 3.8, 15],
      [level * 0.6, level * 3.7 + 2, 0],
    );
    box(
      hotel,
      cream,
      [28 - level * 2, 0.32, 18],
      [level * 0.6, level * 3.7 + 0.2, -1],
    );
    for (let x = -4; x <= 4; x++)
      box(
        hotel,
        glass,
        [1.7, 2.6, 0.06],
        [x * 2.45 + level * 0.6, level * 3.7 + 2, -7.55],
      );
  }
  box(hotel, navy, [18, 0.3, 9], [1.8, 15, -1]);
  // Cap Sol's old citadel makes the long return leg recognisable from the road.
  const citadel = attach(district, trackLength * 0.58, 58, 3);
  box(citadel, rock, [68, 18, 52], [0, -8, 0]);
  box(citadel, cream, [59, 0.7, 43], [0, 1.05, 0]);
  for (const side of [-1, 1]) {
    box(citadel, rock, [51, 13, 4], [0, 7, side * 20]);
    box(citadel, cream, [52, 0.6, 4.5], [0, 13.75, side * 20]);
    box(citadel, rock, [4, 13, 37], [side * 25, 7, 0]);
    for (let k = -5; k <= 5; k++)
      box(citadel, cream, [2.1, 1.7, 4.4], [k * 4.6, 14.85, side * 20]);
    for (let k = -4; k <= 4; k++)
      box(citadel, cream, [4.5, 1.7, 2.1], [side * 25, 14.85, k * 4.3]);
  }
  for (const x of [-24, 24])
    for (const z of [-18, 18]) {
      add(
        citadel,
        new THREE.CylinderGeometry(5.8, 6.6, 23, 18),
        rock,
        x,
        12,
        z,
      );
      add(
        citadel,
        new THREE.CylinderGeometry(6.35, 6.35, 0.75, 18),
        cream,
        x,
        23.7,
        z,
      );
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2,
          merlon = box(
            citadel,
            cream,
            [1.65, 2, 1.65],
            [x + Math.sin(a) * 5.5, 25.0, z + Math.cos(a) * 5.5],
          );
        merlon.rotation.y = a;
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2,
          slit = box(
            citadel,
            navy,
            [0.55, 2.2, 0.075],
            [x + Math.sin(a) * 6.15, 16, z + Math.cos(a) * 6.15],
          );
        slit.rotation.y = a;
      }
    }
  box(citadel, navy, [4.5, 6.0, 0.09], [0, 4.5, -22.05]);
  const crest = add(
    citadel,
    new THREE.PlaneGeometry(15, 1.87),
    boardMaterial("CAP / SOL", "CITADEL OF THE SUN", "#e1c990"),
    0,
    10,
    -22.06,
  );
  crest.rotation.y = Math.PI;
  for (const x of [-24, 24]) {
    add(
      citadel,
      new THREE.CylinderGeometry(0.08, 0.1, 8, 8),
      wood,
      x,
      28.8,
      -18,
    );
    const flag = new THREE.BufferGeometry();
    flag.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [x, 31.8, -18, x + 4, 30.7, -17.65, x, 29.4, -18],
        3,
      ),
    );
    flag.computeVertexNormals();
    add(citadel, flag, navy);
  }
  mergeWorld(district);
}
