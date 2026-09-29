import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch {
  // No .env file: environment variables / defaults only.
}

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const value = Number.parseInt(str(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const value = str(name).toLowerCase();
  if (value === "") return fallback;
  return value === "true" || value === "1" || value === "yes";
}

export const config = {
  host: str("HOST", "127.0.0.1"),
  port: int("PORT", 8001),
  // Checked against the `Authorization` header or a `?password=` query param.
  password: str("PASSWORD"),
  logLevel: str("LOG_LEVEL", "info").toLowerCase(),

  spotify: {
    enabled: bool("SPOTIFY_ENABLED", true),
    // Chrome/Chromium/Edge/Brave executable. Auto-detected when empty.
    browserPath: str("BROWSER_PATH"),
    // Chromium's sandbox usually cannot start inside containers. Always on when running as root.
    browserNoSandbox: bool("BROWSER_NO_SANDBOX", false),
    timeoutMs: int("SPOTIFY_TIMEOUT_MS", 20_000),
    // Close the headless browser after this long without token requests (0 = keep it open).
    browserIdleMs: int("SPOTIFY_BROWSER_IDLE_MS", 5 * 60_000),
    // Keep refreshing a token in the background until nobody has asked for it this long.
    keepWarmMs: int("SPOTIFY_KEEP_WARM_HOURS", 12) * 60 * 60_000,
    // Optional: your sp_dc cookie, so the account token (used for Spotify lyrics) is ready at startup.
    spDc: str("SPOTIFY_SP_DC"),
  },

  cipher: {
    enabled: bool("CIPHER_ENABLED", true),
    // Fetch this player variant instead of the one requested. yt-cipher recommends IAS.
    // "auto" keeps whatever variant the client asked for.
    playerVariant: str("CIPHER_PLAYER_VARIANT", "IAS").toUpperCase(),
    // Force a specific player script ID (8 chars). Empty = use the requested one.
    playerId: str("CIPHER_PLAYER_ID"),
    // Treat regional copies of the same player version as one cache entry.
    ignoreScriptRegion: bool("CIPHER_IGNORE_SCRIPT_REGION", false),
    cacheDir: str("CIPHER_CACHE_DIR", join(ROOT, "cache", "players")),
  },
};
