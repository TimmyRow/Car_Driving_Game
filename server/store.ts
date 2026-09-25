export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export interface RoomRow {
  code: string;
  host_token: string;
  guest_token: string | null;
  track_id: "riviera" | "canyon" | "alpine";
  laps: 1 | 2;
  phase: "waiting" | "racing" | "finished" | "closed";
  round: number;
  host_name: string;
  host_color: string;
  guest_name: string | null;
  guest_color: string | null;
  guest_ready: number;
  host_seen_at: number;
  guest_seen_at: number | null;
  expires_at: number;
  closed_reason: string | null;
  snapshot: string | null;
  snapshot_seq: number;
  input: string | null;
  input_seq: number;
  offer: string | null;
  answer: string | null;
}
export const readRoom = (db: Database, code: string) =>
  db
    .prepare("SELECT * FROM race_rooms WHERE code = ?")
    .bind(code)
    .first<RoomRow>();
