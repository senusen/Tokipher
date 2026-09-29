import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { config } from "../config.ts";
import { logger } from "../log.ts";

const log = logger("browser");

function candidatePaths(): string[] {
  const env = process.env;
  switch (process.platform) {
    case "win32": {
      const roots = [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].filter(Boolean) as string[];
      const apps = [
        ["Google", "Chrome", "Application", "chrome.exe"],
        ["Microsoft", "Edge", "Application", "msedge.exe"],
        ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
        ["Chromium", "Application", "chrome.exe"],
      ];
      return apps.flatMap((app) => roots.map((root) => join(root, ...app)));
    }
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ];
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
        "/usr/bin/brave-browser",
      ];
  }
}

export function findBrowser(): string {
  if (config.spotify.browserPath) {
    if (!existsSync(config.spotify.browserPath)) {
      throw new Error(`BROWSER_PATH does not exist: ${config.spotify.browserPath}`);
    }
    return config.spotify.browserPath;
  }
  const found = candidatePaths().find((path) => existsSync(path));
  if (!found) {
    throw new Error("No Chrome/Chromium/Edge/Brave found. Install one or set BROWSER_PATH.");
  }
  return found;
}

let browserPromise: Promise<Browser> | null = null;
let activeUses = 0;
let idleTimer: NodeJS.Timeout | undefined;

async function launch(): Promise<Browser> {
  const executablePath = findBrowser();
  const args = [
    "--disable-gpu",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-dev-shm-usage",
  ];
  // Chromium refuses to start as root without this, and its sandbox rarely works in containers.
  if (config.spotify.browserNoSandbox || process.getuid?.() === 0) args.push("--no-sandbox");

  const started = Date.now();
  const browser = await puppeteer.launch({ executablePath, headless: true, args });
  log.info(`Launched ${executablePath} in ${Date.now() - started}ms`);
  return browser;
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const current = launch();
    browserPromise = current;
    current.then(
      (browser) =>
        browser.on("disconnected", () => {
          if (browserPromise === current) browserPromise = null;
          log.debug("Browser disconnected");
        }),
      () => {
        if (browserPromise === current) browserPromise = null;
      },
    );
  }
  return browserPromise;
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  activeUses++;
  clearTimeout(idleTimer);
  try {
    return await fn(await getBrowser());
  } finally {
    activeUses--;
    if (activeUses === 0 && config.spotify.browserIdleMs > 0) {
      idleTimer = setTimeout(() => {
        log.debug("Closing idle browser");
        void closeBrowser();
      }, config.spotify.browserIdleMs);
      idleTimer.unref();
    }
  }
}

export async function closeBrowser(): Promise<void> {
  clearTimeout(idleTimer);
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  try {
    await (await current).close();
  } catch {
    // Already gone.
  }
}
