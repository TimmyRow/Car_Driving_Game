import { getTrack, type TrackId } from "./track";
import type { Difficulty, RaceMode } from "./simulation";

export interface TourEvent {
  id: string;
  title: string;
  trackId: TrackId;
  mode: RaceMode;
  difficulty: Difficulty;
  laps: 1 | 2;
  goldTime?: number;
  silverTime?: number;
}
export interface CareerProgress {
  version: 1;
  medals: Record<string, number>;
}
export const TOUR_CHAPTERS = [
  {
    name: "Salt & Sun",
    trackId: "riviera" as TrackId,
    reward: "Amethyst",
    paint: "#8868ce",
  },
  {
    name: "Fire & Stone",
    trackId: "canyon" as TrackId,
    reward: "Sandstorm",
    paint: "#d8b26b",
  },
  {
    name: "Sky & Ice",
    trackId: "alpine" as TrackId,
    reward: "Rose Quartz",
    paint: "#e696b6",
  },
];
export const TOUR_EVENTS: TourEvent[] = [
  {
    id: "first-light",
    title: "First Light",
    trackId: "riviera",
    mode: "race",
    difficulty: "rookie",
    laps: 1,
  },
  {
    id: "tideline",
    title: "Against the Tide",
    trackId: "riviera",
    mode: "time-trial",
    difficulty: "rookie",
    laps: 1,
    goldTime: getTrack("riviera").length / 85 + 3,
    silverTime: getTrack("riviera").length / 69 + 5,
  },
  {
    id: "saltline-cup",
    title: "Saltline Cup",
    trackId: "riviera",
    mode: "race",
    difficulty: "pro",
    laps: 2,
  },
  {
    id: "redshift",
    title: "Redshift",
    trackId: "canyon",
    mode: "race",
    difficulty: "pro",
    laps: 1,
  },
  {
    id: "desert-rhythm",
    title: "Desert Rhythm",
    trackId: "canyon",
    mode: "time-trial",
    difficulty: "pro",
    laps: 1,
    goldTime: getTrack("canyon").length / 87 + 5,
    silverTime: getTrack("canyon").length / 71 + 5,
  },
  {
    id: "ember-crown",
    title: "Ember Crown",
    trackId: "canyon",
    mode: "race",
    difficulty: "pro",
    laps: 2,
  },
  {
    id: "thin-air",
    title: "Thin Air",
    trackId: "alpine",
    mode: "race",
    difficulty: "expert",
    laps: 1,
  },
  {
    id: "aster-dash",
    title: "Aster Dash",
    trackId: "alpine",
    mode: "time-trial",
    difficulty: "expert",
    laps: 1,
    goldTime: getTrack("alpine").length / 89 + 5,
    silverTime: getTrack("alpine").length / 73 + 5,
  },
  {
    id: "summit-final",
    title: "Summit Final",
    trackId: "alpine",
    mode: "race",
    difficulty: "expert",
    laps: 2,
  },
];
export function readCareer(value: unknown): CareerProgress {
  const result: CareerProgress = { version: 1, medals: {} };
  if (!value || typeof value !== "object") return result;
  const medals = (value as { medals?: unknown }).medals;
  if (!medals || typeof medals !== "object") return result;
  for (const event of TOUR_EVENTS) {
    const score = (medals as Record<string, unknown>)[event.id];
    if (typeof score === "number" && Number.isFinite(score))
      result.medals[event.id] = Math.max(0, Math.min(3, Math.floor(score)));
  }
  return result;
}
export function totalMedals(progress: CareerProgress) {
  return Object.values(progress.medals).reduce((a, b) => a + b, 0);
}
export function chapterMedals(progress: CareerProgress, chapter: number) {
  return TOUR_EVENTS.slice(chapter * 3, chapter * 3 + 3).reduce(
    (n, e) => n + (progress.medals[e.id] ?? 0),
    0,
  );
}
export function eventUnlocked(progress: CareerProgress, id: string) {
  const index = TOUR_EVENTS.findIndex((e) => e.id === id);
  if (index < 0) return false;
  const chapter = Math.floor(index / 3);
  for (let c = 0; c < chapter; c++)
    if (
      chapterMedals(progress, c) < 5 ||
      !(progress.medals[TOUR_EVENTS[c * 3 + 2].id] > 0)
    )
      return false;
  return (
    index % 3 === 0 || (progress.medals[TOUR_EVENTS[index - 1].id] ?? 0) > 0
  );
}
export function unlockedPaints(progress: CareerProgress) {
  return TOUR_CHAPTERS.filter((_, i) => chapterMedals(progress, i) >= 5).map(
    (c) => c.paint,
  );
}
export function awardEvent(
  progress: CareerProgress,
  id: string,
  position: number,
  elapsed: number,
) {
  const event = TOUR_EVENTS.find((e) => e.id === id);
  if (
    !event ||
    !eventUnlocked(progress, id) ||
    !Number.isFinite(elapsed) ||
    elapsed <= 0 ||
    !Number.isInteger(position) ||
    position < 1 ||
    position > 6
  )
    return { progress, earned: 0, improvement: 0, newPaints: [] as string[] };
  const earned =
    event.mode === "race"
      ? position === 1
        ? 3
        : position <= 3
          ? 2
          : 1
      : elapsed <= event.goldTime!
        ? 3
        : elapsed <= event.silverTime!
          ? 2
          : 1;
  const best = Math.max(progress.medals[id] ?? 0, earned);
  const next: CareerProgress = {
    version: 1,
    medals: { ...progress.medals, [id]: best },
  };
  return {
    progress: next,
    earned,
    improvement: best - (progress.medals[id] ?? 0),
    newPaints: unlockedPaints(next).filter(
      (p) => !unlockedPaints(progress).includes(p),
    ),
  };
}
export function eventGoal(event: TourEvent) {
  return event.mode === "race"
    ? "FINISH ★  ·  PODIUM ★★  ·  WIN ★★★"
    : `FINISH ★  ·  ${event.silverTime!.toFixed(1)}s ★★  ·  ${event.goldTime!.toFixed(1)}s ★★★`;
}
