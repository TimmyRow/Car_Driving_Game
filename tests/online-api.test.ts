import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { localDatabase } from "../server/local-db";
import { onlineApi } from "../server/online-api";
import { readRoom } from "../server/store";
import { createSimulation, type OnlineSnapshot } from "../src/simulation";
import type { OnlineSession } from "../src/online-protocol";

let snapshot: OnlineSnapshot;
before(async () => {
  const sim = await createSimulation();
  sim.resetOnline(
    [
      { name: "HOST", color: "#fa633b" },
      { name: "GUEST", color: "#69cced" },
    ],
    1,
  );
  sim.start();
  const controls = { steer: 0, throttle: true, brake: false, nitro: false };
  for (let frame = 0; frame < 4 * 60; frame++)
    sim.stepOnline(1 / 60, [controls, controls]);
  snapshot = sim.getOnlineSnapshot();
  sim.dispose();
});

const profile = { name: "HOST", color: "#fa633b", version: 1 };
const controls = { steer: 0.4, throttle: true, brake: false, nitro: false };
const clone = <T>(value: T): T => structuredClone(value);

function fixture(t: TestContext) {
  const database = localDatabase(":memory:");
  t.after(() => database.close());
  let now = 1_800_000_000_000;
  async function request(
    path: string,
    body: unknown = {},
    token?: string,
    options: {
      raw?: string;
      headers?: Record<string, string>;
      method?: string;
    } = {},
  ) {
    const method = options.method ?? "POST";
    const req = new Request(`https://race.test${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      ...(method === "GET" || method === "OPTIONS"
        ? {}
        : { body: options.raw ?? JSON.stringify(body) }),
    });
    const response = await onlineApi(req, database.db, now);
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data, response };
  }
  async function create(overrides = {}) {
    const result = await request("/api/online/rooms", {
      ...profile,
      trackId: "riviera",
      laps: 1,
      ...overrides,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data as OnlineSession;
  }
  const join = (host: OnlineSession, overrides = {}) =>
    request(`/api/online/rooms/${host.room.code}/join`, {
      ...profile,
      name: "GUEST",
      color: "#69cced",
      ...overrides,
    });
  const sync = (session: OnlineSession, body: unknown = {}) =>
    request(`/api/online/rooms/${session.room.code}/sync`, body, session.token);
  async function pair() {
    const host = await create();
    const joined = await join(host);
    assert.equal(joined.status, 200);
    return { host, guest: joined.data as OnlineSession };
  }
  async function start(host: OnlineSession, guest: OnlineSession) {
    assert.equal((await sync(guest, { ready: true })).status, 200);
    const result = await sync(host, { action: "start" });
    assert.equal(result.status, 200);
    assert.equal(result.data.room.phase, "racing");
    return result.data.room.round as number;
  }
  return {
    ...database,
    request,
    create,
    join,
    sync,
    pair,
    start,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

test("rooms use the generated migration, validate profiles/version and store only hashed participant tokens", async (t) => {
  const f = fixture(t);
  assert.ok(f.sqlite.prepare("SELECT name FROM local_migrations").get());
  const host = await f.create({
    name: "  Zoë   Racer  ",
    trackId: "canyon",
    laps: 2,
  });
  assert.equal(host.role, "host");
  assert.match(host.room.code, /^[A-Z2-9]{6}$/);
  assert.match(host.token, /^[a-f0-9]{64}$/);
  assert.equal(host.room.host.name, "Zoë Racer");
  assert.equal(host.room.trackId, "canyon");
  assert.equal(host.room.laps, 2);
  assert.equal(host.room.guest, null);
  assert.equal(host.room.round, 0);
  const row = await readRoom(f.db, host.room.code);
  assert.equal(
    row?.host_token,
    createHash("sha256").update(host.token).digest("hex"),
  );
  assert.notEqual(row?.host_token, host.token);
  assert.equal(JSON.stringify(host.room).includes("token"), false);
  for (const fields of [
    { name: "x" },
    { name: "X".repeat(19) },
    { name: "<script>" },
    { color: "red" },
    { color: "#12345g" },
    { trackId: "unknown" },
    { laps: 3 },
  ]) {
    const invalid = await f.request("/api/online/rooms", {
      ...profile,
      trackId: "riviera",
      laps: 1,
      ...fields,
    });
    assert.equal(invalid.status, 400, JSON.stringify(fields));
  }
  assert.equal(
    (
      await f.request("/api/online/rooms", {
        ...profile,
        trackId: "riviera",
        laps: 1,
        version: 2,
      })
    ).status,
    409,
  );
  assert.equal((await f.join(host, { version: 2 })).status, 409);
  assert.equal((await f.join(host, { name: "<bad>" })).status, 400);
  const joined = await f.join(host, { name: "蒼 Racer" });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.room.guest.name, "蒼 Racer");
  assert.equal(JSON.stringify(joined.data.room).includes(host.token), false);
  assert.equal(joined.data.role, "guest");
});

test("concurrent joins admit exactly one guest and cannot replace the winner", async (t) => {
  const f = fixture(t),
    host = await f.create();
  const attempts = await Promise.all([
    f.join(host, { name: "ALPHA" }),
    f.join(host, { name: "BRAVO" }),
  ]);
  assert.deepEqual(attempts.map((value) => value.status).sort(), [200, 409]);
  const winner = attempts.find((value) => value.status === 200)!
    .data as OnlineSession;
  const row = await readRoom(f.db, host.room.code);
  assert.equal(
    row?.guest_token,
    createHash("sha256").update(winner.token).digest("hex"),
  );
  assert.equal(row?.guest_name, winner.room.guest?.name);
  assert.equal((await f.join(host, { name: "THIRD" })).status, 409);
  assert.equal((await f.sync(winner)).status, 200);
});

test("bearer authorization and roles isolate control, signaling, inputs and secrets", async (t) => {
  const f = fixture(t),
    { host, guest } = await f.pair();
  const path = `/api/online/rooms/${host.room.code}/sync`;
  assert.equal((await f.request(path)).status, 401);
  assert.equal((await f.request(path, {}, "wrong")).status, 401);
  assert.equal((await f.request(path, {}, "a".repeat(64))).status, 403);
  for (const action of ["start", "reset", "finish"])
    assert.equal((await f.sync(guest, { action })).status, 403);
  for (const payload of [
    { snapshot: { round: 0, seq: 0, state: snapshot } },
    { offer: { type: "offer", sdp: "offer" } },
  ])
    assert.equal((await f.sync(guest, payload)).status, 403);
  for (const payload of [
    { input: { round: 0, seq: 0, controls } },
    { ready: true },
    { answer: { type: "answer", sdp: "answer" } },
  ])
    assert.equal((await f.sync(host, payload)).status, 403);
  assert.equal((await f.sync(host, { action: "delete" })).status, 400);
  const offer = { type: "offer", sdp: "v=0\r\na=offer" };
  const answer = { type: "answer", sdp: "v=0\r\na=answer" };
  assert.equal((await f.sync(host, { offer })).data.offer, null);
  assert.deepEqual((await f.sync(guest, { answer })).data.offer, offer);
  const hostReply = await f.sync(host);
  assert.deepEqual(hostReply.data.answer, answer);
  assert.equal(hostReply.data.snapshot, null);
  const guestReply = await f.sync(guest);
  assert.equal(guestReply.data.answer, null);
  assert.equal(guestReply.data.input, null);
  for (const reply of [hostReply, guestReply]) {
    const serialized = JSON.stringify(reply.data);
    assert.equal(serialized.includes(host.token), false);
    assert.equal(serialized.includes(guest.token), false);
    assert.equal(serialized.includes("host_token"), false);
    assert.equal(reply.response.headers.get("cache-control"), "no-store");
  }
});

test("ready/start, sequenced frames and new rounds ignore replays and stale race packets", async (t) => {
  const f = fixture(t),
    { host, guest } = await f.pair();
  assert.equal((await f.sync(host, { action: "start" })).status, 409);
  assert.equal((await f.sync(host, { action: "reset" })).status, 409);
  assert.equal((await f.sync(host, { action: "finish" })).status, 409);
  const round = await f.start(host, guest);
  assert.equal(round, 1);
  assert.equal((await f.sync(guest, { ready: true })).status, 409);
  const sentInput = { round, seq: 5, controls };
  const sentState = { round, seq: 8, state: clone(snapshot) };
  assert.equal((await f.sync(guest, { input: sentInput })).status, 200);
  assert.equal((await f.sync(host, { snapshot: sentState })).status, 200);
  await f.sync(guest, {
    input: { ...sentInput, controls: { ...controls, steer: -1 } },
  });
  await f.sync(guest, { input: { ...sentInput, seq: 4 } });
  await f.sync(host, {
    snapshot: { ...sentState, state: { ...snapshot, elapsed: 100 } },
  });
  await f.sync(host, { snapshot: { ...sentState, seq: 7 } });
  assert.deepEqual((await f.sync(host)).data.input, sentInput);
  assert.deepEqual((await f.sync(guest)).data.snapshot, sentState);
  assert.equal(
    (
      await f.sync(guest, {
        input: { round: round - 1, seq: 999, controls: null },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.sync(host, {
        snapshot: { round: round + 1, seq: 999, state: null },
      })
    ).status,
    200,
  );
  assert.deepEqual((await f.sync(host)).data.input, sentInput);
  assert.deepEqual((await f.sync(guest)).data.snapshot, sentState);
  assert.equal(
    (await f.sync(host, { action: "finish" })).data.room.phase,
    "finished",
  );
  const finalState = {
    ...sentState,
    seq: 9,
    state: { ...snapshot, phase: "finished", raceComplete: true },
  };
  assert.equal((await f.sync(host, { snapshot: finalState })).status, 200);
  assert.deepEqual((await f.sync(guest)).data.snapshot, finalState);
  const reset = await f.sync(host, { action: "reset" });
  assert.equal(reset.data.room.phase, "waiting");
  assert.equal(reset.data.room.guestReady, false);
  assert.equal(reset.data.input, null);
  assert.equal((await f.sync(guest)).data.snapshot, null);
  assert.equal((await f.sync(host, { action: "start" })).status, 409);
  const nextRound = await f.start(host, guest);
  assert.equal(nextRound, round + 1);
  await f.sync(guest, { input: { ...sentInput, seq: 999 } });
  await f.sync(host, { snapshot: { ...sentState, seq: 999 } });
  assert.equal((await f.sync(host)).data.input, null);
  assert.equal((await f.sync(guest)).data.snapshot, null);
  const nextInput = { round: nextRound, seq: 0, controls };
  await f.sync(guest, { input: nextInput });
  assert.deepEqual((await f.sync(host)).data.input, nextInput);
});

test("leave, heartbeat disconnect boundaries and expiry close rooms without leaking participant data", async (t) => {
  const f = fixture(t);
  for (const leaver of ["host", "guest"] as const) {
    const pair = await f.pair();
    const reply = await f.sync(pair[leaver], { action: "leave" });
    assert.equal(reply.data.room.phase, "closed");
    assert.match(reply.data.room.closedReason, /left/);
    assert.equal(
      (await f.sync(pair[leaver === "host" ? "guest" : "host"])).data.room
        .phase,
      "closed",
    );
    assert.equal((await f.join(pair.host)).status, 409);
  }
  const pair = await f.pair();
  f.advance(15_000);
  assert.equal(
    (await f.sync(pair.host)).data.room.phase,
    "waiting",
    "exactly 15 seconds is within disconnect grace",
  );
  f.advance(1);
  assert.equal((await f.sync(pair.host)).data.room.phase, "closed");
  const orphan = await f.create();
  f.advance(15_001);
  assert.equal(
    (await f.join(orphan)).status,
    409,
    "a stale waiting host cannot admit a guest",
  );
  const expiring = await f.create();
  f.advance(2 * 60 * 60 * 1000);
  assert.equal((await f.sync(expiring)).status, 404);
  assert.equal((await f.join(expiring)).status, 404);
  f.advance(1);
  await f.create();
  assert.equal(
    await readRoom(f.db, expiring.room.code),
    null,
    "new room creation prunes expired records",
  );
  assert.equal(
    (await f.request("/api/online/rooms/ABC123/sync", {}, "a".repeat(64)))
      .status,
    404,
  );
});

test("malformed JSON, method, body size, driving input and SDP are rejected without mutating room state", async (t) => {
  const f = fixture(t),
    { host, guest } = await f.pair();
  const createPath = "/api/online/rooms";
  assert.equal(
    (await f.request(createPath, {}, undefined, { method: "OPTIONS" })).status,
    204,
  );
  assert.equal(
    (await f.request(createPath, {}, undefined, { method: "GET" })).status,
    405,
  );
  assert.equal(
    (
      await f.request(createPath, {}, undefined, {
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  for (const raw of ["{", "null", "[]", '"text"'])
    assert.equal(
      (await f.request(createPath, {}, undefined, { raw })).status,
      400,
    );
  assert.equal(
    (
      await f.request(createPath, {}, undefined, {
        headers: { "Content-Length": "48001" },
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.request(createPath, {}, undefined, {
        raw: JSON.stringify({ padding: "x".repeat(48_001) }),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.request(createPath, {}, undefined, {
        raw: JSON.stringify({ padding: "é".repeat(24_001) }),
      })
    ).status,
    413,
    "size limit counts encoded bytes",
  );
  for (const offer of [
    { type: "answer", sdp: "x" },
    { type: "offer", sdp: "x".repeat(16_001) },
    { type: "offer", sdp: null },
  ])
    assert.equal((await f.sync(host, { offer })).status, 400);
  const round = await f.start(host, guest);
  for (const invalidControls of [
    { ...controls, steer: 1.1 },
    { ...controls, steer: null },
    { ...controls, throttle: 1 },
    { ...controls, brake: "false" },
  ])
    assert.equal(
      (
        await f.sync(guest, {
          input: { round, seq: 1, controls: invalidControls },
        })
      ).status,
      400,
    );
  for (const seq of [-1, 0.5, 10_000_000])
    assert.equal(
      (await f.sync(guest, { input: { round, seq, controls } })).status,
      409,
    );
  assert.equal((await f.sync(host)).data.input, null);
});

test("malformed snapshot driver records and required scalars are rejected before reaching the guest", async (t) => {
  const f = fixture(t),
    { host, guest } = await f.pair();
  const round = await f.start(host, guest);
  const invalidStates = [
    { ...snapshot, drivers: [null, null] },
    { ...snapshot, countdown: null },
    { ...snapshot, totalLaps: -1 },
    {
      ...snapshot,
      vehicles: snapshot.vehicles.map((car) => ({ ...car, id: 7 })),
    },
    {
      ...snapshot,
      vehicles: snapshot.vehicles.map((car) => ({ ...car, crashTravel: null })),
    },
  ];
  for (const [index, state] of invalidStates.entries()) {
    const reply = await f.sync(host, {
      snapshot: { round, seq: index + 1, state },
    });
    assert.equal(
      reply.status,
      400,
      `malformed state ${index} must not be relayed to the renderer`,
    );
  }
  assert.equal((await f.sync(guest)).data.snapshot, null);
});
