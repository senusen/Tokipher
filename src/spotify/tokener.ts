// Gets Spotify web-player access tokens by letting a real (headless) browser open
// open.spotify.com and capturing the /api/token response it makes. This keeps working
// when Spotify rotates the TOTP secrets that LavaSrc's built-in token code depends on.
// Same idea as https://github.com/topi314/spotify-tokener.

import { createHash } from "node:crypto";
import type { HTTPRequest } from "puppeteer-core";
import { config } from "../config.ts";
import { errorMessage, logger } from "../log.ts";
import { withBrowser } from "./browser.ts";

const log = logger("spotify");

const SPOTIFY_URL = "https://open.spotify.com/";
const TOKEN_URL_PREFIX = "https://open.spotify.com/api/token";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
// The token request is made by the page's scripts; nothing else needs to load.
const BLOCKED_RESOURCES = new Set(["image", "media", "font", "stylesheet", "texttrack", "manifest"]);
// Refresh a token in the background once it has less than this left.
const REFRESH_BEFORE_MS = 5 * 60_000;
// Don't hand out a token that expires sooner than this, unless it was just fetched (see SAME_TOKEN_RETRY_MS).
const MIN_VALID_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
// Spotify keeps handing out the same token until it is about to expire, so a refresh in the last
// REFRESH_BEFORE_MS gets back a token that is due for refresh again right away. Wait this long
// (or until just after it expires) before trying again, instead of opening the browser back to back.
const SAME_TOKEN_RETRY_MS = 60_000;

export interface SpotifyToken {
  accessToken: string;
  accessTokenExpirationTimestampMs: number;
  isAnonymous?: boolean;
  clientId?: string;
  [key: string]: unknown;
}

// One entry per cookie set (anonymous = no cookies). Tokens are kept warm so requests are
// answered from cache: LavaSrc gives up on the token endpoint after ~3s, and a browser
// fetch takes about that long.
interface Entry {
  cookies: Map<string, string>;
  token?: SpotifyToken;
  lastRequested: number;
  lastFetched?: number;
  pending?: Promise<SpotifyToken>;
  timer?: NodeJS.Timeout;
}

const entries = new Map<string, Entry>();

function cacheKey(cookies: Map<string, string>): string {
  if (cookies.size === 0) return "anonymous";
  const serialized = [...cookies].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(";");
  return createHash("sha256").update(serialized).digest("hex");
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && value) cookies.set(name, value);
  }
  return cookies;
}

export async function getToken(cookies: Map<string, string>): Promise<{ token: SpotifyToken; cached: boolean }> {
  const key = cacheKey(cookies);
  let entry = entries.get(key);
  if (!entry) {
    entry = { cookies, lastRequested: 0 };
    entries.set(key, entry);
  }
  entry.lastRequested = Date.now();

  const remaining = (entry.token?.accessTokenExpirationTimestampMs ?? 0) - Date.now();
  // A token fetched in the last SAME_TOKEN_RETRY_MS is the newest Spotify will give, even with little time left.
  const fetchedRecently = Date.now() - (entry.lastFetched ?? 0) < SAME_TOKEN_RETRY_MS;
  if (entry.token && (remaining > MIN_VALID_MS || (remaining > 0 && fetchedRecently))) {
    if (remaining < REFRESH_BEFORE_MS && !fetchedRecently) void refresh(key, entry).catch(() => {});
    return { token: entry.token, cached: true };
  }
  return { token: await refresh(key, entry), cached: false };
}

/** Fetches tokens ahead of time so the first real request is answered from cache. */
export function prewarm(cookies: Map<string, string>): Promise<unknown> {
  return getToken(cookies).catch((error) => log.warn(`Prewarm failed: ${errorMessage(error)}`));
}

function refresh(key: string, entry: Entry): Promise<SpotifyToken> {
  entry.pending ??= fetchToken(entry.cookies)
    .then((token) => {
      entry.token = token;
      entry.lastFetched = Date.now();
      schedule(key, entry, nextRefreshDelay(token));
      return token;
    })
    .catch((error) => {
      log.error(`Token fetch failed: ${errorMessage(error)}`);
      if (entry.token) schedule(key, entry, RETRY_AFTER_FAILURE_MS);
      throw error;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}

function nextRefreshDelay(token: SpotifyToken): number {
  const remaining = token.accessTokenExpirationTimestampMs - Date.now();
  if (remaining > REFRESH_BEFORE_MS) return remaining - REFRESH_BEFORE_MS;
  // Already inside the refresh window: most likely Spotify returned the token it had handed out before.
  return Math.max(Math.min(SAME_TOKEN_RETRY_MS, remaining + 1_000), 5_000);
}

function schedule(key: string, entry: Entry, delayMs: number): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    // Stop refreshing tokens nobody has asked for in a while.
    if (Date.now() - entry.lastRequested > config.spotify.keepWarmMs) {
      entries.delete(key);
      log.debug(`Dropped unused ${entry.token?.isAnonymous === false ? "account" : "anonymous"} token`);
      return;
    }
    void refresh(key, entry).catch(() => {});
  }, Math.max(delayMs, 0));
  entry.timer.unref();
}

async function fetchToken(cookies: Map<string, string>): Promise<SpotifyToken> {
  const started = Date.now();
  const timeout = config.spotify.timeoutMs;

  const token = await withBrowser(async (browser) => {
    // A fresh incognito context per request so anonymous and account cookies never mix.
    const context = await browser.createBrowserContext();
    try {
      if (cookies.size > 0) {
        await context.setCookie(
          ...[...cookies].map(([name, value]) => ({
            name,
            value,
            domain: ".spotify.com",
            path: "/",
            secure: true,
            httpOnly: true,
          })),
        );
      }

      const page = await context.newPage();
      await page.setUserAgent({ userAgent: USER_AGENT });
      await page.setRequestInterception(true);
      page.on("request", (request: HTTPRequest) => {
        if (request.isInterceptResolutionHandled()) return;
        if (BLOCKED_RESOURCES.has(request.resourceType())) void request.abort();
        else void request.continue();
      });

      const tokenResponse = page.waitForResponse(
        (response) => response.url().startsWith(TOKEN_URL_PREFIX) && response.request().method() === "GET",
        { timeout },
      );
      // Navigation only matters if it fails; the token request fires from scripts after load.
      const navigationFailure = page.goto(SPOTIFY_URL, { waitUntil: "domcontentloaded", timeout }).then(
        () => new Promise<never>(() => {}),
        (error) => {
          throw new Error(`Could not open ${SPOTIFY_URL}: ${errorMessage(error)}`);
        },
      );
      navigationFailure.catch(() => {});

      const response = await Promise.race([tokenResponse, navigationFailure]);
      const body = await response.text();
      if (!response.ok()) {
        throw new Error(`Spotify answered ${response.status()}: ${body.slice(0, 200)}`);
      }
      const payload = JSON.parse(body) as SpotifyToken;
      if (typeof payload.accessToken !== "string" || typeof payload.accessTokenExpirationTimestampMs !== "number") {
        throw new Error(`Unexpected token payload: ${body.slice(0, 200)}`);
      }
      return payload;
    } finally {
      await context.close().catch(() => {});
    }
  });

  const minutes = Math.round((token.accessTokenExpirationTimestampMs - Date.now()) / 60_000);
  log.info(
    `Fetched ${token.isAnonymous === false ? "account" : "anonymous"} token in ${Date.now() - started}ms (valid ~${minutes} min)`,
  );
  return token;
}
