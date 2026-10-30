// Builds the Bolblar Agent extension zip from src/.
//
//   node build.mjs               obfuscated build (default, for buyers)
//   node build.mjs --no-minify   readable build (for debugging)
//   node build.mjs --out <dir>   write the zip somewhere other than dist/
//
// The obfuscated build bundles the side-panel scripts into one file so their shared
// names (BBLicense, BB_LICENSE_CONFIG, ...) can be renamed too, then obfuscates it,
// the content script and the service worker. Files under lib/ are already minified
// third-party code and are copied as-is.

import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import JSZip from 'jszip';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');

const args = process.argv.slice(2);
const minify = !args.includes('--no-minify');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'dist');
const STAGE = path.join(OUT, 'Bolblar-Agent');

// Panel scripts in the order panel.html loads them (lib/ scripts excluded).
const PANEL_SCRIPTS = [
  'presets.js', 'parse.js', 'ai.js', 'cast.js', 'compose.js',
  'store.js', 'engine.js', 'license-config.js', 'license.js', 'panel.js',
];
const PANEL_BUNDLE = 'app.js';

// No eval/new Function anywhere: Manifest V3 pages block them.
const OBFUSCATOR_OPTIONS = {
  compact: true,
  target: 'browser',
  identifierNamesGenerator: 'hexadecimal',
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.15,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  transformObjectKeys: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  unicodeEscapeSequence: false,
  // A fixed seed makes the same commit build the same zip, so the SHA-256 printed with a release can be checked by anyone
  // who builds it again (security review EXT-09, SITE-05).
  seed: 20261030,
};

const obfuscate = (code, extra = {}) =>
  JavaScriptObfuscator.obfuscate(code, { ...OBFUSCATOR_OPTIONS, ...extra }).getObfuscatedCode();

async function checkLicenseConfig() {
  const cfg = await readFile(path.join(SRC, 'panel', 'license-config.js'), 'utf8');
  const api = /api:\s*'([^']*)'/.exec(cfg);
  if (!api || !api[1]) {
    throw new Error('panel/license-config.js has an empty "api": the agent would run unlocked. Set it before building a release.');
  }
}

async function buildPanel() {
  const dir = path.join(STAGE, 'panel');
  const parts = await Promise.all(PANEL_SCRIPTS.map((f) => readFile(path.join(dir, f), 'utf8')));
  const bundle = parts.map((code, i) => `// ${PANEL_SCRIPTS[i]}\n${code};\n`).join('\n');
  await writeFile(path.join(dir, PANEL_BUNDLE), obfuscate(bundle, { renameGlobals: true }));
  await Promise.all(PANEL_SCRIPTS.map((f) => rm(path.join(dir, f))));

  const htmlPath = path.join(dir, 'panel.html');
  let html = await readFile(htmlPath, 'utf8');
  for (const f of PANEL_SCRIPTS) {
    const tag = `<script src="${f}"></script>`;
    if (!html.includes(tag)) throw new Error(`panel.html no longer loads ${f}; update PANEL_SCRIPTS in build.mjs`);
    html = html.replace(`${tag}\n`, '').replace(tag, '');
  }
  html = html.replace('</body>', `<script src="${PANEL_BUNDLE}"></script>\n</body>`);
  await writeFile(htmlPath, html);
}

async function obfuscateFile(rel) {
  const file = path.join(STAGE, rel);
  await writeFile(file, obfuscate(await readFile(file, 'utf8')));
}

async function addDir(zip, dir, prefix) {
  for (const name of (await readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if ((await stat(full)).isDirectory()) await addDir(zip, full, rel);
    else zip.file(rel, await readFile(full), { date: new Date('2020-01-01T00:00:00Z'), createFolders: false }); // no folder entries stamped with today's time
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.json'), 'utf8'));
  if (minify) await checkLicenseConfig();

  await rm(STAGE, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, STAGE, { recursive: true, filter: (p) => !/(^|[/\\])(\.DS_Store|__MACOSX)$/.test(p) });

  if (minify) {
    await buildPanel();
    await obfuscateFile('content/content.js');
    await obfuscateFile('background.js');
  }

  const zip = new JSZip();
  await addDir(zip, STAGE, 'Bolblar-Agent');
  const name = `Bolblar-Agent-${manifest.version}${minify ? '' : '-dev'}.zip`;
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  await writeFile(path.join(OUT, name), buf);
  console.log(`Built ${path.relative(process.cwd(), path.join(OUT, name))} (${minify ? 'obfuscated' : 'readable'}, ${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(`Build failed: ${e.message}`); process.exit(1); });
