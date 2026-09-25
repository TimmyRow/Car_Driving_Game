import type { Controls, OnlineSnapshot } from "./simulation";
import type { TrackId } from "./track";

export const ONLINE_VERSION = 1;
export type OnlineRole = "host" | "guest";
export type RoomPhase = "waiting" | "racing" | "finished" | "closed";
export interface RoomDriver {
  name: string;
  color: string;
}
export interface RoomState {
  code: string;
  version: number;
  round: number;
  trackId: TrackId;
  laps: 1 | 2;
  phase: RoomPhase;
  host: RoomDriver;
  guest: RoomDriver | null;
  guestReady: boolean;
  hostSeenAt: number;
  guestSeenAt: number | null;
  expiresAt: number;
  closedReason: string | null;
}
export interface RaceFrame {
  round: number;
  seq: number;
  state: OnlineSnapshot;
}
export interface InputFrame {
  round: number;
  seq: number;
  controls: Controls;
}
export interface OnlineSession {
  token: string;
  role: OnlineRole;
  room: RoomState;
}
export interface RoomSync {
  room: RoomState;
  snapshot: RaceFrame | null;
  input: InputFrame | null;
  offer: RTCSessionDescriptionInit | null;
  answer: RTCSessionDescriptionInit | null;
  serverTime: number;
}
export interface SyncPayload {
  snapshot?: RaceFrame;
  input?: InputFrame;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  ready?: boolean;
  action?: "start" | "reset" | "finish" | "leave";
}
