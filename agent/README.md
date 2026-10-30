# Bolblar Agent — extension source

`src/` is the Chrome extension (Manifest V3). Load it unpacked from `chrome://extensions` while developing.

## Build

```sh
cd agent
npm ci
npm run build        # obfuscated zip for buyers  -> dist/Bolblar-Agent-<version>.zip
npm run build:dev    # readable zip for debugging -> dist/Bolblar-Agent-<version>-dev.zip
```

`node build.mjs --out <dir>` writes the zip somewhere else.

The obfuscated build:
- bundles the side-panel scripts into `panel/app.js` and obfuscates it, renaming shared names like the licence check;
- obfuscates `content/content.js` and `background.js`;
- copies `lib/` (third-party, already minified) unchanged;
- refuses to build if `panel/license-config.js` has an empty `api`, since that runs the agent unlocked.

If you add a script to `panel/panel.html`, add it to `PANEL_SCRIPTS` in `build.mjs` too (the build stops and tells you if they drift).

## Release

1. Bump `version` in `src/manifest.json`.
2. Publish a GitHub release tagged `v<version>` (e.g. `v1.0.1`).
3. The **Release agent** workflow builds the obfuscated zip and attaches it, with a `.sha256` file, to the release. It runs in the `release` environment: in GitHub, Settings, Environments, `release`, add yourself as a required reviewer so nothing reaches buyers without your approval.
4. Post the zip in the Telegram group yourself (only admins should be able to post files there) and pin the SHA-256 next to it. Buyers can check a zip with `shasum -a 256 Bolblar-Agent-<version>.zip` (Mac or Linux) or `certutil -hashfile Bolblar-Agent-<version>.zip SHA256` (Windows).
5. To show the update bar in the extension, set the server's `updateLink` to that GitHub release (the extension only opens links on github.com/celebritycy/bolblar/releases or bolblar.com) and, if you like, `sha256` to the checksum.

The build is reproducible: the obfuscator has a fixed seed and every file has a fixed date, so building the same tag again gives the same zip and the same SHA-256.

Obfuscation makes the code hard to read, not impossible to change, and this repository is public, so the readable source is too. The real lock is the server-side licence check: see docs/security-review-2026-10-29.md, section 9, for what the server must enforce.
