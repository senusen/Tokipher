import { config } from "../config.ts";
import { HttpError } from "../http.ts";
import { logger } from "../log.ts";

const log = logger("cipher");

interface VariantPattern {
  variant: string;
  match: RegExp;
  // Path of this variant's script for a region. Embed players are fetched as their IAS/ES6 twins.
  build: (region: string) => string;
}

// Variant list and URL patterns from yt-cipher (https://github.com/kikkia/yt-cipher/blob/master/src/player.ts).
const VARIANTS: VariantPattern[] = [
  { variant: "IAS", match: /^player_ias\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_ias.vflset/${r}/base.js` },
  { variant: "IAS_TCC", match: /^player_ias_tcc\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_ias_tcc.vflset/${r}/base.js` },
  { variant: "IAS_TCE", match: /^player_ias_tce\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_ias_tce.vflset/${r}/base.js` },
  { variant: "ES5", match: /^player_es5\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_es5.vflset/${r}/base.js` },
  { variant: "ES6", match: /^player_es6\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_es6.vflset/${r}/base.js` },
  { variant: "ES6_TCC", match: /^player_es6_tcc\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_es6_tcc.vflset/${r}/base.js` },
  { variant: "ES6_TCE", match: /^player_es6_tce\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_es6_tce.vflset/${r}/base.js` },
  { variant: "PHONE", match: /^player-plasma-ias-phone-([a-zA-Z_]+)\.vflset\/base\.js$/, build: (r) => `player-plasma-ias-phone-${r}.vflset/base.js` },
  { variant: "TV", match: /^tv-player-ias\.vflset\/tv-player-ias\.js$/, build: () => "tv-player-ias.vflset/tv-player-ias.js" },
  { variant: "TV_ES6", match: /^tv-player-es6\.vflset\/tv-player-es6\.js$/, build: () => "tv-player-es6.vflset/tv-player-es6.js" },
  { variant: "EMBED", match: /^player_embed\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_ias.vflset/${r}/base.js` },
  { variant: "EMBED_ES6", match: /^player_embed_es6\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `player_es6.vflset/${r}/base.js` },
  { variant: "HOUSE", match: /^house_brand_player\.vflset\/([a-zA-Z_]+)\/base\.js$/, build: (r) => `house_brand_player.vflset/${r}/base.js` },
];

export const PLAYER_VARIANTS = VARIANTS.map((v) => v.variant);

export interface PlayerScript {
  id: string;
  variant: string;
  region: string | null;
}

export function parsePlayerUrl(playerUrl: string): PlayerScript {
  let path: string;
  try {
    path = new URL(playerUrl, "https://www.youtube.com").pathname;
  } catch {
    throw new HttpError(400, `Invalid player URL: ${playerUrl}`);
  }
  const parts = path.split("/");
  const index = parts.indexOf("player");
  const id = index === -1 ? undefined : parts[index + 1];
  if (!id || !/^[a-zA-Z0-9_-]{8}$/.test(id)) {
    throw new HttpError(400, `Invalid player URL: ${playerUrl}`);
  }

  const variantPath = parts.slice(index + 2).join("/");
  for (const pattern of VARIANTS) {
    const match = variantPath.match(pattern.match);
    if (match) return { id, variant: pattern.variant, region: match[1] ?? null };
  }
  log.warn(`Unknown player variant in ${playerUrl}, treating it as IAS`);
  return { id, variant: "IAS", region: null };
}

/** Parses the requested player URL and applies the CIPHER_PLAYER_ID / CIPHER_PLAYER_VARIANT overrides. */
export function resolvePlayerScript(playerUrl: string): PlayerScript {
  const script = parsePlayerUrl(playerUrl);
  if (config.cipher.playerId) script.id = config.cipher.playerId;
  if (config.cipher.playerVariant !== "AUTO") script.variant = config.cipher.playerVariant;
  return script;
}

export function playerScriptUrl(script: PlayerScript): string {
  const pattern = VARIANTS.find((v) => v.variant === script.variant);
  if (!pattern) throw new Error(`Unknown player variant: ${script.variant}`);
  return `https://www.youtube.com/s/player/${script.id}/${pattern.build(script.region ?? "en_US")}`;
}
