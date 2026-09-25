import type { RoomState, SyncPayload } from "../src/online-protocol";
import { validOnlineSnapshot } from "../src/online-validation";
import { readRoom, type Database, type RoomRow } from "./store";

const MAX_BODY = 48_000;
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
function publicRoom(row: RoomRow): RoomState {
  return {
    code: row.code,
    version: 1,
    round: row.round,
    trackId: row.track_id,
    laps: row.laps,
    phase: row.phase,
    host: { name: row.host_name, color: row.host_color },
    guest: row.guest_token
      ? { name: row.guest_name!, color: row.guest_color! }
      : null,
    guestReady: !!row.guest_ready,
    hostSeenAt: row.host_seen_at,
    guestSeenAt: row.guest_seen_at,
    expiresAt: row.expires_at,
    closedReason: row.closed_reason,
  };
}
async function hash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
function code() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (n) => letters[n % letters.length],
  ).join("");
}
function driver(body: Record<string, unknown>) {
  const name =
    typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  assert(
    /^[\p{L}\p{N} _.-]{2,18}$/u.test(name),
    400,
    "Use a driver name with 2–18 letters, numbers or spaces.",
  );
  assert(
    typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color),
    400,
    "Choose a valid car paint.",
  );
  assert(
    body.version === 1,
    409,
    "Refresh the game to use the latest online version.",
  );
  return { name, color: body.color as string };
}
function sdp(value: unknown, type: "offer" | "answer") {
  assert(
    value && typeof value === "object",
    400,
    "Invalid connection details.",
  );
  const v = value as Record<string, unknown>;
  assert(
    v.type === type && typeof v.sdp === "string" && v.sdp.length <= 16_000,
    400,
    "Invalid connection details.",
  );
  return JSON.stringify({ type, sdp: v.sdp });
}
function frame(value: unknown, round: number, input: boolean) {
  assert(value && typeof value === "object", 400, "Invalid race update.");
  const v = value as Record<string, any>;
  assert(
    v.round === round &&
      Number.isSafeInteger(v.seq) &&
      v.seq >= 0 &&
      v.seq < 10_000_000,
    409,
    "This race has changed. Return to the room.",
  );
  if (input) {
    const c = v.controls;
    assert(
      c &&
        Number.isFinite(c.steer) &&
        Math.abs(c.steer) <= 1 &&
        [c.throttle, c.brake, c.nitro].every((x) => typeof x === "boolean"),
      400,
      "Invalid driving input.",
    );
    return JSON.stringify({
      round,
      seq: v.seq,
      controls: {
        steer: c.steer,
        throttle: c.throttle,
        brake: c.brake,
        nitro: c.nitro,
      },
    });
  }
  assert(validOnlineSnapshot(v.state), 400, "Invalid race state.");
  return JSON.stringify(v);
}
export async function onlineApi(
  request: Request,
  db: Database,
  now = Date.now(),
): Promise<Response> {
  try {
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    assert(
      request.method === "POST",
      405,
      "Use a supported online race action.",
    );
    assert(
      (request.headers.get("content-type") ?? "").includes("application/json"),
      415,
      "Send an online race request.",
    );
    assert(
      Number(request.headers.get("content-length") ?? 0) <= MAX_BODY,
      413,
      "Race update is too large.",
    );
    const reader = request.body?.getReader();
    let raw = "",
      size = 0;
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BODY) {
          await reader.cancel();
          throw new ApiError(413, "Race update is too large.");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "Invalid online race request.");
    }
    assert(
      body && typeof body === "object" && !Array.isArray(body),
      400,
      "Invalid online race request.",
    );
    const path = new URL(request.url).pathname;
    if (path === "/api/online/rooms") {
      const player = driver(body);
      assert(
        ["riviera", "canyon", "alpine"].includes(body.trackId) &&
          [1, 2].includes(body.laps),
        400,
        "Choose a route and lap count.",
      );
      await db
        .prepare(
          "DELETE FROM race_rooms WHERE code IN (SELECT code FROM race_rooms WHERE expires_at < ? LIMIT 100)",
        )
        .bind(now)
        .run();
      const secret = token(),
        digest = await hash(secret);
      for (let attempt = 0; attempt < 4; attempt++) {
        const roomCode = code();
        await db
          .prepare(
            "INSERT OR IGNORE INTO race_rooms (code,host_token,track_id,laps,host_name,host_color,host_seen_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            roomCode,
            digest,
            body.trackId,
            body.laps,
            player.name,
            player.color,
            now,
            now + 2 * 60 * 60 * 1000,
          )
          .run();
        const row = await readRoom(db, roomCode);
        if (row?.host_token === digest)
          return json(
            { token: secret, role: "host", room: publicRoom(row) },
            201,
          );
      }
      throw new ApiError(503, "Could not create a room. Please try again.");
    }
    const match = /^\/api\/online\/rooms\/([A-Z2-9]{6})\/(join|sync)$/.exec(
      path,
    );
    assert(match, 404, "Room not found. Check the six-character code.");
    const [, roomCode, operation] = match;
    let room = await readRoom(db, roomCode);
    assert(
      room && room.expires_at > now,
      404,
      "That room has expired or does not exist.",
    );
    if (operation === "join") {
      const player = driver(body),
        secret = token(),
        digest = await hash(secret);
      assert(
        room.phase === "waiting" && now - room.host_seen_at < 15_000,
        409,
        "That room is no longer waiting for a driver.",
      );
      assert(
        !room.guest_token,
        409,
        "That room is full. Ask your friend for a new code.",
      );
      await db
        .prepare(
          "UPDATE race_rooms SET guest_token=?,guest_name=?,guest_color=?,guest_seen_at=? WHERE code=? AND guest_token IS NULL AND phase='waiting' AND host_seen_at>?",
        )
        .bind(digest, player.name, player.color, now, roomCode, now - 15_000)
        .run();
      room = (await readRoom(db, roomCode))!;
      assert(
        room.guest_token === digest,
        409,
        "Another driver joined first. Ask your friend for a new code.",
      );
      return json({ token: secret, role: "guest", room: publicRoom(room) });
    }
    const secret = (request.headers.get("authorization") ?? "").replace(
      /^Bearer /,
      "",
    );
    assert(/^[a-f0-9]{64}$/.test(secret), 401, "Rejoin the room to continue.");
    const digest = await hash(secret),
      host = digest === room.host_token;
    assert(
      host || digest === room.guest_token,
      403,
      "This driver does not belong to that room.",
    );
    const payload = body as SyncPayload;
    assert(
      !payload.action ||
        ["start", "reset", "finish", "leave"].includes(payload.action),
      400,
      "Unknown room action.",
    );
    assert(
      host ||
        !(
          payload.snapshot ||
          payload.offer ||
          ["start", "reset", "finish"].includes(payload.action ?? "")
        ),
      403,
      "Only the host can control the shared race.",
    );
    assert(
      !host ||
        !(payload.input || payload.answer || payload.ready !== undefined),
      403,
      "This update belongs to the joining driver.",
    );
    if (room.phase !== "closed") {
      const otherSeen = host ? room.guest_seen_at : room.host_seen_at;
      if (otherSeen !== null && now - otherSeen > 15_000) {
        await db
          .prepare(
            "UPDATE race_rooms SET phase='closed',closed_reason=? WHERE code=?",
          )
          .bind(
            "The other driver disconnected. Create or join a new room.",
            roomCode,
          )
          .run();
        room = (await readRoom(db, roomCode))!;
      }
    }
    if (room.phase !== "closed") {
      const updates = [
        db
          .prepare(
            host
              ? "UPDATE race_rooms SET host_seen_at=? WHERE code=?"
              : "UPDATE race_rooms SET guest_seen_at=? WHERE code=?",
          )
          .bind(now, roomCode),
      ];
      if (payload.offer)
        updates.push(
          db
            .prepare("UPDATE race_rooms SET offer=? WHERE code=?")
            .bind(sdp(payload.offer, "offer"), roomCode),
        );
      if (payload.answer)
        updates.push(
          db
            .prepare("UPDATE race_rooms SET answer=? WHERE code=?")
            .bind(sdp(payload.answer, "answer"), roomCode),
        );
      if (payload.ready !== undefined) {
        assert(
          typeof payload.ready === "boolean" && room.phase === "waiting",
          409,
          "Wait for the next race to get ready.",
        );
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET guest_ready=? WHERE code=? AND phase='waiting'",
            )
            .bind(Number(payload.ready), roomCode),
        );
      }
      if (
        payload.snapshot &&
        ["racing", "finished"].includes(room.phase) &&
        payload.snapshot.round === room.round
      )
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET snapshot=?,snapshot_seq=? WHERE code=? AND round=? AND snapshot_seq<? AND phase IN ('racing','finished')",
            )
            .bind(
              frame(payload.snapshot, room.round, false),
              payload.snapshot.seq,
              roomCode,
              room.round,
              payload.snapshot.seq,
            ),
        );
      if (
        payload.input &&
        room.phase === "racing" &&
        payload.input.round === room.round
      )
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET input=?,input_seq=? WHERE code=? AND round=? AND input_seq<? AND phase='racing'",
            )
            .bind(
              frame(payload.input, room.round, true),
              payload.input.seq,
              roomCode,
              room.round,
              payload.input.seq,
            ),
        );
      if (payload.action === "start") {
        assert(
          room.phase === "waiting" &&
            room.guest_token &&
            room.guest_ready &&
            now - (room.guest_seen_at ?? 0) < 15_000,
          409,
          "Wait until your friend is ready.",
        );
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET phase='racing',round=round+1,snapshot=NULL,input=NULL,snapshot_seq=-1,input_seq=-1 WHERE code=? AND phase='waiting' AND guest_ready=1",
            )
            .bind(roomCode),
        );
      }
      if (payload.action === "reset") {
        assert(
          room.phase === "finished",
          409,
          "Finish the current race first.",
        );
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET phase='waiting',guest_ready=0,snapshot=NULL,input=NULL,snapshot_seq=-1,input_seq=-1 WHERE code=? AND phase='finished'",
            )
            .bind(roomCode),
        );
      }
      if (payload.action === "finish") {
        assert(
          room.phase === "racing" || room.phase === "finished",
          409,
          "The race has not started.",
        );
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET phase='finished' WHERE code=? AND phase='racing'",
            )
            .bind(roomCode),
        );
      }
      if (payload.action === "leave")
        updates.push(
          db
            .prepare(
              "UPDATE race_rooms SET phase='closed',closed_reason=? WHERE code=?",
            )
            .bind(
              host
                ? "The host left the room."
                : "The other driver left the room.",
              roomCode,
            ),
        );
      await db.batch(updates);
      room = (await readRoom(db, roomCode))!;
    }
    return json({
      room: publicRoom(room),
      snapshot: !host && room.snapshot ? JSON.parse(room.snapshot) : null,
      input: host && room.input ? JSON.parse(room.input) : null,
      offer: !host && room.offer ? JSON.parse(room.offer) : null,
      answer: host && room.answer ? JSON.parse(room.answer) : null,
      serverTime: now,
    });
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message }, error.status);
    console.error(
      "Online room request failed",
      error instanceof Error ? error.message : "Unknown storage error",
    );
    return json(
      {
        error:
          "Online racing is temporarily unavailable. Solo modes still work; please try again.",
      },
      503,
    );
  }
}
