// Bolblar Agent parsers: turn CSV, TXT, PDF text or a pasted AI reply into slides,
// plus timeline checks (gaps, overlaps) and retiming tools.

const BB_TS_RANGE = /(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|\d+(?:\.\d+)?\s*s|\d{1,2}m\d{1,2}s)\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|\d+(?:\.\d+)?\s*s|\d{1,2}m\d{1,2}s)/i;

function bbSeconds(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,2})m(\d{1,2})s$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/))) return +m[1];
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}
const bbClock = (s) => { s = Math.round(s); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const bbClockFine = (s) => { const m = Math.floor(s / 60), r = Math.round((s - m * 60) * 10) / 10; return `${String(m).padStart(2, '0')}:${r < 10 ? '0' : ''}${r}`; };
const bbFileTime = (s) => { s = Math.round(s); return `${String(Math.floor(s / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`; };

function bbStripFences(text) {
  // AI replies often wrap the CSV in ``` fences with chatter around it.
  const fence = text.match(/```[a-z]*\n([\s\S]*?)```/i);
  return (fence ? fence[1] : text).replace(/^\uFEFF/, '').trim();
}

function bbParseCSVRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function bbLooksLikeCSV(text) {
  // Only a real header row counts: short cells, one of them a known column name.
  // "Slide 1 [00:00 - 00:05]: Wide shot, dusk" has a comma and the word Slide but is a prompt, not a header.
  const row = (bbParseCSVRows((text.split(/\r?\n/)[0] || '') + '\n')[0] || []).map((c) => c.trim());
  if (row.length < 2 || row.some((c) => c.length > 40)) return false;
  return row.some((c) => /^(slide|scene|shot|#|no|prompt|image prompt|visual prompt|visual|timecode|timestamp|time|start|end|narration|sentence|script|overlay|text overlay|concept|characters|location)$/i.test(c));
}

function bbSlidesFromCSV(text) {
  const rows = bbParseCSVRows(bbStripFences(text));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...keys) => head.findIndex((h) => keys.includes(h));
  const colLike = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  let iPrompt = col('prompt', 'imageprompt', 'visualprompt', 'visual', 'image');
  if (iPrompt === -1) iPrompt = colLike('prompt');
  const hasHeader = iPrompt !== -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const iLabel = hasHeader ? col('slide', 'scene', 'shot', 'id', 'number') : -1;
  const iStart = hasHeader ? colLike('start') : -1;
  const iEnd = hasHeader ? colLike('end') : -1;
  const iTime = hasHeader ? col('timecode', 'timestamp', 'time', 'tc') : -1;
  const iNarr = hasHeader ? col('narration', 'sentence', 'script', 'voiceover', 'vo', 'line', 'text') : -1;
  const iConcept = hasHeader ? col('concept', 'idea', 'shottype') : -1;
  const iOverlay = hasHeader ? colLike('overlay', 'onscreen', 'caption') : -1;
  const iCast = hasHeader ? col('characters', 'character', 'cast', 'who', 'people') : -1;
  const iMotion = hasHeader ? col('motion', 'motionscore', 'animate', 'animation') : -1;
  const iMove = hasHeader ? col('movement', 'camera', 'cameramove', 'action') : -1;
  const iPlace = hasHeader ? col('location', 'place', 'setting', 'where') : -1;
  const iThings = hasHeader ? col('things', 'objects', 'props', 'items', 'vehicles', 'thing') : -1;
  const iMoment = hasHeader ? col('moment', 'sceneid', 'beat', 'sequence', 'continuity') : -1;
  const iLight = hasHeader ? col('light', 'lighting', 'timeofday', 'weather', 'timeweather') : -1;
  return body.map((r) => {
    const g = (i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    let start = null, end = null;
    if (hasHeader) {
      start = bbSeconds(g(iStart)); end = bbSeconds(g(iEnd));
      if (start == null && iTime >= 0) { const m = g(iTime).match(BB_TS_RANGE); if (m) { start = bbSeconds(m[1]); end = bbSeconds(m[2]); } }
      return { label: g(iLabel), start, end, narration: g(iNarr), concept: g(iConcept === iLabel ? -1 : iConcept), overlay: g(iOverlay), cast: g(iCast), place: g(iPlace), things: g(iThings), moment: g(iMoment), light: g(iLight), motion: g(iMotion), movement: g(iMove), prompt: g(iPrompt) };
    }
    const prompt = (r[r.length - 1] || '').trim();
    const m = r.slice(0, -1).join(' ').match(BB_TS_RANGE);
    if (m) { start = bbSeconds(m[1]); end = bbSeconds(m[2]); }
    return { label: '', start, end, narration: '', concept: '', overlay: '', prompt };
  }).filter((s) => s.prompt);
}

// Shot lists Bolblar asks for, by column count. Used when the AI drops the header row.
const BB_KNOWN_HEADERS = {
  13: 'Slide,Start,End,Narration,Overlay,Characters,Location,Things,Moment,Light,Motion,Movement,Prompt',
  10: 'Slide,Start,End,Narration,Overlay,Characters,Location,Motion,Movement,Prompt',
  8: 'Slide,Start,End,Narration,Overlay,Characters,Location,Prompt',
  7: 'Slide,Start,End,Narration,Overlay,Concept,Prompt',
  6: 'Slide,Timecode,Sentence,Concept,Text Overlay,Prompt',
  5: 'Slide,Start,End,Narration,Prompt'
};
function bbHeaderless(clean) {
  const rows = bbParseCSVRows(clean + '\n');
  if (rows.length < 2) return null;
  const n = rows[0].length;
  if (!BB_KNOWN_HEADERS[n]) return null;
  const same = rows.filter((r) => r.length === n).length;
  const numbered = rows.filter((r) => /^\s*(?:slide\s*)?\d+\s*$/i.test(r[0])).length;
  const timed = rows.filter((r) => /\d{1,2}:\d{2}/.test(r[1] || '')).length;
  return same >= rows.length * 0.8 && numbered >= rows.length * 0.8 && timed >= rows.length * 0.6 ? BB_KNOWN_HEADERS[n] : null;
}

function bbSlidesFromText(text) {
  const clean = bbStripFences(text).replace(/\r/g, '').trim();
  if (!clean) return [];
  if (bbLooksLikeCSV(clean)) return bbSlidesFromCSV(clean);
  const header = bbHeaderless(clean);
  if (header) return bbSlidesFromCSV(header + '\n' + clean);
  const lines = clean.split('\n');
  const marker = /^\s*(?:#+\s*|\*\*)?(?:slide|scene|shot|frame|image)\s*\d+|^\s*\[?\(?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:-|–|—|to)/i;
  let blocks;
  if (lines.some((l) => marker.test(l))) {
    blocks = []; let cur = [];
    for (const l of lines) { if (marker.test(l) && cur.length) { blocks.push(cur.join('\n')); cur = []; } cur.push(l); }
    if (cur.length) blocks.push(cur.join('\n'));
  } else if (/\n\s*\n/.test(clean)) blocks = clean.split(/\n\s*\n/);
  else blocks = lines;
  return blocks.map((b) => {
    let start = null, end = null;
    const m = b.match(BB_TS_RANGE);
    if (m) { start = bbSeconds(m[1]); end = bbSeconds(m[2]); }
    const narr = (b.match(/\b(?:narration|sentence|vo|voiceover)\s*:\s*(.+)/i) || [])[1] || '';
    const overlay = (b.match(/\b(?:overlay|text overlay|on.?screen)\s*:\s*(.+)/i) || [])[1] || '';
    let prompt = (b.match(/(?:prompt|visual|image prompt)\s*:\s*([\s\S]+?)(?:\n\s*(?:narration|sentence|overlay|vo)\s*:|$)/i) || [])[1];
    if (!prompt) {
      prompt = b
        .replace(/^\s*(?:#+\s*|\*\*)?(?:slide|scene|shot|frame|image)\s*\d+\**\s*[:.)\-–]?\s*/i, '')
        .replace(/\[?\(?\s*[\d:ms.]+\s*(?:-|–|—|to)\s*[\d:ms.]+\s*\)?\]?\s*[:\-–]?\s*/i, '')
        .replace(/\b(?:narration|sentence|overlay|vo)\s*:.*$/gim, '');
    }
    return { label: '', start, end, narration: narr.trim(), concept: '', overlay: overlay.trim(), prompt: prompt.replace(/\s*\n\s*/g, ' ').trim() };
  }).filter((s) => s.prompt.length > 3);
}

async function bbTextFromPDF(buf) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    let lastY = null;
    for (const it of tc.items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n';
      out += it.str; if (it.hasEOL) out += '\n';
      lastY = y;
    }
    out += '\n\n';
  }
  return out;
}

// Fill missing times so every slide has a start and end, back to back.
function bbFinalize(raw, secsPerSlide, startNumber = 1) {
  let clock = 0, lastMoment = '', lastLight = '';
  return raw.map((s, i) => {
    // Slides of the same moment keep the same time of day, weather and light.
    const moment = String(s.moment || '').trim();
    let light = String(s.light || '').trim();
    if (!light && moment && moment === lastMoment) light = lastLight;
    if (moment) { lastLight = light; lastMoment = moment; }
    let start = s.start, end = s.end;
    if (start == null) start = clock;
    if (end == null || end <= start) end = start + secsPerSlide;
    clock = end;
    return {
      n: startNumber + i, label: s.label || '', start, end,
      narration: s.narration || '', concept: s.concept || '', overlay: s.overlay || '', cast: s.cast || '', place: s.place || '', things: s.things || '', moment, light, motion: s.motion || '', movement: s.movement || '', anim: 'auto', prompt: s.prompt,
      status: 'pending', images: [], error: '', attempts: 0
    };
  });
}

function bbTimelineIssues(slides) {
  const issues = [];
  for (let i = 1; i < slides.length; i++) {
    const a = slides[i - 1], b = slides[i];
    if (b.start < a.end - 0.05) issues.push(`Slide ${b.n} overlaps slide ${a.n}`);
    else if (b.start > a.end + 0.05) issues.push(`Gap of ${(b.start - a.end).toFixed(1)}s before slide ${b.n}`);
  }
  return issues;
}

function bbMakeContinuous(slides) {
  for (let i = 1; i < slides.length; i++) {
    const d = slides[i].end - slides[i].start;
    slides[i].start = slides[i - 1].end;
    slides[i].end = slides[i].start + Math.max(0.5, d);
  }
}

// Stretch or shrink every slide so the batch matches the real voiceover length.
function bbFitToDuration(slides, totalSeconds) {
  if (!slides.length) return;
  bbMakeContinuous(slides);
  const t0 = slides[0].start, t1 = slides[slides.length - 1].end;
  const k = totalSeconds / (t1 - t0);
  for (const s of slides) { s.start = Math.round((s.start - t0) * k * 10) / 10; s.end = Math.round((s.end - t0) * k * 10) / 10; }
}


// The words spoken during a slide: its narration, or (when slides were loaded straight from a script) its own text.
function bbSpoken(slides) {
  const none = slides.every((s) => !String(s.narration || '').trim());
  return slides.map((s) => (none ? s.prompt : s.narration) || '');
}

// ---------- syncing slides to the real voiceover ----------
// Reads SRT or VTT captions (exported from CapCut, ElevenLabs, Premiere, YouTube and others).
function bbParseCaptions(text) {
  const cues = [];
  const t = String(text || '').replace(/\r/g, '');
  const ts = (s) => { const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : null; };
  for (const block of t.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = ts(a), end = ts(b);
    const words = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (start != null && end != null && words) cues.push({ start, end, text: words });
  }
  return cues;
}

const bbWords = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

// Line each slide's narration up with the captions and take its start time from the voiceover.
function bbSyncToCaptions(slides, cues) {
  if (!cues.length) return { ok: false, reason: 'No captions found in that file.' };
  const said = bbSpoken(slides);
  if (said.some((x) => !x.trim())) return { ok: false, reason: 'Some slides have no narration text, so they can\'t be matched to the voiceover. Use the prompt from box 1 so every slide has its sentence.' };
  // Every spoken word with its own time, spread evenly across its caption.
  const audio = [];
  for (const c of cues) { const w = bbWords(c.text); w.forEach((x, k) => audio.push({ w: x, t: c.start + ((c.end - c.start) * k) / Math.max(1, w.length) })); }
  const slideWords = said.map((x) => bbWords(x));
  const total = slideWords.reduce((a, w) => a + w.length, 0);
  let at = 0, cursor = 0, matched = 0;
  const starts = [];
  for (const w of slideWords) {
    // Expected position in the audio, then search nearby for where this sentence really starts.
    const guess = Math.max(cursor, Math.round((at / total) * audio.length));
    let best = guess, bestScore = -1;
    for (let j = Math.max(cursor, guess - 25); j <= Math.min(audio.length - 1, guess + 25); j++) {
      let score = 0;
      for (let k = 0; k < Math.min(4, w.length); k++) if (audio[j + k] && audio[j + k].w === w[k]) score += 4 - k;
      score -= Math.abs(j - guess) * 0.05;
      if (score > bestScore) { bestScore = score; best = j; }
    }
    if (bestScore >= 3) matched++;
    starts.push(audio[Math.min(best, audio.length - 1)].t);
    cursor = best + 1; at += w.length;
  }
  starts[0] = 0; // the video starts at zero
  const endAll = cues[cues.length - 1].end;
  slides.forEach((s, i) => {
    s.start = Math.round(starts[i] * 10) / 10;
    s.end = Math.round((i + 1 < slides.length ? starts[i + 1] : endAll) * 10) / 10;
    if (s.end <= s.start) s.end = s.start + 0.5;
  });
  return { ok: true, matched, total: slides.length, length: endAll };
}

// ---------- which slides get animated ----------
const BB_ANIM_LEVELS = [
  { id: 'none', label: 'None', pct: 0 },
  { id: 'light', label: 'Light', pct: 20 },
  { id: 'balanced', label: 'Balanced', pct: 35 },
  { id: 'heavy', label: 'Heavy', pct: 40 },
  { id: 'all', label: 'All video', pct: 100 }
];

// 1 to 5: how much a scene gains from movement. From the AI's Motion column, or guessed from the prompt.
function bbMotionScore(s) {
  const n = parseFloat(String(s.motion || '').replace(/[^\d.]/g, ''));
  if (n >= 1 && n <= 5) return n;
  if (/^(yes|animate|video|y)$/i.test(String(s.motion).trim())) return 5;
  if (/^(no|still|image|n)$/i.test(String(s.motion).trim())) return 1;
  const p = `${s.prompt} ${s.movement || ''}`.toLowerCase();
  let score = 2;
  if (/\b(run|runs|running|chase|chasing|fight|fights|explod|crash|falls?|falling|jump|drives?|driving|racing|flees?|escap|storm|fire|flames|waves?|rain|dance|dancing|fly|flying|pours?|shatter|burst|collaps|attack|throws?|swing)/.test(p)) score = 5;
  else if (/\b(walk|walking|turns?|reach|opens?|enters?|crowd|traffic|wind|smoke|cries|crying|scream|reveal|looks? up|grabs?|hug)/.test(p)) score = 4;
  else if (/\b(close up|close-up|face|eyes|tears|expression|staring)\b/.test(p)) score = 3;
  if (/\b(map|calendar|document|paper|chart|graph|newspaper|photo of|letter|sign|logo|diagram|text)\b/.test(p) && score < 4) score = 1;
  return score;
}

// Pick the slides to animate: the hook always, then the strongest scenes, spread out across the video.
function bbPlanAnimation(slides, pct) {
  // The level picks its share automatically; slides you switch on are added on top, slides you switch off never move.
  const out = new Set();
  const banned = new Set(slides.filter((s) => s.anim === 'off'));
  const target = pct >= 100 ? slides.length : Math.round((slides.length * pct) / 100);
  if (target > 0 && slides[0] && !banned.has(slides[0])) out.add(slides[0]); // the hook
  const ranked = slides.map((s, i) => ({ s, k: bbMotionScore(s), i })).filter((r) => !out.has(r.s) && !banned.has(r.s))
    .sort((a, b) => b.k - a.k || a.i - b.i);
  const near = (i) => [...out].some((o) => Math.abs(slides.indexOf(o) - i) <= 1);
  for (const pass of [true, false]) for (const r of ranked) {   // first keep a gap between clips, then fill up
    if (out.size >= target) break;
    if (out.has(r.s) || (pass && near(r.i))) continue;
    out.add(r.s);
  }
  slides.forEach((s) => { if (s.anim === 'on') out.add(s); });
  return out;
}

// ---------- syncing straight from the voiceover audio (no captions needed) ----------
// Finds the pauses in the narration and lines each slide's sentence up with the pause before it.
function bbAlignAudio(slides, samples, sampleRate) {
  const said = bbSpoken(slides);
  if (said.some((x) => !x.trim())) return { ok: false, reason: 'Some slides have no narration text, so they can\'t be matched to the voiceover. Use the prompt from box 1 so every slide has its sentence.' };
  const hop = Math.round(sampleRate * 0.02), n = Math.floor(samples.length / hop);
  if (n < 50) return { ok: false, reason: 'That audio is too short.' };
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = i * hop, e = k + hop; k < e; k++) s += samples[k] * samples[k]; rms[i] = Math.sqrt(s / hop); }
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.1)], loud = sorted[Math.floor(n * 0.9)];
  const thr = floor + (loud - floor) * 0.12;
  const t = (i) => i * 0.02;
  let first = 0; while (first < n && rms[first] < thr) first++;
  let last = n - 1; while (last > first && rms[last] < thr) last--;
  // Pauses: at least 140 ms of quiet inside the speech.
  const pauses = [];
  for (let i = first, run = -1; i <= last; i++) {
    if (rms[i] < thr) { if (run < 0) run = i; }
    else if (run >= 0) { if (i - run >= 7) pauses.push({ a: t(run), b: t(i), len: t(i - run) }); run = -1; }
  }
  // Speaking time with pauses taken out, so word counts map onto real time.
  const segs = []; let cur = t(first);
  for (const p of pauses) { segs.push([cur, p.a]); cur = p.b; }
  segs.push([cur, t(last + 1)]);
  const speech = segs.reduce((a, [x, y]) => a + (y - x), 0);
  const toReal = (st) => { for (const [x, y] of segs) { if (st <= y - x) return x + st; st -= y - x; } return t(last); };
  const words = said.map((x) => bbWords(x).length || 1);
  const total = words.reduce((a, b) => a + b, 0);
  const perWord = speech / total;
  const S = slides.length, P = pauses.length;
  // Speaking time from the first word up to each pause.
  const spokenTo = (x) => segs.reduce((acc, [a1, b1]) => acc + Math.max(0, Math.min(b1, x) - a1), 0);
  const at = pauses.map((p) => spokenTo(p.a));
  const exp = words.map((w) => w * perWord);
  const starts = [0];
  let matched = 0;
  if (S > 1 && P >= S - 1) {
    // Choose all slide boundaries together: each slide should last about as long as its words take to say,
    // and boundaries should sit on real pauses (longer ones are sentence ends). One bad pick can't drag the rest along.
    const cost = (len, e) => ((len - e) * (len - e)) / (e + 0.6);
    const INF = 1e18;
    let dp = new Float64Array(P).fill(INF), from = [];
    for (let j = 0; j < P; j++) dp[j] = cost(at[j], exp[0]) - 0.9 * Math.min(pauses[j].len, 1.2);
    for (let i = 1; i < S - 1; i++) {
      const nd = new Float64Array(P).fill(INF), back = new Int32Array(P).fill(-1);
      for (let j = i; j < P; j++) {
        const bonus = 0.9 * Math.min(pauses[j].len, 1.2);
        for (let k = j - 1; k >= i - 1; k--) {
          const len = at[j] - at[k];
          if (len > exp[i] * 3 + 3) break;
          if (dp[k] >= INF) continue;
          const c = dp[k] + cost(len, exp[i]) - bonus;
          if (c < nd[j]) { nd[j] = c; back[j] = k; }
        }
      }
      from.push(back); dp = nd;
    }
    let end = -1, best = INF;
    for (let j = S - 2; j < P; j++) { if (dp[j] >= INF) continue; const c = dp[j] + cost(speech - at[j], exp[S - 1]); if (c < best) { best = c; end = j; } }
    if (end >= 0) {
      const chosen = [end];
      for (let i = from.length - 1; i >= 0; i--) chosen.unshift(from[i][chosen[0]]);
      for (const j of chosen) { const p = pauses[j]; starts.push(Math.max(p.a, p.b - 0.1)); }
      matched = S - 1;
    }
  }
  if (starts.length < S) {
    // Not enough clear pauses: fall back to spreading slides by word count over the speaking time.
    starts.length = 1;
    let acc = 0;
    for (let i = 1; i < S; i++) { acc += words[i - 1]; starts.push(toReal((acc / total) * speech)); }
  }
  const dur = samples.length / sampleRate;
  slides.forEach((s, i) => {
    s.start = Math.round(starts[i] * 10) / 10;
    s.end = Math.round((i + 1 < slides.length ? starts[i + 1] : dur) * 10) / 10;
    if (s.end <= s.start) s.end = s.start + 0.3;
  });
  return { ok: true, matched: matched + 1, total: slides.length, length: dur };
}
