import { build as viteBuild } from "vite";
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "dist");
if (
  dirname(output) !== root ||
  basename(output) !== "dist" ||
  resolve(process.cwd()) !== root
)
  throw new Error("Build must run from this game's project directory");
await rm(output, { recursive: true, force: true });
await viteBuild({ build: { outDir: "dist/client" } });
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await mkdir("dist/.openai", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
await writeFile(
  "dist/server/wrangler.json",
  JSON.stringify(
    {
      name: "velocity-coast",
      main: "index.js",
      compatibility_date: "2026-09-01",
      assets: { directory: "../client", binding: "ASSETS" },
      d1_databases: [
        {
          binding: "DB",
          database_name: "velocity-online",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "../.openai/drizzle",
        },
      ],
    },
    null,
    2,
  ),
);
