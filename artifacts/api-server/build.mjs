import { build as esbuild } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "linked",
    logLevel: "info",
  });
}

buildAll().catch(err => {
  console.error(err);
  process.exit(1);
});