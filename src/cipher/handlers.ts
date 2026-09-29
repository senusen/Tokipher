// yt-cipher compatible API (https://github.com/kikkia/yt-cipher), used by Lavalink's
// youtube-source `remoteCipher` option.

import { HttpError, optionalString, requireString } from "../http.ts";
import { resolvePlayerScript } from "./player.ts";
import { getSolvers, getSts } from "./solver.ts";

type Body = Record<string, unknown>;

function solve(fn: ((value: string) => string) | null, kind: string, value: string): string {
  if (!fn) throw new HttpError(500, `No ${kind} solver found for this player`);
  try {
    return fn(value);
  } catch (error) {
    throw new HttpError(500, `${kind} solver failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// POST /decrypt_signature { encrypted_signature?, n_param?, player_url }
export async function decryptSignature(body: Body) {
  const script = resolvePlayerScript(requireString(body, "player_url"));
  const encryptedSignature = optionalString(body, "encrypted_signature");
  const nParam = optionalString(body, "n_param");
  const solvers = await getSolvers(script);

  return {
    decrypted_signature: encryptedSignature && solvers.sig ? solve(solvers.sig, "sig", encryptedSignature) : "",
    decrypted_n_sig: nParam && solvers.n ? solve(solvers.n, "n", nParam) : "",
  };
}

// POST /get_sts { player_url }
export async function getSignatureTimestamp(body: Body) {
  const script = resolvePlayerScript(requireString(body, "player_url"));
  const sts = await getSts(script);
  if (!sts) throw new HttpError(404, "Timestamp not found in player script");
  return { sts };
}

// POST /resolve_url { stream_url, player_url, encrypted_signature?, signature_key?, n_param? }
export async function resolveUrl(body: Body) {
  const script = resolvePlayerScript(requireString(body, "player_url"));
  const streamUrl = requireString(body, "stream_url");
  const encryptedSignature = optionalString(body, "encrypted_signature");
  const signatureKey = optionalString(body, "signature_key");

  let url: URL;
  try {
    url = new URL(streamUrl);
  } catch {
    throw new HttpError(400, "'stream_url' is not a valid URL");
  }

  const solvers = await getSolvers(script);

  if (encryptedSignature) {
    const key = signatureKey || url.searchParams.get("sp") || "sig";
    url.searchParams.set(key, solve(solvers.sig, "sig", encryptedSignature));
    url.searchParams.delete("s");
  }

  const nParam = optionalString(body, "n_param") ?? url.searchParams.get("n");
  if (nParam && solvers.n) {
    url.searchParams.set("n", solve(solvers.n, "n", nParam));
  }

  return { resolved_url: url.toString() };
}
