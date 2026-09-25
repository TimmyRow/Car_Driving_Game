import "./style.css";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createWorld, updateWorld, worldAssetsReady } from "./world";
import { createCar } from "./car";
import { sampleTrack, trackLength, trackPoints } from "./track";
import {
  createSimulation,
  type Controls,
  type RaceMode,
  type Vehicle,
} from "./simulation";
import { RaceAudio } from "./audio";
import { CrashEffects } from "./crash-effects";
import {
  initPlatform,
  loaded,
  gameplay,
  adBreak,
  readSave,
  writeSave,
} from "./platform";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const soundIcon =
  '<svg viewBox="0 0 24 24"><path d="M11 4 5 9H2v6h3l6 5zM15 8q5 4 0 8m3-11q8 7 0 14"/></svg>';
const gearIcon =
  '<svg viewBox="0 0 24 24"><path d="m9 3-1 3-3 1-2 3 2 3v4l4 1 3 3 3-3 4-1v-4l2-3-2-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>';
const pauseIcon =
  '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
const fullIcon =
  '<svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
const settings = readSave("settings", {
  muted: false,
  quality: "medium",
  auto: true,
  paint: "#f05b27",
});
const validPaints = ["#f05b27", "#dfeaf0", "#12b7c1", "#e5ff54"];
if (!validPaints.includes(settings.paint)) settings.paint = validPaints[0];
if (!["high", "medium", "low"].includes(settings.quality))
  settings.quality = "high";
let personalBest = readSave<number>("best", 0),
  trialBest = readSave<number>("trial-best", 0);
let selectedMode: RaceMode = "race",
  screen: "menu" | "race" | "pause" | "settings" | "results" = "menu";
let settingsReturn: "menu" | "pause" = "menu";
const audio = new RaceAudio();
audio.muted = settings.muted;
const touch =
  matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle("touch-mode", touch);

document.querySelector("#app")!.innerHTML = `
  <canvas id="scene" aria-label="Velocity Coast 3D race track"></canvas>
  <div class="speed-vignette"></div><div class="impact-vignette"></div>
  <section id="menu" class="layer hidden" aria-label="Main menu">
    <div class="menu-shade"></div>
    <header class="masthead"><div class="brand"><i class="brand-mark"></i>VELOCITY <span class="edition"> / COAST</span></div><div class="top-actions"><button class="icon-button" id="sound" aria-label="Toggle sound">${soundIcon}</button><button class="icon-button" id="settings-open" aria-label="Settings">${gearIcon}</button><button class="icon-button" id="fullscreen" aria-label="Full screen">${fullIcon}</button></div></header>
    <div class="hero"><div class="eyebrow">The coast is calling</div><h1>VELOCITY<span>COAST</span></h1><p class="tagline">Find your line. Feel the rush.<br>Leave everything else behind.</p><div class="race-options"><div class="mode-switch" role="group" aria-label="Race mode"><button class="active" data-mode="race" aria-pressed="true">QUICK RACE</button><button data-mode="time-trial" aria-pressed="false">TIME ATTACK</button></div></div><button id="race-start" class="race-button"><span>LET’S RACE</span><span class="arrow">↗</span></button><div class="controls-line"><kbd>← →</kbd> STEER &nbsp; <kbd>SPACE</kbd> DRIFT &nbsp; <kbd>SHIFT</kbd> NITRO</div></div>
    <div class="car-caption"><div class="car-number">01</div><div><strong>APEX GT</strong><p>PURE PERFORMANCE. ZERO COMPROMISE.</p><div class="swatches" role="group" aria-label="Car paint">${validPaints.map((paint, i) => `<button class="swatch ${paint === settings.paint ? "selected" : ""}" style="--paint:${paint}" data-paint="${paint}" aria-label="${["Volcanic orange", "Glacier white", "Lagoon blue", "Acid yellow"][i]} paint" aria-pressed="${paint === settings.paint}"></button>`).join("")}</div></div></div><div class="edition-label">THE HORIZON COLLECTION — 01 / 26</div>
    <footer class="menu-footer"><div class="circuit-summary"><canvas class="circuit-map" id="menu-map" width="224" height="140"></canvas><div><span class="small">FEATURED CIRCUIT / 01</span><h2>RIVIERA RUN</h2><p id="circuit-description">${(trackLength / 1000).toFixed(1)} KM &nbsp; • &nbsp; 2 LAPS &nbsp; • &nbsp; 6 DRIVERS</p></div></div><div class="session-best">PERSONAL BEST<b id="menu-best">— : —</b></div></footer>
  </section>
  <section id="hud" class="layer hud hidden" aria-label="Race information"><div class="hud-top"><div class="race-position"><div class="position-value"><span id="position">6</span><small id="field-size"> / 6</small></div><div class="race-details"><label>RIVIERA RUN</label><strong id="race-mode-label">COASTAL SPRINT</strong><span class="lap-pill">LAP <span id="lap">1 / 2</span></span></div></div><div class="hud-top-right"><div class="clock"><small>RACE TIME</small><span id="race-time">00:00.00</span></div><button class="icon-button" id="pause" aria-label="Pause race">${pauseIcon}</button></div></div><div class="mini-map"><canvas id="race-map" width="332" height="252"></canvas><p>RIVIERA RUN</p></div><div class="speedometer"><div class="speed-row"><span class="gear" id="gear">N</span><span class="speed-number" id="speed">000</span><span class="speed-unit">KM/H</span></div><div class="nitro-title"><span>NITRO</span><span id="nitro-state">SHIFT</span></div><div class="nitro-track"><div class="nitro-fill"></div></div></div><div class="race-feedback"><div class="feedback-title" id="feedback"></div><div class="feedback-sub" id="feedback-sub"></div></div><div class="countdown hidden"><span id="countdown-value">3</span><div class="countdown-label">MAKE THE COAST YOURS</div></div><div class="race-hint" id="race-hint">AUTO ACCELERATE &nbsp; / &nbsp; ← → STEER &nbsp; / &nbsp; SPACE + STEER TO DRIFT</div><div class="touch-controls"><div><button class="touch-btn" data-control="left" aria-label="Steer left">‹</button><button class="touch-btn" data-control="right" aria-label="Steer right">›</button></div><div><button class="touch-btn drift" data-control="brake" aria-label="Brake and drift">DRIFT</button><button class="touch-btn boost" data-control="nitro" aria-label="Nitro boost">NITRO</button></div></div></section>
  <section id="pause-modal" class="layer modal-backdrop hidden" aria-label="Race paused"><div class="panel"><div class="eyebrow">Take a breath</div><h2>THE COAST<br>CAN WAIT.</h2><button class="race-button" id="resume"><span>BACK TO THE RACE</span><span>↗</span></button><button class="secondary-button" id="restart">RESTART RACE</button><button class="secondary-button" id="pause-settings">SETTINGS</button><button class="secondary-button" id="quit">BACK TO GARAGE</button></div></section>
  <section id="settings-modal" class="layer modal-backdrop hidden" aria-label="Settings"><div class="panel"><div class="eyebrow">Make it yours</div><h2>FINE TUNE.</h2><label class="settings-row">Sound effects<input type="checkbox" id="sound-setting" ${!settings.muted ? "checked" : ""}></label><label class="settings-row">Graphics quality<select id="quality"><option value="high">Ultra</option><option value="medium">Balanced</option><option value="low">Performance</option></select></label><label class="settings-row auto-row">Auto accelerate<input type="checkbox" id="auto-setting" ${settings.auto ? "checked" : ""}></label><p class="control-guide">← → or A D — Steer<br>Space or ↓ — Brake / hold while steering to drift<br>Shift or X — Nitro &nbsp; · &nbsp; Esc — Pause<br>W / ↑ — Accelerate when auto is off<br>Touch: steering, drift and nitro buttons. Auto accelerate is always on.</p><button class="race-button" id="settings-close"><span>ALL SET</span><span>↗</span></button></div></section>
  <section id="results-modal" class="layer modal-backdrop hidden" aria-label="Race results"><div class="panel"><div class="eyebrow" id="result-kicker">Finish line crossed</div><h2 id="result-title">WHAT A RIDE.</h2><div class="result-position" id="result-position">1<small>ST PLACE</small></div><div class="result-stats"><div><label>RACE TIME</label><strong id="result-time">—</strong></div><div><label>BEST LAP</label><strong id="result-lap">—</strong></div><div><label>DRIFT PTS</label><strong id="result-drift">0</strong></div></div><p class="new-best" id="new-best"></p><button class="race-button" id="race-again"><span>ONE MORE RUN</span><span>↗</span></button><button class="secondary-button" id="results-garage">BACK TO GARAGE</button></div></section>
  <section id="loading" class="layer loading"><div><i class="brand-mark"></i><h1>VELOCITY COAST</h1><p id="load-message">WARMING UP THE ENGINE</p><div class="load-line"></div></div></section>`;

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "— : —";
  const centi = Math.floor(seconds * 100);
  return `${String(Math.floor(centi / 6000)).padStart(2, "0")}:${String(Math.floor(centi / 100) % 60).padStart(2, "0")}.${String(centi % 100).padStart(2, "0")}`;
}
function updateBest() {
  $("#menu-best").textContent = timeLabel(
    selectedMode === "race" ? personalBest : trialBest,
  );
}
updateBest();
if (touch) {
  $(".control-guide").textContent =
    "Hold a steering button to turn. Hold Drift while steering to charge nitro. Hold Nitro for a burst of speed.";
}

async function boot() {
  const platformReady = initPlatform();
  const canvas = $<HTMLCanvasElement>("#scene");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#a3c9d6");
  scene.fog = new THREE.FogExp2("#a3c9d6", 0.0004);
  const camera = new THREE.PerspectiveCamera(
    49,
    innerWidth / innerHeight,
    0.2,
    5000,
  );
  const sunPosition = new THREE.Vector3(-0.58, 0.54, -0.61).normalize();
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunDirection: { value: sunPosition } },
    vertexShader:
      "varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `
    varying vec3 vDirection;uniform vec3 sunDirection;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
    float fbm(vec2 p){return noise(p)*.5+noise(p*2.03)*.25+noise(p*4.07)*.125+noise(p*8.11)*.0625;}
    void main(){vec3 d=normalize(vDirection);float elevation=max(d.y,0.);vec3 col=mix(vec3(.51,.72,.78),vec3(.08,.39,.65),pow(elevation,.45));
    vec2 uv=d.xz/(max(.08,d.y)+.18)*2.7;float clouds=smoothstep(.51,.73,fbm(uv))*smoothstep(.04,.19,d.y)*(1.-smoothstep(.70,.95,d.y));col=mix(col,vec3(.93,.92,.84),clouds*.83);
    float sun=max(dot(d,sunDirection),0.);col+=vec3(.8,.59,.3)*pow(sun,35.)*.28+vec3(1.9,1.5,.95)*pow(sun,1700.);gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3500, 32, 20),
    skyMaterial,
  );
  sky.frustumCulled = false;
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight("#bde5ff", "#968464", 1.0));
  const sunlight = new THREE.DirectionalLight("#fff1d2", 2.65);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -65;
  sunlight.shadow.camera.right = 65;
  sunlight.shadow.camera.top = 65;
  sunlight.shadow.camera.bottom = -65;
  sunlight.shadow.camera.near = 5;
  sunlight.shadow.camera.far = 330;
  sunlight.shadow.bias = -0.00015;
  sunlight.shadow.normalBias = 0.035;
  sunlight.shadow.radius = 3;
  scene.add(sunlight, sunlight.target);
  const world = createWorld();
  scene.add(world);
  const sim = await createSimulation();
  const playerCar = createCar(settings.paint);
  const rivalCars = sim.rivals.map((v) => createCar(v.color));
  scene.add(playerCar, ...rivalCars);
  // A separate soft footprint grounds each vehicle without relying on tiny distant shadow texels.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const shadowCtx = shadowCanvas.getContext("2d")!;
  const gradient = shadowCtx.createRadialGradient(64, 64, 10, 64, 64, 61);
  gradient.addColorStop(0, "rgba(0,0,0,.58)");
  gradient.addColorStop(0.5, "rgba(0,0,0,.38)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  shadowCtx.fillStyle = gradient;
  shadowCtx.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const contactShadows = [playerCar, ...rivalCars].map(() => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.7, 6.4),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.78,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    return mesh;
  });
  const renderTarget = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType,
    samples: 2,
  });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.19,
    0.45,
    1.35,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let usePost = true;
  function quality() {
    const value = settings.quality;
    const dpr =
      value === "low"
        ? 1
        : Math.min(devicePixelRatio, value === "high" ? 1.5 : 1.25);
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    renderer.shadowMap.enabled = value !== "low";
    usePost = value === "high";
    resize();
  }
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  }
  addEventListener("resize", resize);
  quality();
  const keys = new Set<string>(),
    touches = new Set<string>();
  function clearInput() {
    keys.clear();
    touches.clear();
    document
      .querySelectorAll(".touch-btn")
      .forEach((el) => el.classList.remove("active"));
  }
  let accumulator = 0,
    lastTime = 0,
    worldTime = 0,
    lastCount = -1,
    previousPhase = sim.phase,
    lastImpact = 0,
    peakSpeed = 0;
  let cameraInitialized = false,
    boostBlend = 0,
    driftCombo = 0,
    ready = true,
    adPending = false;
  let feedbackTimer = 0,
    feedbackTitle = "",
    feedbackSub = "";
  const crashes = new CrashEffects(scene);
  let lastCollisionId = 0;
  let crashSmokeClock = 0;
  const cameraAnchor = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3(),
    desiredCamera = new THREE.Vector3(),
    desiredTarget = new THREE.Vector3();
  const previousCarPosition = new THREE.Vector3(),
    cameraTranslation = new THREE.Vector3();
  const forward = new THREE.Vector3(),
    right = new THREE.Vector3();
  function toast(title: string, sub: string, duration = 1.5) {
    if (
      feedbackTimer > 0 &&
      feedbackTitle === "TAKEDOWN" &&
      title === "CLEAN DRIFT"
    )
      return;
    feedbackTitle = title;
    feedbackSub = sub;
    feedbackTimer = duration;
  }
  function showScreen(next: typeof screen) {
    screen = next;
    $("#menu").classList.toggle("hidden", next !== "menu");
    $("#hud").classList.toggle("hidden", next === "menu");
    $("#pause-modal").classList.toggle("hidden", next !== "pause");
    $("#settings-modal").classList.toggle("hidden", next !== "settings");
    $("#results-modal").classList.toggle("hidden", next !== "results");
    if (next !== "race") {
      clearInput();
      gameplay(false);
      audio.update(0, false, false, false);
    }
    if (next === "settings" && settingsReturn === "menu")
      $("#hud").classList.add("hidden");
  }
  function paintCar(color: string) {
    const materials = playerCar.userData.paintMaterials ?? [
      playerCar.userData.paintMaterial,
    ];
    let updated = false;
    for (const material of materials) {
      if (material?.color) {
        material.color.set(color);
        updated = true;
      }
    }
    if (!updated) {
      playerCar.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        if (
          mat?.isMeshPhysicalMaterial &&
          mat.metalness > 0.3 &&
          mat.clearcoat > 0.1
        )
          mat.color.set(color);
      });
    }
  }
  async function startRace() {
    if (adPending) return;
    void audio.unlock().catch(() => {});
    audio.setMuted(settings.muted);
    clearInput();
    sim.reset(selectedMode);
    sim.start();
    lastCollisionId = 0;
    crashes.clear();
    lastImpact = 0;
    cameraInitialized = false;
    accumulator = 0;
    lastCount = -1;
    previousPhase = sim.phase;
    driftCombo = 0;
    peakSpeed = 0;
    feedbackTimer = 0;
    trailCount = 0;
    trailGeometry.setDrawRange(0, 0);
    showScreen("race");
    gameplay(true);
    $("#race-mode-label").textContent =
      selectedMode === "race" ? "COASTAL SPRINT" : "TIME ATTACK";
    $("#field-size").textContent = selectedMode === "race" ? " / 6" : " / 1";
    $("#race-hint").textContent = touch
      ? "HOLD DRIFT + STEER TO CHARGE NITRO"
      : settings.auto
        ? "AUTO ACCELERATE  /  ← → STEER  /  SPACE + STEER TO DRIFT"
        : "↑ ACCELERATE  /  ← → STEER  /  SPACE + STEER TO DRIFT";
    rivalCars.forEach((c) => (c.visible = selectedMode === "race"));
    contactShadows
      .slice(1)
      .forEach((c) => (c.visible = selectedMode === "race"));
  }
  function pause() {
    if (screen === "race") {
      showScreen("pause");
      accumulator = 0;
    }
  }
  async function resume() {
    if (adPending) return;
    adPending = true;
    $<HTMLButtonElement>("#resume").disabled = true;
    audio.setMuted(true);
    audio.update(0, false, false, false);
    await adBreak();
    audio.setMuted(settings.muted);
    adPending = false;
    $<HTMLButtonElement>("#resume").disabled = false;
    clearInput();
    showScreen("race");
    gameplay(true);
    lastTime = performance.now();
  }
  function garage() {
    showScreen("menu");
    sim.reset(selectedMode);
    crashes.clear();
    lastCollisionId = 0;
    const paint = playerCar.userData
      .paintMaterial as THREE.MeshPhysicalMaterial;
    paint.emissiveIntensity = 0;
    playerCar.visible = true;
    rivalCars.forEach((c) => (c.visible = false));
    contactShadows.slice(1).forEach((c) => (c.visible = false));
    cameraInitialized = false;
    updateBest();
  }
  function finish() {
    gameplay(false);
    showScreen("results");
    audio.tone(523, 0.2, 0.12);
    setTimeout(() => audio.tone(659, 0.25, 0.12), 130);
    setTimeout(() => audio.tone(784, 0.4, 0.12), 290);
    const n = sim.position;
    const suffix = ["", "ST", "ND", "RD"][n] ?? "TH";
    $("#result-title").textContent =
      selectedMode === "time-trial"
        ? "RACE COMPLETE"
        : n === 1
          ? "COAST TO VICTORY."
          : n <= 3
            ? "PODIUM FINISH."
            : "WHAT A RIDE.";
    $("#result-position").innerHTML =
      selectedMode === "time-trial"
        ? "<small>TIME ATTACK COMPLETE</small>"
        : `${n}<small>${suffix} PLACE</small>`;
    $("#result-time").textContent = timeLabel(sim.elapsed);
    $("#result-lap").textContent = timeLabel(sim.bestLap || sim.lastLap);
    $("#result-drift").textContent = Math.floor(
      sim.driftScore,
    ).toLocaleString();
    let newRecord = false;
    if (
      selectedMode === "race" &&
      (!personalBest || sim.elapsed < personalBest)
    ) {
      personalBest = sim.elapsed;
      writeSave("best", personalBest);
      newRecord = true;
    }
    if (
      selectedMode === "time-trial" &&
      (!trialBest || sim.elapsed < trialBest)
    ) {
      trialBest = sim.elapsed;
      writeSave("trial-best", trialBest);
      newRecord = true;
    }
    $("#new-best").textContent = newRecord
      ? "↗ NEW PERSONAL BEST"
      : `TOP SPEED ${Math.round(peakSpeed * 3.6)} KM/H · THE NEXT RUN IS YOURS`;
  }
  $("#race-start").onclick = startRace;
  $("#race-again").onclick = startRace;
  $("#restart").onclick = startRace;
  $("#resume").onclick = resume;
  $("#pause").onclick = pause;
  $("#quit").onclick = garage;
  $("#results-garage").onclick = garage;
  $("#settings-open").onclick = () => {
    settingsReturn = "menu";
    showScreen("settings");
  };
  $("#pause-settings").onclick = () => {
    settingsReturn = "pause";
    showScreen("settings");
  };
  $("#settings-close").onclick = () => {
    showScreen(settingsReturn);
  };
  function toggleMute() {
    settings.muted = !settings.muted;
    audio.setMuted(settings.muted);
    $<HTMLInputElement>("#sound-setting").checked = !settings.muted;
    $("#sound").style.opacity = settings.muted ? ".45" : "1";
    $("#sound").setAttribute(
      "aria-label",
      settings.muted ? "Unmute sound" : "Mute sound",
    );
    writeSave("settings", settings);
  }
  $("#sound").onclick = () => {
    void audio.unlock().catch(() => {});
    toggleMute();
  };
  $("#sound-setting").onchange = toggleMute;
  $("#sound").style.opacity = settings.muted ? ".45" : "1";
  $<HTMLSelectElement>("#quality").value = settings.quality;
  $("#quality").onchange = () => {
    settings.quality = $<HTMLSelectElement>("#quality").value;
    quality();
    writeSave("settings", settings);
  };
  $("#auto-setting").onchange = () => {
    settings.auto = $<HTMLInputElement>("#auto-setting").checked;
    writeSave("settings", settings);
  };
  $("#fullscreen").onclick = () => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        selectedMode = button.dataset.mode as RaceMode;
        document
          .querySelectorAll<HTMLButtonElement>("[data-mode]")
          .forEach((b) => {
            b.classList.toggle("active", b === button);
            b.setAttribute("aria-pressed", String(b === button));
          });
        $("#circuit-description").textContent =
          `${(trackLength / 1000).toFixed(1)} KM  •  ${selectedMode === "race" ? "2 LAPS  •  6 DRIVERS" : "1 LAP  •  JUST YOU & THE CLOCK"}`;
        updateBest();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-paint]").forEach(
    (button) =>
      (button.onclick = () => {
        settings.paint = button.dataset.paint!;
        paintCar(settings.paint);
        document
          .querySelectorAll<HTMLButtonElement>("[data-paint]")
          .forEach((b) => {
            b.classList.toggle("selected", b === button);
            b.setAttribute("aria-pressed", String(b === button));
          });
        writeSave("settings", settings);
      }),
  );
  addEventListener("keydown", (event) => {
    if (
      screen === "race" &&
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "ShiftLeft",
        "ShiftRight",
      ].includes(event.code)
    )
      event.preventDefault();
    if (event.code === "Escape" && !event.repeat) {
      if (screen === "race") pause();
      else if (screen === "pause") void resume();
      else if (screen === "settings") showScreen(settingsReturn);
      return;
    }
    if (event.code === "Enter" && screen === "menu") {
      void startRace();
      return;
    }
    if (screen === "race") keys.add(event.code);
  });
  addEventListener("keyup", (event) => keys.delete(event.code));
  document
    .querySelectorAll<HTMLButtonElement>("[data-control]")
    .forEach((button) => {
      const key = button.dataset.control!;
      button.addEventListener("pointerdown", (event) => {
        if (screen !== "race") return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        touches.add(key);
        button.classList.add("active");
      });
      const release = () => {
        touches.delete(key);
        button.classList.remove("active");
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });
  addEventListener("blur", () => {
    clearInput();
    pause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInput();
      pause();
    }
  });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    ready = false;
    pause();
    $("#loading").classList.remove("hidden");
    $("#load-message").textContent = "RESTORING THE VIEW…";
  });
  canvas.addEventListener("webglcontextrestored", () => location.reload());
  // Lightweight reusable particles: tire smoke, dust and boost mist.
  const particleCount = 220,
    positions = new Float32Array(particleCount * 3),
    colors = new Float32Array(particleCount * 3);
  positions.fill(-10000);
  const ages = new Float32Array(particleCount),
    velocities = new Float32Array(particleCount * 3);
  let particleCursor = 0;
  const particleCanvas = document.createElement("canvas");
  particleCanvas.width = 64;
  particleCanvas.height = 64;
  const pctx = particleCanvas.getContext("2d")!;
  const pg = pctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  pg.addColorStop(0, "rgba(255,255,255,.5)");
  pg.addColorStop(0.3, "rgba(255,255,255,.3)");
  pg.addColorStop(1, "rgba(255,255,255,0)");
  pctx.fillStyle = pg;
  pctx.fillRect(0, 0, 64, 64);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const particleMaterial = new THREE.PointsMaterial({
    size: 2.6,
    map: new THREE.CanvasTexture(particleCanvas),
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  scene.add(particles);
  function emitParticle(position: THREE.Vector3, color: THREE.Color) {
    const i = particleCursor++ % particleCount;
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    velocities[i * 3] = (Math.random() - 0.5) * 1.5;
    velocities[i * 3 + 1] = 0.7 + Math.random();
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    ages[i] = 1.2;
  }
  const trailMax = 1200,
    trailPositions = new Float32Array(trailMax * 6);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(trailPositions, 3),
  );
  trailGeometry.setDrawRange(0, 0);
  const trails = new THREE.LineSegments(
    trailGeometry,
    new THREE.LineBasicMaterial({
      color: "#1a2323",
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  trails.frustumCulled = false;
  scene.add(trails);
  let trailCount = 0;
  const lastTires = [new THREE.Vector3(), new THREE.Vector3()];
  let hadDrift = false;
  function trail(a: THREE.Vector3, b: THREE.Vector3) {
    const i = (trailCount++ % trailMax) * 6;
    trailPositions.set([a.x, a.y, a.z, b.x, b.y, b.z], i);
    trailGeometry.setDrawRange(0, Math.min(trailCount, trailMax) * 2);
    trailGeometry.attributes.position.needsUpdate = true;
  }
  const tirePoint = new THREE.Vector3(),
    smokeColor = new THREE.Color("#e4d9c5"),
    boostColor = new THREE.Color("#a3f8ff");
  const mapCanvas = $<HTMLCanvasElement>("#race-map"),
    menuMap = $<HTMLCanvasElement>("#menu-map");
  const mapBounds = trackPoints.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      maxX: Math.max(b.maxX, p.x),
      minZ: Math.min(b.minZ, p.z),
      maxZ: Math.max(b.maxZ, p.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  function drawMap(canvas: HTMLCanvasElement, showCars: boolean) {
    const ctx = canvas.getContext("2d")!,
      w = canvas.width,
      h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const scale = Math.min(
      (w - 30) / (mapBounds.maxX - mapBounds.minX),
      (h - 25) / (mapBounds.maxZ - mapBounds.minZ),
    );
    const project = (p: { x: number; z: number }) => [
      (p.x - (mapBounds.minX + mapBounds.maxX) / 2) * scale + w / 2,
      -(p.z - (mapBounds.minZ + mapBounds.maxZ) / 2) * scale + h / 2,
    ];
    ctx.beginPath();
    for (let i = 0; i < trackPoints.length; i += 16) {
      const [x, y] = project(trackPoints[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = showCars ? 9 : 5;
    ctx.strokeStyle = showCars ? "rgba(14,40,49,.45)" : "rgba(209,231,216,.5)";
    ctx.stroke();
    if (showCars) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(234,247,229,.75)";
      ctx.stroke();
    }
    const [sx, sy] = project(sampleTrack(0));
    ctx.fillStyle = "#e5ff54";
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    if (showCars) {
      for (const v of [...sim.rivals, sim.player]) {
        if (v.id !== sim.player.id && selectedMode === "time-trial") continue;
        const [x, y] = project(sampleTrack(v.distance, v.offset));
        ctx.beginPath();
        ctx.arc(x, y, v.id === sim.player.id ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = v.id === sim.player.id ? "#e5ff54" : "#f4f6eb";
        ctx.fill();
        if (v.id === sim.player.id) {
          ctx.strokeStyle = "#17303a";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }
  drawMap(menuMap, false);
  function positionVehicle(car: THREE.Group, v: Vehicle, dt: number) {
    const p = sampleTrack(v.distance, v.offset);
    car.position.set(p.x, p.y + 0.055, p.z);
    car.rotation.set(0, p.heading + v.yaw, 0);
    const targetRoll = -v.yaw * 0.1;
    car.rotation.z = THREE.MathUtils.lerp(car.rotation.z, targetRoll, 0.1);
    if (v.crashTimer > 0) {
      const progress = THREE.MathUtils.clamp(
        1 - v.crashTimer / v.crashDuration,
        0,
        1,
      );
      const arc = Math.sin(progress * Math.PI);
      const roll = v.crashSide * progress * Math.PI * 2;
      car.position.y +=
        arc * (v.id === 0 ? 1.4 : 2.25) + 0.65 * (1 - Math.cos(roll));
      car.rotation.set(
        arc * 0.3,
        p.heading + v.yaw + v.crashSide * progress * Math.PI * 1.4,
        roll,
      );
    }
    const paint = car.userData.paintMaterial as THREE.MeshPhysicalMaterial;
    paint.emissive.set("#40cddd");
    paint.emissiveIntensity =
      v.invulnerable > 0 && v.crashTimer <= 0
        ? 0.1 + 0.07 * Math.sin(worldTime * 7)
        : 0;
    const wheels = car.userData.wheels as THREE.Object3D[] | undefined;
    wheels?.forEach((wheel) => {
      wheel.rotation.x += (v.speed * dt) / 0.39;
    });
    const fronts = car.userData.frontWheels as THREE.Object3D[] | undefined;
    fronts?.forEach((wheel) => {
      wheel.rotation.y = v.yaw * (v.drifting ? -0.6 : 1.2);
    });
    const flames = car.userData.flames as THREE.Object3D[] | undefined;
    flames?.forEach((flame) => {
      flame.visible = v.boosting;
      flame.scale.z = 0.8 + Math.random() * 0.6;
    });
  }
  function renderFrame(now: number) {
    requestAnimationFrame(renderFrame);
    if (!ready) return;
    const realDt = (now - (lastTime || now)) / 1000;
    const dt = Math.min(realDt, 0.1);
    lastTime = now;
    worldTime += dt;
    const active = screen === "race";
    if (active) {
      const controls: Controls = {
        steer:
          Number(
            keys.has("ArrowLeft") || keys.has("KeyA") || touches.has("left"),
          ) -
          Number(
            keys.has("ArrowRight") || keys.has("KeyD") || touches.has("right"),
          ),
        throttle:
          settings.auto || touch || keys.has("ArrowUp") || keys.has("KeyW"),
        brake:
          keys.has("Space") ||
          keys.has("ArrowDown") ||
          keys.has("KeyS") ||
          touches.has("brake"),
        nitro:
          keys.has("ShiftLeft") ||
          keys.has("ShiftRight") ||
          keys.has("KeyX") ||
          touches.has("nitro"),
      };
      accumulator += dt;
      while (accumulator >= 1 / 60) {
        sim.step(1 / 60, controls);
        accumulator -= 1 / 60;
      }
      for (const event of sim.collisionEvents) {
        if (event.id <= lastCollisionId) continue;
        lastCollisionId = event.id;
        crashes.burst(event);
        if (event.attackerId === 0 || event.victimId === 0) {
          audio.crash(event.kind !== "hit");
          if (event.kind === "takedown" && event.attackerId === 0)
            toast("TAKEDOWN", "+ NITRO", 1.6);
          else if (event.victimId === 0 && event.kind === "wreck")
            toast("WRECKED", "", 1.1);
        }
        if (event.kind !== "hit") {
          const at = sampleTrack(event.distance, event.offset);
          for (let i = 0; i < 24; i++)
            emitParticle(
              new THREE.Vector3(
                at.x + (Math.random() - 0.5) * 2,
                at.y + 0.7,
                at.z + (Math.random() - 0.5) * 2,
              ),
              smokeColor,
            );
        }
      }
      if (sim.phase === "countdown") {
        const count = Math.ceil(sim.countdown);
        if (count !== lastCount) {
          lastCount = count;
          audio.tone(330, 0.15, 0.15);
        }
        $(".countdown").classList.remove("hidden");
        $("#countdown-value").textContent = String(Math.max(1, count));
      } else if (sim.phase === "racing") {
        if (previousPhase === "countdown") {
          audio.tone(880, 0.35, 0.13);
          toast("GO!", "CHASE THE HORIZON", 1.1);
        }
        $(".countdown").classList.add("hidden");
      }
      if (sim.phase === "finished" && previousPhase !== "finished") finish();
      previousPhase = sim.phase;
      peakSpeed = Math.max(peakSpeed, sim.player.speed);
      if (sim.player.drifting) {
        driftCombo += dt;
      } else if (driftCombo > 0.4) {
        toast(
          "CLEAN DRIFT",
          `+${Math.round(driftCombo * 100)}  /  NITRO RECHARGED`,
          1.5,
        );
        driftCombo = 0;
      } else driftCombo = 0;
      if (sim.impact > 0.25 && lastImpact <= 0.25) {
        audio.impact();
      }
      lastImpact = sim.impact;
    }
    const menuMode =
      screen === "menu" || (screen === "settings" && settingsReturn === "menu");
    if (menuMode) {
      const hero = sampleTrack(112, 1);
      playerCar.position.set(hero.x, hero.y + 0.055, hero.z);
      playerCar.rotation.set(0, hero.heading, 0);
      rivalCars.forEach((car) => (car.visible = false));
      contactShadows.slice(1).forEach((shadow) => (shadow.visible = false));
      const flames = playerCar.userData.flames as THREE.Object3D[] | undefined;
      flames?.forEach((flame) => (flame.visible = false));
    } else {
      positionVehicle(playerCar, sim.player, active ? dt : 0);
      sim.rivals.forEach((v, i) => {
        if (rivalCars[i]) positionVehicle(rivalCars[i], v, active ? dt : 0);
      });
    }
    [playerCar, ...rivalCars].forEach((car, i) => {
      const shadow = contactShadows[i];
      shadow.position.copy(car.position);
      const vehicle = i === 0 ? sim.player : sim.rivals[i - 1];
      const surface = sampleTrack(
        menuMode ? 112 : (vehicle?.distance ?? 0),
        menuMode ? 1 : (vehicle?.offset ?? 0),
      );
      shadow.position.y = surface.y + 0.04;
      shadow.rotation.z = -surface.heading;
    });
    const ground = sampleTrack(sim.player.distance, sim.player.offset);
    const carPos = menuMode
      ? playerCar.position
      : cameraAnchor.set(ground.x, ground.y + 0.055, ground.z);
    sunlight.target.position.copy(carPos);
    sunlight.position.copy(carPos).addScaledVector(sunPosition, 180);
    sunlight.target.updateMatrixWorld();
    const p = sampleTrack(menuMode ? 112 : sim.player.distance),
      h = p.heading;
    forward.set(Math.sin(h), 0, Math.cos(h));
    right.set(Math.cos(h), 0, -Math.sin(h));
    if (menuMode) {
      const portrait = innerHeight > innerWidth,
        orbit = Math.sin(worldTime * 0.1) * 0.2;
      const distance = portrait ? 12.7 : 8.2;
      desiredCamera
        .copy(carPos)
        .addScaledVector(right, distance * 0.77 + orbit)
        .addScaledVector(forward, distance * 0.84);
      desiredCamera.y += portrait ? 4.5 : 3.25;
      const viewRight = new THREE.Vector3().crossVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3().subVectors(desiredCamera, carPos).normalize(),
      );
      desiredTarget
        .copy(carPos)
        .addScaledVector(viewRight, portrait ? 0 : -2.8);
      desiredTarget.y += 0.85;
      camera.fov = portrait ? 51 : 43;
    } else {
      const portrait = innerHeight > innerWidth;
      const look = sampleTrack(
        sim.player.distance + (portrait ? 15 : 18),
        sim.player.offset * (portrait ? 1 : 0.6),
      );
      boostBlend = THREE.MathUtils.damp(
        boostBlend,
        active && sim.player.boosting ? 1 : 0,
        4,
        dt,
      );
      desiredCamera
        .copy(carPos)
        .addScaledVector(forward, -(portrait ? 11 : 7.3) - boostBlend * 0.65)
        .addScaledVector(right, -sim.player.yaw * 1.2);
      desiredCamera.y += portrait ? 4 : 2.9;
      desiredTarget.set(look.x, look.y + 1.0, look.z);
      camera.fov = THREE.MathUtils.damp(
        camera.fov,
        57 + sim.player.speed * 0.1 + boostBlend * 6,
        5,
        dt,
      );
      if (active && sim.impact > 0.1) {
        desiredCamera.x += Math.sin(worldTime * 65) * sim.impact * 0.12;
        desiredCamera.y += Math.cos(worldTime * 52) * sim.impact * 0.07;
      }
    }
    if (!cameraInitialized) {
      camera.position.copy(desiredCamera);
      cameraTarget.copy(desiredTarget);
      cameraInitialized = true;
    } else {
      // Translate with the chassis before smoothing the relative camera pose.
      // Smoothing absolute world positions adds a speed-dependent 8m+ lag.
      if (!menuMode) {
        cameraTranslation.subVectors(carPos, previousCarPosition);
        camera.position.add(cameraTranslation);
        cameraTarget.add(cameraTranslation);
      }
      const factor = 1 - Math.exp(-dt * (menuMode ? 2.4 : 9));
      camera.position.lerp(desiredCamera, factor);
      cameraTarget.lerp(desiredTarget, factor);
    }
    previousCarPosition.copy(carPos);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
    if (!menuMode) {
      sim.rivals.forEach((vehicle, i) => {
        const visible =
          selectedMode === "race" &&
          !(
            vehicle.distance < sim.player.distance - 2 &&
            rivalCars[i].position.distanceTo(camera.position) < 6
          );
        rivalCars[i].visible = visible;
        contactShadows[i + 1].visible = visible;
      });
    }
    updateWorld(worldTime);
    crashes.update(active ? dt : 0);
    crashSmokeClock += active ? dt : 0;
    if (active && crashSmokeClock >= 0.035) {
      crashSmokeClock = 0;
      for (const [i, vehicle] of [sim.player, ...sim.rivals].entries()) {
        if (vehicle.crashTimer > 0)
          emitParticle([playerCar, ...rivalCars][i].position, smokeColor);
      }
    }
    if (
      active &&
      sim.player.speed > 12 &&
      (sim.player.drifting || sim.player.boosting)
    ) {
      for (let side = 0; side < 2; side++) {
        tirePoint
          .set(side === 0 ? -0.82 : 0.82, 0.25, -1.65)
          .applyMatrix4(playerCar.matrixWorld);
        emitParticle(tirePoint, sim.player.boosting ? boostColor : smokeColor);
        tirePoint.y = carPos.y + 0.018;
        if (sim.player.drifting && hadDrift) trail(lastTires[side], tirePoint);
        lastTires[side].copy(tirePoint);
      }
    }
    hadDrift = active && sim.player.drifting;
    for (let i = 0; i < particleCount; i++) {
      if (ages[i] > 0) {
        ages[i] -= dt;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        if (ages[i] <= 0) positions[i * 3 + 1] = -10000;
      }
    }
    particleGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.color.needsUpdate = true;
    if (!menuMode) {
      $("#position").textContent = String(sim.position);
      $("#lap").textContent = `${sim.lap} / ${sim.totalLaps}`;
      $("#race-time").textContent =
        sim.elapsed > 0 ? timeLabel(sim.elapsed) : "00:00.00";
      $("#speed").textContent = String(
        Math.round(sim.player.speed * 3.6),
      ).padStart(3, "0");
      $("#gear").textContent =
        sim.player.speed < 1
          ? "N"
          : String(Math.min(6, Math.floor(sim.player.speed / 17) + 1));
      $(".nitro-fill").style.width = `${sim.player.nitro * 100}%`;
      $(".nitro-track").classList.toggle("boosting", sim.player.boosting);
      $("#nitro-state").textContent = sim.player.boosting
        ? "BOOSTING"
        : touch
          ? "HOLD NITRO"
          : "SHIFT";
      feedbackTimer = Math.max(0, feedbackTimer - dt);
      const collisionFeedback =
        feedbackTimer > 0 &&
        (feedbackTitle === "TAKEDOWN" || feedbackTitle === "WRECKED");
      $("#feedback").textContent = collisionFeedback
        ? feedbackTitle
        : sim.player.boosting
          ? "NITRO"
          : sim.player.drifting
            ? "DRIFT"
            : feedbackTimer > 0
              ? feedbackTitle
              : "";
      $("#feedback-sub").textContent = collisionFeedback
        ? feedbackSub
        : sim.player.boosting
          ? "CHASE THE HORIZON"
          : sim.player.drifting
            ? `+${Math.floor(driftCombo * 100)}  /  CHARGING NITRO`
            : feedbackTimer > 0
              ? feedbackSub
              : "";
      $("#race-hint").classList.toggle(
        "hidden",
        sim.elapsed > 9 || sim.phase === "finished",
      );
      if (selectedMode === "race" && sim.elapsed > 5 && sim.elapsed <= 9) {
        $("#race-hint").textContent = touch
          ? "HOLD NITRO AND RAM A RIVAL"
          : "HOLD SHIFT AND RAM A RIVAL FOR A TAKEDOWN";
      }
      drawMap(mapCanvas, true);
    }
    $(".speed-vignette").style.opacity = String(active ? boostBlend * 0.75 : 0);
    $(".impact-vignette").style.opacity = String(active ? sim.impact * 0.4 : 0);
    audio.update(
      sim.player.speed,
      sim.player.drifting,
      sim.player.boosting,
      active && sim.phase === "racing",
    );
    renderer.info.autoReset = false;
    renderer.info.reset();
    if (usePost) composer.render();
    else renderer.render(scene, camera);
    frameStats.frames++;
    frameStats.time += realDt;
    if (frameStats.time >= 1) {
      frameStats.fps = frameStats.frames / frameStats.time;
      frameStats.frames = 0;
      frameStats.time = 0;
    }
  }
  const frameStats = { fps: 0, frames: 0, time: 0 };
  if (import.meta.env.DEV) {
    Object.defineProperty(window, "__velocityDebug", {
      get: () => ({
        screen,
        phase: sim.phase,
        speed: sim.player.speed,
        distance: sim.player.distance,
        offset: sim.player.offset,
        nitro: sim.player.nitro,
        drifting: sim.player.drifting,
        boosting: sim.player.boosting,
        crashTimer: sim.player.crashTimer,
        takedowns: sim.takedowns,
        collisionEvents: sim.collisionEvents,
        rivals: sim.rivals.map((v) => ({
          id: v.id,
          distance: v.distance,
          offset: v.offset,
          speed: v.speed,
          crashTimer: v.crashTimer,
          invulnerable: v.invulnerable,
        })),
        position: sim.position,
        lap: sim.lap,
        totalLaps: sim.totalLaps,
        elapsed: sim.elapsed,
        trackLength,
        fps: frameStats.fps,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        quality: settings.quality,
      }),
    });
  }
  await Promise.all([platformReady, worldAssetsReady]);
  loaded();
  $("#loading").classList.add("hidden");
  garage();
  requestAnimationFrame(renderFrame);
}

boot().catch((error) => {
  console.error(error);
  $("#load-message").classList.add("error-message");
  $("#load-message").textContent =
    "The track could not load. Please enable hardware acceleration and refresh to try again.";
  $(".load-line").classList.add("hidden");
});
