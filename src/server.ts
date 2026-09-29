import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decryptSignature, getSignatureTimestamp, resolveUrl } from "./cipher/handlers.ts";
import { initPlayerCache } from "./cipher/playerCache.ts";
import { config } from "./config.ts";
import { HttpError, readJsonBody, sendJson } from "./http.ts";
import { errorMessage, logger } from "./log.ts";
import { closeBrowser, findBrowser } from "./spotify/browser.ts";
import { getToken, parseCookieHeader, prewarm } from "./spotify/tokener.ts";

const log = logger("server");

const ejsVersion = JSON.parse(readFileSync(new URL("../vendor/ejs/VERSION.json", import.meta.url), "utf8"));

const cipherRoutes: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
  "/decrypt_signature": decryptSignature,
  "/get_sts": getSignatureTimestamp,
  "/resolve_url": resolveUrl,
};

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (!config.password) return true;
  const given = req.headers.authorization ?? url.searchParams.get("password") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(config.password);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && (path === "/" || path === "/health")) {
    sendJson(res, 200, {
      name: "tokipher",
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      spotify: config.spotify.enabled ? { endpoint: "GET /api/token" } : false,
      cipher: config.cipher.enabled
        ? { endpoints: Object.keys(cipherRoutes).map((p) => `POST ${p}`), ejs: ejsVersion.sha.slice(0, 7) }
        : false,
    });
    return;
  }

  if (!isAuthorized(req, url)) {
    throw new HttpError(401, req.headers.authorization || url.searchParams.has("password") ? "Invalid password" : "Missing password");
  }

  if (path === "/api/token" && config.spotify.enabled) {
    if (req.method !== "GET") throw new HttpError(405, "Use GET");
    const { token, cached } = await getToken(parseCookieHeader(req.headers.cookie));
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
    sendJson(res, 200, token);
    return;
  }

  const cipherRoute = config.cipher.enabled ? cipherRoutes[path] : undefined;
  if (cipherRoute) {
    if (req.method !== "POST") throw new HttpError(405, "Use POST");
    sendJson(res, 200, await cipherRoute(await readJsonBody(req)));
    return;
  }

  throw new HttpError(404, "Not Found");
}

const server = createServer((req, res) => {
  const started = Date.now();
  handle(req, res)
    .catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) log.error(`${req.method} ${req.url?.split("?")[0]} failed: ${errorMessage(error)}`);
      if (!res.headersSent) sendJson(res, status, { error: errorMessage(error) });
      else res.destroy();
    })
    .finally(() => {
      log.debug(`${req.method} ${req.url?.split("?")[0]} -> ${res.statusCode} (${Date.now() - started}ms)`);
    });
});

if (config.spotify.enabled) {
  try {
    log.info(`Spotify tokener: using browser ${findBrowser()}`);
    void prewarm(new Map()).then(() =>
      config.spotify.spDc ? prewarm(new Map([["sp_dc", config.spotify.spDc]])) : undefined,
    );
  } catch (error) {
    log.error(`Spotify tokener: ${errorMessage(error)}`);
  }
}
if (config.cipher.enabled) {
  await initPlayerCache();
  log.info(`YouTube cipher: ejs ${ejsVersion.sha.slice(0, 7)} (${ejsVersion.date}), player variant ${config.cipher.playerVariant}`);
}
if (!config.password && config.host !== "127.0.0.1" && config.host !== "localhost") {
  log.warn(`Listening on ${config.host} without a PASSWORD: anyone who can reach this port can use it.`);
}

server.listen(config.port, config.host, () => {
  log.info(`Listening on http://${config.host}:${config.port}`);
});

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => log.error(`Unhandled rejection: ${errorMessage(error)}`));
