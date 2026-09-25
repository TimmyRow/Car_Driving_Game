import test from "node:test";
import assert from "node:assert/strict";
import {
  OnlineClient,
  OnlineSnapshotBuffer,
  sanitizeOnlineControls,
} from "../src/online-client";
import type { OnlineSnapshot, CollisionEvent } from "../src/simulation";
import type { RaceFrame, RoomState } from "../src/online-protocol";
import { validOnlineSnapshot } from "../src/online-validation";

function snapshot(distance = 0): OnlineSnapshot {
  const car = (id: number) => ({
    id,
    name: id ? "Guest" : "Host",
    color: "#ffffff",
    distance: distance + id * 4,
    offset: 0,
    speed: 40,
    yaw: 0,
    drifting: false,
    boosting: false,
    nitro: 0.5,
    finished: false,
    crashTimer: 0,
    crashDuration: 0,
    crashSide: 0,
    crashTravel: 0,
    invulnerable: 0,
  });
  const driver = (id: 0 | 1) => ({
    id,
    position: id + 1,
    lap: 1,
    bestLap: 0,
    lastLap: 0,
    driftScore: 0,
    impact: 0,
    takedowns: 0,
    finishTime: null,
    dnf: false,
  });
  return {
    version: 1,
    phase: "racing",
    elapsed: distance / 40,
    countdown: 0,
    totalLaps: 2,
    difficulty: "pro",
    raceComplete: false,
    finishGraceRemaining: null,
    vehicles: [car(0), car(1)],
    drivers: [driver(0), driver(1)],
    collisionEvents: [],
  };
}
const frame = (seq: number, distance = 0, round = 1): RaceFrame => ({
  round,
  seq,
  state: snapshot(distance),
});
const event = (id: number): CollisionEvent => ({
  id,
  kind: "hit",
  attackerId: 0,
  victimId: 1,
  distance: 30,
  offset: 0,
  intensity: 0.4,
  speed: 40,
  side: 1,
});
const room = (): RoomState => ({
  code: "ABC123",
  version: 1,
  round: 1,
  trackId: "riviera",
  laps: 2,
  phase: "waiting",
  host: { name: "Host", color: "#ffffff" },
  guest: { name: "Guest", color: "#eeeeee" },
  guestReady: false,
  hostSeenAt: Date.now(),
  guestSeenAt: Date.now(),
  expiresAt: Date.now() + 60000,
  closedReason: null,
});

test("snapshot interpolation is smooth, angle-aware, and cannot mutate received state", () => {
  const buffer = new OnlineSnapshotBuffer();
  buffer.reset(1);
  const a = frame(1, 0),
    b = frame(2, 4);
  a.state.vehicles[0].yaw = Math.PI - 0.1;
  b.state.vehicles[0].yaw = -Math.PI + 0.1;
  buffer.push(a, 1000);
  buffer.push(b, 1100);
  const sampled = buffer.sample(1150)!;
  assert.equal(sampled.vehicles[0].distance, 2);
  assert.ok(Math.abs(sampled.vehicles[0].yaw - Math.PI) < 0.0001);
  sampled.vehicles[0].distance = 999;
  b.state.vehicles[0].distance = 888;
  assert.equal(buffer.sample(1150)!.vehicles[0].distance, 2);
});
test("extrapolation is capped at 100ms and finished cars stay fixed", () => {
  const buffer = new OnlineSnapshotBuffer();
  buffer.reset(1);
  const state = frame(1, 20);
  state.state.vehicles[1].finished = true;
  buffer.push(state, 1000);
  const sampled = buffer.sample(9000)!;
  assert.equal(sampled.vehicles[0].distance, 24);
  assert.equal(sampled.vehicles[1].distance, 24);
  assert.equal(buffer.sample(1100)!.vehicles[0].distance, 20);
});
test("late sequences and wrong rounds are ignored; reset discards previous race events", () => {
  const buffer = new OnlineSnapshotBuffer();
  buffer.reset(1);
  assert.equal(buffer.push(frame(5, 20), 1000), true);
  assert.equal(buffer.push(frame(4, 500), 1100), false);
  assert.equal(buffer.push(frame(6, 500, 2), 1100), false);
  assert.equal(buffer.latest()!.vehicles[0].distance, 20);
  const withEvent = frame(6, 24);
  withEvent.state.collisionEvents = [event(7)];
  buffer.push(withEvent, 1200);
  buffer.reset(2);
  assert.equal(buffer.sample(2000), null);
  assert.equal(buffer.push(frame(900, 40, 1), 1300), false);
  assert.equal(buffer.push(frame(1, 0, 2), 1400), true);
  assert.deepEqual(buffer.latest()!.collisionEvents, []);
});
test("collision events survive rolling snapshot windows without reordering or duplication", () => {
  const buffer = new OnlineSnapshotBuffer();
  buffer.reset(1);
  const a = frame(1),
    b = frame(2),
    c = frame(3);
  a.state.collisionEvents = [event(3), event(1)];
  b.state.collisionEvents = [event(3), event(4)];
  buffer.push(a, 1000);
  buffer.push(b, 1100);
  buffer.push(c, 1200);
  assert.deepEqual(
    buffer.sample(1250)!.collisionEvents.map((e) => e.id),
    [1, 3, 4],
  );
  const sampled = buffer.sample(1250)!;
  sampled.collisionEvents[0].id = 99;
  assert.deepEqual(
    buffer.latest()!.collisionEvents.map((e) => e.id),
    [1, 3, 4],
  );
});
test("malformed state is rejected and unsafe controls are clamped", () => {
  const buffer = new OnlineSnapshotBuffer();
  buffer.reset(1);
  const broken = frame(1);
  broken.state.vehicles[0].distance = NaN;
  assert.equal(buffer.push(broken, 0), false);
  assert.deepEqual(
    sanitizeOnlineControls({
      steer: 12,
      throttle: true,
      brake: false,
      nitro: "yes",
    }),
    { steer: 1, throttle: true, brake: false, nitro: false },
  );
  assert.deepEqual(sanitizeOnlineControls(null), {
    steer: 0,
    throttle: false,
    brake: true,
    nitro: false,
  });
});
test("shared validator rejects incomplete nested stats and unsafe render values", () => {
  assert.equal(validOnlineSnapshot(snapshot()), true);
  const mutations: ((s: any) => void)[] = [
    (s) => (s.drivers = [null, null]),
    (s) => delete s.drivers[0].finishTime,
    (s) => (s.drivers[1].id = 0),
    (s) => (s.drivers[0].position = 6),
    (s) => (s.drivers[0].lap = 4),
    (s) => (s.drivers[0].dnf = "false"),
    (s) => (s.vehicles[0].boosting = 1),
    (s) => (s.vehicles[0].crashTimer = 1),
    (s) => (s.vehicles[0].crashTravel = Infinity),
    (s) => (s.vehicles[1].name = {}),
    (s) => (s.vehicles[0].color = "url(bad)"),
    (s) => (s.vehicles[1].nitro = 2),
    (s) => (s.countdown = 30),
    (s) => (s.elapsed = -1),
    (s) => (s.finishGraceRemaining = 31),
    (s) => (s.totalLaps = 0),
    (s) => (s.collisionEvents = [{ ...event(1), victimId: 0 }]),
    (s) => (s.collisionEvents = [{ ...event(1), side: NaN }]),
    (s) =>
      (s.collisionEvents = Array.from({ length: 65 }, (_, i) => event(i + 1))),
  ];
  for (const mutate of mutations) {
    const state = snapshot();
    mutate(state);
    assert.equal(validOnlineSnapshot(state), false);
  }
  const wreck = snapshot();
  Object.assign(wreck.vehicles[0], {
    crashTimer: 1.6,
    crashDuration: 1.6,
    crashTravel: 65,
    crashSide: -1,
    speed: 114,
  });
  wreck.finishGraceRemaining = 30;
  assert.equal(validOnlineSnapshot(wreck), true);
});
test("HTTP commands remain serial and stale remote input defaults to braking", async () => {
  const original = globalThis.fetch;
  let active = 0,
    maxActive = 0;
  const readies: boolean[] = [];
  const state = room();
  globalThis.fetch = async (_url, init) => {
    active++;
    maxActive = Math.max(maxActive, active);
    const payload = JSON.parse(String(init?.body));
    assert.equal(init?.credentials, "omit");
    if (typeof payload.ready === "boolean") {
      state.guestReady = payload.ready;
      readies.push(payload.ready);
    }
    await new Promise((resolve) => setTimeout(resolve, 12));
    active--;
    return new Response(
      JSON.stringify({
        room: state,
        snapshot: null,
        input: null,
        offer: null,
        answer: null,
        serverTime: Date.now(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const client = new OnlineClient({
    token: "test-only-token",
    role: "guest",
    room: state,
  });
  try {
    await Promise.all([client.setReady(true), client.setReady(false)]);
    assert.equal(maxActive, 1);
    assert.deepEqual(readies, [true, false]);
    assert.equal(client.remoteInput.brake, true);
    assert.equal(client.room.guestReady, false);
  } finally {
    client.dispose();
    globalThis.fetch = original;
  }
});
test("disposing during a pending request suppresses all late callbacks", async () => {
  const original = globalThis.fetch;
  let finish!: (response: Response) => void, started!: () => void;
  const began = new Promise<void>((resolve) => (started = resolve));
  globalThis.fetch = async () => {
    started();
    return new Promise<Response>((resolve) => (finish = resolve));
  };
  let callbacks = 0;
  const state = room();
  const client = new OnlineClient(
    { token: "test-only-token", role: "host", room: state },
    {
      onRoom: () => callbacks++,
      onError: () => callbacks++,
      onStatus: () => callbacks++,
    },
  );
  try {
    await began;
    client.dispose();
    const count = callbacks;
    finish(
      new Response(
        JSON.stringify({
          room: { ...state, phase: "closed" },
          snapshot: null,
          input: null,
          offer: null,
          answer: null,
          serverTime: Date.now(),
        }),
        { status: 200 },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(callbacks, count);
    assert.equal(client.status, "closed");
    assert.equal(client.sampleSnapshot(), null);
  } finally {
    client.dispose();
    globalThis.fetch = original;
  }
});

test("a rematch reset clears render history and ignores late frames from the waiting room", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const state = room();
  state.phase = "finished";
  globalThis.fetch = async () => {
    requests++;
    return new Response(
      JSON.stringify({
        room: { ...state, phase: requests === 1 ? "finished" : "waiting" },
        snapshot: frame(requests, 100),
        input: null,
        offer: null,
        answer: null,
        serverTime: Date.now(),
      }),
      { status: 200 },
    );
  };
  const client = new OnlineClient({
    token: "test-only-token",
    role: "guest",
    room: state,
  });
  try {
    await client.setReady(false);
    assert.notEqual(client.sampleSnapshot(), null);
    await client.setReady(true);
    assert.equal(client.room.phase, "waiting");
    assert.equal(client.sampleSnapshot(), null);
  } finally {
    client.dispose();
    globalThis.fetch = original;
  }
});

test("finish persists the last snapshot despite a live direct channel, then stale RTC falls back", async () => {
  const original = globalThis.fetch;
  let finalPayload: any;
  const state = room();
  state.phase = "racing";
  globalThis.fetch = async (_url, init) => {
    finalPayload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        room: { ...state, phase: "finished" },
        snapshot: null,
        input: null,
        offer: null,
        answer: null,
        serverTime: Date.now(),
      }),
      { status: 200 },
    );
  };
  const client = new OnlineClient({
    token: "test-only-token",
    role: "host",
    room: state,
  });
  Object.assign(client, {
    channel: {
      readyState: "open",
      bufferedAmount: 0,
      send: () => {},
      close: () => {},
    },
    peerOpenedAt: performance.now(),
    rtcStateAt: performance.now(),
  });
  try {
    client.publish(snapshot(400));
    await client.action("finish");
    assert.equal(finalPayload.action, "finish");
    assert.equal(finalPayload.snapshot.state.vehicles[0].distance, 400);
    Object.assign(client, {
      peerOpenedAt: performance.now() - 2000,
      rtcStateAt: performance.now() - 2000,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(client.status, "relay");
  } finally {
    client.dispose();
    globalThis.fetch = original;
  }
});
