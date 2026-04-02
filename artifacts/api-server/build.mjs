import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Allow plugins to use require
globalThis.require = createRequire(import.meta.url);

// Current folder
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const srcFile = path.resolve(artifactDir, "src/index.ts");
const distDir = path.resolve(artifactDir, "dist");

async function build() {
  // Clean previous build
  await rm(distDir, { recursive: true, force: true });

  // Build with esbuild
  await esbuild({
    entryPoints: [srcFile],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "linked",
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
    ],
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
    },
  });

  console.log("Build completed. dist/index.mjs is ready.");
}

build().catch(err => {
  console.error("Build failed:", err);
  process.exit(1);
});