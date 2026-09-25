import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            "three",
            "three/addons/postprocessing/EffectComposer.js",
            "three/addons/postprocessing/RenderPass.js",
            "three/addons/postprocessing/UnrealBloomPass.js",
            "three/addons/postprocessing/OutputPass.js",
            "three/addons/environments/RoomEnvironment.js",
            "three/addons/utils/BufferGeometryUtils.js",
          ],
          physics: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
});
