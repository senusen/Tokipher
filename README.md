# Tokipher

[![CI](https://github.com/senusen/Tokipher/actions/workflows/ci.yml/badge.svg)](https://github.com/senusen/Tokipher/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

One small Node.js service that gives Lavalink two things it normally gets from separate servers:

| Part | Replaces | Used by |
|---|---|---|
| **Spotify tokener**: `GET /api/token` | [topi314/spotify-tokener](https://github.com/topi314/spotify-tokener) | LavaSrc `spotify.customTokenEndpoint` |
| **YouTube cipher**: `POST /get_sts`, `/resolve_url`, `/decrypt_signature` | [kikkia/yt-cipher](https://github.com/kikkia/yt-cipher) | youtube-source `remoteCipher` |

**Spotify:** a headless browser opens open.spotify.com and captures the access token the web player fetches for itself. Unlike LavaSrc's built-in method, this doesn't break when Spotify changes its TOTP secret. With your `sp_dc` cookie you get an account token as well (LavaSrc needs it for Spotify lyrics). Tokens are cached and refreshed in the background before they expire, so LavaSrc always gets an answer in a few milliseconds. LavaSrc stops waiting after about 3 seconds, and a fresh browser fetch takes about that long.

**YouTube:** YouTube player scripts are solved with [yt-dlp/ejs](https://github.com/yt-dlp/ejs), the solver behind yt-cipher. The API and responses are the same as yt-cipher's. Player scripts are cached on disk. The heavy parsing runs in a worker thread, and the extracted solver functions run in their own V8 context.

## Requirements

- Node.js 22.18+ (it runs the TypeScript sources directly, with no build step)
- Chrome, Chromium, Edge or Brave. On Windows, Edge is always installed and is found automatically. On a Linux server: `sudo apt install chromium`.

## Setup

```bash
git clone https://github.com/senusen/Tokipher.git
cd Tokipher
npm install
cp .env.example .env    # then set PASSWORD (and SPOTIFY_SP_DC)
npm start
```

Check it: `curl http://127.0.0.1:8001/health`

## Lavalink config

```yaml
plugins:
  youtube:
    remoteCipher:
      url: http://127.0.0.1:8001/
      password: <PASSWORD from .env>
  lavasrc:
    spotify:
      spDc: <your sp_dc cookie>
      # LavaSrc calls this URL as-is, so the password goes in the query string.
      customTokenEndpoint: http://127.0.0.1:8001/api/token?password=<PASSWORD from .env>
      # Loads Spotify-made playlists (Daily Mix, Discover Weekly, This Is, editorial) through
      # the web-player API, which needs the tokens from this service.
      preferPartnerApi: true
```

Start Tokipher before Lavalink, or at least before the first track plays.

## Docker

Prebuilt images for amd64 and arm64 are published to `ghcr.io/senusen/tokipher`:

| Tag | Built from |
|---|---|
| `latest` | every push to `main` |
| `1.2.3`, `1.2` | version tags (`v1.2.3`) |

Copy [compose.yml](compose.yml) to your server, set `PASSWORD` (and `SPOTIFY_SP_DC` if you use lyrics), then:

```sh
docker compose up -d
```

The compose file publishes the port on `127.0.0.1` only. If Lavalink runs in the same compose project, you can remove `ports:` and point Lavalink at `http://tokipher:8001/`.

To build the image yourself: `docker build -t tokipher .`

## Configuration

All settings are environment variables, optionally set in `.env`. See [.env.example](.env.example) for the full list with descriptions. The main ones:

| Variable | Default | |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8001` | Use `HOST=0.0.0.0` only together with a `PASSWORD` |
| `PASSWORD` | *(none)* | `Authorization` header or `?password=` query param |
| `SPOTIFY_SP_DC` | *(none)* | Fetch the account token at startup |
| `BROWSER_PATH` | auto-detect | Path to the browser executable |
| `CIPHER_PLAYER_VARIANT` | `IAS` | The variant yt-cipher recommends; `auto` uses the requested one |

## API

| Endpoint | Body / input | Response |
|---|---|---|
| `GET /` or `/health` | none (no password needed) | status info |
| `GET /api/token` | optional `Cookie: sp_dc=...` | Spotify's own token JSON: `accessToken`, `accessTokenExpirationTimestampMs`, `isAnonymous`, `clientId` |
| `POST /get_sts` | `{ player_url }` | `{ sts }` |
| `POST /resolve_url` | `{ stream_url, player_url, encrypted_signature?, signature_key?, n_param? }` | `{ resolved_url }` |
| `POST /decrypt_signature` | `{ player_url, encrypted_signature?, n_param? }` | `{ decrypted_signature, decrypted_n_sig }` |

Errors come back as `{ "error": "..." }` with a 4xx or 5xx status.

## When YouTube breaks playback

YouTube changes its player scripts regularly. When yt-dlp updates its solver:

```bash
npm run update-ejs            # latest yt-dlp/ejs
npm run update-ejs -- <sha>   # or a specific commit
```

Then restart. The script downloads the solver into `vendor/ejs`, warns if its `meriyah`/`astring` versions changed, and checks that it still loads.

## Layout

```
src/server.ts            HTTP server, routing, password check, startup/shutdown
src/config.ts            environment variables
src/spotify/browser.ts   finds/launches the headless browser, closes it when idle
src/spotify/tokener.ts   token capture, cache, background refresh
src/cipher/player.ts     player URL parsing, variant overrides
src/cipher/playerCache.ts   on-disk player script cache
src/cipher/solver.ts     preprocessing worker + sandboxed solver functions
src/cipher/handlers.ts   the three yt-cipher endpoints
vendor/ejs/              yt-dlp/ejs solver (Unlicense), updated by scripts/update-ejs.ts
```

## Security

Your `sp_dc` cookie is a login session for your Spotify account, so treat it like a password. Keep Tokipher on the same host or private network as Lavalink, and set a `PASSWORD` whenever it listens on anything other than `127.0.0.1`. See [SECURITY.md](SECURITY.md) for details and for how to report vulnerabilities.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [yt-dlp/ejs](https://github.com/yt-dlp/ejs): the YouTube signature and n-parameter solver, vendored in `vendor/ejs`.
- [kikkia/yt-cipher](https://github.com/kikkia/yt-cipher): the cipher API is compatible with it, and the player-variant handling is based on it.
- [topi314/spotify-tokener](https://github.com/topi314/spotify-tokener): the original idea of capturing the web player's token with a headless browser.

## Disclaimer

Tokipher is an independent project. It is not affiliated with, endorsed by, or sponsored by Spotify, YouTube or Google. It works by automating their public web players. Using it may be against their Terms of Service, and it can stop working whenever they change something. You are responsible for how you use it.

## License

[MIT](LICENSE). The vendored solver in [vendor/ejs](vendor/ejs) is from yt-dlp/ejs and is released under [the Unlicense](vendor/ejs/LICENSE).
