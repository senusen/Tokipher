# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub instead: go to the repository's **Security** tab and click **Report a vulnerability**. Include what you found, how to reproduce it, and which version or commit you tested.

You should get a reply within a week. Once a fix is released, the report can be made public.

## Supported versions

Only the latest release and the `main` branch get security fixes.

## Running Tokipher safely

- **Your `sp_dc` cookie is a login session for your Spotify account.** Anyone who has it can act as you on Spotify. Keep it in `.env` or your container's environment. Never commit it or paste it into an issue or log.
- **Set a `PASSWORD` whenever Tokipher is reachable from other machines.** By default it listens on `127.0.0.1` only. If you set `HOST=0.0.0.0`, or use the Docker image (which listens on all interfaces), anyone who can reach the port can get tokens and use your server's bandwidth unless a password is set.
- **Don't expose the port to the internet.** Put Tokipher on the same host or private network as Lavalink. For Docker, bind the port to localhost (`127.0.0.1:8001:8001`) or leave out `ports:` and use the compose network.
- The password can be sent as a `?password=` query parameter, because LavaSrc's `customTokenEndpoint` can't send headers. Query strings can end up in proxy logs, so use a password that isn't reused anywhere else.
