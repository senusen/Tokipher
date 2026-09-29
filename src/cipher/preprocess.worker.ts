// Runs yt-dlp/ejs's player preprocessing (parse a multi-MB script, extract the n/sig
// functions) off the main thread so token and cipher requests keep being served.

import { parentPort, workerData } from "node:worker_threads";
import { preprocessPlayer } from "../../vendor/ejs/src/yt/solver/solvers.ts";

try {
  parentPort!.postMessage({ ok: true, code: preprocessPlayer(workerData as string) });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
