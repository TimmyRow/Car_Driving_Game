# Velocity Coast

An original Three.js arcade racer with three larger circuits, the nine-event Wayfinder Tour, and private two-player online races. Six drivers in solo races, configurable rival difficulty, drift-charged nitro, hard-impact takedowns, time attack, seven paint finishes (three earned in career), original vehicles and scenery with photographic road/rock materials, synthesized audio, touch controls, and locally saved progress, route records and settings.

## Run

Node.js 24 or newer is recommended for the local SQLite room service.

```sh
npm install
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

`npm run build` produces `dist/client/` for the game and `dist/server/index.js` for its online room API. Deploy both with a D1 binding named `DB` and apply the versioned migrations in `drizzle/`; Sites performs this wiring and migration step. Use `npm run dev` to test online rooms locally: the Vite development server provides the same API using local SQLite in the ignored `.sites-runtime/online.sqlite` file. `npm run preview` previews client assets without starting the room service. All fonts, libraries and game art remain bundled.

## Controls

| Action         | Keyboard                                | Touch                     |
| -------------- | --------------------------------------- | ------------------------- |
| Steer          | Left/right or A/D                       | Left/right buttons        |
| Drift          | Hold Space or down while steering       | Hold Drift while steering |
| Nitro          | Hold Shift or X                         | Hold Nitro                |
| Accelerate     | Automatic; W/up if disabled in Settings | Automatic                 |
| Pause / resume | Escape                                  | Pause button              |

Drifting builds nitro faster. Release an empty nitro tank before activating it again. Rivals have fixed performance with no teleporting or position-dependent speed boost. Auto acceleration helps entry; overtaking and well-timed nitro determine the win.

Light contact and sustained rubbing shove cars apart safely, even while boosting. A takedown requires a meaningful speed difference: a hard rear-end slam or a committed fast side impact. Nitro contact by itself never escalates into a knockout. A successful knockout preserves your momentum, throws the rival forward and triggers a brief impact stop, slow motion and a camera move. Wrecks tumble with sparks, torn panels and smoke, then recover into an open lane with brief protection from another wreck. Cinematic takedowns can be disabled in Settings; collisions and rewards still work.

Settings offers Rookie, Pro (default), and Expert rivals. Higher levels increase pace, acceleration and passing reactions, and use finite nitro strategically. The selected level is saved and applies on the next race or restart; changing it during a pause does not alter the race already underway. Rivals do not teleport or receive position-based speed boosts.

## Routes and career

Use **Change Route** in the garage to freely select any circuit for Quick Race or Time Attack:

| Circuit      | Length | Character                                                         |
| ------------ | ------ | ----------------------------------------------------------------- |
| Riviera Run  | 3.2 km | Mediterranean cliffs, marina, promenade and open sea              |
| Ember Canyon | 4.2 km | Sandstone arches, layered mesas, cacti and solar research outpost |
| Aster Ridge  | 4.1 km | Snow peaks, pine valleys, a cable viaduct and observatory         |

**Career → Wayfinder Tour** contains three events per destination: a one-lap sprint, one-lap Time Attack, and two-lap cup. Finish an event to unlock the next. Complete a chapter's three events and earn at least five medals to open the next chapter. Five medals unlock that chapter's paint in the garage. Race medals reward finishing, a podium and winning; Time Attack medals use the displayed time targets. Replays retain the best result without duplicating rewards. Career events set their own difficulty. Quick Race uses the Settings selection.

Career progress and records persist locally. Records are separated by route, mode, lap count and rival difficulty; the enlarged circuits begin fresh records. Route switching caches three bounded worlds and shares the four local photo textures.

## Online races

Choose **Online** in the garage, enter a driver name and create a private two-player room. Choose any route and one or two laps, then share its six-character code. Your friend selects Online, enters the code, joins and taps **I'm Ready**. The host starts the race. Both drivers use the same human drivetrain, shared collisions and finishing order. The first finisher starts a 30-second deadline for the other driver; missing that deadline is a DNF. Both can return to the room for a rematch.

The host's browser runs the authoritative simulation. WebRTC sends sequenced inputs and snapshots directly when available; an authenticated HTTP relay falls back when direct connections are blocked. Guests interpolate the shared state. Online takedown effects retain the camera, sparks and impact feedback without slowing shared race time. Opening the race menu keeps the race running and brakes your car. You can switch tabs in the lobby to share the code. Keep the game visible once racing: putting an active race in the background leaves the room. Closing a game or losing its connection closes the room after a short detection period.

Rooms require no account. Driver credentials stay in memory, tokens are hashed in storage, and room/session data expires after two hours. Old rows are cleaned up as new rooms are created. This is friend-to-friend host-authoritative multiplayer, not competitive anti-cheat or public matchmaking. Solo modes, career and local records remain separate from online results.

Online race entry is a separate option. Offline/static exports can use `VITE_ONLINE_API_URL` to point at the hosted `/api/online` service; without a service, they show an unavailable message while solo play remains usable.

## Browser presentation

The default Balanced preset keeps shadows without postprocessing. Ultra adds bloom and higher render resolution, and Performance removes shadow maps. Settings are accessible in the garage and pause screen. Losing focus or hiding the tab pauses solo play; online races follow the room behavior described above. WebGL context recovery reloads the game safely. Local storage failure does not prevent play.

The game uses an arcade model: Rapier resolves vehicle and barrier contacts in road coordinates, and the drivetrain/tire model controls longitudinal speed and lateral slip. It does not attempt a full vehicle suspension or tire simulation. The scenery and cars are authored procedural geometry, not photogrammetry or licensed production car models.

## Poki build

```sh
npm run build:poki
```

This writes `dist-poki/` and enables loading the official Poki SDK. Initialization failure falls back to a playable game. Loading-complete and paired start/stop lifecycle events are implemented. Solo resume requests a commercial break; blocked/failed ads do not gate play. Online resume never requests an ad during a shared race. Normal `npm run build` creates the hosted game plus API and does not load the SDK. `npm run build:web` creates the portable game in `dist-web/`; portable and Poki exports connect online rooms to the hosted service configured in their respective environment files.

Actual Poki Inspector validation, platform approval, thumbnail submission, and testing on physical mobile devices remain release steps. This project has not been submitted to or approved by Poki.

## Independent review

`qa/visual-review.md` records a separate agent's comparison with publisher-supplied Asphalt Legends screenshots. It is an explicitly unblinded comparison, not proof of AAA parity. `qa/driving-review.md` covers driving and race balance. QA pages and reference images are outside the production entry and are not copied into `dist/`.

## Main boundaries

- `src/track.ts`: three arc-length sampled closed circuits and active-route selection.
- `src/career.ts`: event definitions, medals, chapter gates and paint rewards.
- `src/simulation.ts`: fixed-step racing rules and Rapier contacts.
- `src/car.ts`, `src/world.ts` and `src/regional-environments.ts`: original vehicles and regional environments.
- `src/main.ts`: render/camera, HUD, input and lifecycle.
- `src/audio.ts`: gesture-unlocked synthesis.
- `src/crash-effects.ts`: pooled sparks and bouncing debris.
- `src/platform.ts`: optional SDK and resilient local saves.
- `tests/`: lifecycle, contact intent, nitro, balance, route continuity, lap counts and career progression regressions.

Fonts: Barlow Condensed and Manrope, distributed under the SIL Open Font License by their respective authors via Fontsource. Three.js is MIT licensed. Rapier is Apache-2.0 licensed. Photo materials are CC0 from Poly Haven; see `ASSETS.md`. Asphalt reference images remain the property of Gameloft and are used only for comparative review; they are not game assets.
