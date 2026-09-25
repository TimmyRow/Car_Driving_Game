type SDK = {
  init: () => Promise<void>;
  gameLoadingFinished: () => void;
  gameplayStart: () => void;
  gameplayStop: () => void;
  commercialBreak: () => Promise<void>;
};
declare global {
  interface Window {
    PokiSDK?: SDK;
  }
}
let playing = false;
let sdkReady = false;
export async function initPlatform() {
  if (import.meta.env.VITE_POKI === "true" && !window.PokiSDK) {
    await new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
      setTimeout(resolve, 4000);
    });
  }
  if (window.PokiSDK) {
    try {
      await Promise.race([
        window.PokiSDK.init(),
        new Promise((_, reject) => setTimeout(reject, 4000)),
      ]);
      sdkReady = true;
    } catch {
      /* Play remains available if SDK is blocked. */
    }
  }
}
export function loaded() {
  if (sdkReady) window.PokiSDK?.gameLoadingFinished();
}
export function gameplay(active: boolean) {
  if (active === playing) return;
  playing = active;
  if (sdkReady) {
    if (active) window.PokiSDK?.gameplayStart();
    else window.PokiSDK?.gameplayStop();
  }
}
export async function adBreak() {
  if (sdkReady) {
    try {
      await window.PokiSDK?.commercialBreak();
    } catch {
      /* Ads never gate racing. */
    }
  }
}
export function readSave<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`velocity:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function writeSave(key: string, value: unknown) {
  try {
    localStorage.setItem(`velocity:${key}`, JSON.stringify(value));
  } catch {
    /* Private browsing is fully playable. */
  }
}
