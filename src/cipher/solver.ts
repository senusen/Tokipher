import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import { logger } from "../log.ts";
import { Lru } from "../lru.ts";
import type { PlayerScript } from "./player.ts";
import { getPlayerFile } from "./playerCache.ts";

const log = logger("cipher");

const PREPROCESS_TIMEOUT_MS = 60_000;
const STS_PATTERN = /(?:signatureTimestamp|sts):(\d+)/;

export interface Solvers {
  n: ((value: string) => string) | null;
  sig: ((value: string) => string) | null;
}

// Keyed by the cached player file path (one entry per player version/variant).
const solverCache = new Lru<Solvers>(50);
const stsCache = new Lru<string>(150);
const building = new Map<string, Promise<Solvers>>();

export async function getSolvers(script: PlayerScript): Promise<Solvers> {
  const file = await getPlayerFile(script);
  const cached = solverCache.get(file);
  if (cached) return cached;

  let pending = building.get(file);
  if (!pending) {
    pending = buildSolvers(file, script)
      .then((solvers) => {
        solverCache.set(file, solvers);
        return solvers;
      })
      .finally(() => building.delete(file));
    building.set(file, pending);
  }
  return pending;
}

export async function getSts(script: PlayerScript): Promise<string | null> {
  const file = await getPlayerFile(script);
  const cached = stsCache.get(file);
  if (cached) return cached;

  const match = (await readFile(file, "utf8")).match(STS_PATTERN);
  if (!match?.[1]) return null;
  stsCache.set(file, match[1]);
  return match[1];
}

async function buildSolvers(file: string, script: PlayerScript): Promise<Solvers> {
  const started = Date.now();
  const prepared = await preprocessInWorker(await readFile(file, "utf8"));
  const solvers = loadPrepared(prepared, script.id);
  if (!solvers.n && !solvers.sig) {
    throw new Error(`Could not extract n/sig functions from player ${script.id} (${script.variant})`);
  }
  log.info(
    `Prepared solvers for player ${script.id} (${script.variant}) in ${Date.now() - started}ms` +
      ` [n: ${solvers.n ? "yes" : "no"}, sig: ${solvers.sig ? "yes" : "no"}]`,
  );
  return solvers;
}

function preprocessInWorker(player: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./preprocess.worker.ts", import.meta.url), { workerData: player });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Player preprocessing timed out"));
    }, PREPROCESS_TIMEOUT_MS);

    worker.once("message", (message: { ok: true; code: string } | { ok: false; error: string }) => {
      clearTimeout(timer);
      if (message.ok) resolve(message.code);
      else reject(new Error(`Player preprocessing failed: ${message.error}`));
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Preprocess worker exited with code ${code}`));
    });
  });
}

// ejs's getFromPrepared() evaluates the player code with Function() in the global scope, and
// that code defines globals (window, document, self, ...). Run it in its own V8 context instead
// so it cannot leak into this process (puppeteer and friends check some of those globals).
function loadPrepared(code: string, playerId: string): Solvers {
  const result: Solvers = { n: null, sig: null };
  const context = vm.createContext({ __solverResult: result });
  vm.runInContext(`(function (_result) {\n${code}\n})(__solverResult);`, context, {
    filename: `yt-player-${playerId}.js`,
    timeout: 10_000,
  });
  return result;
}
