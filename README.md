# Velocity Coast

An original Three.js arcade racer around a 1.77 km Mediterranean circuit. Six drivers, two laps, drift-charged nitro, car collisions and takedowns, one-lap time attack, four paint finishes, original vehicles and scenery with photographic road/rock materials, synthesized audio, touch controls, and locally saved records/settings.

## Run

Node.js 22 or newer is recommended.

```sh
npm install
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

Serve `dist/` over HTTP after building. The build uses relative asset paths and can be hosted in a subdirectory. All fonts, libraries and game art are bundled; the standalone version makes no external requests.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | Left/right or A/D | Left/right buttons |
| Drift | Hold Space or down while steering | Hold Drift while steering |
| Nitro | Hold Shift or X | Hold Nitro |
| Accelerate | Automatic; W/up if disabled in Settings | Automatic |
| Pause / resume | Escape | Pause button |

Drifting builds nitro faster. Release an empty nitro tank before activating it again. Rivals have fixed performance with no teleporting or position-dependent speed boost. Auto acceleration helps entry; overtaking and well-timed nitro determine the win.

Light contact shoves cars apart. Ram a rival from behind or the side while boosting at speed to score a takedown and regain nitro. Holding nitro against a rival also builds enough pressure to break through, so an early bumper contact cannot trap a committed boost. A successful knockout preserves your momentum, throws the rival forward and triggers a brief impact stop, slow motion and a camera move. Wrecks tumble with sparks, torn panels and smoke, then recover into an open lane with brief protection from another wreck. Cinematic takedowns can be disabled in Settings; collisions and rewards still work.

Settings offers Rookie, Pro (default), and Expert rivals. Higher levels increase pace, acceleration and passing reactions, and use finite nitro strategically. The selected level is saved and applies on the next race or restart; changing it during a pause does not alter the race already underway. Rivals do not teleport or receive position-based speed boosts.

## Browser presentation

The default Balanced preset keeps shadows without postprocessing. Ultra adds bloom and higher render resolution, and Performance removes shadow maps. Settings are accessible in the garage and pause screen. Losing focus or hiding the tab pauses play. WebGL context recovery reloads the game safely. Local storage failure does not prevent play.

The game uses an arcade model: Rapier resolves vehicle and barrier contacts in road coordinates, and the drivetrain/tire model controls longitudinal speed and lateral slip. It does not attempt a full vehicle suspension or tire simulation. The scenery and cars are authored procedural geometry, not photogrammetry or licensed production car models.

## Poki build

```sh
npm run build -- --mode poki --outDir dist-poki
```

This writes `dist-poki/` and enables loading the official Poki SDK. Initialization failure falls back to a playable game. Loading-complete and paired start/stop lifecycle events are implemented. Resume requests a commercial break; blocked/failed ads do not gate play. Audio is silent while paused or in an ad. Normal `npm run build` writes `dist/` and does not load the SDK.

Actual Poki Inspector validation, platform approval, thumbnail submission, and testing on physical mobile devices remain release steps. This project has not been submitted to or approved by Poki.

## Independent review

`qa/visual-review.md` records a separate agent's comparison with publisher-supplied Asphalt Legends screenshots. It is an explicitly unblinded comparison, not proof of AAA parity. `qa/driving-review.md` covers driving and race balance. QA pages and reference images are outside the production entry and are not copied into `dist/`.

## Main boundaries

- `src/track.ts`: arc-length sampled closed circuit.
- `src/simulation.ts`: fixed-step racing rules and Rapier contacts.
- `src/car.ts` and `src/world.ts`: original geometry/materials.
- `src/main.ts`: render/camera, HUD, input and lifecycle.
- `src/audio.ts`: gesture-unlocked synthesis.
- `src/crash-effects.ts`: pooled sparks and bouncing debris.
- `src/platform.ts`: optional SDK and resilient local saves.
- `tests/simulation.test.ts`: lifecycle, timestep, collision, nitro, balance and finish regressions.

Fonts: Barlow Condensed and Manrope, distributed under the SIL Open Font License by their respective authors via Fontsource. Three.js is MIT licensed. Rapier is Apache-2.0 licensed. Photo materials are CC0 from Poly Haven; see `ASSETS.md`. Asphalt reference images remain the property of Gameloft and are used only for comparative review; they are not game assets.
