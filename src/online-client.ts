import type { Controls, OnlineSnapshot, CollisionEvent } from "./simulation";
import type { TrackId } from "./track";
import { validOnlineSnapshot } from "./online-validation";
import {
  ONLINE_VERSION,
  type OnlineRole,
  type OnlineSession,
  type RoomState,
  type RoomSync,
  type SyncPayload,
  type RaceFrame,
  type InputFrame,
} from "./online-protocol";

export type OnlineStatus =
  "connecting" | "direct" | "relay" | "reconnecting" | "closed";
export interface OnlineCallbacks {
  onRoom?: (room: RoomState) => void;
  onSnapshot?: (snapshot: OnlineSnapshot) => void;
  onError?: (message: string, fatal: boolean) => void;
  onStatus?: (status: OnlineStatus) => void;
}
export interface OnlineProfile {
  name: string;
  color: string;
}
export interface CreateOnlineRoom extends OnlineProfile {
  trackId: TrackId;
  laps: 1 | 2;
}
type Action = NonNullable<SyncPayload["action"]>;
type Command = {
  payload: SyncPayload;
  resolve: () => void;
  reject: (error: Error) => void;
};
type BufferedFrame = { frame: RaceFrame; receivedAt: number };
const SAFE_INPUT: Readonly<Controls> = {
  steer: 0,
  throttle: false,
  brake: true,
  nitro: false,
};
const INTERPOLATION_DELAY = 100;
const OFFLINE_LIMIT = 12000;
const now = () => performance.now();
const clone = <T>(value: T): T => structuredClone(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const validSequence = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const apiBase = () =>
  (
    (import.meta as ImportMeta & { env?: { VITE_ONLINE_API_URL?: string } }).env
      ?.VITE_ONLINE_API_URL || "/api/online"
  ).replace(/\/+$/, "");

export function sanitizeOnlineControls(value: unknown): Controls {
  if (!value || typeof value !== "object") return { ...SAFE_INPUT };
  const input = value as Partial<Controls>;
  return {
    steer: finite(input.steer) ? Math.max(-1, Math.min(1, input.steer)) : 0,
    throttle: input.throttle === true,
    brake: input.brake === true,
    nitro: input.nitro === true,
  };
}

/** Sequenced render history. It owns its copies and retains events lost from later rolling windows. */
export class OnlineSnapshotBuffer {
  private round = 0;
  private sequence = -1;
  private frames: BufferedFrame[] = [];
  private events = new Map<number, CollisionEvent>();
  reset(round: number) {
    this.round = round;
    this.sequence = -1;
    this.frames = [];
    this.events.clear();
  }
  push(frame: RaceFrame, receivedAt = now()): boolean {
    if (
      !frame ||
      frame.round !== this.round ||
      !validSequence(frame.seq) ||
      frame.seq <= this.sequence ||
      !validOnlineSnapshot(frame.state)
    )
      return false;
    this.sequence = frame.seq;
    const owned = clone(frame);
    this.frames.push({ frame: owned, receivedAt });
    if (this.frames.length > 32) this.frames.shift();
    for (const event of owned.state.collisionEvents)
      if (!this.events.has(event.id)) this.events.set(event.id, clone(event));
    if (this.events.size > 256) {
      const ids = [...this.events.keys()].sort((a, b) => a - b);
      for (const id of ids.slice(0, ids.length - 256)) this.events.delete(id);
    }
    return true;
  }
  latest(): OnlineSnapshot | null {
    const latest = this.frames.at(-1);
    if (!latest) return null;
    return this.withEvents(clone(latest.frame.state));
  }
  private withEvents(state: OnlineSnapshot) {
    state.collisionEvents = [...this.events.values()]
      .sort((a, b) => a.id - b.id)
      .map((e) => ({ ...e }));
    return state;
  }
  sample(time = now()): OnlineSnapshot | null {
    if (!this.frames.length) return null;
    const target = time - INTERPOLATION_DELAY;
    let before = this.frames[0],
      after: BufferedFrame | undefined;
    for (const frame of this.frames) {
      if (frame.receivedAt <= target) before = frame;
      else {
        after = frame;
        break;
      }
    }
    const state = clone(before.frame.state);
    if (after && after !== before && target >= before.receivedAt) {
      const span = after.receivedAt - before.receivedAt;
      const t = Math.max(
        0,
        Math.min(1, span > 0 ? (target - before.receivedAt) / span : 1),
      );
      const other = after.frame.state;
      if (state.phase === other.phase) {
        state.elapsed += (other.elapsed - state.elapsed) * t;
        state.countdown += (other.countdown - state.countdown) * t;
      }
      for (let i = 0; i < 2; i++) {
        const a = state.vehicles[i],
          b = other.vehicles[i];
        for (const key of [
          "distance",
          "offset",
          "speed",
          "nitro",
          "crashTimer",
          "crashTravel",
          "invulnerable",
        ] as const)
          a[key] += (b[key] - a[key]) * t;
        a.yaw +=
          Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * t;
        if (t >= 0.5) {
          a.boosting = b.boosting;
          a.drifting = b.drifting;
          state.drivers[i] = clone(other.drivers[i]);
        }
      }
    } else if (!after && target > before.receivedAt) {
      const dt = Math.min(0.1, (target - before.receivedAt) / 1000);
      if (state.phase === "racing" && !state.raceComplete) {
        state.elapsed += dt;
        for (const v of state.vehicles)
          if (!v.finished && v.crashTimer <= 0)
            v.distance += Math.max(0, v.speed) * dt;
        if (state.finishGraceRemaining !== null)
          state.finishGraceRemaining = Math.max(
            0,
            state.finishGraceRemaining - dt,
          );
      } else if (state.phase === "countdown")
        state.countdown = Math.max(0, state.countdown - dt);
    }
    return this.withEvents(state);
  }
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function post<T>(
  url: string,
  body: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw new HttpError(
      typeof value?.error === "string"
        ? value.error.slice(0, 220)
        : `Online service returned ${response.status}.`,
      response.status,
    );
  if (!value)
    throw new Error("The online service returned an unreadable response.");
  return value as T;
}
async function createSession(
  path: string,
  payload: unknown,
): Promise<OnlineSession> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 8000);
  try {
    const session = await post<OnlineSession>(
      `${apiBase()}${path}`,
      payload,
      undefined,
      controller.signal,
    );
    if (
      !session.token ||
      !session.room ||
      !["host", "guest"].includes(session.role) ||
      session.room.version !== ONLINE_VERSION
    )
      throw new Error("This room uses an unsupported online version.");
    return session;
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP is authoritative for lobby/liveness; WebRTC is an optional low-latency state path. */
export class OnlineClient {
  readonly role: OnlineRole;
  onRoom?: OnlineCallbacks["onRoom"];
  onSnapshot?: OnlineCallbacks["onSnapshot"];
  onError?: OnlineCallbacks["onError"];
  onStatus?: OnlineCallbacks["onStatus"];
  private currentRoom: RoomState;
  private currentStatus: OnlineStatus = "connecting";
  private currentPing: number | null = null;
  private readonly token: string;
  private readonly base = apiBase();
  private disposed = false;
  private leaving = false;
  private polling = false;
  private pollSoon = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setInterval>;
  private abort?: AbortController;
  private commands: Command[] = [];
  private lastHttpSuccess = now();
  private lastErrorNotice = -Infinity;
  private failures = 0;
  private roomSignature = "";
  private snapshotSequence = 0;
  private inputSequence = 0;
  private remoteSequence = -1;
  private remoteControls: Controls = { ...SAFE_INPUT };
  private remoteReceivedAt = -Infinity;
  private localControls: Controls = { ...SAFE_INPUT };
  private localInputAt = -Infinity;
  private pendingSnapshot?: RaceFrame;
  private readonly snapshots = new OnlineSnapshotBuffer();
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private pendingOffer?: RTCSessionDescriptionInit;
  private pendingAnswer?: RTCSessionDescriptionInit;
  private signaling = false;
  private peerOpenedAt = -Infinity;
  private rtcStateAt = -Infinity;
  private lastRtcPing = -Infinity;
  private iceWaiters = new Set<() => void>();

  static async create(
    options: CreateOnlineRoom,
    callbacks: OnlineCallbacks = {},
  ) {
    return new OnlineClient(
      await createSession("/rooms", { ...options, version: ONLINE_VERSION }),
      callbacks,
    );
  }
  static async join(
    code: string,
    profile: OnlineProfile,
    callbacks: OnlineCallbacks = {},
  ) {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,16}$/.test(normalized))
      throw new Error("Enter the room code shared by the host.");
    return new OnlineClient(
      await createSession(`/rooms/${encodeURIComponent(normalized)}/join`, {
        ...profile,
        version: ONLINE_VERSION,
      }),
      callbacks,
    );
  }
  constructor(session: OnlineSession, callbacks: OnlineCallbacks = {}) {
    this.role = session.role;
    this.token = session.token;
    this.currentRoom = clone(session.room);
    Object.assign(this, callbacks);
    this.snapshots.reset(this.currentRoom.round);
    this.tickTimer = setInterval(() => this.tick(), 50);
    this.schedulePoll(0);
    void this.setupPeer();
    queueMicrotask(() => {
      if (!this.disposed) this.notifyRoom(true);
    });
  }
  get room() {
    return clone(this.currentRoom);
  }
  get status() {
    return this.currentStatus;
  }
  get ping() {
    return this.currentPing;
  }
  get remoteInput(): Controls {
    return now() - this.remoteReceivedAt <= 800
      ? { ...this.remoteControls }
      : { ...SAFE_INPUT };
  }
  publish(snapshot: OnlineSnapshot) {
    if (this.disposed || this.leaving || this.role !== "host") return;
    this.pendingSnapshot = {
      round: this.currentRoom.round,
      seq: ++this.snapshotSequence,
      state: clone(snapshot),
    };
  }
  sendInput(controls: Controls) {
    if (this.disposed || this.leaving || this.role !== "guest") return;
    this.localControls = sanitizeOnlineControls(controls);
    this.localInputAt = now();
  }
  sampleSnapshot(time = now()) {
    return this.disposed ? null : this.snapshots.sample(time);
  }
  action(action: Action): Promise<void> {
    return action === "leave" ? this.leave() : this.enqueue({ action });
  }
  setReady(ready: boolean): Promise<void> {
    return this.enqueue({ ready });
  }
  private enqueue(payload: SyncPayload): Promise<void> {
    if (this.disposed || this.leaving)
      return Promise.reject(new Error("This online room is closed."));
    const result = new Promise<void>((resolve, reject) =>
      this.commands.push({ payload, resolve, reject }),
    );
    this.schedulePoll(0);
    return result;
  }
  async leave(): Promise<void> {
    if (this.disposed || this.leaving) return;
    const request = this.enqueue({ action: "leave" });
    this.leaving = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        request.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1800);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.dispose();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.abort?.abort();
    for (const finish of [...this.iceWaiters]) finish();
    if (this.channel) {
      this.channel.onopen =
        this.channel.onclose =
        this.channel.onerror =
        this.channel.onmessage =
          null;
      this.channel.close();
    }
    if (this.pc) {
      this.pc.ondatachannel = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
    }
    this.channel = undefined;
    this.pc = undefined;
    for (const command of this.commands.splice(0))
      command.reject(new Error("This online room is closed."));
    this.snapshots.reset(this.currentRoom.round);
    this.pendingSnapshot = undefined;
    this.remoteControls = { ...SAFE_INPUT };
    this.currentStatus = "closed";
    this.onRoom = this.onSnapshot = this.onError = this.onStatus = undefined;
  }
  private directAvailable() {
    if (
      !this.channel ||
      this.channel.readyState !== "open" ||
      this.channel.bufferedAmount > 128 * 1024
    )
      return false;
    return (
      this.currentRoom.phase === "waiting" ||
      now() - Math.max(this.rtcStateAt, this.peerOpenedAt) < 1000
    );
  }
  private updateStatus() {
    if (this.disposed) return;
    const status: OnlineStatus =
      now() - this.lastHttpSuccess > 2500
        ? "reconnecting"
        : this.directAvailable()
          ? "direct"
          : "relay";
    if (status !== this.currentStatus) {
      this.currentStatus = status;
      this.call(this.onStatus, status);
    }
  }
  private call<T extends unknown[]>(
    callback: ((...args: T) => void) | undefined,
    ...args: T
  ) {
    if (this.disposed || !callback) return;
    try {
      callback(...args);
    } catch {
      /* UI errors must not start overlapping network retries. */
    }
  }
  private notifyRoom(force = false) {
    const r = this.currentRoom,
      signature = JSON.stringify([
        r.code,
        r.round,
        r.trackId,
        r.laps,
        r.phase,
        r.host,
        r.guest,
        r.guestReady,
        r.closedReason,
      ]);
    if (force || signature !== this.roomSignature) {
      this.roomSignature = signature;
      this.call(this.onRoom, clone(r));
    }
  }
  private setRoom(room: RoomState) {
    if (
      this.disposed ||
      room.code !== this.currentRoom.code ||
      room.version !== ONLINE_VERSION ||
      room.round < this.currentRoom.round
    )
      return;
    if (
      room.round !== this.currentRoom.round ||
      (room.phase === "waiting" && this.currentRoom.phase !== "waiting")
    ) {
      this.snapshots.reset(room.round);
      this.pendingSnapshot = undefined;
      this.snapshotSequence = this.inputSequence = 0;
      this.remoteSequence = -1;
      this.remoteControls = { ...SAFE_INPUT };
      this.remoteReceivedAt = -Infinity;
      this.localControls = { ...SAFE_INPUT };
      this.localInputAt = -Infinity;
      this.rtcStateAt = -Infinity;
    }
    this.currentRoom = clone(room);
    this.notifyRoom();
    if (room.phase === "closed") {
      if (!this.leaving)
        this.call(
          this.onError,
          room.closedReason || "The other driver left the room.",
          true,
        );
      this.dispose();
    }
  }
  private nextInput(): InputFrame {
    return {
      round: this.currentRoom.round,
      seq: ++this.inputSequence,
      controls:
        now() - this.localInputAt < 800
          ? { ...this.localControls }
          : { ...SAFE_INPUT },
    };
  }
  private acceptInput(frame: InputFrame, rtc: boolean) {
    if (
      this.disposed ||
      this.currentRoom.phase !== "racing" ||
      this.role !== "host" ||
      !frame ||
      frame.round !== this.currentRoom.round ||
      !validSequence(frame.seq) ||
      frame.seq <= this.remoteSequence
    )
      return;
    const controls = frame.controls;
    if (
      !controls ||
      typeof controls !== "object" ||
      !finite(controls.steer) ||
      [controls.throttle, controls.brake, controls.nitro].some(
        (value) => typeof value !== "boolean",
      )
    )
      return;
    this.remoteSequence = frame.seq;
    this.remoteControls = sanitizeOnlineControls(frame.controls);
    this.remoteReceivedAt = now();
    if (rtc) this.rtcStateAt = this.remoteReceivedAt;
  }
  private acceptSnapshot(frame: RaceFrame, rtc: boolean) {
    if (
      this.disposed ||
      this.currentRoom.phase === "waiting" ||
      this.role !== "guest"
    )
      return;
    if (this.snapshots.push(frame, now())) {
      if (rtc) this.rtcStateAt = now();
      const state = this.snapshots.latest();
      if (state) this.call(this.onSnapshot, state);
    }
  }
  private sendRtc(value: unknown) {
    if (
      this.disposed ||
      !this.channel ||
      this.channel.readyState !== "open" ||
      this.channel.bufferedAmount > 128 * 1024
    )
      return;
    try {
      this.channel.send(JSON.stringify(value));
    } catch {
      this.rtcStateAt = -Infinity;
    }
  }
  private tick() {
    if (this.disposed) return;
    if (now() - this.lastHttpSuccess > OFFLINE_LIMIT) {
      this.call(
        this.onError,
        "Connection lost. Rejoin or create a new room.",
        true,
      );
      this.dispose();
      return;
    }
    const wasDirect = this.currentStatus === "direct";
    if (!this.leaving && this.channel?.readyState === "open") {
      if (this.role === "host" && this.pendingSnapshot)
        this.sendRtc({ type: "snapshot", frame: this.pendingSnapshot });
      else if (this.role === "guest")
        this.sendRtc({ type: "input", frame: this.nextInput() });
      if (now() - this.lastRtcPing > 500) {
        this.lastRtcPing = now();
        this.sendRtc({ type: "ping", sent: this.lastRtcPing });
      }
    }
    this.updateStatus();
    if (wasDirect && !this.directAvailable()) this.schedulePoll(0);
  }
  private schedulePoll(delay: number) {
    if (this.disposed) return;
    if (this.polling) {
      if (delay === 0) this.pollSoon = true;
      return;
    }
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll();
    }, delay);
  }
  private async poll() {
    if (this.disposed || this.polling) return;
    this.polling = true;
    this.pollSoon = false;
    const command = this.commands[0],
      offer = this.pendingOffer,
      answer = this.pendingAnswer;
    const payload: SyncPayload = {
      ...(command?.payload || {}),
      ...(offer ? { offer } : {}),
      ...(answer ? { answer } : {}),
    };
    if (!this.directAvailable()) {
      if (this.role === "host" && this.pendingSnapshot)
        payload.snapshot = this.pendingSnapshot;
      if (this.role === "guest") payload.input = this.nextInput();
    }
    // Persist results even when the final unreliable RTC packet is lost.
    if (
      command?.payload.action === "finish" &&
      this.role === "host" &&
      this.pendingSnapshot
    )
      payload.snapshot = this.pendingSnapshot;
    const controller = new AbortController();
    this.abort = controller;
    const deadline = setTimeout(() => controller.abort(), 4000),
      started = now();
    let retryDelay = 0;
    try {
      const sync = await post<RoomSync>(
        `${this.base}/rooms/${encodeURIComponent(this.currentRoom.code)}/sync`,
        payload,
        this.token,
        controller.signal,
      );
      if (this.disposed) return;
      this.lastHttpSuccess = now();
      this.failures = 0;
      if (!this.directAvailable())
        this.currentPing = Math.round(now() - started);
      if (!sync.room) throw new Error("The room response was incomplete.");
      if (command && this.commands[0] === command) {
        this.commands.shift();
        command.resolve();
      }
      if (this.pendingOffer === offer) this.pendingOffer = undefined;
      if (this.pendingAnswer === answer) this.pendingAnswer = undefined;
      this.setRoom(sync.room);
      if (this.disposed) return;
      if (sync.snapshot) this.acceptSnapshot(sync.snapshot, false);
      if (sync.input) this.acceptInput(sync.input, false);
      await this.signal(sync);
      this.updateStatus();
    } catch (error) {
      if (this.disposed) return;
      retryDelay = Math.min(1800, 300 * 2 ** Math.min(3, ++this.failures));
      const fatal =
        error instanceof HttpError &&
        [401, 403, 404, 410, 426].includes(error.status);
      const message =
        error instanceof HttpError
          ? error.message
          : "Connection interrupted. Reconnecting…";
      if (
        error instanceof HttpError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429 &&
        command &&
        this.commands[0] === command
      ) {
        this.commands.shift();
        command.reject(new Error(message));
      }
      if (fatal) {
        this.call(this.onError, message, true);
        this.dispose();
      } else if (now() - this.lastErrorNotice > 3500) {
        this.lastErrorNotice = now();
        this.call(this.onError, message, false);
      }
      this.updateStatus();
    } finally {
      clearTimeout(deadline);
      if (this.abort === controller) this.abort = undefined;
      this.polling = false;
      if (!this.disposed) {
        const cadence =
          this.currentRoom.phase === "waiting"
            ? 500
            : this.directAvailable()
              ? 1200
              : this.currentRoom.phase === "racing"
                ? 100
                : 500;
        this.schedulePoll(
          retryDelay || (this.commands.length || this.pollSoon ? 0 : cadence),
        );
      }
    }
  }
  private async setupPeer() {
    if (this.disposed || typeof RTCPeerConnection === "undefined") return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.pc = pc;
      pc.ondatachannel = (event) => {
        if (!this.disposed) this.attachChannel(event.channel);
        else event.channel.close();
      };
      pc.onconnectionstatechange = () => {
        if (!this.disposed) {
          this.updateStatus();
          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected"
          )
            this.schedulePoll(0);
        }
      };
      if (this.role === "host") {
        this.attachChannel(
          pc.createDataChannel("velocity-race", {
            ordered: false,
            maxRetransmits: 0,
          }),
        );
        await pc.setLocalDescription(await pc.createOffer());
        await this.waitForIce(pc);
        if (this.disposed || this.pc !== pc) return;
        if (pc.localDescription) {
          this.pendingOffer = {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          };
          this.schedulePoll(0);
        }
      }
    } catch {
      if (!this.disposed) {
        this.updateStatus();
        this.schedulePoll(0);
      }
    }
  }
  private attachChannel(channel: RTCDataChannel) {
    if (this.channel && this.channel !== channel) {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.onopen = () => {
      if (this.disposed) return;
      this.peerOpenedAt = now();
      this.updateStatus();
      this.tick();
    };
    channel.onclose = channel.onerror = () => {
      if (!this.disposed) {
        this.rtcStateAt = -Infinity;
        this.updateStatus();
        this.schedulePoll(0);
      }
    };
    channel.onmessage = (event) => {
      if (
        this.disposed ||
        typeof event.data !== "string" ||
        event.data.length > 100000
      )
        return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "snapshot")
          this.acceptSnapshot(message.frame, true);
        else if (message.type === "input")
          this.acceptInput(message.frame, true);
        else if (message.type === "ping" && finite(message.sent))
          this.sendRtc({ type: "pong", sent: message.sent });
        else if (message.type === "pong" && finite(message.sent)) {
          const latency = now() - message.sent;
          if (latency >= 0 && latency < 10000)
            this.currentPing = Math.round(latency);
        }
      } catch {
        /* An invalid peer packet cannot interrupt rendering or HTTP fallback. */
      }
    };
  }
  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (this.disposed || pc.iceGatheringState === "complete")
      return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", changed);
        this.iceWaiters.delete(finish);
        resolve();
      };
      const changed = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      this.iceWaiters.add(finish);
      pc.addEventListener("icegatheringstatechange", changed);
      timer = setTimeout(finish, 3000);
    });
  }
  private async signal(sync: RoomSync) {
    const pc = this.pc;
    if (this.disposed || !pc || this.signaling) return;
    try {
      this.signaling = true;
      if (
        this.role === "guest" &&
        sync.offer?.type === "offer" &&
        !pc.remoteDescription
      ) {
        await pc.setRemoteDescription(sync.offer);
        if (this.disposed) return;
        await pc.setLocalDescription(await pc.createAnswer());
        await this.waitForIce(pc);
        if (this.disposed || this.pc !== pc) return;
        if (pc.localDescription) {
          this.pendingAnswer = {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          };
          this.schedulePoll(0);
        }
      } else if (
        this.role === "host" &&
        sync.answer?.type === "answer" &&
        !pc.remoteDescription
      ) {
        await pc.setRemoteDescription(sync.answer);
      }
    } catch {
      /* NAT/RTC negotiation failure leaves serial HTTP transport fully usable. */
    } finally {
      this.signaling = false;
    }
  }
}
