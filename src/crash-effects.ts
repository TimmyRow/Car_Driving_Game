import * as THREE from "three";
import { sampleTrack } from "./track";
import type { CollisionEvent } from "./simulation";

/** Fixed pools keep impacts bounded: four draw calls, no per-impact GPU objects. */
export class CrashEffects {
  private readonly maxSparks = 480;
  private readonly maxDebris = 64;
  private readonly maxFlashes = 8;
  private sparkCursor = 0;
  private debrisCursor = 0;
  private flashCursor = 0;
  private sparks = Array.from({ length: this.maxSparks }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    life: 0,
    duration: 1,
    floor: 0,
    trail: 0.05,
  }));
  private debris = Array.from({ length: this.maxDebris }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    spin: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    life: 0,
    floor: 0,
  }));
  private flashes = Array.from({ length: this.maxFlashes }, () => ({
    position: new THREE.Vector3(),
    life: 0,
    duration: 0.34,
    energy: 1,
  }));
  private readonly vertices = new Float32Array(this.maxSparks * 6).fill(-10000);
  private readonly colors = new Float32Array(this.maxSparks * 6);
  private readonly sparkGeometry = new THREE.BufferGeometry();
  private readonly fragments: THREE.InstancedMesh;
  private readonly contactFlashes: THREE.InstancedMesh;
  private readonly halos: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.sparkGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.vertices, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.sparkGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.colors, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const streaks = new THREE.LineSegments(
      this.sparkGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    streaks.frustumCulled = false;
    scene.add(streaks);

    // Bent, torn sheets catch light like loose body skins and aero panels.
    const panel = new THREE.BufferGeometry();
    panel.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          0, 0.09, 0, -0.48, 0, -0.58, 0.22, 0.02, -0.65, 0.5, 0.13, -0.15,
          0.35, 0.18, 0.51, -0.18, -0.035, 0.63, -0.46, -0.02, 0.18,
        ],
        3,
      ),
    );
    panel.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1]);
    panel.computeVertexNormals();
    this.fragments = new THREE.InstancedMesh(
      panel,
      new THREE.MeshStandardMaterial({
        color: "#bcc6ca",
        metalness: 0.68,
        roughness: 0.38,
        side: THREE.DoubleSide,
      }),
      this.maxDebris,
    );
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragments.frustumCulled = false;
    const palette = ["#a8b5bb", "#263338", "#687b85", "#dddbd0", "#354149"];
    for (let i = 0; i < this.maxDebris; i++)
      this.fragments.setColorAt(i, this.color.set(palette[i % palette.length]));
    scene.add(this.fragments);

    this.contactFlashes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({
        color: "#fff3c5",
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      this.maxFlashes,
    );
    this.halos = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.84, 1, 32),
      new THREE.MeshBasicMaterial({
        color: "#ffcc77",
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      this.maxFlashes,
    );
    for (const pool of [this.contactFlashes, this.halos]) {
      pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      pool.frustumCulled = false;
      for (let i = 0; i < this.maxFlashes; i++)
        pool.setColorAt(i, this.color.setScalar(0));
      scene.add(pool);
    }
    this.clear();
  }

  burst(event: CollisionEvent) {
    const p = sampleTrack(event.distance, event.offset),
      big = event.kind !== "hit";
    const motion = event as CollisionEvent & { speed?: number; side?: number };
    const speed = THREE.MathUtils.clamp(motion.speed ?? 35, 0, 110);
    const side = Math.sign(motion.side ?? 1) || 1;
    const energy = 0.7 + THREE.MathUtils.clamp(event.intensity, 0, 1) * 0.45;
    const fx = Math.sin(p.heading),
      fz = Math.cos(p.heading),
      rx = fz,
      rz = -fx;
    const count = big ? 130 + Math.round(energy * 24) : 30;
    for (let n = 0; n < count; n++) {
      const spark = this.sparks[this.sparkCursor++ % this.maxSparks];
      spark.position.set(
        p.x + rx * side * 0.5,
        p.y + 0.58 + Math.random() * 0.35,
        p.z + rz * side * 0.5,
      );
      const angle = Math.random() * Math.PI * 2;
      const velocity =
        ((big ? 9 : 4) + Math.random() * (big ? 23 : 8)) * energy;
      const lateral = Math.sin(angle) * velocity + side * (big ? 7 : 3);
      const forward = Math.cos(angle) * velocity + speed * (big ? 0.3 : 0.13);
      spark.velocity.set(
        rx * lateral + fx * forward,
        (big ? 4 : 2) + Math.random() * (big ? 13 : 6),
        rz * lateral + fz * forward,
      );
      spark.duration = spark.life =
        (big ? 0.48 : 0.22) + Math.random() * (big ? 0.9 : 0.38);
      spark.trail = (big ? 0.055 : 0.032) + Math.random() * 0.065;
      spark.floor = p.y + 0.07;
    }
    if (big)
      for (let n = 0; n < 21; n++) {
        const part = this.debris[this.debrisCursor++ % this.maxDebris];
        part.position.set(
          p.x + (Math.random() - 0.5) * 1.4,
          p.y + 0.75 + Math.random() * 0.45,
          p.z + (Math.random() - 0.5),
        );
        const lateral =
          side * (3 + Math.random() * 10) + (Math.random() - 0.5) * 12;
        const forward = speed * 0.42 + (Math.random() - 0.5) * 19;
        part.velocity.set(
          rx * lateral + fx * forward,
          4 + Math.random() * 10,
          rz * lateral + fz * forward,
        );
        part.rotation.set(
          Math.random() * 6,
          Math.random() * 6,
          Math.random() * 6,
        );
        part.spin.set(
          Math.random() * 16 - 8,
          Math.random() * 12 - 6,
          Math.random() * 18 - 9,
        );
        const size =
          n < 5 ? 0.48 + Math.random() * 0.34 : 0.22 + Math.random() * 0.45;
        part.scale.set(size, size, size * (0.7 + Math.random() * 0.8));
        part.life = 2.1 + Math.random() * 1.15;
        part.floor = p.y + 0.11;
      }
    const flash = this.flashes[this.flashCursor++ % this.maxFlashes];
    flash.position.set(p.x + rx * side * 0.4, p.y + 0.6, p.z + rz * side * 0.4);
    flash.duration = flash.life = big ? 0.38 : 0.18;
    flash.energy = big ? energy : 0.34;
  }

  update(dt: number) {
    const sparkDrag = Math.exp(-1.2 * dt),
      debrisDrag = Math.exp(-0.37 * dt);
    this.sparks.forEach((spark, i) => {
      const offset = i * 6;
      if (spark.life <= 0) {
        this.vertices.fill(-10000, offset, offset + 6);
        return;
      }
      spark.life -= dt;
      spark.velocity.multiplyScalar(sparkDrag);
      spark.velocity.y -= 24 * dt;
      spark.position.addScaledVector(spark.velocity, dt);
      if (spark.position.y < spark.floor) {
        spark.position.y = spark.floor;
        spark.velocity.y = Math.abs(spark.velocity.y) * 0.35;
        spark.velocity.x *= 0.82;
        spark.velocity.z *= 0.82;
      }
      const fade = Math.max(0, spark.life / spark.duration),
        trail = spark.trail * (0.45 + fade * 0.55);
      this.vertices[offset] = spark.position.x;
      this.vertices[offset + 1] = spark.position.y;
      this.vertices[offset + 2] = spark.position.z;
      this.vertices[offset + 3] = spark.position.x - spark.velocity.x * trail;
      this.vertices[offset + 4] = Math.max(
        spark.floor,
        spark.position.y - spark.velocity.y * trail,
      );
      this.vertices[offset + 5] = spark.position.z - spark.velocity.z * trail;
      const glow = Math.min(1, fade * 3);
      this.colors[offset] = glow;
      this.colors[offset + 1] = glow * (0.42 + fade * 0.53);
      this.colors[offset + 2] = glow * fade * 0.54;
      this.colors[offset + 3] = glow * 0.3;
      this.colors[offset + 4] = glow * 0.1;
      this.colors[offset + 5] = 0.01 * glow;
    });
    this.sparkGeometry.attributes.position.needsUpdate = true;
    this.sparkGeometry.attributes.color.needsUpdate = true;

    this.debris.forEach((part, i) => {
      if (part.life > 0) {
        part.life -= dt;
        part.velocity.multiplyScalar(debrisDrag);
        part.velocity.y -= 20 * dt;
        part.position.addScaledVector(part.velocity, dt);
        if (part.position.y < part.floor) {
          part.position.y = part.floor;
          part.velocity.y = Math.abs(part.velocity.y) * 0.24;
          part.velocity.x *= 0.66;
          part.velocity.z *= 0.66;
          part.spin.multiplyScalar(0.7);
        }
        part.rotation.x += part.spin.x * dt;
        part.rotation.y += part.spin.y * dt;
        part.rotation.z += part.spin.z * dt;
        this.dummy.position.copy(part.position);
        this.dummy.rotation.copy(part.rotation);
        this.dummy.scale
          .copy(part.scale)
          .multiplyScalar(Math.min(1, Math.max(0, part.life * 2.5)));
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.fragments.setMatrixAt(i, this.dummy.matrix);
    });
    this.fragments.instanceMatrix.needsUpdate = true;

    this.flashes.forEach((flash, i) => {
      flash.life = Math.max(0, flash.life - dt);
      const progress = 1 - flash.life / flash.duration;
      this.dummy.position.copy(flash.position);
      this.dummy.rotation.set(0, 0, 0);
      const core = Math.max(0, 1 - progress * 2.65);
      this.dummy.scale.setScalar(
        flash.life > 0 ? (0.5 + progress * 2.6) * flash.energy : 0,
      );
      this.dummy.updateMatrix();
      this.contactFlashes.setMatrixAt(i, this.dummy.matrix);
      this.contactFlashes.setColorAt(i, this.color.setScalar(core * core));
      this.dummy.position.y = flash.position.y - 0.51;
      this.dummy.rotation.x = -Math.PI / 2;
      this.dummy.scale.setScalar(
        flash.life > 0 ? (0.6 + progress * 5.8) * flash.energy : 0,
      );
      this.dummy.updateMatrix();
      this.halos.setMatrixAt(i, this.dummy.matrix);
      this.halos.setColorAt(
        i,
        this.color.setScalar(Math.pow(1 - progress, 2) * 0.72),
      );
    });
    for (const pool of [this.contactFlashes, this.halos]) {
      pool.instanceMatrix.needsUpdate = true;
      if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.sparks.forEach((s) => (s.life = 0));
    this.debris.forEach((d) => (d.life = 0));
    this.flashes.forEach((f) => (f.life = 0));
    this.sparkCursor = this.debrisCursor = this.flashCursor = 0;
    this.update(0);
  }
}
