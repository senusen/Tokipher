import { config } from "./config.ts";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[config.logLevel as Level] ?? LEVELS.info;

function write(level: Level, scope: string, message: string, extra: unknown[]) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(line, ...extra);
}

export function logger(scope: string) {
  return {
    debug: (message: string, ...extra: unknown[]) => write("debug", scope, message, extra),
    info: (message: string, ...extra: unknown[]) => write("info", scope, message, extra),
    warn: (message: string, ...extra: unknown[]) => write("warn", scope, message, extra),
    error: (message: string, ...extra: unknown[]) => write("error", scope, message, extra),
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
