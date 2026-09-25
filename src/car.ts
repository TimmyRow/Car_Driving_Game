import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// An original mid-engined silhouette. Every part is authored in metres, +Z forward.
const rubber = new THREE.MeshStandardMaterial({
  color: "#15191b",
  roughness: 0.92,
});
const carbon = new THREE.MeshStandardMaterial({
  color: "#131c20",
  metalness: 0.36,
  roughness: 0.32,
});
const alloy = new THREE.MeshStandardMaterial({
  color: "#b9c7cb",
  metalness: 0.96,
  roughness: 0.21,
});
const darkAlloy = new THREE.MeshStandardMaterial({
  color: "#293237",
  metalness: 0.84,
  roughness: 0.31,
});
const glass = new THREE.MeshPhysicalMaterial({
  color: "#172b36",
  metalness: 0.45,
  roughness: 0.08,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
});
const whiteLight = new THREE.MeshStandardMaterial({
  color: "#e1f8ff",
  emissive: "#b5eeff",
  emissiveIntensity: 3.2,
});
const tireGeo = new THREE.CylinderGeometry(0.385, 0.385, 0.275, 32, 1);
const rimGeo = new THREE.CylinderGeometry(0.282, 0.282, 0.014, 24);
const discGeo = new THREE.CylinderGeometry(0.227, 0.227, 0.018, 28);
const hubGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.027, 16);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(
  parent: THREE.Object3D,
  mat: THREE.Material,
  size: number[],
  pos: number[],
) {
  const m = part(parent, boxGeo, mat, pos[0], pos[1], pos[2]);
  m.scale.set(size[0], size[1], size[2]);
  return m;
}
function beam(
  parent: THREE.Object3D,
  mat: THREE.Material,
  a: number[],
  b: number[],
  width: number,
  depth: number,
) {
  const start = new THREE.Vector3(...(a as [number, number, number])),
    end = new THREE.Vector3(...(b as [number, number, number])),
    direction = end.clone().sub(start);
  const m = box(
    parent,
    mat,
    [width, depth, direction.length()],
    start.clone().add(end).multiplyScalar(0.5).toArray(),
  );
  m.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    direction.normalize(),
  );
  return m;
}
function shell(rings: number[][]): THREE.BufferGeometry {
  const p: number[] = [],
    idx: number[] = [];
  // z, half width, centre crown height, shoulder height, lower height.
  for (const [z, w, top, shoulder, lo] of rings) {
    const lowSide = lo + Math.min(0.11, (shoulder - lo) * 0.22),
      highSide = shoulder - Math.min(0.075, (shoulder - lo) * 0.25);
    p.push(
      -w * 0.78,
      lo,
      z,
      -w,
      lowSide,
      z,
      -w,
      highSide,
      z,
      -w * 0.87,
      shoulder,
      z,
      -w * 0.6,
      top,
      z,
      w * 0.6,
      top,
      z,
      w * 0.87,
      shoulder,
      z,
      w,
      highSide,
      z,
      w,
      lowSide,
      z,
      w * 0.78,
      lo,
      z,
    );
  }
  for (let r = 0; r < rings.length - 1; r++)
    for (let j = 0; j < 10; j++) {
      const a = r * 10 + j,
        b = r * 10 + ((j + 1) % 10),
        c = (r + 1) * 10 + j,
        d = (r + 1) * 10 + ((j + 1) % 10);
      idx.push(a, c, b, b, c, d);
    }
  for (let j = 1; j < 9; j++) {
    idx.push(0, j, j + 1);
    const b = (rings.length - 1) * 10;
    idx.push(b, b + j + 1, b + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function quad(parent: THREE.Object3D, mat: THREE.Material, points: number[][]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points.flat(), 3),
  );
  g.setIndex(points[0][0] > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  const m = part(parent, g, mat, 0, 0, 0);
  m.material = mat;
  return m;
}

function combineStatic(parent: THREE.Object3D) {
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...parent.children])
    if (
      child instanceof THREE.Mesh &&
      child.name !== "nitro-flame" &&
      !Array.isArray(child.material)
    ) {
      const list = batches.get(child.material) || [];
      list.push(child);
      batches.set(child.material, list);
    }
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((m) => {
      m.updateMatrix();
      const g = m.geometry.index
        ? m.geometry.toNonIndexed()
        : m.geometry.clone();
      g.deleteAttribute("uv");
      g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = mergeGeometries(geometries);
    if (merged) {
      meshes.forEach((m) => parent.remove(m));
      part(parent, merged, material, 0, 0, 0);
    }
    geometries.forEach((g) => g.dispose());
  }
}

export function createCar(color: string): THREE.Group {
  const car = new THREE.Group();
  car.name = "AERIS GT";
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.64,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  const caliper = new THREE.MeshStandardMaterial({
    color: "#e9ed65",
    metalness: 0.4,
    roughness: 0.32,
  });
  const redLight = new THREE.MeshStandardMaterial({
    color: "#ff2938",
    emissive: "#ff1238",
    emissiveIntensity: 1.8,
  });
  const amber = new THREE.MeshStandardMaterial({
    color: "#f6b036",
    emissive: "#f49a1d",
    emissiveIntensity: 0.6,
  });
  part(
    car,
    shell([
      [-2.24, 0.83, 0.67, 0.66, 0.3],
      [-2.02, 0.99, 0.8, 0.78, 0.29],
      [-1.34, 1.055, 0.84, 0.91, 0.3],
      [-0.72, 0.95, 0.78, 0.8, 0.29],
      [0.28, 0.94, 0.76, 0.77, 0.28],
      [1.26, 1.045, 0.77, 0.86, 0.29],
      [1.88, 0.97, 0.67, 0.72, 0.3],
      [2.22, 0.79, 0.56, 0.6, 0.33],
    ]),
    paint,
    0,
    0,
    0,
  );
  // Long lower sill, splitter and subtly flared rear diffuser.
  part(
    car,
    shell([
      [1.78, 0.985, 0.3, 0.3, 0.255],
      [2.12, 0.92, 0.3, 0.3, 0.255],
      [2.3, 0.775, 0.3, 0.3, 0.255],
    ]),
    carbon,
    0,
    0,
    0,
  );
  part(
    car,
    shell([
      [-2.28, 0.89, 0.3, 0.3, 0.24],
      [-2.08, 1.02, 0.3, 0.3, 0.24],
      [-1.7, 1.0, 0.3, 0.3, 0.24],
    ]),
    carbon,
    0,
    0,
    0,
  );
  for (const s of [-1, 1]) {
    const sill = box(car, carbon, [0.14, 0.11, 3.3], [s * 1.01, 0.29, -0.02]);
    sill.rotation.z = s * -0.12;
    const blade = box(car, paint, [0.07, 0.08, 1.04], [s * 1.078, 0.37, -0.06]);
    blade.rotation.y = s * 0.06;
    // Triangular dark intake, then a coloured fin framing its lower lip.
    quad(car, carbon, [
      [s * 0.953, 0.72, -0.65],
      [s * 1.067, 0.69, -1.17],
      [s * 1.065, 0.37, -0.81],
      [s * 0.958, 0.39, -0.34],
    ]);
    const fin = box(car, paint, [0.065, 0.07, 0.6], [s * 1.08, 0.37, -0.67]);
    fin.rotation.y = s * 0.15;
    // Door seams remain subdued at racing distance.
    const seam = box(
      car,
      carbon,
      [0.009, 0.008, 0.8],
      [s * 0.955, 0.762, -0.1],
    );
    seam.rotation.y = s * 0.015;
    box(car, alloy, [0.008, 0.025, 0.16], [s * 0.97, 0.69, -0.21]);
  }
  // Cabin: broad curved windscreen, narrow roof and swept triangular windows.
  part(
    car,
    shell([
      [-1.0, 0.66, 0.8, 0.8, 0.73],
      [-0.52, 0.675, 1.225, 1.19, 0.76],
      [0.34, 0.65, 1.245, 1.19, 0.76],
      [1.12, 0.77, 0.785, 0.78, 0.74],
    ]),
    glass,
    0,
    0,
    0,
  );
  part(
    car,
    shell([
      [-0.54, 0.62, 1.245, 1.225, 1.19],
      [0.28, 0.6, 1.265, 1.235, 1.2],
      [0.4, 0.59, 1.225, 1.21, 1.19],
    ]),
    paint,
    0,
    0,
    0,
  );
  for (const s of [-1, 1]) {
    beam(
      car,
      paint,
      [s * 0.557, 1.205, 0.362],
      [s * 0.675, 0.796, 1.08],
      0.038,
      0.027,
    );
    beam(
      car,
      paint,
      [s * 0.571, 1.204, -0.508],
      [s * 0.578, 0.804, -0.984],
      0.069,
      0.038,
    );
    const mirrorArm = box(
      car,
      carbon,
      [0.19, 0.033, 0.048],
      [s * 0.844, 0.865, 0.56],
    );
    mirrorArm.rotation.y = s * 0.3;
    const mirror = part(
      car,
      new THREE.SphereGeometry(0.12, 14, 8),
      paint,
      s * 0.993,
      0.876,
      0.57,
    );
    mirror.scale.set(1, 0.48, 1.6);
    box(car, glass, [0.17, 0.065, 0.035], [s * 0.998, 0.874, 0.447]);
  }
  // Recessed dark engine deck, six cooling louvres and raised rear haunches.
  box(car, carbon, [1.14, 0.023, 0.7], [0, 0.813, -1.41]);
  for (let i = 0; i < 7; i++) {
    const l = box(
      car,
      darkAlloy,
      [1.05, 0.022, 0.028],
      [0, 0.834, -1.12 - i * 0.083],
    );
    l.rotation.x = -0.2;
  }
  for (const s of [-1, 1]) {
    const hoodChannel = box(
      car,
      carbon,
      [0.057, 0.016, 0.64],
      [s * 0.48, 0.764, 1.3],
    );
    hoodChannel.rotation.y = s * -0.12;
    hoodChannel.rotation.x = 0.11;
    const hoodEdge = box(
      car,
      paint,
      [0.045, 0.026, 0.89],
      [s * 0.63, 0.769, 1.22],
    );
    hoodEdge.rotation.y = s * -0.09;
    hoodEdge.rotation.x = 0.12;
  }
  // Continuous black rear mask with floating red LED light blades.
  box(car, carbon, [1.61, 0.165, 0.037], [0, 0.608, -2.235]);
  box(car, carbon, [1.5, 0.2, 0.055], [0, 0.45, 2.236]);
  for (const s of [-1, 1]) {
    const led = box(
      car,
      redLight,
      [0.66, 0.031, 0.038],
      [s * 0.449, 0.67, -2.263],
    );
    led.rotation.z = s * -0.04;
    box(car, redLight, [0.037, 0.085, 0.039], [s * 0.78, 0.636, -2.255]);
    box(car, whiteLight, [0.56, 0.024, 0.019], [s * 0.443, 0.541, 2.272]);
    box(car, whiteLight, [0.021, 0.068, 0.019], [s * 0.712, 0.517, 2.272]);
    box(car, darkAlloy, [0.52, 0.105, 0.012], [s * 0.457, 0.411, 2.269]);
    for (let j = 0; j < 4; j++)
      box(
        car,
        carbon,
        [0.025, 0.099, 0.018],
        [s * 0.457 + (j - 1.5) * 0.119, 0.411, 2.282],
      );
    box(car, amber, [0.014, 0.036, 0.11], [s * 0.982, 0.598, 1.87]);
  }
  box(car, paint, [0.16, 0.13, 0.035], [0, 0.43, 2.278]);
  for (let i = -3; i <= 3; i++)
    box(car, carbon, [0.025, 0.15, 0.4], [i * 0.205, 0.294, -2.02]);
  // Titanium exhaust pipes with dark bores.
  for (const s of [-1, 1]) {
    const pipe = part(
      car,
      new THREE.CylinderGeometry(0.082, 0.082, 0.14, 16, 1, true),
      alloy,
      s * 0.48,
      0.352,
      -2.242,
    );
    pipe.rotation.x = Math.PI / 2;
    const bore = part(
      car,
      new THREE.CircleGeometry(0.066, 16),
      carbon,
      s * 0.48,
      0.352,
      -2.317,
    );
    bore.rotation.y = Math.PI;
  }
  // Fixed aerofoil with swept endplates.
  for (const s of [-1, 1]) {
    box(car, carbon, [0.041, 0.145, 0.12], [s * 0.62, 0.9, -1.93]);
    box(car, carbon, [0.028, 0.085, 0.3], [s * 0.92, 0.996, -1.99]);
  }
  const wing = box(car, carbon, [1.86, 0.032, 0.25], [0, 0.969, -1.985]);
  wing.rotation.x = -0.075;
  box(car, paint, [1.78, 0.012, 0.026], [0, 0.99, -1.876]);
  // Four multi-spoke alloy wheels. Axles point along local X.
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  for (const z of [-1.34, 1.3])
    for (const s of [-1, 1]) {
      const steering = new THREE.Group();
      steering.position.set(s * 1.012, 0.39, z);
      car.add(steering);
      const wheel = new THREE.Group();
      steering.add(wheel);
      wheels.push(wheel);
      if (z > 0) frontWheels.push(steering);
      const tire = part(wheel, tireGeo, rubber, 0, 0, 0);
      tire.rotation.z = Math.PI / 2;
      const disc = part(wheel, discGeo, darkAlloy, s * 0.132, 0, 0);
      disc.rotation.z = Math.PI / 2;
      const rim = part(wheel, rimGeo, carbon, s * 0.149, 0, 0);
      rim.rotation.z = Math.PI / 2;
      const torus = part(
        wheel,
        new THREE.TorusGeometry(0.276, 0.022, 7, 28),
        alloy,
        s * 0.162,
        0,
        0,
      );
      torus.rotation.y = Math.PI / 2;
      const hub = part(wheel, hubGeo, alloy, s * 0.177, 0, 0);
      hub.rotation.z = Math.PI / 2;
      for (let j = 0; j < 5; j++)
        for (const branch of [-1, 1]) {
          const angle = (j * Math.PI * 2) / 5 + branch * 0.08;
          const spoke = box(
            wheel,
            alloy,
            [0.026, 0.219, 0.024],
            [s * 0.169, Math.cos(angle) * 0.141, Math.sin(angle) * 0.141],
          );
          spoke.rotation.x = angle;
        }
      box(steering, caliper, [0.065, 0.145, 0.078], [s * 0.145, 0.07, -0.158]);
      // Tread shoulder grooves catch grazing sunlight.
      for (const offset of [-0.09, 0.09]) {
        const groove = part(
          wheel,
          new THREE.TorusGeometry(0.382, 0.005, 4, 32),
          darkAlloy,
          offset,
          0,
          0,
        );
        groove.rotation.y = Math.PI / 2;
      }
      combineStatic(wheel);
    }
  // A small hood badge and competition number panel are intentionally unbranded.
  const badge = box(car, alloy, [0.045, 0.012, 0.07], [0, 0.67, 1.98]);
  badge.rotation.x = 0.15;
  const flames: THREE.Object3D[] = [];
  const flameMat = new THREE.MeshBasicMaterial({
    color: "#60eaff",
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (const s of [-1, 1]) {
    const flame = part(
      car,
      new THREE.ConeGeometry(0.12, 0.75, 10, 1, true),
      flameMat,
      s * 0.48,
      0.353,
      -2.65,
    );
    flame.rotation.x = -Math.PI / 2;
    flame.visible = false;
    flame.name = "nitro-flame";
    flames.push(flame);
  }
  combineStatic(car);
  car.userData.wheels = wheels;
  car.userData.frontWheels = frontWheels;
  car.userData.brakeLights = [redLight];
  car.userData.flames = flames;
  car.userData.paintMaterial = paint;
  return car;
}
