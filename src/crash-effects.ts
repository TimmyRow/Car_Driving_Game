import * as THREE from "three";
import { sampleTrack } from "./track";
import type { CollisionEvent } from "./simulation";

/** Fixed pools keep repeated takedowns from accumulating objects or GPU buffers. */
export class CrashEffects {
  private readonly maxSparks = 180;
  private readonly maxDebris = 36;
  private sparkCursor = 0;
  private debrisCursor = 0;
  private sparks = Array.from({ length: this.maxSparks }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    life: 0,
    floor: 0,
  }));
  private debris = Array.from({ length: this.maxDebris }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    spin: new THREE.Vector3(),
    life: 0,
    floor: 0,
  }));
  private readonly vertices = new Float32Array(this.maxSparks * 6).fill(-10000);
  private readonly sparkGeometry = new THREE.BufferGeometry();
  private readonly fragments: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.sparkGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.vertices, 3),
    );
    const streaks = new THREE.LineSegments(
      this.sparkGeometry,
      new THREE.LineBasicMaterial({
        color: "#ffcc73",
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    streaks.frustumCulled = false;
    scene.add(streaks);
    this.fragments = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.055, 0.25),
      new THREE.MeshStandardMaterial({
        color: "#323e42",
        metalness: 0.6,
        roughness: 0.35,
      }),
      this.maxDebris,
    );
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragments.frustumCulled = false;
    this.fragments.castShadow = false;
    scene.add(this.fragments);
    this.clear();
  }

  burst(event: CollisionEvent) {
    const p = sampleTrack(event.distance, event.offset);
    const big = event.kind !== "hit";
    const count = big ? 48 : 15;
    for (let n = 0; n < count; n++) {
      const spark = this.sparks[this.sparkCursor++ % this.maxSparks];
      spark.position.set(p.x, p.y + 0.55, p.z);
      const angle = Math.random() * Math.PI * 2;
      const velocity = (big ? 6 : 3) + Math.random() * (big ? 14 : 6);
      spark.velocity.set(
        Math.sin(angle) * velocity,
        2 + Math.random() * 7,
        Math.cos(angle) * velocity,
      );
      spark.life = 0.25 + Math.random() * 0.65;
      spark.floor = p.y + 0.06;
    }
    if (big)
      for (let n = 0; n < 12; n++) {
        const part = this.debris[this.debrisCursor++ % this.maxDebris];
        part.position.set(
          p.x + (Math.random() - 0.5),
          p.y + 0.9,
          p.z + (Math.random() - 0.5),
        );
        part.velocity.set(
          (Math.random() - 0.5) * 11,
          3 + Math.random() * 7,
          (Math.random() - 0.5) * 11,
        );
        part.rotation.set(
          Math.random() * 6,
          Math.random() * 6,
          Math.random() * 6,
        );
        part.spin.set(
          Math.random() * 10 - 5,
          Math.random() * 10 - 5,
          Math.random() * 10 - 5,
        );
        part.life = 1.4 + Math.random() * 0.6;
        part.floor = p.y + 0.06;
      }
  }

  update(dt: number) {
    this.sparks.forEach((spark, i) => {
      const offset = i * 6;
      if (spark.life <= 0) {
        this.vertices.fill(-10000, offset, offset + 6);
        return;
      }
      spark.life -= dt;
      spark.velocity.y -= 19 * dt;
      spark.position.addScaledVector(spark.velocity, dt);
      if (spark.position.y < spark.floor) {
        spark.position.y = spark.floor;
        spark.velocity.y *= -0.27;
      }
      this.vertices.set(
        [
          spark.position.x,
          spark.position.y,
          spark.position.z,
          spark.position.x - spark.velocity.x * 0.035,
          spark.position.y - spark.velocity.y * 0.035,
          spark.position.z - spark.velocity.z * 0.035,
        ],
        offset,
      );
    });
    this.sparkGeometry.attributes.position.needsUpdate = true;
    this.debris.forEach((part, i) => {
      if (part.life > 0) {
        part.life -= dt;
        part.velocity.y -= 19 * dt;
        part.position.addScaledVector(part.velocity, dt);
        if (part.position.y < part.floor) {
          part.position.y = part.floor;
          part.velocity.y *= -0.3;
          part.velocity.x *= 0.7;
          part.velocity.z *= 0.7;
        }
        part.rotation.x += part.spin.x * dt;
        part.rotation.y += part.spin.y * dt;
        part.rotation.z += part.spin.z * dt;
        this.dummy.position.copy(part.position);
        this.dummy.rotation.copy(part.rotation);
        this.dummy.scale.setScalar(Math.min(1, Math.max(0, part.life * 3)));
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.fragments.setMatrixAt(i, this.dummy.matrix);
    });
    this.fragments.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.sparks.forEach((s) => (s.life = 0));
    this.debris.forEach((d) => (d.life = 0));
    this.sparkCursor = this.debrisCursor = 0;
    this.update(0);
  }
}
