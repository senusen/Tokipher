// YouTube player scripts (~1-3 MB each) cached on disk, one file per player version.

import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { errorMessage, logger } from "../log.ts";
import { type PlayerScript, playerScriptUrl } from "./player.ts";

const log = logger("cipher");

const STALE_AFTER_MS = 14 * 24 * 60 * 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const downloads = new Map<string, Promise<void>>();

function cacheFile(script: PlayerScript, url: string): string {
  const key = config.cipher.ignoreScriptRegion
    ? `${script.id}-${script.variant}`
    : createHash("sha256").update(url).digest("hex").slice(0, 32);
  return join(config.cipher.cacheDir, `${key}.js`);
}

/** Returns the path of the cached player script, downloading it first if needed. */
export async function getPlayerFile(script: PlayerScript): Promise<string> {
  const url = playerScriptUrl(script);
  const file = cacheFile(script, url);

  try {
    await stat(file);
    const now = new Date();
    await utimes(file, now, now).catch(() => {}); // mtime = last used, for cleanup
    return file;
  } catch {
    // Not cached yet.
  }

  let pending = downloads.get(file);
  if (!pending) {
    pending = download(url, file).finally(() => downloads.delete(file));
    downloads.set(file, pending);
  }
  await pending;
  return file;
}

async function download(url: string, file: string): Promise<void> {
  const started = Date.now();
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Failed to fetch player ${url}: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, content);
  await rename(temp, file);
  log.info(`Downloaded player ${url} (${Math.round(content.length / 1024)} KB, ${Date.now() - started}ms)`);
}

export async function initPlayerCache(): Promise<void> {
  await mkdir(config.cipher.cacheDir, { recursive: true });
  let kept = 0;
  for (const name of await readdir(config.cipher.cacheDir)) {
    const file = join(config.cipher.cacheDir, name);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      if (name.endsWith(".tmp") || Date.now() - info.mtimeMs > STALE_AFTER_MS) {
        await rm(file, { force: true });
        log.debug(`Removed stale cache file ${name}`);
      } else {
        kept++;
      }
    } catch (error) {
      log.warn(`Could not check cache file ${name}: ${errorMessage(error)}`);
    }
  }
  log.info(`Player cache: ${config.cipher.cacheDir} (${kept} scripts)`);
}
