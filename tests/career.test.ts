import test from "node:test";
import assert from "node:assert/strict";
import {
  TOUR_EVENTS,
  readCareer,
  eventUnlocked,
  awardEvent,
  unlockedPaints,
  totalMedals,
} from "../src/career";

test("tour starts with one open event and medals unlock sequential events without skipping a final", () => {
  let p = readCareer(null);
  assert.deepEqual(
    TOUR_EVENTS.filter((e) => eventUnlocked(p, e.id)).map((e) => e.id),
    ["first-light"],
  );
  p = awardEvent(p, "first-light", 1, 42).progress;
  assert.ok(eventUnlocked(p, "tideline"));
  assert.equal(eventUnlocked(p, "saltline-cup"), false);
  p = awardEvent(p, "tideline", 1, 35).progress;
  assert.equal(totalMedals(p), 6);
  assert.ok(eventUnlocked(p, "saltline-cup"));
  assert.equal(eventUnlocked(p, "redshift"), false);
  assert.equal(unlockedPaints(p).length, 1);
  p = awardEvent(p, "saltline-cup", 4, 90).progress;
  assert.ok(eventUnlocked(p, "redshift"));
});

test("replays retain best medals and never duplicate a paint reward", () => {
  let p = awardEvent(readCareer(null), "first-light", 1, 42).progress;
  const first = awardEvent(p, "tideline", 1, 35);
  p = first.progress;
  assert.equal(first.newPaints.length, 1);
  const replay = awardEvent(p, "tideline", 1, 100);
  assert.equal(replay.earned, 1);
  assert.equal(replay.improvement, 0);
  assert.equal(replay.progress.medals.tideline, 3);
  assert.deepEqual(replay.newPaints, []);
  assert.equal(totalMedals(replay.progress), 6);
});

test("time attack medals use exact published thresholds and podium rewards differ from finish", () => {
  let p = awardEvent(readCareer(null), "first-light", 2, 45).progress;
  assert.equal(p.medals["first-light"], 2);
  const event = TOUR_EVENTS[1];
  assert.equal(awardEvent(p, event.id, 1, event.goldTime!).earned, 3);
  assert.equal(awardEvent(p, event.id, 1, event.goldTime! + 0.1).earned, 2);
  assert.equal(awardEvent(p, event.id, 1, event.silverTime! + 0.1).earned, 1);
});

test("saved career round-trips and rejects invalid awards and unknown progress fields", () => {
  let p = readCareer({
    medals: { "first-light": 3, tideline: 2, bogus: 99, "saltline-cup": NaN },
  });
  assert.equal(totalMedals(p), 5);
  assert.equal(p.medals.bogus, undefined);
  assert.deepEqual(readCareer(JSON.parse(JSON.stringify(p))), p);
  for (const [id, pos, time] of [
    ["redshift", 1, 40],
    ["first-light", 0, 40],
    ["first-light", 1, Infinity],
    ["missing", 1, 40],
  ] as const) {
    assert.equal(awardEvent(p, id, pos, time).improvement, 0);
  }
  assert.deepEqual(readCareer("bad"), { version: 1, medals: {} });
});

test("all nine events can be completed to27medals and exactly three paint unlocks", () => {
  let p = readCareer(null),
    rewards = 0;
  for (const event of TOUR_EVENTS) {
    assert.ok(eventUnlocked(p, event.id));
    const result = awardEvent(p, event.id, 1, 35);
    p = result.progress;
    rewards += result.newPaints.length;
  }
  assert.equal(totalMedals(p), 27);
  assert.equal(rewards, 3);
  assert.equal(unlockedPaints(p).length, 3);
});
