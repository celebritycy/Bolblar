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
3. The **Release agent** workflow builds the obfuscated zip and attaches it to the release.

Obfuscation makes the code hard to read, not impossible to change. The real lock is the server-side licence check.
