// Bolblar Agent content script. Runs on Google Flow (flow.google.com and labs.google).
// Responsibilities: find the prompt box and create button, type and submit,
// watch for new images and Google warnings, grab finished images,
// attach the hero reference, and host the floating panel on phones.

(() => {
  if (window.__bolblarLoaded) return;
  window.__bolblarLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets = { prompt: '', submit: '' };
  chrome.storage.local.get(['bb_targets'], (r) => { if (r.bb_targets) targets = r.bb_targets; });
  chrome.storage.onChanged.addListener((c) => { if (c.bb_targets) targets = c.bb_targets.newValue || { prompt: '', submit: '' }; });

  const ROOT_ID = 'bolblar-root';
  const isOurs = (el) => !!(el && el.closest && el.closest('#' + ROOT_ID));

  function visible(el) {
    if (!el || !el.isConnected || isOurs(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  }
  const label = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.title || '') + ' ' + (el.innerText || '')).toLowerCase().replace(/\s+/g, ' ').trim();

  function cssPath(el) {
    if (el.id && !/\d{4,}|:/.test(el.id)) return '#' + CSS.escape(el.id);
    for (const a of ['aria-label', 'placeholder', 'data-testid']) {
      const v = el.getAttribute(a);
      if (v && v.length < 80) {
        const sel = `${el.tagName.toLowerCase()}[${a}="${CSS.escape(v)}"]`;
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
      }
    }
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body && parts.length < 8) {
      let p = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(p);
      const sel = parts.join(' > ');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
      n = parent;
    }
    return parts.join(' > ');
  }

  // ---------- target detection ----------
  function findPromptBox() {
    if (targets.prompt) {
      try { const el = document.querySelector(targets.prompt); if (visible(el)) return el; } catch (e) {}
    }
    const cands = [...document.querySelectorAll('[data-slate-editor="true"], textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
    let best = null, bestScore = -Infinity;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      const hint = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('aria-placeholder') || '') + ' ' + (el.parentElement ? el.parentElement.innerText.slice(0, 200) : '')).toLowerCase();
      let score = (r.width * Math.max(r.height, 20)) / 2000;
      if (/what do you want to create|prompt|describe|create/.test(hint)) score += 400;
      if (el.hasAttribute('data-slate-editor')) score += 300;
      if (/search|rename|project name|title/.test(hint)) score -= 600;
      score += (r.bottom / window.innerHeight) * 200; // Flow keeps the prompt bar low on the screen
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function promptCard(box) {
    let n = box;
    for (let i = 0; i < 8 && n && n.parentElement; i++) {
      n = n.parentElement;
      const btns = n.querySelectorAll('button, [role="button"]');
      if (btns.length >= 2 && n.getBoundingClientRect().width > 200) return n;
    }
    return box ? box.parentElement : null;
  }

  function findSubmit(box) {
    if (targets.submit) {
      try { const el = document.querySelector(targets.submit); if (visible(el)) return el.closest('button,[role="button"]') || el; } catch (e) {}
    }
    const card = box ? promptCard(box) : document.body;
    const pool = [...(card || document.body).querySelectorAll('button, [role="button"]')].filter(visible);
    const br = box ? box.getBoundingClientRect() : null;
    let best = null, bestScore = -Infinity;
    for (const b of pool) {
      const t = label(b);
      const r = b.getBoundingClientRect();
      let score = 0;
      if (/arrow_forward|arrow_upward|send|generate|create|submit/.test(t)) score += 500;
      if (/^\+$|add|attach|upload|ingredient|agent|banana|imagen|veo|16:9|9:16|1:1|x[1-4]\b|[1-4]x\b|settings|menu|close|clear|delete|mic|voice|expand|collapse/.test(t)) score -= 800;
      if (Math.abs(r.width - r.height) < 10 && r.width >= 24 && r.width <= 72) score += 120; // round icon button
      if (br) {
        score += (r.right - br.left) / 4; // rightmost wins
        if (r.top > br.bottom + 200 || r.bottom < br.top - 80) score -= 400;
      }
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  const isDisabled = (b) => !b || b.disabled || b.getAttribute('aria-disabled') === 'true';

  // ---------- typing ----------
  function readPrompt(el) {
    if (!el) return '';
    return ((el.value !== undefined && el.tagName !== 'DIV') ? el.value : el.innerText || '').replace(/[\u200B\uFEFF]/g, '').trim();
  }

  async function focusAndSelect(el) {
    el.scrollIntoView({ block: 'nearest' });
    el.focus();
    await sleep(60);
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.select();
    else document.execCommand('selectAll', false, null);
    await sleep(40);
  }

  async function domType(el, text) {
    await focusAndSelect(el);
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const ok = document.execCommand('insertText', false, text);
      if (!ok || !readPrompt(el).includes(text.slice(0, 20))) {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
    }
    await sleep(200);
    return readPrompt(el).includes(text.slice(0, 20).trim());
  }

  function domClick(b) {
    const r = b.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    b.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
    b.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    b.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerType: 'mouse', isPrimary: true }));
    b.dispatchEvent(new MouseEvent('mouseup', o));
    b.click(); // single real click event; no extra channels, so a slide is never submitted twice
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  // ---------- reference image attach ----------
  async function dataUrlToFile(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name || 'hero.png', { type: blob.type || 'image/png' });
  }
  function findImageInput(root) {
    return [...(root || document).querySelectorAll('input[type="file"]')].find((i) => !isOurs(i) && (!i.accept || /image/.test(i.accept)));
  }
  // The prompt bar area where Flow shows attached reference images ("ingredients").
  function refArea() {
    const box = findPromptBox(); if (!box) return null;
    let area = promptCard(box);
    const up = area && area.parentElement;
    if (up && up.getBoundingClientRect().height < 420) area = up;
    return area;
  }
  const REF_MARK = '[class*="ingredient" i],[data-testid*="ingredient" i],[aria-label*="ingredient" i],[class*="reference" i],[class*="attachment" i]';
  function refThumbs() {
    const out = new Set();
    const area = refArea();
    if (area) for (const img of area.querySelectorAll('img')) {
      if (isOurs(img) || !visible(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width <= 160 && r.height <= 160) out.add(img);
    }
    for (const el of document.querySelectorAll(REF_MARK)) for (const img of el.querySelectorAll('img')) if (!isOurs(img) && visible(img)) out.add(img);
    return [...out];
  }
  function refSlot() { const t = refThumbs(); return { ok: true, count: t.length, srcs: t.map((i) => i.currentSrc || i.src) }; }
  // The small remove button on each attached reference image.
  function refRemovers() {
    const out = [];
    for (const img of refThumbs()) {
      const c = img.getBoundingClientRect(); const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
      let n = img, found = null;
      for (let i = 0; i < 4 && n && !found; i++) {
        n = n.parentElement; if (!n) break;
        found = [...n.querySelectorAll('button,[role="button"]')].filter(visible).find((b) => {
          const t = label(b), r = b.getBoundingClientRect();
          return /\b(close|cancel|remove|delete|clear|dismiss)\b|^[×✕x]$/.test(t) && Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy) < 110 && r.width < 60;
        });
      }
      if (found) out.push(found);
    }
    return [...new Set(out)];
  }
  async function clearRefs() {
    for (let round = 0; round < 3; round++) {
      const btns = refRemovers();
      if (!btns.length) break;
      for (const b of btns) { domClick(b); await sleep(250); }
      await sleep(300);
    }
    const left = refRemovers();
    return { ok: true, remaining: refThumbs().length, targets: left.map((b) => center(b)) };
  }

  // Flow's + button opens an asset picker ("Search assets", Upload media, Add to prompt) that keeps every
  // picture ever uploaded to the project. Reuse a picture that is already there instead of uploading it again.
  function setInputValue(el, v) {
    el.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const pickerSearch = () => [...document.querySelectorAll('input')].find((i) => visible(i) && !isOurs(i) && /search assets|search/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''}`));
  function pickerRoot(search) {
    let n = search;
    for (let i = 0; i < 10 && n.parentElement; i++) { n = n.parentElement; if (findAddToPrompt(n)) return n; }
    return n;
  }
  const findAddToPrompt = (root) => [...(root || document).querySelectorAll('button,[role="button"]')].filter(visible).find((b) => /add to prompt/.test(label(b)));
  function pickerRow(root, name) {
    const want = name.toLowerCase();
    const rows = [...root.querySelectorAll('[role="option"],[role="listitem"],[role="button"],button,li,div')].filter((el) => visible(el) && el.children.length <= 6 && (el.innerText || '').length < 120);
    const hit = rows.filter((el) => (el.innerText || '').trim().toLowerCase().split('\n')[0].trim() === want);
    // the smallest element whose first line is exactly the name, then its clickable row
    hit.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    return hit.length ? (hit[0].closest('[role="option"],[role="listitem"],[role="button"],button,li') || hit[0]) : null;
  }
  async function closePicker() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(300);
  }
  async function pickerAttach(file, name, addBtn) {
    if (!addBtn) return null;
    const before = refThumbs().length;
    domClick(addBtn);
    let search = null;
    for (let i = 0; i < 10 && !search; i++) { await sleep(200); search = pickerSearch(); }
    if (!search) return null; // no asset picker here: use the old way
    const root = () => pickerRoot(pickerSearch() || search);
    const choose = async () => {
      setInputValue(pickerSearch() || search, name.replace(/\.[a-z]+$/i, ''));
      for (let i = 0; i < 8; i++) {
        await sleep(300);
        const row = pickerRow(root(), name);
        if (row) {
          domClick(row); await sleep(400);
          const add = findAddToPrompt(root()) || findAddToPrompt(document);
          if (add) { domClick(add); await sleep(1200); }
          return true;
        }
      }
      return false;
    };
    if (await choose()) {
      if (pickerSearch()) await closePicker();
      return { ok: true, via: 'library', ...refSlot(), reused: true };
    }
    // Not in the project yet: upload it once through the picker's file input.
    const input = findImageInput(root()) || findImageInput(document);
    if (!input) { await closePicker(); return null; }
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (refThumbs().length > before) { if (pickerSearch()) await closePicker(); return { ok: true, via: 'upload', ...refSlot() }; }
      if (!pickerSearch()) break;
      if (pickerRow(root(), name)) break;
    }
    if (pickerSearch() && await choose()) { if (pickerSearch()) await closePicker(); return { ok: true, via: 'upload', ...refSlot() }; }
    if (pickerSearch()) await closePicker();
    return refThumbs().length > before ? { ok: true, via: 'upload', ...refSlot() } : null;
  }

  // Flow's + button in the prompt bar. Exact words only, so the Ingredients mode switch is never clicked.
  function isPlusBtn(b) {
    const parts = [b.getAttribute('aria-label'), b.title, b.innerText].map((x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
    return parts.length && parts.every((x) => /^(\+|add|add_2|add_circle|add media|add image|add ingredient|add ingredients|attach|upload|upload image|upload media|add (an )?image)$/.test(x) || /^add(_2)? (add|add media|add image)$/.test(x));
  }
  async function attachRef(dataUrl, name, slot) {
    const box = findPromptBox();
    const card = box ? promptCard(box) : null;
    const file = await dataUrlToFile(dataUrl, name);
    uploadedNames.add(String(name).toLowerCase());
    let input = null;
    if (slot === 'start') {
      // Video, Frames: open the start (first) frame slot, then its Upload option if Flow shows a menu.
      const area = (card && card.parentElement) || document;
      const startBtn = [...area.querySelectorAll('button,[role="button"]')].filter(visible)
        .find((b) => /\b(start|first)( frame)?\b/.test(label(b)) && !/\b(end|last)\b/.test(label(b)));
      if (startBtn) {
        domClick(startBtn); await sleep(700);
        input = findImageInput(document);
        if (!input) {
          const up = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"]')].filter(visible).find((b) => /upload|from (your )?(device|computer)/.test(label(b)));
          if (up) { domClick(up); await sleep(700); input = findImageInput(document); }
        }
      }
    }
    if (!input && card) {
      const plus = [...((card.parentElement || card).querySelectorAll('button,[role="button"]'))].filter(visible)
        .find(isPlusBtn);
      const viaPicker = await pickerAttach(file, name, plus).catch(() => null);
      if (viaPicker) return viaPicker;
    }
    input = input || findImageInput(card) || findImageInput(document);
    if (!input && card) {
      const addBtn = [...card.querySelectorAll('button,[role="button"]')].filter(visible)
        .find(isPlusBtn);
      if (addBtn) { domClick(addBtn); await sleep(700); input = findImageInput(document); }
    }
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1500);
      return { ok: true, via: 'file-input', ...refSlot() };
    }
    if (box) {
      const dt = new DataTransfer();
      dt.items.add(file);
      box.focus();
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(1500);
      return { ok: true, via: 'paste', ...refSlot() };
    }
    return { ok: false, error: 'No place to attach the reference image was found.' };
  }

  // ---------- image watcher ----------
  let baseline = new Set();
  let alertBase = {};
  let progressBase = 0;

  function cardTextFor(img) {
    let n = img, best = img.alt || '';
    for (let i = 0; i < 7 && n.parentElement; i++) {
      n = n.parentElement;
      const t = (n.innerText || '').trim();
      if (t.length > 15) { best = (img.alt || '') + ' ' + t.slice(0, 1500); break; }
    }
    return best;
  }

  // Flow keeps every uploaded picture in the project and shows it in the gallery with its file name
  // (for example "hero.jpg"). Those are references, never results.
  const uploadedNames = new Set();
  function isUploadCard(img) {
    let n = img;
    for (let i = 0; i < 5 && n.parentElement; i++) {
      n = n.parentElement;
      // Stop at the gallery grid: a card holds one picture, the grid holds many.
      if ([...n.querySelectorAll('img')].filter((x) => x !== img && x.getBoundingClientRect().width >= 120).length) break;
      const t = (n.innerText || '').toLowerCase();
      if (t.length > 200) break;
      if (/(^|\s)[^\s/]+\.(jpe?g|png|webp|heic)(\s|$)/.test(t)) return true;
      for (const nm of uploadedNames) if (t.includes(nm)) return true;
    }
    return false;
  }
  function resultImages() {
    const out = [];
    const refs = new Set(refThumbs());
    const area = refArea();
    for (const img of document.images) {
      if (refs.has(img) || (area && area.contains(img)) || img.closest(REF_MARK)) continue;
      const rr = img.getBoundingClientRect();
      if (rr.width < 120 || rr.height < 80) continue; // thumbnails, not results
      if (isUploadCard(img)) continue; // a reference picture we uploaded, saved by Flow as media
      if (isOurs(img) || !img.complete || img.naturalWidth < 256 || img.naturalHeight < 256) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:image/svg')) continue;
      if (/googleusercontent\.com\/a\//.test(src)) continue; // account avatars
      if (img.closest('header, nav, [role="navigation"], [role="menu"]')) continue;
      if (!visible(img)) continue;
      const busy = img.closest('[aria-busy="true"]');
      if (busy) continue;
      out.push(img);
    }
    return out;
  }

  const ALERTS = {
    unusual: [/unusual (activity|traffic)/i, /automated (queries|requests)/i, /suspicious activity/i],
    quota: [/quota/i, /rate.?limit/i, /too many requests/i, /out of credits|no credits|credits? (left|remaining): ?0/i, /daily limit|limit reached/i],
    confirm: [/necessary rights/i, /prohibited use policy/i],
    blocked: [/violat\w*/i, /(content|safety|responsible ai) (policy|policies|guidelines)/i, /can.?t (generate|create) (images|content) (like|of) this/i, /sensitive (content|topic)/i],
    failed: [/couldn.?t generate/i, /could not generate/i, /unable to generate/i, /generation failed/i, /something went wrong/i]
  };
  function alertCounts() {
    const t = document.body ? document.body.innerText : '';
    const out = {};
    for (const [k, list] of Object.entries(ALERTS)) {
      out[k] = list.reduce((sum, re) => sum + (t.match(new RegExp(re.source, 'gi')) || []).length, 0);
    }
    return out;
  }
  const progressCount = () => document.querySelectorAll('[role="progressbar"], [aria-busy="true"]').length;

  // Finished videos on the page (never the prompt bar, never tiny previews).
  function videoSrc(v) { return v.currentSrc || v.src || (v.querySelector('source') || {}).src || ''; }
  function resultVideos() {
    const area = refArea();
    return [...document.querySelectorAll('video')].filter((v) => {
      if (isOurs(v) || (area && area.contains(v)) || !videoSrc(v)) return false;
      const r = v.getBoundingClientRect();
      return r.width >= 120 && r.height >= 80 && visible(v) && !v.closest('[aria-busy="true"]');
    });
  }
  function arm(known) {
    baseline = new Set([...resultImages().map((i) => i.currentSrc || i.src), ...resultVideos().map(videoSrc), ...(known || [])]);
    alertBase = alertCounts();
    progressBase = progressCount();
    return { ok: true, baseline: baseline.size };
  }

  function check() {
    const images = [];
    for (const img of resultImages()) {
      const src = img.currentSrc || img.src;
      if (baseline.has(src)) continue;
      images.push({ src, w: img.naturalWidth, h: img.naturalHeight, cardText: cardTextFor(img) });
    }
    const videos = [];
    for (const v of resultVideos()) {
      const src = videoSrc(v);
      if (baseline.has(src)) continue;
      videos.push({ src, w: v.videoWidth, h: v.videoHeight, cardText: cardTextFor(v), poster: v.poster || '' });
    }
    const now = alertCounts();
    const alerts = Object.keys(now).filter((k) => now[k] > (alertBase[k] || 0));
    alertBase = now; // report each new warning once
    return { ok: true, images, videos, alerts, busy: progressCount() };
  }

  async function grab(src) {
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const dataUrl = await new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = no; f.readAsDataURL(blob); });
      let thumb = '';
      try {
        const bmp = await createImageBitmap(blob);
        const scale = 160 / Math.max(bmp.width, bmp.height);
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        thumb = c.toDataURL('image/jpeg', 0.7);
      } catch (e) {}
      return { ok: true, dataUrl, mime: blob.type, thumb };
    } catch (e) {
      return { ok: true, url: new URL(src, location.href).href }; // the panel fetches it with host permission
    }
  }

  // ---------- reading Flow's settings ----------
  // Flow shows its settings in two places: the small summary button in the prompt bar
  // ("Nano Banana Pro ▭ x1") and, when opened, a settings panel with every option where the
  // chosen one is highlighted. Both are read, so the agent follows every click live.
  const MODEL_WORDS = /banana|imagen|veo|gemini|omni|flash|lyria|whisk/i;
  const RATIO_RE = /^(21:9|16:9|9:16|1:1|4:3|3:4|4:5|3:2|2:3)$/;
  const LIST = '[role="menu"],[role="listbox"]'; // a list of models to choose from, not the current choice
  const inList = (el) => !!(el && el.closest && el.closest(LIST));
  const isSelected = (el) => !!el && (['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'].some((a) => ['true', 'page'].includes(el.getAttribute(a))) || /^(on|checked|active|selected)$/.test(el.getAttribute('data-state') || ''));
  const clickable = (el) => el.closest('button,[role="button"],[role="radio"],[role="tab"],[role="option"],[role="menuitemradio"],label') || el;
  const ownText = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const cleanName = (s) => s.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, ' ').replace(/\b(?:x ?[1-4]|[1-4] ?x)\b/gi, ' ').replace(/\b\d{1,2}:\d{1,2}\b/g, ' ').replace(/[^\p{L}\p{N}. ]+/gu, ' ').replace(/\s+/g, ' ').trim();

  // Which option in a row is the chosen one: marked by the page, or the one styled differently from the rest.
  function pickSelected(items) {
    const opts = items.map((it) => ({ ...it, box: clickable(it.el) }));
    const marked = opts.filter((o) => isSelected(o.box) || isSelected(o.el));
    if (marked.length === 1) return marked[0];
    if (opts.length < 2) return null;
    const sig = (el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.backgroundImage, c.color, c.fontWeight, c.borderColor, c.boxShadow, c.opacity].join('|'); };
    const sigs = opts.map((o) => sig(o.box));
    const counts = sigs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
    const unique = opts.filter((o, i) => counts[sigs[i]] === 1);
    if (unique.length === 1) return unique[0];
    // A row of two (Image | Video, Frames | Ingredients): compare with the other option buttons in the same
    // settings panel. The look most buttons share is "not chosen"; the odd one out is the chosen one.
    if (opts.length === 2 && sigs[0] !== sigs[1]) {
      let panel = opts[0].box.parentElement;
      while (panel && panel.querySelectorAll('button,[role="button"],[role="radio"],[role="tab"]').length < 6 && panel !== document.body) panel = panel.parentElement;
      if (!panel) return null;
      const all = [...panel.querySelectorAll('button,[role="button"],[role="radio"],[role="tab"]')].filter((b) => visible(b) && !opts.some((o) => o.box === b));
      const tally = all.map(sig).reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
      const common = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (common && common[1] >= 2) {
        const odd = opts.filter((o, i) => sigs[i] !== common[0]);
        if (odd.length === 1) return odd[0];
      }
    }
    return null;
  }
  function optionsMatching(test, sel) {
    const out = [];
    for (const el of document.querySelectorAll(sel || 'button,[role="button"],[role="radio"],[role="tab"],[role="option"],[role="menuitemradio"],label,span,div')) {
      if (el.children.length > 3 || (el.textContent || '').length > 60 || isOurs(el) || !visible(el)) continue;
      const v = test(ownText(el), el);
      if (v != null && !out.some((o) => o.el.contains(el) || el.contains(o.el))) out.push({ el, v });
    }
    return out;
  }
  // A setting read from a row of options (settings panel open) or the summary button. null = can't tell, keep the last value.
  function readSetting(test, fromSummary, sum) {
    // The summary button's own "x1" is not part of the options row.
    const row = optionsMatching(test).filter((o) => !inList(o.el) && !(sum && (sum.contains(o.el) || o.el.contains(sum))));
    const distinct = [...new Set(row.map((o) => o.v))];
    if (distinct.length > 1) { const p = pickSelected(row.filter((o) => o.v !== undefined)); return p ? p.v : fromSummary(); }
    if (distinct.length === 1) return distinct[0];
    return fromSummary();
  }

  function summaryButton(card) {
    if (!card) return null;
    return [...card.querySelectorAll('button,[role="button"],[aria-haspopup]')].find((b) => MODEL_WORDS.test(ownText(b)) || /\bx ?[1-4]\b/.test(ownText(b))) || null;
  }

  function flowInfo() {
    const box = findPromptBox();
    const card = box ? promptCard(box) : null;
    const sum = summaryButton(card) || summaryButton(card && card.parentElement);
    const sumText = sum ? `${ownText(sum)} ${sum.getAttribute('aria-label') || ''}` : '';

    // Model: the current model is shown by name (summary button, or the dropdown in the settings panel).
    let model = null;
    const MODEL_NAME = /^[^\p{L}\p{N}]*((?:nano banana|imagen|veo|gemini|omni|lyria|whisk)\b[\p{L}\p{N} .]*?)(?:\s+[a-z]+_[a-z_]+)?\s*$/iu;
    const names = [...new Set(optionsMatching((t, el) => { const m = !inList(el) && !(sum && (sum === el || sum.contains(el) || el.contains(sum))) && t.match(MODEL_NAME); return m ? cleanName(m[1]) : null; }, 'button,[role="button"],[role="combobox"],[aria-haspopup]').map((o) => o.v).filter(Boolean))];
    if (names.length === 1) model = names[0];
    else if (sum && MODEL_WORDS.test(sumText)) {
      // The summary button reads like "Nano Banana Pro [size icon] x1": keep only the part before the icon or count.
      const head = ownText(sum).split(/\s(?=x ?[1-4]\b|[a-z]+(?:_[a-z0-9]+)+|crop\b|aspect\b|\d{1,2}:\d{1,2})/)[0];
      model = cleanName(head) || null;
    }

    const ratio = readSetting((t) => (RATIO_RE.test(t) ? t : null), () => {
      const m = sumText.match(/\b(21:9|16:9|9:16|1:1|4:3|3:4|4:5|3:2|2:3)\b/) || (sum && [...sum.querySelectorAll('[aria-label],[title]')].map((x) => x.getAttribute('aria-label') || x.getAttribute('title')).join(' ').match(/\b(21:9|16:9|9:16|1:1|4:3|3:4|4:5|3:2|2:3)\b/));
      return m ? m[1] : null;
    }, sum);
    const count = readSetting((t) => { const m = t.match(/^x ?([1-4])$|^([1-4]) ?x$/i); return m ? +(m[1] || m[2]) : null; }, () => {
      const m = sumText.match(/(?:^|\s)x ?([1-4])(?:\s|$)/i);
      return m ? +m[1] : null;
    }, sum);
    // Exact words only: the sidebar's "Images" link is not the Image/Video switch.
    let mode = readSetting((t) => (/^(image|video)$/i.test(t) ? t.toLowerCase() : null), () => null, sum);
    if (!mode && model) mode = /^veo/i.test(model) ? 'video' : /banana|imagen/i.test(model) ? 'image' : null;
    if (!mode && /^\W*(video|image)\b/i.test(ownText(sum || document.createElement('i')))) mode = ownText(sum).match(/(video|image)/i)[1].toLowerCase();
    // Video mode extras: Frames or Ingredients, resolution and length.
    let vkind = null, res = null, secs = null;
    if (mode === 'video') {
      vkind = readSetting((t) => (/^(frames|ingredients)$/i.test(t) ? t.toLowerCase() : null), () => null, sum);
      res = readSetting((t) => { const m = t.match(/^(360|480|720|1080|2160)p$/i); return m ? m[1] + 'p' : null; }, () => { const m = sumText.match(/\b(360|480|720|1080|2160)p\b/i); return m ? m[1] + 'p' : null; }, sum);
      secs = readSetting((t) => { const m = t.match(/^(\d{1,2}) ?s$/i); return m ? +m[1] : null; }, () => { const m = sumText.match(/\b(\d{1,2}) ?s\b/i); return m ? +m[1] : null; }, sum);
    }
    const cm = (document.body.innerText.match(/will use\s+([\d,.]+)\s+credits?/i) || [])[1];
    const credits = cm != null ? +cm.replace(/,/g, '') : null;
    return { ok: true, url: location.href, prompt: !!box, submit: !!(box && findSubmit(box)), model, ratio, count, mode, credits, vkind, res, secs };
  }


  // ---------- target picker ----------
  function pick(kind) {
    const host = document.getElementById(ROOT_ID);
    if (host) host.style.visibility = 'hidden';
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', pointerEvents: 'none', border: '3px solid #FFD606', background: 'rgba(255,214,6,.15)', borderRadius: '8px', zIndex: 2147483647 });
    const tip = document.createElement('div');
    tip.textContent = kind === 'prompt' ? 'Tap the prompt box. Press Esc to cancel.' : 'Tap the create (arrow) button. Press Esc to cancel.';
    Object.assign(tip.style, { position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', padding: '10px 16px', borderRadius: '10px', font: '600 14px system-ui', zIndex: 2147483647 });
    document.body.append(box, tip);
    let cur = null;
    const resolve = (el) => kind === 'submit' ? (el.closest('button,[role="button"]') || el) : (el.closest('[data-slate-editor="true"],textarea,[contenteditable="true"],[role="textbox"]') || el);
    const show = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      cur = resolve(el);
      const r = cur.getBoundingClientRect();
      Object.assign(box.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
    };
    const finish = (save) => {
      document.removeEventListener('mousemove', mm, true);
      document.removeEventListener('click', ck, true);
      document.removeEventListener('touchend', te, true);
      document.removeEventListener('keydown', kd, true);
      box.remove(); tip.remove();
      if (host) host.style.visibility = '';
      if (save && cur) {
        const sel = cssPath(cur);
        chrome.storage.local.get(['bb_targets'], (r) => {
          const t = r.bb_targets || { prompt: '', submit: '' };
          t[kind] = sel;
          chrome.storage.local.set({ bb_targets: t });
        });
      }
    };
    const mm = (e) => show(e.clientX, e.clientY);
    const ck = (e) => { e.preventDefault(); e.stopPropagation(); show(e.clientX, e.clientY); finish(true); };
    const te = (e) => { const t = e.changedTouches[0]; e.preventDefault(); e.stopPropagation(); show(t.clientX, t.clientY); finish(true); };
    const kd = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('mousemove', mm, true);
    document.addEventListener('click', ck, true);
    document.addEventListener('touchend', te, { capture: true, passive: false });
    document.addEventListener('keydown', kd, true);
  }

  function flash(el) {
    if (!el) return false;
    const o = el.style.outline, f = el.style.outlineOffset;
    el.style.outline = '3px solid #FFD606'; el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = o; el.style.outlineOffset = f; }, 1600);
    return true;
  }

  // ---------- floating panel (phones, or when the user prefers it) ----------
  function ensureOverlay(show) {
    let host = document.getElementById(ROOT_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ROOT_ID;
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .wrap { position: fixed; z-index: 2147483646; right: 10px; bottom: 10px; width: min(380px, calc(100vw - 20px));
                  height: min(640px, calc(100dvh - 20px)); display: flex; flex-direction: column; border-radius: 16px;
                  overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.5); background: #000; border: 1px solid #2A2822; }
          @media (max-width: 600px) {
            .wrap { left: 0; right: 0; bottom: 0; width: 100vw; height: 58dvh; border-radius: 16px 16px 0 0;
                    padding-bottom: env(safe-area-inset-bottom, 0px); }
            .bar { padding-top: 10px; padding-bottom: 10px; }
          }
          .bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; background: #12110E; color: #F6F3EC;
                 font: 600 13px system-ui; cursor: move; touch-action: none; user-select: none; }
          .bar span { flex: 1; }
          .bar button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 8px; background: #2A2822; font: 600 12px system-ui; }
          iframe { border: 0; flex: 1; width: 100%; }
          :host(.min) .wrap { display: none; }
          .fab { display: none; position: fixed; z-index: 2147483646; right: 10px; top: 38%;
                 min-width: 52px; height: 52px; padding: 0 16px; border-radius: 26px;
                 background: #FFD606; color: #0B0A08; font: 800 17px system-ui; border: 0; box-shadow: 0 8px 24px rgba(0,0,0,.3); cursor: pointer; }
          :host(.min) .fab { display: block; }
        </style>
        <div class="wrap"><div class="bar"><span>Bolblar Agent</span><button class="hide" aria-label="Minimize panel">Hide</button></div>
          <iframe title="Bolblar Agent panel" allow="web-share; clipboard-write" src="${chrome.runtime.getURL('panel/panel.html?mode=overlay')}"></iframe></div>
        <button class="fab" aria-label="Open Bolblar Agent">B</button>`;
      // Progress from the panel shows on the button while the panel is hidden.
      const origin = chrome.runtime.getURL('').replace(/\/$/, '');
      window.addEventListener('message', (e) => {
        if (e.origin !== origin || !e.data || e.data.bb !== 'progress') return;
        root.querySelector('.fab').textContent = e.data.text ? `B  ${e.data.text}` : 'B';
      });
      document.documentElement.appendChild(host);
      const wrap = root.querySelector('.wrap');
      root.querySelector('.hide').onclick = () => host.classList.add('min');
      root.querySelector('.fab').onclick = () => host.classList.remove('min');
      // Drag the panel by its bar.
      const bar = root.querySelector('.bar');
      let drag = null;
      bar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = wrap.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; bar.setPointerCapture(e.pointerId); });
      bar.addEventListener('pointermove', (e) => {
        if (!drag) return;
        wrap.style.left = Math.max(0, Math.min(innerWidth - 120, e.clientX - drag.dx)) + 'px';
        wrap.style.top = Math.max(0, Math.min(innerHeight - 60, e.clientY - drag.dy)) + 'px';
        wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
      });
      bar.addEventListener('pointerup', () => { drag = null; });
    }
    if (show === true) host.classList.remove('min');
    else if (show === false) host.classList.add('min');
    else host.classList.toggle('min');
    return host;
  }

  // Show a launcher automatically where there is no side panel.
  // "Desktop site" mode on phones hides the phone from the user agent, so also check for a touch screen with no mouse.
  const IS_TOUCH = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);
  chrome.storage.local.get(['bb_useSidePanel', 'bb_uiMode'], (r) => {
    const wantOverlay = r.bb_useSidePanel === false || r.bb_uiMode === 'overlay' || IS_TOUCH;
    if (wantOverlay && (location.hostname === 'flow.google.com' || /\/fx\//.test(location.pathname))) ensureOverlay(false);
  });

  // Keep the phone screen on during a batch, so the browser doesn't freeze the page.
  let wakeLock = null, wantWake = false;
  async function wake(on) {
    wantWake = on;
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) {}
    return !!wakeLock;
  }
  document.addEventListener('visibilitychange', () => { if (wantWake && document.visibilityState === 'visible') wake(true); });

  document.addEventListener('visibilitychange', () => { try { chrome.runtime.sendMessage({ type: 'flow:visibility', hidden: document.visibilityState === 'hidden' }).catch(() => {}); } catch (e) {} });

  // ---------- live Flow settings ----------
  let lastSig = '', watchT = null;
  function pushSettings() {
    const i = flowInfo();
    if (!i.prompt) return;
    const sig = JSON.stringify([i.model, i.ratio, i.count, i.mode, i.credits, i.vkind, i.res, i.secs]);
    if (sig === lastSig) return;
    lastSig = sig;
    try { chrome.runtime.sendMessage({ type: 'flow:settings', model: i.model, ratio: i.ratio, count: i.count, mode: i.mode, credits: i.credits, vkind: i.vkind, res: i.res, secs: i.secs }).catch(() => {}); } catch (e) {}
  }
  let lastPush = 0;
  new MutationObserver(() => { clearTimeout(watchT); watchT = setTimeout(() => { lastPush = Date.now(); pushSettings(); }, Date.now() - lastPush < 700 ? 700 : 250); })
    .observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'aria-label', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-current'] });
  setTimeout(pushSettings, 800);

  // ---------- messaging ----------
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'ping': reply({ ...flowInfo(), wakeApi: !!navigator.wakeLock, touch: IS_TOUCH }); break;
          case 'wake': reply({ ok: await wake(!!msg.on) }); break;
          case 'arm': reply(arm(msg.known)); break;
          case 'claim': (msg.srcs || []).forEach((s) => baseline.add(s)); reply({ ok: true }); break;
          case 'check': reply(check()); break;
          case 'grab': reply(await grab(msg.src)); break;
          case 'focusPrompt': {
            const el = findPromptBox();
            if (!el) return reply({ ok: false, error: 'Prompt box not found. Open a Flow project or lock the prompt box in Settings.' });
            await focusAndSelect(el);
            reply({ ok: true });
            break;
          }
          case 'focusEnd': {
            const el = findPromptBox();
            if (!el) return reply({ ok: false });
            el.focus();
            try {
              if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.setSelectionRange(el.value.length, el.value.length);
              else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
            } catch (e) {}
            reply({ ok: true });
            break;
          }
          case 'readPrompt': reply({ ok: true, text: readPrompt(findPromptBox()) }); break;
          case 'typePrompt': {
            const el = findPromptBox();
            if (!el) return reply({ ok: false, error: 'Prompt box not found. Open a Flow project or lock the prompt box in Settings.' });
            reply({ ok: await domType(el, msg.text) });
            break;
          }
          case 'submitTarget': {
            const box = findPromptBox();
            let b = null;
            for (let i = 0; i < 20; i++) { b = findSubmit(box); if (b && !isDisabled(b)) break; await sleep(150); }
            if (!b) return reply({ ok: false, error: 'Create button not found. Lock it in Settings.' });
            b.scrollIntoView({ block: 'nearest' });
            const c = center(b);
            const hit = document.elementFromPoint(c.x, c.y);
            // If something (like our floating panel) covers the button, the panel falls back to a DOM click.
            const covered = !hit || !(hit === b || b.contains(hit));
            reply({ ok: true, disabled: isDisabled(b), covered, ...c });
            break;
          }
          case 'clickSubmit': {
            const b = findSubmit(findPromptBox());
            if (!b) return reply({ ok: false, error: 'Create button not found.' });
            domClick(b);
            reply({ ok: true });
            break;
          }
          case 'pressEnter': {
            const el = findPromptBox();
            if (!el) return reply({ ok: false });
            el.focus();
            for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            reply({ ok: true });
            break;
          }
          case 'submitSignal': {
            // Evidence that Flow accepted the prompt: box cleared or new progress indicators.
            const el = findPromptBox();
            const cleared = el ? readPrompt(el).length < 5 : false;
            reply({ ok: true, cleared, busyUp: progressCount() > progressBase });
            break;
          }
          case 'attachRef': reply(await attachRef(msg.dataUrl, msg.name, msg.slot)); break;
          case 'refSlot': reply(refSlot()); break;
          case 'clearRefs': reply(await clearRefs()); break;
          case 'pick': pick(msg.kind); reply({ ok: true }); break;
          case 'flash': {
            const box = findPromptBox();
            reply({ ok: flash(msg.kind === 'prompt' ? box : findSubmit(box)) });
            break;
          }
          case 'overlay:toggle': ensureOverlay(); reply({ ok: true }); break;
          case 'overlay:show': ensureOverlay(true); reply({ ok: true }); break;
          default: reply({ ok: false, error: 'Unknown message ' + msg.type });
        }
      } catch (e) { reply({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  });
})();
