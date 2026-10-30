// Bolblar Agent panel controller.
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const safeName = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'batch';
const IS_OVERLAY = new URLSearchParams(location.search).get('mode') === 'overlay';
// Shown inside a page, the panel must be Google Flow's own overlay: any other page that frames it (to trick clicks on its
// buttons) gets an empty frame (security review EXT-05). The side panel is not framed, so this does not apply there.
const FLOW_ORIGINS = ['https://labs.google', 'https://flow.google.com'];
const FRAME_PARENT = (() => {
  if (window.top === window) return '';
  const a = location.ancestorOrigins, o = a && a.length ? a[0] : '';
  return IS_OVERLAY && FLOW_ORIGINS.includes(o) ? o : null;
})();
if (FRAME_PARENT === null) { document.documentElement.textContent = ''; throw new Error('Bolblar panel: framed outside Google Flow'); }
const UA = navigator.userAgent;
const DEVICE = {
  ios: /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1),
  android: /Android/.test(UA)
};
// Phones in "Desktop site" mode report a desktop browser; a touch only screen still gives them away.
if (!DEVICE.ios && !DEVICE.android && navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) DEVICE.android = true;
DEVICE.mobile = DEVICE.ios || DEVICE.android;
DEVICE.name = DEVICE.ios ? 'iPhone / iPad' : DEVICE.android ? 'Android' : 'Desktop';
const canShareFiles = () => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; } };

const DEFAULTS = {
  batchId: uid(), batchName: 'video_1', secs: 5, slides: [], review: [], sheets: [], cast: [],
  hero: { presetId: 'none', name: '', spec: '', lockMode: 'smart', attach: 'off', refImage: '', custom: [] },
  style: { id: 'stickman', prefix: null, suffix: null, enforce: true, avoid: 'readable text, captions, logos, watermarks, extra fingers' },
  settings: { engine: 'standard', conc: 1, perPrompt: 0, gap: 12, restEvery: 25, restMins: 2, paced2: true, timeout: 180, trustOrder: false, retries: 1, dailyCap: 0,
              multiline: false, ping: true, autoDl: true, nameFormat: 'slide-time', folder: 'Bolblar' },
  mother: { min: 5, max: 8, wps: 2.5, extra: '', paced: true },
  anim: { level: 'light' },
  auto: { on: true },
  ui: { mode: 'guide', step: 1 },
  myStyles: [], ownDraft: [], channel: { chars: [] },
  flow: { model: '', ratio: '', count: 0 }
};
let S = structuredClone(DEFAULTS);
const R = { running: false, paused: false, stopping: false, safe: false, unmatched: 0, lastUnmatched: 0, useCdp: false, lastSubmit: 0, submitted: 0, durations: [], filter: 'all', open: null };

// ---------- persistence ----------
async function load() {
  const { bb_state } = await chrome.storage.local.get('bb_state');
  if (bb_state) {
    S = { ...structuredClone(DEFAULTS), ...bb_state };
    for (const k of ['hero', 'style', 'settings', 'mother', 'flow', 'anim', 'auto', 'ui']) S[k] = { ...DEFAULTS[k], ...(bb_state[k] || {}) };
    for (const s of S.slides) if (s.status === 'creating') s.status = 'pending'; // panel was closed mid-run
    S.sheetJob = null;
  } else if (DEVICE.mobile) {
    S.settings.autoDl = !DEVICE.ios; // iPhone saves through the share sheet at the end
    S.settings.gap = 12;
  }
  // Calmer pace for everyone: old 6 or 8 second gaps move to 12, and a short rest every 25 images.
  if (!S.settings.paced2) { if (+S.settings.gap < 12) S.settings.gap = 12; S.settings.restEvery = 25; S.settings.restMins = 2; S.settings.paced2 = true; }
  // Old default pacing (3 to 6 seconds) made too many images: move it to Normal once.
  if (!S.mother.paced) { if (S.mother.min === 3 && S.mother.max === 6) Object.assign(S.mother, { min: 5, max: 8 }); S.mother.paced = true; }
  // "Needs a home" is gone: slides that waited there count as skipped, so Redo or Retry brings them back.
  (S.slides || []).forEach((x) => { if (x.status === 'review') { x.status = 'skipped'; x.error = 'Skipped. Tap Redo to make it again.'; } });
  if (!S.channel || !Array.isArray(S.channel.chars)) S.channel = { chars: [] };
  // Pacing is one exact number of seconds per image now (1 to 12), not a range.
  if (!S.mother.exact) {
    const was = +S.mother.min === 5 && +S.mother.max === 8 ? 6 : Math.round(((+S.mother.min || 5) + (+S.mother.max || 8)) / 2);
    const n = Math.max(1, Math.min(12, was));
    Object.assign(S.mother, { secs: n, min: n, max: n, exact: true });
  }
  // No hero by default. Older installs that still carry the untouched stickman default get it cleared once.
  if (!S.hero.noDefault) {
    if (S.hero.presetId === 'stickman' && S.hero.spec === BB_HEROES[0].spec) Object.assign(S.hero, { presetId: 'none', spec: '', name: '' });
    S.hero.noDefault = true;
  }
  // Kept simple on purpose: Flow's own settings decide model, size and images per prompt;
  // one prompt at a time keeps every file name right; the engine is picked automatically.
  Object.assign(S.settings, { conc: 1, perPrompt: 0, trustOrder: false, multiline: false, timeout: 180, retries: 1,
    engine: !DEVICE.mobile && BBEngine.hasDebuggerApi() ? 'precision' : 'standard' });
}
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { const { sheetJob, ...rest } = S; chrome.storage.local.set({ bb_state: rest }); }, 250); }

// ---------- feedback ----------
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
function log(m) { const l = $('log'); l.textContent = `${new Date().toLocaleTimeString()}  ${m}\n` + l.textContent.slice(0, 12000); }
function banner(m) { const b = $('banner'); b.hidden = !m; b.textContent = m || ''; }
function beep() {
  try {
    const a = new AudioContext(); const o = a.createOscillator(); const g = a.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.12, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.6);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.6);
  } catch (e) {}
}

const cfg = () => S;
const jobs = () => (S.sheetJob ? [...S.slides, S.sheetJob] : S.slides);
const perPrompt = () => +S.settings.perPrompt || +S.flow.count || 1;
const send = (m) => BBEngine.send(m);

function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
}

// ---------- Flow connection ----------
async function checkConn() {
  const pill = $('conn');
  try {
    const r = await send({ type: 'ping' });
    if (r && r.ok) {
      if (r.prompt) mergeFlow(r);
      pill.className = 'pill ' + (r.prompt ? 'ok' : 'bad');
      pill.querySelector('span').textContent = r.prompt ? 'Flow ready' : 'Open a project';
      renderChips();
      return r;
    }
  } catch (e) {}
  pill.className = 'pill bad'; pill.querySelector('span').textContent = 'Open Flow';
  return null;
}
// Take every setting Flow clearly shows; a value Flow doesn't show right now (null) keeps the last one.
function mergeFlow(r) {
  for (const k of ['model', 'ratio', 'count', 'mode', 'credits', 'vkind', 'res', 'secs']) if (r[k] !== null && r[k] !== undefined && r[k] !== '') S.flow[k] = r[k];
  renderVideoWarning();
}
function renderVideoWarning() {
  const stillsLeft = S.slides.some((s) => s.status === 'pending');
  if (S.flow.mode === 'video' && stillsLeft && !R.video) banner('Flow is set to Video. Make the still images first: switch Flow to Image, then come back to Video to animate.');
  else if ($('banner').textContent.startsWith('Flow is set to Video')) banner('');
  renderAnimCard();
}
function renderChips() {
  const c = [];
  if (S.flow.model) c.push(S.flow.model);
  if (S.flow.ratio) c.push(S.flow.ratio);
  if (S.flow.mode === 'video') c.push(['Video', S.flow.vkind && S.flow.vkind[0].toUpperCase() + S.flow.vkind.slice(1), S.flow.res, S.flow.secs && S.flow.secs + 's'].filter(Boolean).join(' · '));
  if (S.flow.count) c.push(`${S.flow.count} ${S.flow.mode === 'video' ? 'video' : 'image'}${S.flow.count > 1 ? 's' : ''} per prompt`);
  if (S.flow.credits != null && S.flow.credits !== '') c.push(`${S.flow.credits} credit${S.flow.credits === 1 ? '' : 's'} per prompt`);
  if (!c.length) c.push('Settings come from Flow');
  $('flowChips').innerHTML = c.map((x) => `<span${/^Video/.test(x) ? ' class="warn"' : ''}>${esc(x)}</span>`).join('');
}

// ---------- loading prompts ----------
async function loadFile(file) {
  try {
    const n = file.name.toLowerCase();
    let raw;
    let text;
    if (n.endsWith('.pdf')) text = await bbTextFromPDF(await file.arrayBuffer());
    else text = await file.text();
    if (!ingest(text, false)) return toast('No prompts found in ' + file.name);
    S.batchName = safeName(file.name.replace(/\.[^.]+$/, ''));
    $('batchName').value = S.batchName;
    toast(`Loaded ${S.slides.length} slides from ${file.name}`);
  } catch (e) { toast('Could not read that file: ' + e.message); log('File error: ' + e.message); }
}
// Read an AI reply, a CSV or plain prompts. Returns false if nothing usable was found.
function ingest(text, append) {
  const { castText, slidesText } = bbSplitReply(text);
  const raw = bbSlidesFromText(slidesText || text);
  if (!raw.length) return false;
  const incoming = bbParseCast(castText);
  setSlides(raw, append);
  if (!append) S.cast = [];
  bbMergeCast(S.cast, incoming);
  // No cast from the AI: find recurring characters and places in the prompts themselves.
  const found = bbScanCast(S.slides, S.cast, S.hero.name);
  bbMergeCast(S.cast, found);
  save(); renderAll();
  const missing = S.cast.filter((m) => !m.look.trim()).length;
  toast(`Loaded ${S.slides.length} slides` + (S.cast.length ? `, ${bibleSummary()}${missing ? '. Fix descriptions in Settings' : ''}.` : '.'));
  if (missing && BBAI.hasKey()) autoDescribe(); // fill in missing descriptions by itself
  return true;
}
function setSlides(raw, append) {
  S.secs = Math.max(1, +$('secs').value || 5);
  if (append && S.slides.length) {
    const last = S.slides[S.slides.length - 1];
    const add = bbFinalize(raw.map((r) => ({ ...r, start: r.start ?? null })), S.secs, last.n + 1);
    const shift = raw[0] && raw[0].start == null ? last.end : 0;
    add.forEach((s) => { s.start += shift; s.end += shift; });
    S.slides.push(...add);
  } else {
    S.slides = bbFinalize(raw, S.secs);
    S.batchId = uid();
    S.review = [];
  }
  save(); renderAll();
}

// ---------- rendering ----------
function renderScript() {
  const n = S.slides.length;
  $('scriptSummary').textContent = n ? `${n} slides, ${bbClock(S.slides[n - 1].end)} total` : 'No prompts loaded yet.';
  $('preview').innerHTML = S.slides.slice(0, 300).map((s) =>
    `<li><b>[${bbClock(s.start)}–${bbClock(s.end)}]</b> ${esc(s.prompt.slice(0, 120))}${s.prompt.length > 120 ? '…' : ''}${s.overlay ? ` <em>“${esc(s.overlay)}”</em>` : ''}</li>`).join('');
  const issues = bbTimelineIssues(S.slides);
  $('timeIssues').textContent = issues.length ? `Timeline: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? ` and ${issues.length - 3} more` : ''}. Use Fit timeline to fix.` : '';
}

function allHeroes() { return [...BB_HEROES, ...S.hero.custom]; }
function renderHero() {
  $('heroChips').innerHTML = `<button class="chip" data-id="none" aria-pressed="${!S.hero.spec.trim()}">None</button>` + allHeroes().map((h) => `<button class="chip" data-id="${esc(h.id)}" aria-pressed="${!!S.hero.spec.trim() && S.hero.presetId === h.id}">${esc(h.label)}</button>`).join('');
  $('heroName').value = S.hero.name;
  $('heroSpec').value = S.hero.spec;
  $('lockMode').value = S.hero.lockMode;
  $('attachMode').value = S.hero.attach;
  $('delHero').hidden = !S.hero.custom.some((h) => h.id === S.hero.presetId);
  const has = !!S.hero.refImage;
  $('refImg').hidden = !has; $('refHint').hidden = has;
  if (has) $('refImg').src = S.hero.refImage;
  $('sheets').innerHTML = S.sheets.map((sh, i) => `<figure><img src="${sh.thumb}" alt="Character sheet ${i + 1}"><button class="btn sm" data-useref="${i}">Use as reference</button></figure>`).join('');
  $('genSheet').disabled = !!S.sheetJob;
  $('genSheet').textContent = S.sheetJob ? 'Generating sheet…' : 'Generate character sheet';
}

// "2 characters, 1 place, 3 things and the era" for messages.
function bibleSummary() {
  const n = (t) => S.cast.filter((m) => m.type === t).length;
  const part = (c, one, many) => (c ? `${c} ${c === 1 ? one : many}` : '');
  const bits = [part(n('character'), 'character', 'characters'), part(n('place'), 'place', 'places'), part(n('thing'), 'thing', 'things')].filter(Boolean);
  if (n('era')) bits.push('the era');
  return bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits.join('');
}
function castLine(s) {
  if (!S.cast.length) return '';
  const names = bbSlideAll(s, S.cast).map((m) => m.name);
  return names.length ? `<span class="who">${esc(names.join(' · '))}</span>` : '';
}
function renderCast() {
  const list = $('castList'); if (!list) return;
  const ch = S.cast.filter((m) => m.type === 'character').length, pl = S.cast.length - ch;
  $('castCount').textContent = S.cast.length ? `${ch} character${ch === 1 ? '' : 's'}, ${pl} place${pl === 1 ? '' : 's'}` : '';
  const missing = S.cast.filter((m) => !m.look.trim());
  // In automatic mode with the AI helper on, descriptions happen by themselves: no help box needed.
  $('castHelp').hidden = !missing.length || (S.auto.on && BBAI.hasKey());
  $('castAI').hidden = !BBAI.hasKey();
  if (missing.length && !BBAI.hasKey() && S.slides.length) $('castFold').open = true;
  $('autoOn').checked = S.auto.on;
  const locked = S.cast.filter((m) => m.refImage).length;
  $('autoState').textContent = !S.auto.on || !S.slides.length ? '' : !S.cast.length ? 'No recurring characters or places found yet. Press Start and Bolblar checks again.'
    : `Found ${ch} character${ch === 1 ? '' : 's'} and ${pl} place${pl === 1 ? '' : 's'}.` +
      (missing.length && !BBAI.hasKey() ? ` ${missing.length} need a description: open Review characters and places below, tap Copy prompt and paste the reply back.` : missing.length ? ' Describing them…' : ' All described.') +
      (locked ? ` ${locked} locked to a reference sheet.` : ' Reference sheets for the main ones are made first when you press Start.');
  $('castMissing').textContent = missing.length ? `${missing.length} still need a description.` : '';
  const busy = !!S.sheetJob;
  list.innerHTML = S.cast.map((m) => {
    const n = S.slides.filter((s) => { return bbSlideAll(s, S.cast).includes(m); }).length;
    return `<li class="${m.look.trim() ? '' : 'empty'}" data-id="${m.id}">
      <div class="castTop"><span class="castTag">${BB_TYPE_LABEL[m.type] || 'Character'}</span>
        <input type="text" data-f="name" value="${esc(m.name)}" aria-label="Name">
        <button class="castX" data-act="del" aria-label="Remove ${esc(m.name)}">✕</button></div>
      <input type="text" data-f="aliases" value="${esc((m.aliases || []).join(', '))}" placeholder="Other names used, comma separated" aria-label="Other names">
      <textarea data-f="look" rows="3" placeholder="${({ place: 'What it looks like: type, size, materials, colors, key features, lighting', thing: 'Exact type, model style, era, color, material, size, one detail always visible', era: 'Years and region, and what must match: vehicles, clothing, hairstyles, phones, signs' })[m.type] || 'What they look like: age, build, skin tone, face, hair, outfit, one signature detail'}" aria-label="Description">${esc(m.look)}</textarea>
      <div class="castMeta"${m.type === 'era' ? ' hidden' : ''}>
        <label class="castRef" title="Reference image">${m.refImage ? `<img src="${m.refImage}" alt="">` : '+'}<input type="file" accept="image/*" data-act="ref" hidden></label>
        <span>In ${n} slide${n === 1 ? '' : 's'}</span>
        <button class="btn sm" data-act="sheet" ${busy || !m.look.trim() ? 'disabled' : ''}>${busy && S.sheetJob.castId === m.id ? 'Making sheet…' : 'Make sheet'}</button>
        ${m.refImage ? '<button class="btn sm ghost" data-act="unref">Remove image</button>' : ''}
      </div>
      ${(m.sheets || []).length ? `<div class="castSheets">${m.sheets.map((sh, k) => `<button data-act="usesheet" data-k="${k}" aria-pressed="${!!m.refFrom && m.refFrom === sh.key}" title="Use as reference"><img src="${sh.thumb}" alt="Sheet ${k + 1}"></button>`).join('')}</div>` : ''}
    </li>`;
  }).join('');
}
// Drag and drop an image file, or drag an image straight from the Flow page, onto a reference box.
async function droppedImage(dt) {
  const f = [...(dt.files || [])].find((x) => /^image\//.test(x.type));
  if (f) return f;
  let url = dt.getData('text/uri-list') || '';
  if (!url) { const html = dt.getData('text/html') || ''; const m = html.match(/<img[^>]+src="([^"]+)"/i); if (m) url = m[1].replace(/&amp;/g, '&'); }
  if (!url) url = (dt.getData('text/plain') || '').trim();
  url = url.split('\n').find((l) => l && !l.startsWith('#')) || '';
  if (!/^(https?:|data:image\/)/.test(url)) return null;
  try { const res = await fetch(url, { credentials: 'include' }); if (res.ok) { const b = await res.blob(); if (/^image\//.test(b.type)) return b; } } catch (e) {}
  try { const r = await send({ type: 'grab', src: url }); if (r && r.dataUrl) return await (await fetch(r.dataUrl)).blob(); } catch (e) {}
  return null;
}
function enableDrop(root, selector, onImage) {
  const target = (e) => e.target.closest && e.target.closest(selector);
  root.addEventListener('dragover', (e) => { const t = target(e); if (!t) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; t.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { const t = target(e); if (t) t.classList.remove('over'); });
  root.addEventListener('drop', async (e) => {
    const t = target(e); if (!t) return;
    e.preventDefault(); t.classList.remove('over');
    const blob = await droppedImage(e.dataTransfer);
    if (!blob) return toast("That didn't come through as an image. Save it first, then drop the file.");
    await onImage(t, blob);
  });
}
// Fill in every missing cast description with the AI helper.
async function autoDescribe(manual) {
  const missing = S.cast.filter((m) => !m.look.trim());
  if (!missing.length) { if (manual) toast('Everyone already has a description.'); return; }
  if (!BBAI.hasKey()) { if (manual) { $('settings').showModal(); toast('Add your free Gemini API key once in AI helper.'); } return; }
  const btn = $('castAI'); busy2(btn, true);
  try {
    const reply = await BBAI.ask(bbCastPrompt(missing, S.slides, bbStyle(S).label));
    const got = bbParseCast(bbSplitReply(reply).castText || reply);
    const r = bbMergeCast(S.cast, got);
    save(); renderCast(); renderRun(); renderComposed();
    toast(`Described ${r.updated + r.added} character${r.updated + r.added === 1 ? '' : 's'} and places.`);
  } catch (e) { toast(e.message); log(e.message); }
  finally { busy2(btn, false); }
}
function busy2(btn, on) { if (!btn) return; btn.disabled = on; btn.classList.toggle('busy', on); if (on) btn.dataset.busy = 'Describing…'; }
function bindCast() {
  $('autoOn').addEventListener('change', (e) => { S.auto.on = e.target.checked; save(); renderCast(); toast(S.auto.on ? 'Consistency is automatic.' : 'Automatic consistency is off.'); });
  enableDrop($('castList'), '.castRef, li', async (t, blob) => {
    const m = S.cast.find((x) => x.id === t.closest('li').dataset.id); if (!m) return;
    m.refImage = await compressImage(await blobToDataURL(blob)); m.refFrom = '';
    if (S.hero.attach === 'off') S.hero.attach = 'every';
    save(); renderCast(); renderHero(); renderComposed(); toast(`Reference set for ${m.name}.`);
  });
  const add = (type) => { S.cast.push({ id: bbCastId(), type, name: type === 'place' ? 'New place' : 'New character', aliases: [], look: '', refImage: '', sheets: [] }); save(); renderCast(); const last = $('castList').lastElementChild; if (last) last.querySelector('input').select(); };
  $('castAddChar').addEventListener('click', () => add('character'));
  $('castAddPlace').addEventListener('click', () => add('place'));
  $('castScan').addEventListener('click', () => {
    if (!S.slides.length) return toast('Load your prompts first.');
    const r = bbMergeCast(S.cast, bbScanCast(S.slides, S.cast, S.hero.name));
    save(); renderCast(); renderRun(); renderComposed();
    toast(r.added ? `Found ${r.added} new.` : 'Nothing new found. Use + Character or + Place to add one.');
  });
  $('castAI').addEventListener('click', () => autoDescribe(true));
  $('castCopyPrompt').addEventListener('click', async () => {
    const text = bbCastPrompt(S.cast.filter((m) => !m.look.trim()), S.slides, bbStyle(S).label);
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into your AI.'); }
    catch (e) { $('castReply').value = text; toast('Copy blocked; the prompt is in the box below.'); }
  });
  $('castReply').addEventListener('paste', () => setTimeout(() => {
    if (bbParseCast(bbSplitReply($('castReply').value).castText || $('castReply').value).length) $('castApply').click();
  }, 50));
  $('castApply').addEventListener('click', () => {
    const got = bbParseCast(bbSplitReply($('castReply').value).castText || $('castReply').value);
    if (!got.length) return toast('No CHARACTER or PLACE lines found in that reply.');
    const r = bbMergeCast(S.cast, got); $('castReply').value = '';
    save(); renderCast(); renderRun(); renderComposed();
    toast(`Updated ${r.updated}, added ${r.added}.`);
  });
  const list = $('castList');
  const member = (el) => S.cast.find((m) => m.id === el.closest('li').dataset.id);
  list.addEventListener('input', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const m = member(e.target);
    if (f === 'aliases') m.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
    else m[f] = e.target.value;
    e.target.closest('li').classList.toggle('empty', !m.look.trim());
    save(); renderComposed();
  });
  list.addEventListener('change', async (e) => {
    if (e.target.dataset.f) { renderCast(); renderRun(); return; }
    if (e.target.dataset.act !== 'ref') return;
    const f = e.target.files[0]; if (!f) return;
    const m = member(e.target); m.refImage = await compressImage(await blobToDataURL(f)); m.refFrom = '';
    if (S.hero.attach === 'off') S.hero.attach = 'every';
    save(); renderCast(); renderHero(); renderComposed(); toast(`Reference set for ${m.name}.`);
  });
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act === 'ref') return;
    const m = member(b);
    if (b.dataset.act === 'del') { S.cast = S.cast.filter((x) => x !== m); save(); renderCast(); renderRun(); renderComposed(); }
    if (b.dataset.act === 'unref') { m.refImage = ''; m.refFrom = ''; save(); renderCast(); renderComposed(); }
    if (b.dataset.act === 'sheet') {
      S.sheetJob = { kind: 'sheet', castId: m.id, n: 0, prompt: m.type === 'place' ? 'location reference sheet' : m.type === 'thing' ? 'object reference sheet' : 'character model sheet', start: 0, end: 0, status: 'pending', images: [], attempts: 0 };
      renderCast(); toast(`Making a sheet for ${m.name}.`);
      if (!R.running) startRun();
    }
    if (b.dataset.act === 'usesheet') {
      const sh = m.sheets[+b.dataset.k]; const blob = await BBStore.get(sh.key);
      if (!blob) return toast('That sheet is no longer stored.');
      m.refImage = await compressImage(await blobToDataURL(blob)); m.refFrom = sh.key;
      if (S.hero.attach === 'off') S.hero.attach = 'every';
      save(); renderCast(); renderHero(); renderComposed(); toast(`${m.name} is locked to that sheet.`);
    }
  });
}

function renderStyle() {
  const groups = [...new Set(BB_STYLES.map((s) => s.group))];
  $('stylePreset').innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">${BB_STYLES.filter((s) => s.group === g).map((s) => `<option value="${s.id}" ${bbStyle(S).id === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
  const st = bbStyle(S);
  $('stylePrefix').value = st.prefix;
  $('styleSuffix').value = st.suffix;
  $('styleEnforce').checked = S.style.enforce;
  $('avoid').value = S.style.avoid;
  $('previewPick').innerHTML = S.slides.slice(0, 300).map((s, i) => `<option value="${i}">Slide ${s.n}</option>`).join('');
  renderComposed();
}
function renderComposed() {
  const i = +$('previewPick').value || 0;
  $('composed').textContent = S.slides[i] ? bbCompose(S.slides[i], S) : 'Load prompts to see a preview.';
}

function counts() {
  const c = { done: 0, creating: 0, pending: 0, failed: 0, skipped: 0, review: 0 };
  S.slides.forEach((s) => { c[s.status] = (c[s.status] || 0) + 1; });
  return c;
}
function renderRun() {
  renderAnimCard(); renderGuideRun();
  const c = counts(), n = S.slides.length;
  $('cDone').textContent = c.done; $('cCreating').textContent = c.creating; $('cPending').textContent = c.pending; $('cFailed').textContent = c.failed;
  const animSet = animPlan();
  $('strip').innerHTML = S.slides.map((s, i) => `<button class="${s.status}${animSet.has(s) ? ' anim' : ''}" data-i="${i}" title="Slide ${s.n}: ${s.status}" aria-label="Slide ${s.n}, ${s.status}"></button>`).join('');
  const state = R.running ? (R.paused ? 'Paused' : R.stopping ? 'Finishing' : 'Creating') : (n && !c.pending && !c.failed ? 'Finished' : 'Ready');
  $('statusText').textContent = n ? `${state}: ${c.done} of ${n} done` : 'Nothing loaded';
  $('eta').textContent = eta(c);

  const cur = S.slides.filter((s) => s.status === 'creating').sort((a, b) => b.submittedAt - a.submittedAt)[0] || S.slides.find((s) => s.status === 'pending');
  $('current').hidden = !cur;
  if (cur) {
    $('curTitle').textContent = `Slide ${String(cur.n).padStart(2, '0')}  [${bbClock(cur.start)}–${bbClock(cur.end)}]  ${cur.status}`;
    $('curNarr').textContent = cur.narration ? `“${cur.narration}”` : ''; $('curNarr').hidden = !cur.narration;
    $('curPrompt').textContent = cur.prompt;
    const th = cur.images[0] && cur.images[0].thumb;
    $('curThumb').hidden = !th; if (th) $('curThumb').src = th;
  }

  $('start').disabled = R.running || !n;
  $('start').textContent = R.running ? (R.paused ? 'Paused' : 'Running…') : c.done && c.pending ? 'Continue batch' : 'Start batch';
  $('pause').disabled = !R.running;
  $('pause').textContent = R.paused ? 'Resume' : 'Pause';
  $('skip').disabled = !R.running;
  $('stop').disabled = !R.running;
  $('stop').textContent = R.stopping ? 'Stop now' : 'Stop';
  $('retry').disabled = !(c.failed || c.skipped);
  $('newVideo2').hidden = R.running || !n || c.pending > 0 || c.creating > 0;

  if (IS_OVERLAY) {
    try { if (FRAME_PARENT) window.parent.postMessage({ bb: 'progress', text: R.running ? `${c.done}/${n}` : (n && c.done === n ? 'Done' : '') }, FRAME_PARENT); } catch (e) {}
  }
  const list = S.slides.filter((s) => R.filter === 'all' || s.status === R.filter || (R.filter === 'pending' && s.status === 'creating'));
  $('slides').innerHTML = list.map((s) => {
    const i = S.slides.indexOf(s);
    const th = s.images[0] && s.images[0].thumb;
    const open = R.open === i;
    return `<li><div class="rowMain" data-open="${i}">
        ${th ? `<img class="thumb" src="${th}" alt="">` : '<span class="thumb"></span>'}
        <span class="meta"><span class="t">${String(s.n).padStart(2, '0')} · ${bbClock(s.start)}–${bbClock(s.end)}${s.images.length > 1 ? ` · ${s.images.length} images` : ''}</span><span class="p">${esc(s.prompt)}</span>${castLine(s)}</span>
        <span class="side"><span class="s ${s.status}">${s.status}</span><button class="animTag${animSet.has(s) ? ' on' : ''}${s.anim && s.anim !== 'auto' ? ' forced' : ''}" data-anim="${i}" title="Tap to switch between Still and Animate">${animSet.has(s) ? ((s.videos || []).length ? 'Video ✓' : s.videoError ? 'Animate ✕' : 'Animate') : 'Still'}</button></span></div>
      ${open ? `<div class="edit">
        ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
        <div class="field"><label for="ep${i}">Prompt</label><textarea id="ep${i}" rows="4">${esc(s.prompt)}</textarea></div>
        <div class="grid2"><div class="field"><label for="en${i}">Narration</label><input id="en${i}" type="text" value="${esc(s.narration)}"></div>
        <div class="field"><label for="eo${i}">Overlay</label><input id="eo${i}" type="text" value="${esc(s.overlay)}"></div></div>
        <div class="timeRow"><div class="field"><label for="es${i}">Starts at</label><input id="es${i}" type="text" value="${bbClockFine(s.start)}"></div><div class="field"><label for="ee${i}">Ends at</label><input id="ee${i}" type="text" value="${bbClockFine(s.end)}"></div></div>
        <div class="row"><button class="btn sm" data-save="${i}">Save</button><button class="btn sm primary" data-redo="${i}">${s.images.length ? 'Redo' : 'Run this'}</button>
        <button class="btn sm" data-skipone="${i}">Skip</button>${s.images.length ? `<button class="btn sm" data-dl="${i}">Download</button>` : ''}</div></div>` : ''}</li>`;
  }).join('') || '<li class="note" style="padding:10px 2px">Nothing here.</li>';
}
function eta(c) {
  if (!R.durations.length || !(c.pending + c.creating)) return '';
  const avg = R.durations.reduce((a, b) => a + b, 0) / R.durations.length;
  const per = Math.max(avg / Math.max(1, +S.settings.conc), +S.settings.gap * 1000);
  const left = c.pending + c.creating;
  const rests = +S.settings.restEvery > 0 ? Math.floor(left / +S.settings.restEvery) * (+S.settings.restMins || 2) * 60000 : 0;
  const mins = Math.ceil((left * per + rests) / 60000);
  return `about ${mins} min left`;
}
function renderFiles() {
  renderDir();
  $('autoDl').checked = S.settings.autoDl; $('nameFormat').value = S.settings.nameFormat; $('folder').value = S.settings.folder;
}
function renderSettings() {
  const st = S.settings;
  $('gap').value = st.gap; $('restEvery').value = st.restEvery; $('restMins').value = st.restMins; $('dailyCap').value = st.dailyCap; $('ping').checked = st.ping;
  const f = [S.flow.model, S.flow.ratio, S.flow.count ? `x${S.flow.count}` : ''].filter(Boolean).join(', ');
  $('flowNote').textContent = 'Bolblar uses whatever you set in Flow: the model, the size and how many images per prompt (x1 to x4).' + (f ? ` Right now: ${f}.` : '') + ' To change them, change them in Flow.';
}
function animLevel() { return BB_ANIM_LEVELS.find((l) => l.id === S.anim.level) || BB_ANIM_LEVELS[1]; }
function animPlan() { return bbPlanAnimation(S.slides, animLevel().pct); }
function renderAnim() {
  const box = $('animLevels'); if (!box) return;
  box.innerHTML = BB_ANIM_LEVELS.map((l) => `<button role="radio" aria-checked="${l.id === animLevel().id}" data-level="${l.id}">${l.label}<small>${l.pct}%</small></button>`).join('');
  const n = animPlan().size, total = S.slides.length;
  $('animSummary').textContent = total ? `${n} of ${total} slides will be animated, ${total - n} stay still.` : 'Load prompts to see which slides get animated.';
}
function renderAll() { renderGuide(); renderAnim(); renderScript(); renderHero(); renderCast(); renderStyle(); renderRun(); renderFiles(); renderSettings(); renderChips(); }

// ---------- images ----------
const extOf = (mime) => (/mp4/.test(mime) ? 'mp4' : /webm/.test(mime) ? 'webm' : /quicktime/.test(mime) ? 'mov' : /video/.test(mime) ? 'mp4' : /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png');
async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = 160 / Math.max(bmp.width, bmp.height);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) { return ''; }
}
async function grabImage(src) {
  const r = await send({ type: 'grab', src });
  let blob = null, thumb = '';
  if (r && r.dataUrl) { blob = await (await fetch(r.dataUrl)).blob(); thumb = r.thumb; }
  else if (r && r.url && /^https:\/\//.test(r.url)) { const res = await fetch(r.url); if (res.ok) blob = await res.blob(); }
  if (!blob) return null;
  // Only pictures and videos of a sensible size are kept: whatever the page offers is not saved blindly (security review EXT-06).
  if (!/^(image|video)\//.test(blob.type || 'image/') || blob.size > 60 * 1024 * 1024) return null;
  if (!thumb) thumb = await makeThumb(blob);
  return { blob, thumb };
}
const folderPath = () => `${safeName(S.settings.folder)}/${safeName(S.batchName)}`;
// ---------- saving straight into a folder you choose (Chrome and Edge on a computer) ----------
// The folder is remembered between visits; the browser asks once per visit to allow writing to it.
const DIR_OK = !DEVICE.mobile && typeof window.showDirectoryPicker === 'function';
async function dirPermission(ask) {
  if (!R.dir) return 'none';
  try {
    let p = await R.dir.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && ask) p = await R.dir.requestPermission({ mode: 'readwrite' });
    R.dirOk = p === 'granted';
    return p;
  } catch (e) { R.dirOk = false; return 'denied'; }
}
async function loadDir() {
  if (!DIR_OK) return;
  try { R.dir = await BBStore.get('__savefolder'); } catch (e) { R.dir = null; }
  if (R.dir && typeof R.dir.queryPermission !== 'function') R.dir = null;
  await dirPermission(false);
  renderDir();
}
function renderDir() {
  const box = $('dirBox'); if (!box) return;
  box.hidden = !DIR_OK;
  if (!DIR_OK) return;
  const name = R.dir && R.dir.name;
  $('dirNow').innerHTML = name ? (R.dirOk ? `Saving straight into <b>${esc(name)}</b>.` : `Saving into <b>${esc(name)}</b> needs your OK once this visit.`) : 'Saving to your Downloads folder.';
  $('pickDir').textContent = name ? 'Choose a different folder' : 'Choose a folder on this computer';
  $('allowDir').hidden = !name || R.dirOk;
  $('useDownloads').hidden = !name;
  $('folderField').hidden = !!name;
}
async function writeToDir(blob, path) {
  if (!R.dir || !R.dirOk) return false;
  try {
    const name = path.split('/').pop();
    const fh = await R.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(blob); await w.close();
    return true;
  } catch (e) {
    R.dirOk = false; renderDir();
    log(`Could not save into ${R.dir.name} (${e.message}). Saving to Downloads instead until you allow it again in Files.`);
    return false;
  }
}

async function saveBlob(blob, path) {
  if (await writeToDir(blob, path)) return;
  const url = URL.createObjectURL(blob);
  try {
    if (!(chrome.downloads && chrome.downloads.download)) throw new Error('no downloads api');
    await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    const a = document.createElement('a'); a.href = url; a.download = path.split('/').pop();
    document.body.append(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 90000);
}
async function downloadSlide(s) {
  let n = 0;
  for (let i = 0; i < s.images.length; i++) {
    const blob = await BBStore.get(s.images[i].key);
    if (!blob) continue;
    await saveBlob(blob, `${folderPath()}/${bbFileName(s, S.slides.length, i, extOf(blob.type), S.settings.nameFormat)}`);
    n++;
  }
  return n;
}

// ---------- runner ----------
async function ensureCdp() {
  if (DEVICE.mobile || S.settings.engine !== 'precision') return (R.useCdp = false);
  if (R.useCdp && BBEngine.isAttached()) return true;
  R.useCdp = await BBEngine.attach();
  if (R.useCdp) log('Precision connection ready.');
  return R.useCdp;
}
async function typeAndSubmit(text) {
  let typed = false;
  await ensureCdp();
  if (R.useCdp) {
    const f = await send({ type: 'focusPrompt' });
    if (!f.ok) throw new Error(f.error);
    try {
      await BBEngine.cdpInsert(text);
      await sleep(250);
      const rd = await send({ type: 'readPrompt' });
      typed = norm(rd.text).includes(norm(text).slice(0, 40));
    } catch (e) { log('Precision typing failed: ' + e.message); R.useCdp = false; }
  }
  if (!typed) {
    const r = await send({ type: 'typePrompt', text });
    if (!r.ok) throw new Error(r.error || 'Could not type into the prompt box.');
  }
  // Try one way to press Create at a time. Move to the next way only if Flow clearly did
  // not accept the prompt (the text is still in the box and nothing started), so a slide is never sent twice.
  const accepted = async () => {
    await sleep(1800);
    const sig = await send({ type: 'submitSignal' });
    return !!(sig && (sig.cleared || sig.busyUp));
  };
  const stillThere = async () => {
    const rd = await send({ type: 'readPrompt' });
    return norm(rd.text).includes(norm(text).slice(0, 30));
  };
  const steps = [];
  if (R.useCdp) {
    steps.push(['real click', async () => { const t = await send({ type: 'submitTarget' }); if (!t.ok) throw new Error(t.error); if (t.covered) throw new Error('covered'); await BBEngine.cdpClick(t.x, t.y); }]);
    steps.push(['real Enter key', async () => { await send({ type: 'focusEnd' }); await BBEngine.cdpEnter(); }]);
  }
  steps.push(['page click', async () => { const t = await send({ type: 'submitTarget' }); if (!t.ok) throw new Error(t.error); await send({ type: 'clickSubmit' }); }]);
  steps.push(['page Enter key', async () => { await send({ type: 'pressEnter' }); }]);
  const known = steps.findIndex(([n]) => n === R.lastMethod);
  if (known > 0) steps.unshift(steps.splice(known, 1)[0]); // what worked last time goes first
  for (const [name, run] of steps) {
    try { await run(); } catch (e) { log(`Create via ${name} failed: ${e.message}`); continue; }
    if (await accepted()) { if (name !== R.lastMethod) log(`Flow accepted the prompt via ${name}.`); R.lastMethod = name; return true; }
    if (!(await stillThere())) return true; // the box emptied late: Flow took it
    log(`Flow did not react to ${name}, trying the next way.`);
  }
  if (!R.useCdp && !DEVICE.mobile) {
    if (S.settings.engine === 'precision') {
      const why = BBEngine.lastDetach() === 'canceled_by_user' ? 'The "started debugging" bar was closed with Cancel.' : 'Chrome dropped the Precision connection.';
      throw new Error(`${why} Flow did not accept the click. Press Resume to reconnect, and leave that bar open.`);
    }
    throw new Error('Flow did not accept the click. Use Chrome or Edge on a laptop, or press Create once by hand.');
  }
  throw new Error('Flow did not accept the prompt. Press Create once by hand, then use "Lock create button" in Settings.');
}

// Flow keeps attached reference images ("ingredients") for every prompt until they are removed.
// So: attach once, check before each slide that they are still there, and only swap them
// when this slide needs different people or places. Never stack duplicates.
// A stable, unique file name per picture, so Flow's asset library can find it again instead of a new upload.
function refName(who, dataUrl) {
  let h = 2166136261;
  for (let i = 0; i < dataUrl.length; i += 7) { h ^= dataUrl.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `bb-${safeName(who).toLowerCase()}-${(h >>> 0).toString(36).slice(0, 5)}.jpg`;
}
function wantedRefs(job) {
  if (job.kind === 'sheet' || (job.safe || 0) >= 2) return [];
  const refs = [];
  // The channel character's picture goes only into slides that are about them, never into every slide.
  if (S.hero.attach !== 'off' && S.hero.refImage && bbMentionsHero(job.prompt, S)) refs.push(['hero', S.hero.refImage, S.hero.label || S.hero.name || 'hero']);
  // Your own style: the 1 or 2 starred example images go into every slide.
  // Your own style's example images are NOT sent to Flow: Flow redraws attached pictures instead of only borrowing
  // their look. The style travels as the written description your AI made from them.
  if (S.hero.attach === 'every') {
    const { chars, places, things } = bbSlideCast(job, S.cast);
    for (const m of [...chars, ...places, ...things]) if (m.refImage) refs.push([m.id || m.name, m.refImage, m.name]);
  }
  return refs.slice(0, 3);
}
async function syncRefs(job, name) {
  const want = wantedRefs(job);
  const keys = want.map((r) => r[0]);
  let slot;
  try { slot = await send({ type: 'refSlot' }); } catch (e) { slot = { count: -1, srcs: [] }; }
  if (slot.srcs && slot.srcs.length) send({ type: 'claim', srcs: slot.srcs }).catch(() => {});
  const have = R.attached || [];
  const same = have.length === keys.length && have.every((k, i) => k === keys[i]);
  if (same && (slot.count === keys.length || slot.count < 0)) return; // still attached, nothing to do
  if (!keys.length && !slot.count) { R.attached = []; return; }
  // Something changed (or Flow dropped them): clear the slot, then attach exactly what this slide needs.
  let todo = want;
  const prefix = have.length && have.length < keys.length && have.every((k, i) => k === keys[i]) && slot.count === have.length;
  if (prefix) todo = want.slice(have.length); // the ones already there stay, just add the new ones
  else if (slot.count > 0) {
    const c = await send({ type: 'clearRefs' }).catch(() => ({ remaining: slot.count }));
    if (c.remaining > 0) {
      const keep = have.filter((k) => keys.includes(k));
      if (keep.length === have.length && c.remaining === have.length) {
        todo = want.filter((r) => !have.includes(r[0])); // could not remove, but the old ones are still wanted
      } else {
        log(`${name}: could not remove the old reference images from Flow's prompt box (${c.remaining} left). Remove them by hand if this slide looks wrong.`);
        todo = want.filter((r) => !have.includes(r[0]));
      }
    } else R.attached = [];
  } else R.attached = [];
  for (const [key, img, label] of todo) {
    const a = await send({ type: 'attachRef', dataUrl: img, name: refName(label || key, img) });
    if (!a.ok) { log(`${name}: reference for ${label || key} not attached (${a.error})`); continue; }
    R.attached = [...(R.attached || []).filter((k) => k !== key), key];
    if (a.srcs && a.srcs.length) send({ type: 'claim', srcs: a.srcs }).catch(() => {});
  }
  if (todo.length) log(`${name}: references in Flow now ${keys.length ? want.map((r) => r[2] || r[0]).join(', ') : 'none'}.`);
}

async function submitJob(job) {
  job.status = 'creating'; job.error = ''; job.attempts = (job.attempts || 0) + 1;
  job.submittedAt = Date.now(); job.lastImageAt = 0; job.images = job.images || [];
  const member = job.castId ? S.cast.find((m) => m.id === job.castId) : null;
  job.key = norm(job.kind === 'sheet' ? (member && member.type === 'place' ? 'location reference sheet' : member && member.type === 'thing' ? 'object reference sheet' : 'character model sheet') : bbSanitize(bbScene(job), bbStyle(S))).slice(0, 40);
  R.lastSubmit = Date.now();
  renderRun(); renderHero(); renderCast();
  const name = job.kind === 'sheet' ? `Sheet for ${member ? member.name : 'the hero'}` : `Slide ${job.n}`;
  try {
    await syncRefs(job, name);
    const text = job.kind === 'sheet' ? bbSheetPrompt(S, member) : bbCompose(job, S);
    const confirmed = await typeAndSubmit(text);
    R.submitted++; if (job.kind !== 'sheet') R.sinceRest = (R.sinceRest || 0) + 1;
    log(`${name}: submitted${confirmed ? '' : ' (no confirmation from Flow yet, watching for the image)'}`);
  } catch (e) {
    if (/not found|did not accept/i.test(e.message)) {
      // A setup problem, not a bad prompt: keep the slide queued and wait for the user.
      job.status = 'pending'; job.attempts = Math.max(0, job.attempts - 1);
      R.paused = true; banner(e.message + ' Then press Resume.'); log(e.message);
    } else failJob(job, e.message, false);
  }
  save(); renderRun();
}

function finishJob(job) {
  job.status = 'done'; job.doneAt = Date.now();
  if (job.submittedAt) R.durations.push(job.doneAt - job.submittedAt);
  if (R.durations.length > 20) R.durations.shift();
  if (job.kind === 'sheet') {
    const member = job.castId ? S.cast.find((m) => m.id === job.castId) : null;
    const sheets = job.images.map((im) => ({ key: im.key, thumb: im.thumb }));
    if (member) {
      member.sheets = [...sheets, ...(member.sheets || [])].slice(0, 6);
      if (job.auto && sheets[0]) useSheet(member, sheets[0]).then(() => log(`${member.name}: sheet made and locked in as the reference.`));
      else toast(`Sheet for ${member.name} ready. Tap it to use it as the reference.`);
    }
    else { S.sheets.unshift(...sheets); toast('Character sheet ready. Tap the best one to lock it in.'); }
    S.sheetJob = null;
    renderHero(); renderCast(); renderGuide();
  }
  const sheetOf = job.castId ? (S.cast.find((m) => m.id === job.castId) || {}).name : '';
  log(`${job.kind === 'sheet' ? `Sheet for ${sheetOf || 'the main character'}` : 'Slide ' + job.n}: done (${job.images.length} image${job.images.length === 1 ? '' : 's'})`);
}
function failJob(job, msg, retryable) {
  job.error = msg;
  if (retryable && job.attempts <= +S.settings.retries) { job.status = 'pending'; log(`Slide ${job.n}: ${msg} Retrying.`); }
  else { job.status = 'failed'; log(`${job.kind === 'sheet' ? 'Character sheet' : 'Slide ' + job.n}: ${msg}`); if (job.kind === 'sheet') { S.sheetJob = null; renderHero(); renderCast(); } }
}

function matchImage(img) {
  const now = Date.now();
  const creating = jobs().filter((j) => j.status === 'creating').sort((a, b) => a.submittedAt - b.submittedAt);
  const recent = jobs().filter((j) => j.status === 'done' && now - (j.doneAt || 0) < 60000);
  // Slides you skipped while Flow was still working on them: their image may still turn up.
  const skipped = S.slides.filter((s) => s.status === 'skipped' && !s.images.length && now - (s.skippedAt || 0) < 30 * 60000).sort((a, b) => b.skippedAt - a.skippedAt);
  const missing = S.slides.filter((s) => (s.status === 'failed' || s.status === 'skipped') && !s.images.length);
  const text = norm(img.cardText);
  const hits = text ? [...creating, ...recent, ...missing].filter((j) => j.key && j.key.length > 12 && text.includes(j.key)) : [];
  if (hits.length === 1) return hits[0];
  // Nothing running and exactly one slide is still missing its image: a late or hand-retried image is that one.
  if (!creating.length && missing.length === 1 && !recent.some((j) => j.images.length < perPrompt())) return missing[0];
  // An image that appears within seconds of a new prompt can't be from it yet: it belongs to the slide before.
  const short = [...recent.filter((j) => j.images.length < perPrompt()), ...skipped].sort((a, b) => (b.doneAt || b.skippedAt) - (a.doneAt || a.skippedAt));
  // How soon after a prompt can its own image appear? Learned from this session (the fastest seen so far).
  const tooSoon = R.minFirst ? Math.min(5000, R.minFirst * 0.6) : 1500;
  if (short.length && (!creating.length || now - creating[0].submittedAt < tooSoon)) return short[0];
  if (creating.length) return creating[0]; // only ever one prompt at a time, so it is this one
  return skipped[0] || null;
}

async function attachImage(job, g, src) {
  const idx = job.images.length;
  if (!idx && job.submittedAt && job.kind !== 'sheet') R.minFirst = Math.min(R.minFirst || Infinity, Date.now() - job.submittedAt);
  const key = `${S.batchId}:${job.kind === 'sheet' ? 'sheet-' + uid() : job.n}:${idx}:${uid()}`;
  await BBStore.put(key, g.blob);
  job.images.push({ key, thumb: g.thumb, src, mime: g.blob.type });
  job.lastImageAt = Date.now();
  if (job.slowWarned) { job.slowWarned = false; banner(''); }
  if (job.kind !== 'sheet' && ['failed', 'skipped', 'review'].includes(job.status)) {
    job.status = 'done'; job.error = ''; job.doneAt = Date.now();
    log(`Slide ${job.n}: its image arrived later and was put back in its place.`);
  }
  if (S.settings.autoDl && job.kind !== 'sheet') {
    await saveBlob(g.blob, `${folderPath()}/${bbFileName(job, S.slides.length, idx, extOf(g.blob.type), S.settings.nameFormat)}`);
  }
}

function handleAlerts(alerts) {
  if (!alerts || !alerts.length) return;
  const creating = jobs().filter((j) => j.status === 'creating');
  if (alerts.includes('unusual')) { R.paused = true; banner('Google flagged unusual activity. Paused to protect your account. Wait a few minutes, raise "Seconds between prompts", then Resume.'); }
  else if (alerts.includes('quota')) { R.paused = true; banner('Flow says you hit a limit or ran out of credits. Paused. Resume when your credits are back.'); }
  else if (alerts.includes('confirm')) { R.paused = true; banner('Flow is asking you to confirm something on the page. Read and confirm it yourself, then press Resume.'); }
  if (alerts.includes('blocked') && creating.length === 1 && creating[0].kind !== 'sheet') {
    const j = creating[0]; j.blocked = true;
    failJob(j, 'Flow blocked this slide for its content. Change the prompt (tap the slide) and press Redo, or press Retry failed at the end.', false);
  }
  else if (alerts.includes('failed') && creating.length === 1) failJob(creating[0], 'Flow could not generate this one. It may have been blocked by a content policy; try rewording the prompt.', true);
  alerts.forEach((a) => log('Flow warning: ' + a));
  if (R.paused) { if (S.settings.ping) beep(); renderRun(); }
}

async function poll() {
  if (R.video) return;
  const active = jobs().some((j) => j.status === 'creating');
  if (!active && !R.running && Date.now() > (R.watchUntil || 0)) return;
  let r;
  try { r = await send({ type: 'check' }); } catch (e) { log('Lost the Flow tab: ' + e.message); R.paused = true; banner('Lost contact with the Flow tab. Keep it open, then press Resume.'); return; }
  if (!r || !r.ok) return;
  handleAlerts(r.alerts);
  for (const img of r.images) {
    await send({ type: 'claim', srcs: [img.src] });
    const job = matchImage(img);
    const g = await grabImage(img.src);
    if (!g) { log('Could not read a finished image from Flow.'); continue; }
    if (await isRefCopy(g.blob)) { log('Skipped a copy of one of your reference pictures (not a new image).'); continue; }
    if (job) await attachImage(job, g, img.src);
    else log('An image appeared in Flow that does not belong to any slide. It was left in Flow.');
  }
  const now = Date.now(), per = perPrompt();
  for (const j of jobs().filter((x) => x.status === 'creating')) {
    // If Flow's x1 to x4 couldn't be read, don't assume 1: wait until no new image has arrived for 15s.
    const sure = +S.flow.count > 0 || +S.settings.perPrompt > 0;
    if (sure && j.images.length >= per) finishJob(j);
    else if (j.images.length && now - j.lastImageAt > (!sure ? 15000 : per > 1 ? 30000 : 8000)) finishJob(j);
    else if (!j.slowWarned && now - j.submittedAt > +S.settings.timeout * 1000) {
      // Never move on by itself: a second image would start while this one is still being made.
      j.slowWarned = true;
      banner(`Slide ${j.n || ''} is taking longer than usual. The agent keeps waiting for it. Check Flow, or tap Skip to move on.`.replace('Slide  ', 'This one '));
      log(`Slide ${j.n}: still waiting after ${Math.round((now - j.submittedAt) / 60000)} minutes.`);
      if (S.settings.ping) beep();
    }
  }
  save(); renderRun();
}

function sheetJobFor(m) {
  return { kind: 'sheet', auto: true, castId: m.id, n: 0, prompt: m.type === 'place' ? 'location reference sheet' : m.type === 'thing' ? 'object reference sheet' : 'character model sheet', start: 0, end: 0, status: 'pending', images: [], attempts: 0 };
}
function nextPending() {
  if (!S.sheetJob && R.sheetQueue && R.sheetQueue.length) {
    const id = R.sheetQueue.shift();
    const m = S.cast.find((x) => x.id === id);
    if (m && !m.refImage) { S.sheetJob = sheetJobFor(m); renderCast(); }
  }
  if (S.sheetJob && S.sheetJob.status === 'pending') return S.sheetJob;
  if (R.sheetOnly) return null; // making only the character sheet, not the batch
  return S.slides.find((s) => s.status === 'pending' && !s.rewriting);
}

// ---------- automatic consistency ----------
// Before the slides: find everyone and everywhere, describe them, and make a reference sheet for the
// main ones, so every slide gets the same person and place without the user setting anything up.
async function useSheet(m, sh) {
  const blob = await BBStore.get(sh.key); if (!blob) return;
  m.refImage = await compressImage(await blobToDataURL(blob)); m.refFrom = sh.key;
  if (S.hero.attach === 'off') S.hero.attach = 'every';
  save(); renderCast(); renderHero(); renderComposed();
}
async function prepareConsistency() {
  if (!S.cast.length) bbMergeCast(S.cast, bbScanCast(S.slides, S.cast, S.hero.name));
  if (S.cast.some((m) => !m.look.trim())) {
    if (BBAI.hasKey()) { banner('Preparing your characters and places…'); await autoDescribe(); banner(''); }
  }
  // Never start with main characters that have no fixed look: every image would invent a new person.
  const inSl = (m) => S.slides.filter((s) => { return bbSlideAll(s, S.cast).includes(m); }).length;
  const bare = S.cast.filter((m) => m.type === 'character' && !m.look.trim() && inSl(m) >= 2);
  if (bare.length) {
    banner(`${bare.map((m) => m.name).join(' and ')} ${bare.length > 1 ? 'have' : 'has'} no fixed look yet, so every image would draw a different person. Cast tab: tap Copy prompt, paste it into your AI, paste the reply back, then press Start.`);
    switchTab('hero'); $('castFold').open = true; renderCast();
    return false;
  }
  // Main characters: in 3 or more slides (top 3). Main places: in 3 or more slides (top 2).
  const inSlides = (m) => S.slides.filter((s) => { return bbSlideAll(s, S.cast).includes(m); }).length;
  const pick = (type, max) => S.cast.filter((m) => m.type === type && m.look.trim() && !m.refImage && inSlides(m) >= 3)
    .sort((a, b) => inSlides(b) - inSlides(a)).slice(0, max);
  const main = [...pick('character', 3), ...pick('place', 2)];
  R.sheetQueue = main.map((m) => m.id);
  if (main.length) log(`Making reference sheets first for: ${main.map((m) => m.name).join(', ')}.`);
  save(); renderCast();
  return true;
}
// ---------- never save a copy of a reference picture ----------
// A small fingerprint of each picture you attach (character, place, thing). A finished "image" that matches one
// is Flow showing or redrawing your reference, not a new scene, so it is never filed as a slide.
async function fingerprint(src) {
  try {
    const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data, g = [];
    for (let i = 0; i < d.length; i += 4) g.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
    const avg = g.reduce((a, b) => a + b, 0) / g.length;
    const bits = g.map((v) => (v > avg + 2 ? 1 : 0)), ones = bits.reduce((a, b) => a + b, 0);
    if (ones < 16 || ones > 240) return null; // a plain, nearly one-colour picture is too simple to tell apart safely
    return { bits, ratio: bmp.width / bmp.height };
  } catch (e) { return null; }
}
async function loadRefPrints() {
  const srcs = [S.hero.refImage, ...S.cast.map((m) => m.refImage)].filter(Boolean);
  R.refPrints = (await Promise.all([...new Set(srcs)].map(fingerprint))).filter(Boolean);
}
async function isRefCopy(blob) {
  if (!(R.refPrints || []).length) return false;
  const f = await fingerprint(blob); if (!f) return false;
  return R.refPrints.some((r) => Math.abs(r.ratio - f.ratio) < 0.05 && r.bits.reduce((n, b, i) => n + (b !== f.bits[i] ? 1 : 0), 0) <= 24);
}

async function restBreak() {
  const ms = Math.max(0.1, +S.settings.restMins || 2) * 60000, until = Date.now() + ms;
  log(`Resting ${S.settings.restMins} min after ${R.sinceRest} images.`);
  R.resting = true;
  while (Date.now() < until && !R.stopping) {
    if (!R.paused) banner(`Short rest to keep your account safe. Continues in ${Math.ceil((until - Date.now()) / 1000)}s.`);
    await sleep(1000);
    if (R.paused) { R.resting = false; banner(''); return; } // Pause ends the rest; Resume carries on
  }
  R.resting = false; R.sinceRest = 0; banner(''); renderRun();
}

async function startRun() {
  if (R.running) return;
  if (!(await gateCheck(false))) return;
  if (R.dir && !R.dirOk) await dirPermission(true).then(renderDir); // Start is a tap, so the browser lets us ask here
  const info = await checkConn();
  if (!info || !info.prompt) { toast('Open a Google Flow project in a tab first.'); return; }
  if (S.flow.mode === 'video') { renderVideoWarning(); toast('Flow is set to Video. Switch it to Image first.'); return; }
  if (+S.flow.count > 1) { toast(`Flow is set to make ${S.flow.count} images per prompt. Set it to x1 first, so only one image is made at a time.`); return; }
  if (!(await ensureCdp()) && S.settings.engine === 'precision' && !DEVICE.mobile) log('Precision mode unavailable here, using standard.');
  // Step by step mode keeps it simple: one main character, no automatic extra sheets.
  if (S.ui.mode !== 'guide' && S.auto.on && S.slides.some((s) => s.status === 'pending') && (await prepareConsistency()) === false) return;
  const known = jobs().flatMap((j) => j.images.map((im) => im.src)).concat(S.review.map((r) => r.src)).filter(Boolean);
  await send({ type: 'arm', known });
  R.attached = null; // unknown until the first slide checks Flow's prompt box
  await loadRefPrints();
  Object.assign(R, { running: true, paused: false, stopping: false, submitted: 0, sinceRest: 0, safe: false, unmatched: 0, sweeps: 0 });
  send({ type: 'wake', on: true }).catch(() => {});
  banner('');
  renderRun();
  log('Batch started.');
  try {
    while (true) {
      await poll();
      if (+S.flow.count > 1 && !R.paused) { R.paused = true; banner(`Flow was switched to ${S.flow.count} images per prompt. Set it back to x1, then press Resume.`); renderRun(); }
      if (R.paused) { await sleep(800); continue; }
      const creating = jobs().filter((j) => j.status === 'creating');
      const next = R.stopping ? null : nextPending();
      if (!next && !creating.length && S.slides.some((s) => s.rewriting)) { await sleep(800); continue; }
      if (!next && !creating.length) {
        // Flow sometimes fails one image (network, busy). Before finishing, go back for failed slides, up to 2 more times.
        const failed = S.slides.filter((s) => s.status === 'failed' && !s.blocked); // content blocks wait for you
        if (failed.length && (R.sweeps || 0) < 2 && !R.stopping) {
          R.sweeps = (R.sweeps || 0) + 1;
          failed.forEach((s) => { s.status = 'pending'; s.attempts = 0; });
          log(`Pass ${R.sweeps + 1}: retrying slide${failed.length > 1 ? 's' : ''} ${failed.map((s) => s.n).join(', ')}.`);
          toast(`Retrying ${failed.length} failed slide${failed.length > 1 ? 's' : ''}.`);
          save(); renderRun();
          await sleep(Math.max(3000, +S.settings.gap * 1000));
          continue;
        }
        break;
      }
      const capHit = +S.settings.dailyCap && R.submitted >= +S.settings.dailyCap;
      if (capHit && !creating.length) { banner(`Stopped at your cap of ${S.settings.dailyCap} slides.`); break; }
      // A short rest every few images, so a long batch looks like steady work, not a nonstop machine.
      if (next && !creating.length && +S.settings.restEvery > 0 && +S.settings.restMins > 0 && (R.sinceRest || 0) >= +S.settings.restEvery && next.kind !== 'sheet') {
        await restBreak();
        continue;
      }
      if (next && !capHit && creating.length === 0 && Date.now() - R.lastSubmit >= +S.settings.gap * 1000) {
        await submitJob(next);
        continue;
      }
      await sleep(1200);
    }
  } catch (e) { log('Runner error: ' + e.message); }
  finally {
    R.running = false; R.stopping = false; R.sheetOnly = false;
    R.watchUntil = Date.now() + 15 * 60000; // keep catching late or hand-retried images for 15 minutes
    send({ type: 'wake', on: false }).catch(() => {});
    if (R.useCdp) await BBEngine.detach();
    save(); renderRun();
    const c = counts();
    log(`Batch stopped: ${c.done} done, ${c.failed} failed, ${c.pending} pending.`);
    if (!c.pending && S.slides.length) { toast(`Batch finished: ${c.done} done, ${c.failed} failed.`); if (S.settings.ping) beep(); }
  }
}

// ---------- animate: turn chosen slides into short videos ----------
// Flow in Video mode, Frames: each video starts from the slide's own finished image,
// so the characters and places match the stills exactly.
function animTargets() { const plan = animPlan(); return S.slides.filter((s) => plan.has(s) && s.images.length && !(s.videos || []).length); }
function renderAnimCard() {
  const card = $('animCard'); if (!card) return;
  const plan = animPlan(), list = animTargets();
  const anyStill = S.slides.some((s) => s.images.length);
  card.hidden = !plan.size || !anyStill;
  if (card.hidden) return;
  const btn = $('animate'); let note, ok = false;
  const per = +S.flow.credits > 0 ? +S.flow.credits : null;
  if (R.video) note = `Animating… ${R.vDone || 0} of ${R.vTotal || 0} done.`;
  else if (!list.length) note = `All ${plan.size} animated slides have their videos.`;
  else if (R.running) note = `${list.length} slides will be ready to animate after the stills finish.`;
  else if (S.flow.mode !== 'video') note = `${list.length} slide${list.length > 1 ? 's are' : ' is'} ready to animate. In Flow, switch to Video, then Frames, pick the length, then tap Animate.`;
  else if (S.flow.vkind === 'ingredients') note = 'Flow is on Ingredients. Switch it to Frames so each video starts from its slide\'s own image.';
  else { ok = true; note = `Ready: ${list.length} video${list.length > 1 ? 's' : ''}${S.flow.secs ? `, ${S.flow.secs}s each` : ''}${per ? `, about ${list.length * per} credits` : ''}.`; }
  $('animNote').textContent = note;
  btn.disabled = !ok || R.running;
  btn.textContent = R.video ? 'Animating…' : `Animate ${list.length || ''} slide${list.length === 1 ? '' : 's'}`.replace('  ', ' ');
}
async function blobToDataUrl(blob) { return new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = no; f.readAsDataURL(blob); }); }
async function runVideos() {
  if (R.running) return;
  if (!(await gateCheck(false))) return;
  const info = await checkConn();
  if (!info || !info.prompt) { toast('Open your Google Flow project in a tab first.'); return; }
  if (S.flow.mode !== 'video') { toast('Switch Flow to Video, then Frames, first.'); return; }
  if (+S.flow.count > 1) { toast(`Flow is set to make ${S.flow.count} videos per prompt. Set it to x1 first.`); return; }
  const list = animTargets();
  if (!list.length) { toast('Nothing to animate yet.'); return; }
  const per = +S.flow.credits > 0 ? +S.flow.credits : null;
  if (per && !confirm(`Animate ${list.length} slide${list.length > 1 ? 's' : ''}? Flow says each uses ${per} credits, about ${list.length * per} in total.`)) return;
  await ensureCdp();
  const known = jobs().flatMap((j) => j.images.map((im) => im.src).concat((j.videos || []).map((v) => v.src)));
  await send({ type: 'arm', known });
  Object.assign(R, { running: true, video: true, paused: false, stopping: false, vDone: 0, vTotal: list.length });
  send({ type: 'wake', on: true }).catch(() => {});
  banner(''); renderRun(); renderAnimCard(); log(`Animating ${list.length} slides.`);
  const want = 1; // one video per slide, one at a time
  try {
    for (const s of list) {
      while (R.paused && !R.stopping) await sleep(800);
      if (R.stopping) break;
      if (S.flow.mode !== 'video') { R.paused = true; banner('Flow left Video mode. Switch back to Video, Frames, then press Resume.'); renderRun(); while (R.paused && !R.stopping) await sleep(800); if (R.stopping) break; }
      // The slide's own image becomes the start frame. Clear whatever is attached first.
      const slot = await send({ type: 'refSlot' }).catch(() => ({ count: 0 }));
      if (slot.count) await send({ type: 'clearRefs' }).catch(() => {});
      const blob = await BBStore.get(s.images[0].key);
      if (!blob) { log(`Slide ${s.n}: its image is missing, skipped.`); continue; }
      const a = await send({ type: 'attachRef', dataUrl: await blobToDataUrl(blob), name: `Slide_${s.n}.${extOf(blob.type)}`, slot: 'start' });
      if (!a.ok) { log(`Slide ${s.n}: could not add its image as the start frame (${a.error}).`); R.paused = true; banner('Could not add the start frame. Check Flow is on Video, Frames, then press Resume.'); renderRun(); continue; }
      if (a.srcs && a.srcs.length) send({ type: 'claim', srcs: a.srcs }).catch(() => {});
      R.attached = null;
      await sleep(+S.settings.gap * 1000);
      s.videoError = '';
      await typeAndSubmit(bbVideoPrompt(s, S));
      log(`Slide ${s.n}: video requested.`);
      const t0 = Date.now(); s.videos = s.videos || []; let lastAt = 0, slow = false; R.skipVideo = false;
      while (true) { // waits until this video is done; it never starts the next one while Flow is still busy
        await sleep(2500);
        if (R.stopping) break;
        if (R.skipVideo) { R.skipVideo = false; s.videoError = 'Skipped by you. The still image is kept.'; log(`Slide ${s.n}: video skipped.`); break; }
        if (!slow && Date.now() - t0 > 10 * 60000) { slow = true; banner(`The video for slide ${s.n} is taking longer than usual. The agent keeps waiting. Check Flow, or tap Skip to move on.`); if (S.settings.ping) beep(); }
        const r = await send({ type: 'check' }).catch(() => null);
        if (!r || !r.ok) continue;
        if (r.images && r.images.length) await send({ type: 'claim', srcs: r.images.map((i) => i.src) }); // video covers are not slide images
        if ((r.alerts || []).includes('blocked')) { s.videoError = 'Flow blocked this video. The still image is kept.'; log(`Slide ${s.n}: ${s.videoError}`); break; }
        if ((r.alerts || []).includes('failed') && !r.videos.length) { s.videoError = 'Flow could not make this video. The still image is kept.'; log(`Slide ${s.n}: ${s.videoError}`); break; }
        for (const v of r.videos || []) {
          await send({ type: 'claim', srcs: [v.src] });
          const g = await grabImage(v.src).catch(() => null);
          if (!g) { log(`Slide ${s.n}: could not read the finished video.`); continue; }
          const key = `${S.batchId}:video:${s.n}:${uid()}`;
          await BBStore.put(key, g.blob);
          const idx = s.videos.length;
          s.videos.push({ key, src: v.src, mime: g.blob.type || 'video/mp4' });
          lastAt = Date.now();
          if (S.settings.autoDl) await saveBlob(g.blob, `${folderPath()}/${bbFileName(s, S.slides.length, idx, extOf(g.blob.type || 'video/mp4'), S.settings.nameFormat)}`);
        }
        if (s.videos.length >= want || (s.videos.length && Date.now() - lastAt > 30000)) break;
      }
      if (slow) banner('');
      if (s.videos.length) { R.vDone++; log(`Slide ${s.n}: video done.`); }
      save(); renderRun(); renderAnimCard();
    }
  } catch (e) { log('Animate error: ' + e.message); }
  finally {
    Object.assign(R, { running: false, video: false, stopping: false });
    send({ type: 'wake', on: false }).catch(() => {});
    if (R.useCdp) await BBEngine.detach();
    save(); renderRun(); renderAnimCard();
    const miss = animPlan().size - S.slides.filter((s) => animPlan().has(s) && (s.videos || []).length).length;
    toast(`Animating finished: ${R.vDone} video${R.vDone === 1 ? '' : 's'} made${miss ? `, ${miss} slide${miss > 1 ? 's' : ''} stay still` : ''}.`);
    if (S.settings.ping) beep();
  }
}

// ---------- exports ----------
function manifest() {
  const total = S.slides.length;
  return {
    schema: 'bolblar.timeline.v1', app: 'Bolblar Agent ' + ((chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '1.0.0'), batch: S.batchName, createdAt: new Date().toISOString(),
    aspectRatio: S.flow.ratio || null, model: S.flow.model || null,
    durationSeconds: total ? S.slides[total - 1].end : 0,
    slides: S.slides.map((s) => ({
      index: s.n, start: s.start, end: s.end, duration: +(s.end - s.start).toFixed(2),
      narration: s.narration, overlay: s.overlay, concept: s.concept, prompt: s.prompt, status: s.status,
      animate: animPlan().has(s), movement: s.movement || '',
      files: s.images.map((im, i) => bbFileName(s, total, i, extOf(im.mime || ''), S.settings.nameFormat)),
      videos: (s.videos || []).map((v, i) => bbFileName(s, total, i, extOf(v.mime || 'video/mp4'), S.settings.nameFormat))
    }))
  };
}
function statusCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Slide', 'Start', 'End', 'Status', 'Animate', 'Movement', 'Files', 'Narration', 'Overlay', 'Prompt', 'Error'].join(',')];
  const m = manifest();
  m.slides.forEach((s, i) => rows.push([s.index, bbClock(s.start), bbClock(s.end), s.status, s.animate ? 'yes' : 'no', s.movement, s.files.concat(s.videos).join(' '), s.narration, s.overlay, s.prompt, S.slides[i].error].map(q).join(',')));
  return rows.join('\n');
}
let pendingShare = null;
async function shareOrPrepare(btn, build, readyLabel) {
  if (pendingShare && pendingShare.btn === btn) {
    const files = pendingShare.files; const label = pendingShare.label; pendingShare = null;
    btn.textContent = label;
    try { await navigator.share({ files, title: S.batchName }); toast('Saved.'); }
    catch (e) { if (e.name !== 'AbortError') { toast('Share failed, downloading instead.'); for (const f of files) await saveBlob(f, `${folderPath()}/${f.name}`); } }
    return;
  }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const files = await build();
    if (!files.length) { btn.textContent = label; return toast('No finished images yet.'); }
    pendingShare = { btn, files, label };
    btn.textContent = readyLabel(files.length);
  } finally { btn.disabled = false; }
}
async function collectImageFiles() {
  const out = [];
  for (const s of S.slides) for (let i = 0; i < s.images.length; i++) {
    const blob = await BBStore.get(s.images[i].key);
    if (blob) out.push(new File([blob], bbFileName(s, S.slides.length, i, extOf(blob.type), S.settings.nameFormat), { type: blob.type }));
  }
  return out;
}
function confirmGaps() {
  const gaps = S.slides.filter((s) => !s.images.length);
  if (!gaps.length) return true;
  const list = gaps.slice(0, 12).map((s) => s.n).join(', ') + (gaps.length > 12 ? ` and ${gaps.length - 12} more` : '');
  return confirm(`${gaps.length} slide${gaps.length > 1 ? 's have' : ' has'} no image yet (slide ${list}). Tap "Retry failed" in step 5 first, or press OK to download what's ready. Everything stays in slide order either way.`);
}
async function buildZip() {
  const zip = new JSZip();
  const dir = zip.folder(safeName(S.batchName));
  let n = 0;
  for (const s of S.slides) {
    for (let i = 0; i < s.images.length; i++) {
      const blob = await BBStore.get(s.images[i].key);
      if (!blob) continue;
      dir.file(bbFileName(s, S.slides.length, i, extOf(blob.type), S.settings.nameFormat), blob);
      n++;
    }
    for (let i = 0; i < (s.videos || []).length; i++) {
      const blob = await BBStore.get(s.videos[i].key);
      if (blob) { dir.file(bbFileName(s, S.slides.length, i, extOf(blob.type || 'video/mp4'), S.settings.nameFormat), blob); n++; }
    }
  }
  const gaps = S.slides.filter((s) => !s.images.length);
  if (gaps.length) dir.file('MISSING.txt', `These slides have no image yet, so they are not in this folder:\n${gaps.map((s) => `Slide ${s.n}  ${bbClock(s.start)}-${bbClock(s.end)}  ${s.prompt}`).join('\n')}\n`);
  dir.file('bolblar-timeline.json', JSON.stringify(manifest(), null, 2));
  dir.file('status.csv', statusCSV());
  toast(`Packing ${n} files…`);
  return zip.generateAsync({ type: 'blob' });
}
async function zipAll() {
  if (!confirmGaps()) return;
  if (canShareFiles() && DEVICE.mobile) {
    return shareOrPrepare($('zipAll'), async () => [new File([await buildZip()], `${safeName(S.batchName)}.zip`, { type: 'application/zip' })], () => 'Tap again to save the ZIP');
  }
  const out = await buildZip();
  await saveBlob(out, `${safeName(S.settings.folder)}/${safeName(S.batchName)}.zip`);
  toast('ZIP saved.');
}

// ---------- setup check ----------
async function setupCheck() {
  const rows = [];
  const add = (state, title, tip) => rows.push(`<li class="${state}"><div><b>${esc(title)}</b>${tip ? `<span>${esc(tip)}</span>` : ''}</div></li>`);
  add('ok', `Device: ${DEVICE.name}`, IS_OVERLAY ? 'Floating panel' : 'Side panel');
  let info = null;
  try { info = await send({ type: 'ping' }); } catch (e) {}
  if (!info) add('bad', 'Google Flow tab', 'Open Google Flow, sign in, and open a project.');
  else {
    add('ok', 'Google Flow tab', '');
    add(info.prompt ? 'ok' : 'bad', 'Prompt box', info.prompt ? '' : 'Open or create a Flow project. If it is open, use "Lock prompt box" below.');
    add(info.submit ? 'ok' : 'bad', 'Create button', info.submit ? '' : 'Use "Lock create button" below.');
    add(info.model ? 'ok' : 'warn', 'Flow settings', info.model ? `${info.model} ${info.ratio || ''} ${info.count ? 'x' + info.count : ''}` : 'Could not read the model. Set it in Flow before starting.');
    add(info.wakeApi ? 'ok' : (DEVICE.mobile ? 'warn' : 'ok'), 'Keep screen on', info.wakeApi ? 'Bolblar keeps the screen awake during a batch.' : DEVICE.mobile ? 'Not supported here. Set Auto Lock to Never while a batch runs.' : '');
  }
  try { const k = 'selftest:' + uid(); await BBStore.put(k, new Blob(['ok'])); const b = await BBStore.get(k); await BBStore.del(k); add(b ? 'ok' : 'bad', 'Image storage', b ? '' : 'Storage is blocked. Check the browser allows site data.'); }
  catch (e) { add('bad', 'Image storage', 'Storage is blocked: ' + e.message); }
  const dl = !!(chrome.downloads && chrome.downloads.download), share = canShareFiles();
  if (DEVICE.ios) add(share ? 'ok' : 'warn', 'Saving images', share ? 'Use "Save images to Photos or Files" or the ZIP in Files (folder icon at the top).' : 'Use the ZIP in Files (folder icon at the top).');
  else add(dl ? 'ok' : 'warn', 'Saving images', dl ? 'Images save to your Downloads folder.' : 'Use the ZIP in Files (folder icon at the top).');
  if (!DEVICE.mobile) {
    const prec = await BBEngine.precisionAllowed();
    add(prec ? 'ok' : 'warn', 'Real clicks', prec ? 'On. Chrome shows a "started debugging" bar during a batch; leave it open.' : 'Not available in this browser, so Flow may ignore clicks.');
  }
  $('checks').innerHTML = rows.join('');
  const bad = rows.filter((r) => r.startsWith('<li class="bad"')).length;
  toast(bad ? `${bad} thing${bad > 1 ? 's' : ''} to fix.` : 'All set. You can start a batch.');
}

// ---------- hero helpers ----------
function compressImage(src, max = 1024) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => ok(src);
    img.src = src;
  });
}
const blobToDataURL = (b) => new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });

// ---------- events ----------
// A voiceover can come in several parts (made in 2, 3 or more goes). The parts are joined in order,
// back to back, exactly as they will sit on the editing timeline, then the slides are synced to the whole.
const naturalName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
async function readVoPart(f) {
  if (/\.(srt|vtt|txt)$/i.test(f.name)) {
    const cues = bbParseCaptions(await f.text());
    return { name: f.name, cues, dur: cues.length ? cues[cues.length - 1].end : 0 };
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); } // 16 kHz is plenty to hear the pauses
  try {
    const buf = await ctx.decodeAudioData(await f.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
    return { name: f.name, mono, rate: buf.sampleRate, dur: buf.duration };
  } finally { ctx.close && ctx.close(); }
}
async function syncFiles(files, add) {
  if (!S.slides.length) { toast('Load your prompts first.'); return false; }
  const list = [...files].sort(naturalName);
  if (add && !(R.voParts || []).length && (S.voParts || []).length > 0) { toast('Add all the parts together again, in one go.'); return false; }
  toast(list.length > 1 ? `Listening to ${list.length} parts…` : 'Listening to your voiceover…');
  const parts = [];
  for (const f of list) {
    try { parts.push(await readVoPart(f)); } catch (e) { toast(`${f.name} couldn't be opened. Try MP3 or WAV.`); return false; }
  }
  R.voParts = add ? [...(R.voParts || []), ...parts] : parts;
  return syncParts();
}
function syncParts() {
  const parts = R.voParts || [];
  if (!parts.length) return false;
  const caps = parts.filter((p) => p.cues);
  if (caps.length && caps.length !== parts.length) { toast('Use either all audio files or all caption files, not a mix.'); return false; }
  let r;
  if (caps.length) {
    let off = 0; const cues = [];
    for (const p of parts) { for (const c of p.cues) cues.push({ ...c, start: c.start + off, end: c.end + off }); off += p.dur; }
    r = bbSyncToCaptions(S.slides, cues);
  } else {
    const rate = parts[0].rate;
    const chunks = parts.map((p) => {
      if (p.rate === rate) return p.mono;
      const k = p.rate / rate, out = new Float32Array(Math.floor(p.mono.length / k)); // simple resample
      for (let i = 0; i < out.length; i++) out[i] = p.mono[Math.floor(i * k)];
      return out;
    });
    const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; }
    r = bbAlignAudio(S.slides, all, rate);
    if (r.ok) $('fitTo').value = bbClock(r.length);
  }
  if (!r.ok) { toast(r.reason); return false; }
  S.voName = parts.map((p) => p.name).join(', ');
  S.voParts = parts.map((p) => ({ name: p.name, dur: p.dur }));
  save(); renderAll();
  log(`Synced to ${parts.length > 1 ? parts.length + ' parts (' + S.voName + ')' : S.voName}: ${r.matched} of ${r.total} slides matched their sentence exactly.`);
  toast(r.matched >= r.total ? `Synced to your voiceover (${bbClock(r.length)}). Every slide starts where its sentence is spoken.` : `Synced to your voiceover (${bbClock(r.length)}). Few clear pauses were found, so timing is spread by word count; check a few slides in step 5.`);
  return true;
}

// ---------- step by step ----------
// One question per screen, in this order: script, style, main character, voiceover and motion, create.
const G_STEPS = 5;
function guided() { return true; } // one view only
function gGo(step) { S.ui.step = Math.min(G_STEPS, Math.max(1, step)); save(); renderGuide(); document.getElementById('guide').scrollIntoView({ block: 'start' }); }
function gStyleList() { return [...(S.myStyles || []).map((s) => ({ ...s, mine: true })), ...BB_STYLES.filter((s) => s.id !== 'custom' && s.id !== 'matched')]; }
// ---------- step 3: main character ----------
function storyPeople() {
  const people = S.cast.filter((m) => m.type === 'character' && m.look);
  const n = new Map(people.map((m) => [m, 0]));
  for (const sl of S.slides) for (const m of bbSlideCast(sl, S.cast).chars) if (n.has(m)) n.set(m, n.get(m) + 1);
  return people.map((m) => ({ m, n: n.get(m) })).sort((a, b) => b.n - a.n);
}
function heroMode() {
  const p = S.hero.presetId || 'none';
  if (p.startsWith('channel:')) return 'channel';
  if (!S.hero.spec.trim() && p !== 'own') return 'none';
  return p.startsWith('cast:') ? 'story' : 'more';
}
const channelChar = () => (S.channel.chars || []).find((c) => 'channel:' + c.id === S.hero.presetId);
function defaultPlays(c) {
  if (!S.slides.length) return '';
  const lc = c.name.toLowerCase();
  if (S.slides.some((x) => (x.prompt || '').toLowerCase().includes(lc))) return ''; // the shot list already uses their name
  const top = storyPeople()[0];
  return top && top.n ? top.m.name : '';
}
function setPlays(c, plays) {
  Object.assign(S.hero, { plays: plays || '', name: plays || c.name, playsFor: S.batchId + ':' + S.slides.length });
}
const presetStyle = () => S.style.lastPreset && BB_STYLES.some((x) => x.id === S.style.lastPreset) ? S.style.lastPreset : (BB_STYLES.some((x) => x.id === S.style.id) && S.style.id !== 'matched' ? S.style.id : BB_STYLES[0].id);
function keepCharStyle(c) {
  if (BB_STYLES.some((x) => x.id === S.style.id) && S.style.id !== 'matched') S.style.lastPreset = S.style.id;
  const mine = c.styleId && (S.myStyles || []).some((x) => x.id === c.styleId);
  Object.assign(S.style, { id: mine ? c.styleId : 'matched', prefix: null, suffix: null });
}
function useChannelChar(c, keepStyle = true) {
  Object.assign(S.hero, { presetId: 'channel:' + c.id, label: c.name, spec: `${c.name} (from your picture)`, refImage: c.img, refFrom: 'channel',
    attach: 'every', imageOnly: true, styleId: c.styleId || '', chosen: true });
  setPlays(c, defaultPlays(c));
  S.channel.lastId = c.id;
  if (keepStyle) keepCharStyle(c);
}
function useStoryPerson(m, chosen = true) {
  Object.assign(S.hero, { presetId: 'cast:' + m.id, name: m.name, label: '', plays: '', spec: `${m.name}: ${m.look}`, refImage: m.refImage || '',
    refFrom: m.refImage ? 'sheet' : '', imageOnly: false, styleId: '', chosen });
}
function clearHero(chosen = true) {
  Object.assign(S.hero, { presetId: 'none', spec: '', name: '', label: '', plays: '', refImage: '', attach: 'off', imageOnly: false, styleId: '', chosen });
}
function renderMain() {
  const chars = S.channel.chars || [];
  // First visit with nothing picked: suggest the saved channel character, or the person in the most slides.
  if (!S.hero.chosen && heroMode() === 'none') {
    const last = chars.find((c) => c.id === S.channel.lastId) || chars[0];
    const top = storyPeople()[0];
    if (last) { useChannelChar(last); S.hero.chosen = false; save(); }
    else if (top && top.n) { useStoryPerson(top.m, false); save(); }
  }
  const mode = heroMode();
  const pick = R.pick || mode;
  document.querySelectorAll('#gPick [data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === mode)));
  const people = storyPeople();
  $('gStoryHint').textContent = people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} in your story. The one in the most slides is suggested.` : 'Load your AI reply in step 1 to see the people in your story.';
  // My channel's character
  const c = channelChar();
  $('gChannelBox').hidden = pick !== 'channel';
  $('gChars').innerHTML = chars.map((x) => `<div class="gChar" role="button" tabindex="0" data-ch="${esc(x.id)}" aria-pressed="${!!c && c.id === x.id}"><img src="${x.img}" alt=""><b>${esc(x.name)}</b><button class="del" data-chdel="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">✕</button></div>`).join('')
    + (chars.length && !R.addOpen ? '<button class="linkBtn" data-chadd="1">+ Add another character</button>' : '');
  $('gAdd').hidden = !!chars.length && !R.addOpen;
  $('gAddTitle').textContent = chars.length ? 'Add another character' : 'Add your character';
  $('gAddPic').hidden = !R.chPic; if (R.chPic) $('gAddPic').src = R.chPic; $('gAddPicTxt').hidden = !!R.chPic;
  $('gChSave').disabled = !R.chPic || !$('gChName').value.trim();
  $('gChUse').hidden = !c;
  if (c) {
    if (S.slides.length && S.hero.playsFor !== S.batchId + ':' + S.slides.length) { setPlays(c, defaultPlays(c)); save(); }
    $('gPlays').innerHTML = `<option value="">${esc(c.name)} is the main character${S.slides.length ? '' : ' (named so in your shot list)'}</option>` +
      people.map((p) => `<option value="${esc(p.m.name)}" ${S.hero.plays === p.m.name ? 'selected' : ''}>${esc(p.m.name)} (${p.n} slide${p.n === 1 ? '' : 's'})</option>`).join('');
    $('gPlays').disabled = !people.length;
    const keep = bbKeepsHeroStyle(S);
    const preset = BB_STYLES.find((x) => x.id === presetStyle());
    $('gChStyle').innerHTML = `<button class="chip" data-chstyle="keep" aria-pressed="${keep}">Keep ${esc(c.name)}'s own style ★</button><button class="chip" data-chstyle="redraw" aria-pressed="${!keep}">Redraw in ${esc(preset ? preset.label : 'a preset')}</button>`;
    const described = keep && S.style.id !== 'matched';
    $('gChDescribe').hidden = !keep || described;
    const st = bbStyle(S);
    $('gChOk').classList.toggle('gWarn', keep && !described);
    $('gChOk').textContent = !keep ? `${c.name} will be redrawn in ${preset ? preset.label : 'that style'}. Their face, outfit and colors still come from your picture.`
      : described ? `Every slide uses "${st.label}", with or without ${c.name}. Their look comes only from your picture.`
      : `Until you describe the style, slides without ${c.name} may look a little different.`;
  }
  // Someone from this story
  $('gStoryBox').hidden = pick !== 'story';
  const show = R.peopleAll ? people : people.slice(0, 4);
  $('gPeople').innerHTML = show.map((p, i) => `<button class="gPerson" data-person="${esc(p.m.id)}" aria-pressed="${S.hero.presetId === 'cast:' + p.m.id}"><b>${esc(p.m.name)}${i === 0 && p.n ? '<i>★ suggested</i>' : ''}</b><em>${p.n} slide${p.n === 1 ? '' : 's'}</em></button>`).join('') || '<p class="note">No people found yet. Load your AI reply in step 1.</p>';
  $('gPeopleAll').hidden = R.peopleAll || people.length <= 4;
  // More options: ready made characters and describe my own
  const pid = S.hero.presetId || 'none';
  $('gHeroes').innerHTML = [
    ...BB_HEROES.map((h) => `<button class="chip" data-hero="${esc(h.id)}" aria-pressed="${pid === h.id && !!S.hero.spec.trim()}">${esc(h.label)}</button>`),
    `<button class="chip" data-hero="own" aria-pressed="${pid === 'own'}">Describe my own</button>`
  ].join('');
  if (mode === 'more' && !$('gMore').open) $('gMore').open = true;
  // The description and picture of a story or ready made character
  $('gHeroBox').hidden = !(mode === 'story' || mode === 'more') || (mode === 'story' && pick !== 'story');
  if (document.activeElement !== $('gSpec')) $('gSpec').value = S.hero.spec;
  $('gSpecSum').textContent = S.hero.imageOnly ? '' : S.hero.spec.length > 110 ? S.hero.spec.slice(0, 110) + '…' : S.hero.spec;
  if (pid === 'own' && !S.hero.spec.trim()) $('gSpecEdit').open = true;
  $('gRefRow').hidden = !S.hero.refImage || mode === 'channel'; if (S.hero.refImage) $('gRefImg').src = S.hero.refImage;
  $('gRefTxt').textContent = S.hero.imageOnly ? 'Locked in. Your picture is now the only source of their look, so the description is not sent.' : 'Locked in. This picture goes into every slide with this character.';
  $('gSheetBox').hidden = !!S.hero.imageOnly;
  $('gSheet').disabled = !!S.sheetJob;
  $('gSheet').textContent = S.sheetJob ? 'Making the sheet in Flow…' : S.sheets.length ? 'Make another sheet' : 'Make a character sheet in Flow';
  $('gSheets').innerHTML = S.sheets.map((sh, i) => `<button data-sheet="${i}" aria-pressed="${!!S.hero.refImage && S.hero.refFrom === sh.key}" title="Use this one"><img src="${sh.thumb}" alt="Character sheet ${i + 1}"></button>`).join('');
}

function renderGuide() {
  document.body.classList.add('guided');
  $('guide').hidden = !guided();
  if (!guided()) return;
  const step = S.ui.step || 1;
  document.querySelectorAll('.gStep').forEach((el) => { el.hidden = +el.dataset.step !== step; });
  $('gStepNo').textContent = `Step ${step} of ${G_STEPS}`;
  $('gDots').innerHTML = Array.from({ length: G_STEPS }, (_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('');
  $('gBack').disabled = step === 1;
  $('gNext').hidden = step === G_STEPS;
  $('gNext').textContent = step === 3 && !S.hero.spec.trim() ? 'Skip' : 'Next';
  // 1. script
  if (document.activeElement !== $('gScript')) $('gScript').value = $('mScript').value;
  const ch = S.cast.filter((m) => m.type === 'character').length;
  renderPace();
  const warnPace = paceCheck();
  $('gLoaded').classList.toggle('gWarn', !!warnPace);
  $('gLoaded').textContent = warnPace || (S.slides.length ? `Loaded ${S.slides.length} slides${S.cast.length ? `, ${bibleSummary()}` : ''}${S.slides.length ? `, ${bbClock(S.slides[S.slides.length - 1].end)} long` : ''}.` : '');
  // 2. style
  const cur = bbStyle(S).id;
  $('gStyles').innerHTML = gStyleList().map((s) => `<button data-style="${s.id}" class="${s.mine ? 'mine' : ''}" aria-pressed="${s.id === cur}">${s.mine ? '★ ' : ''}${esc(s.label)}</button>`).join('');
  const own = S.ownDraft || [];
  $('gOwnGrid').innerHTML = own.map((o, i) => `<figure class="${o.use ? 'on' : ''}"><img src="${o.img}" alt="Example ${i + 1}"><button class="del" data-odel="${i}" aria-label="Remove">✕</button></figure>`).join('');
  $('gOwnSteps').hidden = !own.length;
  $('gOwnHint').hidden = !own.length;
  $('gOwnGrid').classList.add('noStar');
  // 3. main character: my channel's character, someone from the story, or none (ready made ones under More options)
  renderMain();
  // 4. voiceover and motion
  const vp = S.voParts || [];
  $('gVoOk').innerHTML = !S.voName ? '' : vp.length > 1
    ? `Synced to ${vp.length} parts, joined in this order:<ol class="gParts">${vp.map((p) => `<li>${esc(p.name)} <span>${bbClock(p.dur)}</span></li>`).join('')}</ol><span class="note">Wrong order? Name the files part 1, part 2, part 3 and add them again.</span>`
    : `Synced to ${esc(S.voName)}.`;
  $('gVoMoreBox').hidden = !S.voName;
  $('gVoLabel').firstChild.textContent = S.voName ? 'Replace voiceover' : 'Add voiceover';
  $('gAnim').innerHTML = BB_ANIM_LEVELS.map((l) => `<button class="chip" data-level="${l.id}" aria-pressed="${l.id === animLevel().id}">${l.label} ${l.pct}%</button>`).join('');
  renderGuideRun();
}
// ---------- pacing: how long each image stays on screen ----------
const SECS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const secsPer = () => Math.max(1, Math.min(12, +S.mother.secs || 6));
function scriptSeconds() {
  const words = ($('mScript').value.match(/[\p{L}\p{N}'’]+/gu) || []).length;
  return words ? words / (+S.mother.wps || 2.5) : 0;
}
function paceEstimate(n = secsPer()) {
  const secs = scriptSeconds();
  if (!secs) return { secs: 0, images: 0 };
  return { secs, images: Math.max(1, Math.round(secs / n)) };
}
function setPace(n) {
  n = Math.max(1, Math.min(12, Math.round(+n) || 6));
  Object.assign(S.mother, { secs: n, min: n, max: n }); $('mSecs').value = n; save(); renderGuide();
}
function renderPace() {
  const cur = secsPer();
  $('gPace').innerHTML = SECS.map((n) => `<button class="chip" role="radio" data-secs="${n}" aria-checked="${cur === n}" aria-pressed="${cur === n}">${n}s</button>`).join('');
  const e = paceEstimate();
  if (!e.secs) { $('gEst').textContent = 'Paste your script to see how many images it will make.'; return; }
  $('gEst').textContent = `About ${bbClock(e.secs)} of voiceover → about ${e.images} images, a new one every ${cur} second${cur > 1 ? 's' : ''}.`;
}
// After the reply loads: warn when the AI made far more (or fewer) slides than the pacing asked for.
function paceCheck() {
  const n = S.slides.length; if (!n) return '';
  const secs = scriptSeconds() || (S.slides[n - 1].end - S.slides[0].start);
  const want = Math.round(secs / secsPer());
  if (want >= 4 && n > want * 1.4) return `Your AI made ${n} slides; about ${want} were expected for this pacing. Tap Copy prompt again and send it in a new chat, or continue with ${n}.`;
  if (want >= 4 && n < want * 0.6) return `Your AI made only ${n} slides; about ${want} were expected. Some lines may be missing. Check before you start.`;
  return '';
}

function renderGuideRun() {
  const c = counts(), ready = S.slides.filter((x) => x.images.length).length;
  const badge = $('filesBadge'); badge.hidden = !ready; badge.textContent = ready > 99 ? '99+' : ready;
  $('gFlow').textContent = S.flow.mode === 'video' && c.pending ? 'Flow is on Video. Switch it to Image for the pictures.' : !S.slides.length ? 'Go back to step 1 and load your script first.' : 'Open your Google Flow project, set it to Image, then tap Start.';
  $('gFlow').hidden = R.running && !R.paused && S.flow.mode !== 'video';
}

function bindGuide() {
  $('openFiles').addEventListener('click', () => { renderFiles(); $('filesDlg').showModal(); });
  document.querySelector('.sAdd').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const type = b.dataset.add;
    if (type === 'era' && S.cast.some((m) => m.type === 'era')) return toast('The story already has an era. Edit it in the list.');
    const name = { character: 'New character', place: 'New place', thing: 'New thing', era: 'Story era' }[type];
    S.cast.push({ id: bbCastId(), type, name, aliases: [], look: '', refImage: '', sheets: [] });
    save(); renderCast();
    const last = $('castList').lastElementChild; if (last) (type === 'era' ? last.querySelector('textarea') : last.querySelector('input')).focus();
  });
  $('pickDir').addEventListener('click', async () => {
    try {
      const h = await window.showDirectoryPicker({ id: 'bolblar', mode: 'readwrite', startIn: 'desktop' });
      R.dir = h; await BBStore.put('__savefolder', h); await dirPermission(true); renderDir();
      toast(R.dirOk ? `Images now save straight into "${h.name}".` : 'Tap "Allow saving to this folder".');
      if (R.dirOk && S.slides.some((s) => s.images.length) && confirm(`Also save the ${S.slides.filter((s) => s.images.length).length} images you already have into "${h.name}"?`)) $('dlAll').click();
    } catch (e) { if (e.name !== 'AbortError') toast('That folder could not be used: ' + e.message); }
  });
  $('allowDir').addEventListener('click', async () => { await dirPermission(true); renderDir(); toast(R.dirOk ? `Saving into "${R.dir.name}".` : 'Not allowed. Images go to Downloads.'); });
  $('useDownloads').addEventListener('click', async () => { R.dir = null; R.dirOk = false; await BBStore.del('__savefolder').catch(() => {}); renderDir(); toast('Images go to your Downloads folder again.'); });
  $('closeFiles').addEventListener('click', () => $('filesDlg').close());
  $('fCopyAll').addEventListener('click', () => $('copyAll').click());
  $('gBack').addEventListener('click', () => gGo((S.ui.step || 1) - 1));
  $('gNext').addEventListener('click', () => {
    if ((S.ui.step || 1) === 1 && !S.slides.length) return toast('Paste your AI\'s reply first.');
    gGo((S.ui.step || 1) + 1);
  });
  $('gScript').addEventListener('input', (e) => { $('mScript').value = e.target.value; renderPace(); });
  $('gPace').addEventListener('click', (e) => {
    const b = e.target.closest('[data-secs]'); if (!b) return;
    setPace(+b.dataset.secs);
  });
  $('gCopy').addEventListener('click', () => { $('mScript').value = $('gScript').value; $('copyMother').click(); });
  const loadReply = () => { const t = $('gReply').value; if (t.trim().length > 20 && ingest(t, false)) { log('AI reply loaded.'); renderGuide(); } };
  $('gReply').addEventListener('paste', () => setTimeout(loadReply, 60));
  $('gReply').addEventListener('change', loadReply);
  $('gStyles').addEventListener('click', (e) => { const b = e.target.closest('[data-style]'); if (!b) return; if (BB_STYLES.some((x) => x.id === b.dataset.style)) S.style.lastPreset = b.dataset.style; Object.assign(S.style, { id: b.dataset.style, prefix: null, suffix: null }); save(); renderStyle(); renderGuide(); });
  $('gPick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const p = b.dataset.pick; R.pick = p;
    if (p === 'none') clearHero();
    else if (p === 'story') { const top = storyPeople()[0]; if (heroMode() !== 'story' && top) useStoryPerson(top.m); }
    else if (p === 'channel') { const chars = S.channel.chars || []; const c = chars.find((x) => x.id === S.channel.lastId) || chars[0]; if (heroMode() !== 'channel' && c) { useChannelChar(c); toast(`Using ${c.name}, in ${c.name}'s own art style. Change it below if you want.`); } }
    save(); renderStyle(); renderHero(); renderGuide();
  });
  $('gPeople').addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (!b) return; const m = S.cast.find((x) => x.id === b.dataset.person); if (m) { useStoryPerson(m); R.pick = 'story'; save(); renderHero(); renderGuide(); } });
  $('gPeopleAll').addEventListener('click', () => { R.peopleAll = true; renderGuide(); });
  $('gHeroes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hero]'); if (!b) return;
    const id = b.dataset.hero; R.pick = 'more';
    const base = { label: '', plays: '', imageOnly: false, styleId: '', chosen: true };
    if (id === 'own') Object.assign(S.hero, base, { presetId: 'own', spec: '', name: '', refImage: '' });
    else { const h = BB_HEROES.find((x) => x.id === id); if (h) Object.assign(S.hero, base, { presetId: id, name: h.name || '', spec: h.spec, refImage: '' }); }
    save(); renderHero(); renderGuide();
    if (id === 'own') { $('gSpecEdit').open = true; $('gSpec').focus(); }
  });
  // My channel's character: add, pick, remove, who they play, art style
  $('gChFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; R.chPic = await compressImage(await blobToDataURL(f), 1024); renderGuide(); $('gChName').focus(); });
  $('gChName').addEventListener('input', () => { $('gChSave').disabled = !R.chPic || !$('gChName').value.trim(); });
  $('gChSave').addEventListener('click', () => {
    const name = $('gChName').value.trim(); if (!R.chPic || !name) return;
    const c = { id: 'ch' + uid(), name, img: R.chPic };
    S.channel.chars = [...(S.channel.chars || []), c].slice(-8);
    R.chPic = ''; R.addOpen = false; $('gChName').value = '';
    useChannelChar(c); save(); renderStyle(); renderHero(); renderGuide();
    toast(`${name} saved for every video. Their picture is the only source of their look.`);
  });
  $('gChars').addEventListener('click', (e) => {
    if (e.target.closest('[data-chadd]')) { R.addOpen = true; renderGuide(); return; }
    const del = e.target.closest('[data-chdel]');
    if (del) {
      const c = S.channel.chars.find((x) => x.id === del.dataset.chdel); if (!c || !confirm(`Remove ${c.name} from your saved characters?`)) return;
      S.channel.chars = S.channel.chars.filter((x) => x !== c);
      if (S.hero.presetId === 'channel:' + c.id) clearHero();
      save(); renderHero(); renderGuide(); return;
    }
    const b = e.target.closest('[data-ch]'); if (!b) return;
    const c = S.channel.chars.find((x) => x.id === b.dataset.ch); if (c) { useChannelChar(c); save(); renderStyle(); renderHero(); renderGuide(); }
  });
  $('gPlays').addEventListener('change', (e) => { const c = channelChar(); if (c) { setPlays(c, e.target.value); save(); renderGuide(); } });
  $('gChStyle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chstyle]'); const c = channelChar(); if (!b || !c) return;
    if (b.dataset.chstyle === 'keep') keepCharStyle(c);
    else Object.assign(S.style, { id: presetStyle(), prefix: null, suffix: null });
    save(); renderStyle(); renderGuide();
  });
  $('gChCopy').addEventListener('click', async () => {
    const c = channelChar(); if (!c) return;
    const text = `I am attaching a picture of ${c.name}, the main character of my channel. Describe ONLY the art style of this picture, so an image generator can draw any scene in exactly the same style, including scenes where ${c.name} is not in the picture. Cover: medium (2D, 3D, photo, painting...), line work, how shapes and proportions are drawn, colour palette, shading, lighting, texture and how backgrounds are drawn. Do NOT describe the character (no face, hair or clothes).

Answer ONLY with these 4 lines, nothing else:
NAME: a short name for this style, 2 to 4 words
PREFIX: one sentence that starts every image prompt and describes the style precisely
SUFFIX: one sentence that ends every image prompt and repeats the most important style rules
AVOID: a short comma separated list of things that would break this style`;
    try { await navigator.clipboard.writeText(text); toast(`Copied. Paste it into ChatGPT or Gemini, attach ${c.name}'s picture too, then paste the reply here.`); }
    catch (e) { $('gChReply').value = text; toast('Copy blocked; the prompt is in the box below.'); }
  });
  const loadChStyle = () => {
    const c = channelChar(); const t = $('gChReply').value; if (!c) return;
    const get = (k) => ((t.match(new RegExp('^\\W*' + k + '\\W*:\\s*(.+)$', 'im')) || [])[1] || '').replace(/[*_`]+/g, '').trim();
    const prefix = get('PREFIX'), suffix = get('SUFFIX');
    if (!prefix) { if (t.trim().length > 20) toast('Could not find the PREFIX line in that reply.'); return; }
    const st = { id: 'my-' + uid(), group: 'My styles', label: get('NAME') || `${c.name}'s style`, prefix, suffix, avoid: get('AVOID'), is2D: /\b2d\b|flat|cartoon|vector|line art|illustrat|doodle|stick/i.test(prefix), refs: [], channelOf: c.id };
    S.myStyles = [st, ...(S.myStyles || []).filter((x) => x.channelOf !== c.id)].slice(0, 12);
    c.styleId = st.id; S.hero.styleId = st.id;
    Object.assign(S.style, { id: st.id, prefix: null, suffix: null }); if (st.avoid) S.style.avoid = st.avoid;
    $('gChReply').value = ''; save(); renderStyle(); renderGuide();
    toast(`"${st.label}" saved. Every slide now uses ${c.name}'s style.`);
  };
  $('gChReply').addEventListener('paste', () => setTimeout(loadChStyle, 60));
  $('gChReply').addEventListener('change', loadChStyle);
  $('gSpec').addEventListener('input', (e) => {
    S.hero.spec = e.target.value;
    if (S.hero.presetId === 'own') { const m = e.target.value.match(/^\s*"?([A-Z][\w'-]+(?: [A-Z][\w'-]+)?)"?\s*[:,—-]/); S.hero.name = m ? m[1] : S.hero.name; }
    if (S.hero.imageOnly) S.hero.label = S.hero.name;
    save();
  });
  // Own style: up to 10 example images, described by your AI, 1 or 2 attached in Flow.
  $('gOwnFiles').addEventListener('change', async (e) => {
    const fs = [...e.target.files]; e.target.value = '';
    S.ownDraft = S.ownDraft || [];
    const room = 10 - S.ownDraft.length;
    if (fs.length > room) toast(`Up to 10 images. ${room ? `Added the first ${room}.` : 'Remove one first.'}`);
    for (const f of fs.slice(0, Math.max(0, room))) S.ownDraft.push({ img: await compressImage(await blobToDataURL(f), 800), name: f.name, use: false });
    save(); renderGuide();
  });
  $('gOwnGrid').addEventListener('click', (e) => {
    const st = e.target.closest('[data-ostar]'), del = e.target.closest('[data-odel]');
    if (st) { const o = S.ownDraft[+st.dataset.ostar]; if (!o.use && S.ownDraft.filter((x) => x.use).length >= 2) return toast('Pick at most 2. Unstar one first.'); o.use = !o.use; }
    if (del) S.ownDraft.splice(+del.dataset.odel, 1);
    save(); renderGuide();
  });
  $('gOwnCopy').addEventListener('click', async () => {
    const n = (S.ownDraft || []).length;
    const text = `I am attaching ${n} example image${n > 1 ? 's' : ''} that show the visual style I want for every image in my video. Study what they have in common: medium (2D, 3D, photo, painting...), line work, shapes, colour palette, lighting, texture, level of detail, camera feel and mood. Ignore the subjects, people and text in them.

Answer ONLY with these 4 lines, nothing else:
NAME: a short name for this style, 2 to 4 words
PREFIX: one sentence that starts every image prompt and describes the style precisely (medium, line work, colours, lighting, texture)
SUFFIX: one sentence that ends every image prompt and repeats the most important style rules
AVOID: a short comma separated list of things that would break this style`;
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into ChatGPT or Gemini, attach your images there too, then paste the reply here.'); }
    catch (e) { $('gOwnReply').value = text; toast('Copy blocked; the prompt is in the box below.'); }
  });
  const loadOwn = () => {
    const t = $('gOwnReply').value;
    const get = (k) => ((t.match(new RegExp('^\\W*' + k + '\\W*:\\s*(.+)$', 'im')) || [])[1] || '').replace(/[*_`]+/g, '').trim();
    const prefix = get('PREFIX'), suffix = get('SUFFIX');
    if (!prefix) { if (t.trim().length > 20) toast('Could not find the PREFIX line in that reply.'); return; }
    const label = get('NAME') || 'My style';
    const refs = [];
    const st = { id: 'my-' + uid(), group: 'My styles', label, prefix, suffix, avoid: get('AVOID'), is2D: /\b2d\b|flat|cartoon|vector|line art|illustrat/i.test(prefix), refs };
    S.myStyles = [st, ...(S.myStyles || [])].slice(0, 12);
    Object.assign(S.style, { id: st.id, prefix: null, suffix: null });
    if (st.avoid) S.style.avoid = st.avoid;
    S.ownDraft = []; $('gOwnReply').value = ''; $('gOwn').open = false;
    save(); renderStyle(); renderGuide();
    toast(`"${label}" saved and selected. It stays in your style list for future videos.`);
  };
  $('gOwnReply').addEventListener('paste', () => setTimeout(loadOwn, 60));
  $('gOwnReply').addEventListener('change', loadOwn);
  // Your own picture of the main character, locked in like a character sheet.
  $('gCharFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    Object.assign(S.hero, { refImage: await compressImage(await blobToDataURL(f), 1024), refFrom: 'upload', attach: 'every', imageOnly: true, label: S.hero.name || '', chosen: true });
    if (!S.hero.spec.trim()) { S.hero.presetId = 'own'; S.hero.spec = 'the main character (from your picture)'; toast('Picture locked in. Give them a name in Edit description so the agent knows which slides they are in.'); $('gSpecEdit').open = true; $('gSpec').focus(); }
    else toast('Locked in. Your picture is now the only source of their look.');
    save(); renderHero(); renderGuide();
  });
  $('gSheet').addEventListener('click', () => { if (!S.hero.spec.trim()) return toast('Describe the character first.'); if (R.running) return toast('Wait for the current run to finish.'); R.sheetOnly = true; $('genSheet').click(); renderGuide(); });
  $('gSheets').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sheet]'); if (!b) return;
    const sh = S.sheets[+b.dataset.sheet];
    const blob = sh && await BBStore.get(sh.key);
    if (!blob) return toast('That sheet is no longer stored.');
    // The chosen sheet is attached in Flow for every slide this character is in, for the whole batch.
    Object.assign(S.hero, { refImage: await compressImage(await blobToDataURL(blob)), refFrom: sh.key, attach: 'every', imageOnly: false, chosen: true });
    save(); renderHero(); renderGuide(); toast('Locked in. This sheet goes into every slide with this character.');
  });
  $('gVo').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) syncFiles(fs, false); });
  $('gVoMore').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) syncFiles(fs, true); });
  $('gAnim').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (!b) return; S.anim.level = b.dataset.level; save(); renderAnim(); renderRun(); renderGuide(); });
}

function bind() {
  bindGuide();
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('conn').addEventListener('click', async () => { const r = await checkConn(); if (!r) chrome.runtime.sendMessage({ type: 'bg:openFlow' }); });
  $('openSettings').addEventListener('click', () => $('settings').showModal());
  $('closeSettings').addEventListener('click', () => $('settings').close());

  // Script
  const m = S.mother;
  $('mSecs').value = secsPer(); $('mWps').value = m.wps; $('mExtra').value = m.extra;
  // ---------- AI helper ----------
  const motherText = () => {
    { const n = Math.max(1, Math.min(12, +$('mSecs').value || 6)); Object.assign(S.mother, { secs: n, min: n, max: n, wps: +$('mWps').value || 2.5, extra: $('mExtra').value.trim() }); }
    save();
    return bbMotherPrompt({ secs: secsPer(), minSecs: secsPer(), maxSecs: secsPer(), wordsPerSecond: S.mother.wps, extra: S.mother.extra, heroWord: S.hero.name ? S.hero.name : 'the hero', script: $('mScript').value.trim(), target: paceEstimate().images });
  };
  const busy = (btn, on, label) => { btn.disabled = on; btn.classList.toggle('busy', on); if (on) btn.dataset.busy = label; };
  $('makeList').addEventListener('click', async () => {
    const script = $('mScript').value.trim();
    if (!script) return toast('Paste your script first.');
    if (!BBAI.hasKey()) { $('settings').showModal(); $('aiKey').focus(); return toast('Add your free Gemini API key once, then tap Make my shot list again.'); }
    const btn = $('makeList'); const t0 = Date.now();
    const tick = setInterval(() => { btn.dataset.busy = `Writing your shot list… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
    busy(btn, true, 'Writing your shot list…');
    try {
      const reply = await BBAI.ask(motherText(), (m) => log(m));
      if (!ingest(reply, false)) { $('paste').value = reply; throw new Error('The AI reply had no shot list in it. It is in the box below; try again or check it.'); }
      S.batchName = safeName(script.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).slice(0, 5).join('_')) || S.batchName; $('batchName').value = S.batchName; save();
      log(`Shot list made by AI in ${Math.round((Date.now() - t0) / 1000)}s.`);
    } catch (e) { toast(e.message); log(e.message); }
    finally { clearInterval(tick); busy(btn, false); }
  });
  $('aiSave').addEventListener('click', async () => {
    const k = $('aiKey').value.trim(); if (!k) return toast('Paste the key first.');
    await BBAI.setKey(k); await sleep(100);
    busy($('aiSave'), true, 'Testing…');
    try { await BBAI.ask('Reply with the single word OK.'); $('makeList').hidden = false; $('aiStatus').textContent = 'Connected. Bolblar can now write your shot lists and descriptions.'; $('aiKey').value = ''; $('aiKey').placeholder = 'Key saved'; toast('AI helper connected.'); }
    catch (e) { $('aiStatus').textContent = e.message; toast(e.message); }
    finally { busy($('aiSave'), false); }
  });
  chrome.storage.local.get(['bb_aiKey'], (r) => { if (r.bb_aiKey) { $('aiKey').placeholder = 'Key saved'; $('aiStatus').textContent = 'Connected.'; $('makeList').hidden = false; } });
  $('copyMother').addEventListener('click', async () => {
    { const n = Math.max(1, Math.min(12, +$('mSecs').value || 6)); Object.assign(S.mother, { secs: n, min: n, max: n, wps: +$('mWps').value || 2.5, extra: $('mExtra').value.trim() }); }
    save();
    const text = motherText();
    if (!$('mScript').value.trim()) toast('Tip: paste your script in box 1 first, so it goes into the prompt.');
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into ChatGPT, Gemini or Claude, then paste the reply in box 2.'); }
    catch (e) { $('paste').value = text; toast('Copy blocked; the prompt is in the paste box.'); }
  });
  $('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  // A reply pasted into box 2 loads by itself.
  $('paste').addEventListener('paste', () => setTimeout(() => {
    const t = $('paste').value;
    if (t.trim().length > 20 && ingest(t, false)) { log('AI reply loaded.'); }
  }, 60));
  $('usePaste').addEventListener('click', () => { if (!ingest($('paste').value, false)) toast('Paste some prompts first.'); });
  $('appendPaste').addEventListener('click', () => { if (!ingest($('paste').value, true)) toast('Paste some prompts first.'); });
  $('batchName').addEventListener('change', (e) => { S.batchName = safeName(e.target.value); e.target.value = S.batchName; save(); });
  $('secs').addEventListener('change', (e) => { S.secs = Math.max(1, +e.target.value || 5); save(); });
  $('srtFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) syncFiles([f]); });
  $('fitBtn').addEventListener('click', () => {
    const t = bbSeconds($('fitTo').value);
    if (!S.slides.length) return toast('Load prompts first.');
    if (!t) { bbMakeContinuous(S.slides); toast('Removed gaps and overlaps.'); }
    else { bbFitToDuration(S.slides, t); toast(`Timeline fitted to ${bbClock(t)}.`); }
    save(); renderAll();
  });

  // Hero
  $('heroChips').addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.id; if (!id) return;
    const h = id === 'none' ? { spec: '', name: '' } : allHeroes().find((x) => x.id === id);
    Object.assign(S.hero, { presetId: id, spec: h.spec, name: h.name || '' });
    save(); renderHero(); renderComposed();
  });
  $('heroSpec').addEventListener('input', (e) => { S.hero.spec = e.target.value; save(); renderComposed(); });
  $('heroName').addEventListener('input', (e) => { S.hero.name = e.target.value.trim(); save(); renderComposed(); });
  $('lockMode').addEventListener('change', (e) => { S.hero.lockMode = e.target.value; save(); renderComposed(); });
  $('attachMode').addEventListener('change', (e) => {
    S.hero.attach = e.target.value;
    if (S.hero.attach !== 'off' && !S.hero.refImage) toast('Upload a reference image or use a character sheet.');
    save(); renderComposed();
  });
  $('saveHero').addEventListener('click', () => {
    const label = S.hero.name || `My hero ${S.hero.custom.length + 1}`;
    const h = { id: 'c_' + uid(), label, spec: S.hero.spec, name: S.hero.name };
    S.hero.custom.push(h); S.hero.presetId = h.id; save(); renderHero(); toast(`Saved "${label}".`);
  });
  $('delHero').addEventListener('click', () => { S.hero.custom = S.hero.custom.filter((h) => h.id !== S.hero.presetId); S.hero.presetId = 'none'; S.hero.spec = ''; S.hero.name = ''; save(); renderHero(); renderComposed(); });
  $('copySpec').addEventListener('click', async () => { await navigator.clipboard.writeText(S.hero.spec).catch(() => {}); toast('Spec copied.'); });
  $('refFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    S.hero.refImage = await compressImage(await blobToDataURL(f));
    if (S.hero.attach === 'off') S.hero.attach = 'once';
    save(); renderHero(); toast('Reference image set.'); e.target.value = '';
  });
  enableDrop(document.body, '#refBox', async (t, blob) => {
    S.hero.refImage = await compressImage(await blobToDataURL(blob));
    if (S.hero.attach === 'off') S.hero.attach = 'once';
    save(); renderHero(); toast('Reference image set.');
  });
  $('testRef').addEventListener('click', async () => {
    if (!S.hero.refImage) return toast('Add a reference image first.');
    try {
      const a = await send({ type: 'attachRef', dataUrl: S.hero.refImage, name: 'hero.jpg' });
      log(a.ok ? `Test: reference sent to Flow (${a.via}).` : 'Test: ' + a.error);
      toast(a.ok ? 'Look at Flow\'s prompt box: the image should now be attached. Nothing was generated. Remove it there with its ✕.' : 'Could not attach: ' + a.error);
    } catch (e) { toast(e.message); }
  });
  $('clearRef').addEventListener('click', () => { S.hero.refImage = ''; S.hero.attach = 'off'; save(); renderHero(); });
  $('genSheet').addEventListener('click', () => {
    if (!S.hero.spec.trim()) return toast('Describe the hero first.');
    S.sheetJob = { kind: 'sheet', n: 0, prompt: 'character model sheet', start: 0, end: 0, status: 'pending', images: [], attempts: 0 };
    renderHero(); toast('Character sheet queued.');
    if (!R.running) startRun();
  });
  $('sheets').addEventListener('click', async (e) => {
    const i = e.target.dataset && e.target.dataset.useref; if (i == null) return;
    const blob = await BBStore.get(S.sheets[+i].key);
    if (!blob) return toast('That sheet is no longer stored.');
    S.hero.refImage = await compressImage(await blobToDataURL(blob));
    if (S.hero.attach === 'off') S.hero.attach = 'once';
    save(); renderHero(); toast('Character sheet is now the hero reference.');
  });

  bindCast();
  $('animLevels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (!b) return; S.anim.level = b.dataset.level; save(); renderAnim(); renderRun(); });

  // Style
  $('stylePreset').addEventListener('change', (e) => { Object.assign(S.style, { id: e.target.value, prefix: null, suffix: null }); save(); renderStyle(); });
  $('stylePrefix').addEventListener('input', (e) => { S.style.prefix = e.target.value; save(); renderComposed(); });
  $('styleSuffix').addEventListener('input', (e) => { S.style.suffix = e.target.value; save(); renderComposed(); });
  $('styleEnforce').addEventListener('change', (e) => { S.style.enforce = e.target.checked; save(); renderComposed(); });
  $('avoid').addEventListener('input', (e) => { S.style.avoid = e.target.value; save(); renderComposed(); });
  $('resetStyle').addEventListener('click', () => { S.style.prefix = null; S.style.suffix = null; save(); renderStyle(); });
  $('previewPick').addEventListener('change', renderComposed);
  $('copyAll').addEventListener('click', async () => {
    const all = S.slides.map((s) => `Slide ${s.n} [${bbClock(s.start)}–${bbClock(s.end)}]\n${bbCompose(s, S)}`).join('\n\n');
    await navigator.clipboard.writeText(all).catch(() => {}); toast(`Copied ${S.slides.length} prompts.`);
  });

  // Run
  $('start').addEventListener('click', startRun);
  $('pause').addEventListener('click', () => { R.paused = !R.paused; R.bgPaused = false; if (!R.paused) banner(''); renderRun(); });
  $('stop').addEventListener('click', () => {
    if (R.stopping) {
      jobs().filter((j) => j.status === 'creating').forEach((j) => { j.status = 'pending'; });
      R.paused = false; R.stopping = true; log('Stopped now.');
      // Loop exits on its next turn because nothing is creating and no new work is taken.
    } else { R.stopping = true; toast('Finishing the images in progress, then stopping.'); }
    renderRun();
  });
  $('skip').addEventListener('click', () => {
    if (R.video) { R.skipVideo = true; toast('Skipping this video.'); return; }
    const j = jobs().filter((x) => x.status === 'creating').sort((a, b) => a.submittedAt - b.submittedAt)[0];
    if (!j) return;
    j.status = 'skipped'; j.skippedAt = Date.now(); j.error = 'Skipped by you. Tap Redo to make it again.';
    if (j.slowWarned) { j.slowWarned = false; banner(''); }
    if (j.kind === 'sheet') { S.sheetJob = null; renderHero(); renderCast(); }
    log(`${j.kind === 'sheet' ? 'Character sheet' : 'Slide ' + j.n}: skipped. Moving to the next one.`);
    save(); renderRun();
  });
  $('animate').addEventListener('click', () => runVideos());
  $('retry').addEventListener('click', () => {
    S.slides.forEach((s) => { if (s.status === 'failed' || s.status === 'skipped') { s.status = 'pending'; s.attempts = 0; s.error = ''; s.blocked = false; } });
    save(); renderRun(); if (!R.running) startRun();
  });
  $('strip').addEventListener('click', (e) => {
    const i = e.target.dataset && e.target.dataset.i; if (i == null) return;
    R.filter = 'all'; R.open = +i; syncFilters(); renderRun();
    const el = $('slides').querySelector(`[data-open="${i}"]`); if (el) el.scrollIntoView({ block: 'center' });
  });
  $('filters').addEventListener('click', (e) => { const f = e.target.dataset && e.target.dataset.f; if (!f) return; R.filter = f; syncFilters(); renderRun(); });
  $('slides').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-anim]');
    if (t) {
      const s = S.slides[+t.dataset.anim];
      s.anim = animPlan().has(s) ? 'off' : 'on';
      save(); renderRun(); renderAnim();
      return;
    }
    const d = e.target.closest('[data-open],[data-save],[data-redo],[data-skipone],[data-dl]');
    if (!d) return;
    const ds = d.dataset;
    if (ds.open != null && !e.target.closest('.edit')) { R.open = R.open === +ds.open ? null : +ds.open; renderRun(); return; }
    const i = +(ds.save ?? ds.redo ?? ds.skipone ?? ds.dl), s = S.slides[i];
    if (ds.save != null || ds.redo != null) {
      const np = $('ep' + i).value.trim(); if (np && np !== s.prompt) { s.safe = 0; s.safePrompt = ''; s.blocked = false; }
      s.prompt = np || s.prompt; s.narration = $('en' + i).value; s.overlay = $('eo' + i).value;
      const st = bbSeconds($('es' + i).value), en = bbSeconds($('ee' + i).value);
      if (st != null && en != null && en > st) { s.start = st; s.end = en; } else if ($('es' + i).value || $('ee' + i).value) toast('Times look wrong, so they were kept. Use mm:ss or mm:ss.s');
    }
    if (ds.redo != null) {
      for (const im of s.images) await BBStore.del(im.key);
      Object.assign(s, { images: [], status: 'pending', attempts: 0, error: '' });
      if (!R.running) startRun();
    }
    if (ds.skipone != null) s.status = 'skipped';
    if (ds.dl != null) toast(`Saved ${await downloadSlide(s)} image(s).`);
    if (ds.save != null) toast('Saved.');
    save(); renderRun();
  });

  // Files
  $('autoDl').addEventListener('change', (e) => { S.settings.autoDl = e.target.checked; save(); });
  $('nameFormat').addEventListener('change', (e) => { S.settings.nameFormat = e.target.value; save(); });
  $('folder').addEventListener('change', (e) => { S.settings.folder = safeName(e.target.value) || 'Bolblar'; e.target.value = S.settings.folder; save(); });
  $('dlAll').addEventListener('click', async () => {
    if (!confirmGaps()) return; let n = 0; for (const s of S.slides) n += await downloadSlide(s); toast(`Saved ${n} images to Downloads/${folderPath()}.`); });
  $('zipAll').addEventListener('click', () => zipAll().catch((e) => toast('ZIP failed: ' + e.message)));
  $('shareImgs').hidden = !(DEVICE.mobile && canShareFiles());
  if (DEVICE.android) $('shareImgs').textContent = 'Save to device (Gallery, Photos, Drive)';
  $('shareImgs').addEventListener('click', () => shareOrPrepare($('shareImgs'), collectImageFiles, (n) => `Tap again to save ${n} images`).catch((e) => toast(e.message)));
  if (DEVICE.ios) $('filesNote').textContent = 'On iPhone, save images through the share sheet: choose Save Images for Photos, or Save to Files.';
  $('runCheck').addEventListener('click', () => setupCheck().catch((e) => toast(e.message)));
  $('dlManifest').addEventListener('click', () => saveBlob(new Blob([JSON.stringify(manifest(), null, 2)], { type: 'application/json' }), `${folderPath()}/bolblar-timeline.json`));
  $('dlCsv').addEventListener('click', () => saveBlob(new Blob([statusCSV()], { type: 'text/csv' }), `${folderPath()}/status.csv`));
  $('clear').addEventListener('click', () => { $('filesDlg').close(); newVideo(); });
  $('newVideo').addEventListener('click', newVideo);
  $('newVideo2').addEventListener('click', newVideo);

  // Settings
  const num = (id, key, min, max) => $(id).addEventListener('change', (e) => { S.settings[key] = Math.min(max, Math.max(min, +e.target.value || min)); e.target.value = S.settings[key]; save(); renderChips(); });
  num('gap', 'gap', 2, 120); num('dailyCap', 'dailyCap', 0, 5000); num('restEvery', 'restEvery', 0, 500); num('restMins', 'restMins', 0, 60);
  $('ping').addEventListener('change', (e) => { S.settings.ping = e.target.checked; save(); });
  $('pickPrompt').addEventListener('click', async () => { $('settings').close(); await send({ type: 'pick', kind: 'prompt' }).catch((e) => toast(e.message)); toast('Now tap the prompt box in Flow.'); });
  $('pickSubmit').addEventListener('click', async () => { $('settings').close(); await send({ type: 'pick', kind: 'submit' }).catch((e) => toast(e.message)); toast('Now tap the create button in Flow.'); });
  $('showTargets').addEventListener('click', async () => {
    try { const a = await send({ type: 'flash', kind: 'prompt' }); await sleep(1700); const b = await send({ type: 'flash', kind: 'submit' }); toast(`Prompt box ${a.ok ? 'found' : 'missing'}, create button ${b.ok ? 'found' : 'missing'}.`); }
    catch (e) { toast(e.message); }
  });
  $('clearTargets').addEventListener('click', () => { chrome.storage.local.set({ bb_targets: { prompt: '', submit: '' } }); toast('Locks cleared.'); });
  chrome.storage.onChanged.addListener((c) => { if (c.bb_targets && c.bb_targets.newValue && (c.bb_targets.newValue.prompt || c.bb_targets.newValue.submit)) toast('Target locked.'); });
  $('testSubmit').addEventListener('click', async () => {
    if (R.running) return toast('Stop the batch first.');
    if (!(await gateCheck(false))) return; // a test prompt is a real Flow generation, so it needs an active subscription too
    try { R.useCdp = S.settings.engine === 'precision' && await BBEngine.precisionAllowed() && await BBEngine.attach(); const ok = await typeAndSubmit('A single red apple on a white table, soft daylight.'); toast(ok ? 'Flow accepted the test prompt.' : 'Sent. Check Flow to confirm it started.'); }
    catch (e) { toast(e.message); }
    finally { if (R.useCdp) await BBEngine.detach(); R.useCdp = false; }
  });
}
function syncFilters() { document.querySelectorAll('#filters button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === R.filter)); }

// Flow's page reports its model, size and x1 to x4 the moment they change.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return; // only this extension (security review EXT-12)
  if (msg && msg.type === 'flow:visibility') {
    // Phones freeze background tabs, so a batch would stall or misfire. Pause and pick up again on return.
    if (!DEVICE.mobile || !R.running) return;
    if (msg.hidden && !R.paused) { R.paused = true; R.bgPaused = true; banner('Paused because Flow went to the background. It continues when you come back to the Flow tab.'); log('Flow went to the background, paused.'); renderRun(); }
    else if (!msg.hidden && R.bgPaused) { R.bgPaused = false; R.paused = false; banner(''); log('Flow is back, resuming.'); renderRun(); }
    return;
  }
  if (!msg || msg.type !== 'flow:settings') return;
  const before = JSON.stringify(S.flow);
  mergeFlow(msg);
  if (before !== JSON.stringify(S.flow)) {
    save(); renderChips(); renderSettings();
    if (R.running && !R.video && S.flow.mode === 'video') { R.paused = true; renderRun(); }
    if (R.running) log(`Flow settings changed: ${[S.flow.model, S.flow.ratio, S.flow.count ? 'x' + S.flow.count : ''].filter(Boolean).join(', ')}.`);
  }
});

// ---------- subscription ----------
const GATE_MSG = {
  none: '', unknown: "That code wasn't found. Check it, or tap Lost your code below.",
  devices: 'This code is already used on 2 devices. Reinstalled the agent or changed computer? Tap Sign out my other devices (allowed 2 times a month).',
  swap_limit: 'This code has already moved to a new device 2 times in the last 30 days. Message us on Telegram (link below) and we will sort it out.',
  ended: 'Your subscription has ended. Subscribe again to continue. Your work is still saved.',
  payment_failed: "Your last payment didn't go through. Subscribe again to continue. Your work is still saved.",
  blocked: 'This code has been turned off. Message us on Telegram (link below).',
  offline: "Can't reach the Bolblar server. Check your internet and try again.",
  not_paid: "We didn't see a payment yet. If you paid, wait a minute and tap Unlock with the code from your email.",
  email: 'Enter a valid email.', already_active: 'This email already has an active subscription. Enter its access code below. Lost it? Message us on Telegram (link below).',
  server: 'Something went wrong. Try again in a minute.', missing: 'Enter your access code.'
};
function showGate(reason) {
  $('gate').hidden = false;
  $('gateMsg').textContent = GATE_MSG[reason] || '';
  $('gateSwap').hidden = reason !== 'devices';
  $('gateWait').hidden = true; $('gateSub').hidden = false;
  BBLicense.price().then((p) => { $('gatePrice').hidden = !p; $('gatePrice').textContent = p; });
}
function unlocked(st) {
  $('gate').hidden = true;
  if (st && st.paymentFailed) toast("Your last payment didn't go through. Update your card in Settings to keep using Bolblar.");
  renderSub();
}
async function gateCheck(force) {
  const st = await BBLicense.check(force);
  if (st.ok) { unlocked(st); return true; }
  showGate(st.reason);
  return false;
}
function renderSub() {
  const st = BBLicense.current() || {};
  $('subBox').hidden = false;
  if (!BBLicense.enabled) { $('subStatus').textContent = 'Subscription check is off in this copy (test mode).'; $('subCode').textContent = ''; ['subCopy', 'subManage', 'subSignOut'].forEach((id) => { $(id).hidden = true; }); return; }
  const until = st.until ? new Date(st.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  $('subStatus').textContent = st.ok ? `${st.paymentFailed ? "Payment failed: update your card soon. " : st.status === 'cancelling' ? 'Cancelled: ' : 'Active: '}access until ${until}${st.email ? ` (${st.email})` : ''}${st.offline ? '. Offline right now.' : '.'}` : 'Not active.';
  // The access code is the key to the subscription: shown masked, copied in full (security review EXT-03).
  $('subCode').textContent = st.code ? `••••${String(st.code).slice(-4)}` : '';
  $('subCode').dataset.full = st.code || '';
  $('subCopy').hidden = !st.code; $('subSignOut').hidden = !st.code; $('subManage').hidden = !st.canManage;
  const tg = BBLicense.safeLink('telegram', st.telegram);
  $('subTelegram').hidden = !tg; if (tg) $('subTelegram').href = tg;
}
function bindGate() {
  const msg = (t, reason) => { $('gateMsg').textContent = t; $('gateSwap').hidden = reason !== 'devices'; };
  $('gateSubscribe').addEventListener('click', async () => {
    const email = $('gateEmail').value.trim(); msg('');
    try {
      const r = await BBLicense.subscribe(email, () => { $('gateSub').hidden = true; $('gateWait').hidden = false; });
      if (r.ok) { unlocked(r); toast('Unlocked. Your access code is in Settings, with a Copy button. Keep it private.'); }
      else { $('gateSub').hidden = false; $('gateWait').hidden = true; msg(GATE_MSG[r.reason] || GATE_MSG.server); }
    } catch (e) { $('gateSub').hidden = false; $('gateWait').hidden = true; msg(GATE_MSG.offline); }
  });
  $('gateCancelWait').addEventListener('click', () => { $('gateSub').hidden = false; $('gateWait').hidden = true; });
  $('gateUnlock').addEventListener('click', async () => {
    const code = $('gateCode').value.trim(); if (!code) return msg(GATE_MSG.missing);
    R.gateCode = code;
    const r = await BBLicense.activate(code);
    if (r.ok) { unlocked(r); toast('Unlocked. Welcome to Bolblar.'); } else msg(GATE_MSG[r.reason] || GATE_MSG.server, r.reason);
  });
  $('gateSwap').addEventListener('click', async () => {
    if (!confirm('Sign out every other device using this code, and use it here?\n\nAllowed 2 times every 30 days.')) return;
    const btn = $('gateSwap'); btn.disabled = true;
    const r = await BBLicense.swap(R.gateCode || $('gateCode').value.trim() || '');
    btn.disabled = false;
    if (r.ok) { unlocked(r); toast(`Done. Your other devices are signed out${r.swapsLeft != null ? ` (${r.swapsLeft} move${r.swapsLeft === 1 ? '' : 's'} left this month)` : ''}.`); }
    else msg(GATE_MSG[r.reason] || GATE_MSG.server, r.reason);
  });
  $('gateCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gateUnlock').click(); });
  try { const sup = (typeof BB_LICENSE_CONFIG !== 'undefined' && BB_LICENSE_CONFIG.support) || ''; if (sup) $('gateHelp').href = sup; } catch (e) {}
  $('subCopy').addEventListener('click', async () => { await navigator.clipboard.writeText($('subCode').dataset.full || '').catch(() => {}); toast('Code copied.'); });
  $('subManage').addEventListener('click', async () => { try { const r = await BBLicense.manage(); if (!r.ok) toast('Could not open the subscription page. Try again later.'); } catch (e) { toast(GATE_MSG.offline); } });
  $('subSignOut').addEventListener('click', async () => {
    if (R.running) return toast('Stop the batch first.');
    if (!confirm('Sign out of this device? This frees one of your 2 device slots. Your images and settings stay here.')) return;
    await BBLicense.signOut(); $('settings').close(); showGate('none');
  });
}

// Show the yellow "new version" bar when the server says a newer version is out.
async function checkUpdate() {
  const u = await BBLicense.update();
  const bar = $('updateBar');
  bar.hidden = !u;
  document.body.classList.toggle('hasUpdate', !!u);
  if (u) { bar.href = u.link; bar.title = `Version ${u.latest} is ready${u.sha256 ? `. SHA-256 of the zip: ${u.sha256}` : ''}`; }
}

// Start a new video: clears this script, its shot list, characters, voiceover and images.
// Keeps the style, settings, save folder and subscription. Files already saved stay where they are.
async function newVideo() {
  if (R.running) return toast('Stop the batch first, then start a new video.');
  const made = S.slides.filter((s) => s.images.length).length;
  const msg = S.slides.length || $('gScript').value.trim()
    ? `Start a new video?\n\nThis clears the script, shot list, characters, voiceover${made ? ` and the ${made} images in the agent` : ''}.${made ? ' Images already saved to your folder or Downloads stay there.' : ''}\n\nYour style and settings are kept.`
    : '';
  if (msg && !confirm(msg)) return;
  await BBStore.clear().catch(() => {});
  if (R.dir) await BBStore.put('__savefolder', R.dir).catch(() => {}); // keep the chosen folder
  const m = /^(.*?)(\d+)$/.exec(S.batchName || '');
  const nextName = S.slides.length ? (m ? m[1] + (+m[2] + 1) : (S.batchName || 'video') + '_2') : S.batchName;
  Object.assign(S, { slides: [], review: [], sheets: [], cast: [], sheetJob: null, voName: '', voParts: [], batchId: uid(), batchName: nextName });
  if (String(S.hero.presetId || '').startsWith('channel:')) { const c = channelChar(); if (c) setPlays(c, ''); S.hero.playsFor = ''; }
  else if (String(S.hero.presetId || '').startsWith('cast:')) clearHero(false);
  R.pick = null; R.peopleAll = false;
  R.voParts = []; R.sheetQueue = []; R.open = null; R.filter = 'all';
  ['gScript', 'mScript', 'gReply'].forEach((id) => { if ($(id)) $(id).value = ''; });
  if ($('batchName')) $('batchName').value = S.batchName;
  banner(''); S.ui.step = 1; save(); renderAll(); gGo(1);
  toast(`Ready for a new video${S.batchName ? ` (${S.batchName})` : ''}. Your style and settings are kept.`);
}

(async function init() {
  await load();
  bindGate();
  // A payment that was in progress when the panel closed: keep waiting for it.
  BBLicense.pendingCheckout().then((ref) => { if (ref && BBLicense.enabled) BBLicense.waitForPayment(ref).then((r) => { if (r.ok) { unlocked(r); toast(`Unlocked. Your access code is ${r.code}.`); } }); });
  gateCheck(false);
  checkUpdate();
  setInterval(() => { if (!R.running) { gateCheck(false); checkUpdate(); } }, 60 * 60000);
  loadDir();
  try { $('appVersion').textContent = 'Version ' + chrome.runtime.getManifest().version; } catch (e) {}
  $('batchName').value = S.batchName; $('secs').value = S.secs;
  bind(); renderAll(); checkConn();
  setInterval(() => { if (!R.running) checkConn(); }, 6000);
  setInterval(() => { if (!R.running && Date.now() < (R.watchUntil || 0)) poll().catch(() => {}); }, 3000);
  if (IS_OVERLAY) document.body.classList.add('overlay');
})();
