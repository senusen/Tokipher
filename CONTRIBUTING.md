# Contributing to Tokipher

Thanks for helping out. Bug reports, fixes and small improvements are all welcome.

## Before you start

- **Bugs:** open an issue with the bug report template. Include Tokipher's log output with `LOG_LEVEL=debug`, after removing your `sp_dc`, password and any tokens.
- **Bigger changes** (new endpoints, new dependencies, changing default behavior): open an issue first so we can agree on the approach before you spend time on it.
- **Security problems:** don't open an issue. See [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 22.18+ and a Chromium-based browser (only for the Spotify part).

```bash
git clone https://github.com/senusen/Tokipher.git
cd Tokipher
npm install
cp .env.example .env
npm start
```

There is no build step: Node runs the TypeScript sources directly using type stripping. This means only [erasable syntax](https://nodejs.org/api/typescript.html#type-stripping) is allowed: no `enum`, no `namespace`, no parameter properties. Relative imports must include the `.ts` extension.

To test only one half, set `SPOTIFY_ENABLED=false` or `CIPHER_ENABLED=false` in `.env`.

## Before opening a pull request

```bash
npm run typecheck
```

Then start the server and check that the part you changed still works. For example, `curl http://127.0.0.1:8001/health`, or play a track through Lavalink.

Pull requests should:

- Stay focused on one change. Separate fixes go in separate PRs.
- Match the existing code style: 2-space indentation, double quotes, small modules, comments that explain *why*.
- Not add runtime dependencies without a good reason. Tokipher tries to stay small.
- Update [README.md](README.md) and [.env.example](.env.example) if they add or change a setting or endpoint.

## Updating the YouTube solver

`vendor/ejs` is a copy of [yt-dlp/ejs](https://github.com/yt-dlp/ejs). Don't edit it by hand, because the next update overwrites it. To update it, run `npm run update-ejs` and commit the result together with any `meriyah`/`astring` version changes the script asks for.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
