// Bolblar Agent cast and places ("story bible").
// Every recurring character and place gets ONE fixed description. Each slide knows who and
// where it shows, and the same description is locked into every prompt it appears in.

// A cast member: { id, type: 'character' | 'place' | 'thing' | 'era', name, aliases: [], look, refImage, sheets: [] }
// character: people and animals. place: rooms, buildings, streets. thing: vehicles, props, evidence, uniforms.
// era: the story's time period and region, locked into every slide (period cars, clothes, phones...).
const BB_TYPE_LABEL = { character: 'Character', place: 'Place', thing: 'Thing', era: 'Era' };
function bbCastType(word) {
  const w = String(word || '').toLowerCase();
  if (/place|location|setting/.test(w)) return 'place';
  if (/thing|object|vehicle|prop|item|uniform/.test(w)) return 'thing';
  if (/era|period|world/.test(w)) return 'era';
  return 'character';
}
const BB_VEHICLE = /\b(car|van|truck|bus|boat|sedan|pickup|jeep|motorcycle|bike|bicycle|taxi|cab|wagon|limo|limousine|plane|helicopter|cruiser)$/i;

const BB_PLACE_WORDS = 'house|home|apartment|flat|cabin|cottage|mansion|office|kitchen|bedroom|living room|bathroom|basement|attic|garage|school|classroom|church|courtroom|court|police station|station|prison|jail|cell|hospital|clinic|farm|ranch|barn|shop|store|restaurant|diner|bar|motel|hotel|warehouse|factory|street|alley|village|town|city|park|forest|lake|beach|car|van|truck|bus|boat|lab|laboratory|studio|palace|castle|temple|mosque|market|bank|courthouse|campus|dorm|trailer';
const BB_NOT_NAMES = new Set(('The A An And But Or So If When While After Before Then Now This That These Those It Its He She They We You I His Her Their Our Your ' +
  'Wide Close Medium Extreme Low High Aerial Overhead Top Side Front Back Shot Slide Scene Frame Image View Angle Camera Inside Outside Interior Exterior ' +
  'Night Day Morning Evening Dawn Dusk Sunset Sunrise Today Yesterday Later Meanwhile Finally Suddenly Years Year Months Weeks Days Hours ' +
  'January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday ' +
  'Hero Protagonist Narrator Everyone Nobody Someone People Police Doctor Mr Mrs Ms Dr One Two Three Four Five Six Seven Eight Nine Ten First Second Third Last Next ' +
  'Not No Yes Why How What Where Who Every Each All Some Many Most Only Just Even Still Also Very Because Although Though Until Since With Without From Into Onto Over Under About Behind Between').split(' '));

const bbCastId = () => 'm_' + Math.random().toString(36).slice(2, 9);
const bbEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function bbCastNames(m) {
  return [m.name, ...(m.aliases || [])].map((x) => String(x || '').trim()).filter((x) => x.length > 1);
}
function bbMentions(text, m) {
  const t = String(text || '');
  // For a person, "Parnell's cabin" names the place, not him, so a possessive before a place word doesn't count.
  const notPlace = m.type === 'character' ? `(?!['’]s\\s+(?:\\p{L}+\\s+)?(?:${BB_PLACE_WORDS})\\b)` : '';
  return bbCastNames(m).some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${bbEsc(n)}${notPlace}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(t));
}
function bbFindMember(cast, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return cast.find((m) => bbCastNames(m).some((x) => x.toLowerCase() === n))
      || cast.find((m) => bbCastNames(m).some((x) => n.includes(x.toLowerCase()) || x.toLowerCase().includes(n)));
}

// Who and where is in a slide: the Characters / Location columns first, then names found in the text.
function bbSlideCast(slide, cast) {
  const chars = [], places = [], things = [];
  const eras = cast.filter((m) => m.type === 'era' && m.look);
  const add = (m) => { if (!m || m.type === 'era') return; const list = m.type === 'place' ? places : m.type === 'thing' ? things : chars; if (!list.includes(m)) list.push(m); };
  const of = (t) => cast.filter((m) => m.type === t);
  for (const n of String(slide.cast || '').split(/[;,/|]+|\band\b/i)) add(bbFindMember(of('character'), n));
  for (const n of String(slide.place || '').split(/[;/|]+/)) add(bbFindMember(of('place'), n));
  for (const n of String(slide.things || '').split(/[;/|]+/)) add(bbFindMember(of('thing'), n));
  // Only names in the image prompt count; a person merely spoken about in the narration isn't drawn.
  for (const m of cast) if (m.type !== 'era' && bbMentions(slide.prompt, m)) add(m);
  return { chars, places, things, eras };
}
// Everything a slide shows (for counts and lists).
function bbSlideAll(slide, cast) { const r = bbSlideCast(slide, cast); return [...r.chars, ...r.places, ...r.things]; }

// ---------- reading the AI's cast block ----------
// Lines like:  CHARACTER | Steven (age 7) | Steven, the boy | 7 year old boy, ...
//              PLACE | Parnell's cabin | the cabin | small wooden cabin ...
function bbParseCast(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^\s*[-*•]\s*/, '').trim();
    const m = line.match(/^(character|person|people|animal|place|location|setting|thing|object|vehicle|prop|item|uniform|era|period|world)\s*[|:]\s*(.+)$/i);
    if (!m) continue;
    const parts = m[2].split('|').map((x) => x.trim());
    let name = parts[0], aliases = [], look = '';
    if (parts.length >= 3) { aliases = parts[1].split(',').map((x) => x.trim()).filter(Boolean); look = parts.slice(2).join(' | '); }
    else if (parts.length === 2) look = parts[1];
    else { const k = parts[0].split(/\s*[:–—-]\s+/); name = k[0]; look = k.slice(1).join(' - '); }
    name = name.replace(/^["']|["']$/g, '').trim();
    if (!name || /^name$/i.test(name)) continue;
    out.push({ id: bbCastId(), type: bbCastType(m[1]), name, aliases, look: look.trim(), refImage: '', sheets: [] });
  }
  return out;
}

// An AI reply can hold a cast block and a CSV block. Split them so each goes to the right parser.
function bbSplitReply(text) {
  const t = String(text || '').replace(/\r/g, '');
  const castLines = [], rest = [];
  const fences = [...t.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  let pool = fences.length ? fences.join('\n') : t;
  // The AI sometimes writes the CSV header line outside the code block: bring it back in.
  if (fences.length) {
    const outside = t.replace(/```[a-z]*\n[\s\S]*?```/gi, '').split('\n').find((l) => /^\s*"?slide"?\s*,/i.test(l) && /prompt/i.test(l));
    if (outside && !/^\s*"?slide"?\s*,.*prompt/im.test(pool)) {
      const lines = pool.split('\n');
      const first = lines.findIndex((l) => /^\s*"?(?:slide\s*)?\d+"?\s*,/i.test(l));
      if (first >= 0) { lines.splice(first, 0, outside.trim()); pool = lines.join('\n'); }
    }
  }
  for (const l of pool.split('\n')) (/^\s*[-*•]?\s*(character|person|animal|place|location|setting|thing|object|vehicle|prop|item|uniform|era|period|world)\s*[|:]/i.test(l) || /^\s*type\s*\|\s*name/i.test(l) ? castLines : rest).push(l);
  return { castText: castLines.join('\n'), slidesText: rest.join('\n').trim() };
}

// Merge new entries into the existing cast without losing looks or reference images already set.
function bbMergeCast(cast, incoming) {
  let added = 0, updated = 0;
  for (const m of incoming) {
    const old = cast.find((c) => c.type === m.type && c.name.toLowerCase() === m.name.toLowerCase());
    if (old) {
      if (m.look && m.look !== old.look) { old.look = m.look; updated++; }
      old.aliases = [...new Set([...(old.aliases || []), ...m.aliases])];
    } else { cast.push(m); added++; }
  }
  return { added, updated };
}

// ---------- finding characters and places in plain prompts ----------
function bbScanCast(slides, cast, heroName) {
  const names = new Map(), places = new Map();
  const bump = (map, key, label, i) => { const k = key.toLowerCase(); const e = map.get(k) || { label, slides: new Set() }; e.slides.add(i); map.set(k, e); };
  slides.forEach((s, i) => {
    const text = `${s.prompt}`;
    // Names: capitalised words, and short runs of them ("Kenneth Parnell"), not at the start of a sentence.
    for (const m of text.matchAll(/(^|[.!?:;]\s+|\s)((?:[A-Z][a-z'’]+(?:\s+(?:[A-Z][a-z'’]+|de|van|von|al|bin))*))/g)) {
      const startOfSentence = m[1] === '' || /[.!?:;]/.test(m[1]);
      let words = m[2].replace(/['’]s$/, '').split(/\s+/).filter((w) => !BB_NOT_NAMES.has(w.replace(/['’]s$/, '')));
      if (!words.length) continue;
      if (startOfSentence && words.length === 1 && BB_NOT_NAMES.has(m[2].split(/\s+/)[0])) continue;
      const name = words.join(' ');
      if (name.length < 3) continue;
      bump(names, name, name, i);
    }
    // Places: "Parnell's cabin", "the Stayner home", "his apartment".
    const re = new RegExp(`\\b((?:[A-Z][a-z]+(?:['’]s)?\\s+)?(?:${BB_PLACE_WORDS}))\\b`, 'gi');
    for (const m of text.matchAll(re)) {
      const label = m[1].replace(/\s+/g, ' ').trim();
      bump(places, label.toLowerCase().replace(/^(the|a|an|his|her|their)\s+/, ''), label, i);
    }
  });
  const known = (n) => cast.some((m) => bbCastNames(m).some((x) => x.toLowerCase() === n.toLowerCase())) || (heroName && n.toLowerCase() === heroName.toLowerCase());
  // A single name inside a longer one ("Steven" in "Steven Stayner") becomes an alias.
  const found = [];
  const nameList = [...names.values()].filter((e) => e.slides.size >= 2).sort((a, b) => b.label.split(' ').length - a.label.split(' ').length);
  for (const e of nameList) {
    if (known(e.label)) continue;
    const parent = found.find((f) => f.type === 'character' && f.name.split(' ').includes(e.label));
    if (parent) { parent.aliases.push(e.label); continue; }
    found.push({ id: bbCastId(), type: 'character', name: e.label, aliases: [], look: '', refImage: '', sheets: [], count: e.slides.size });
  }
  // "Steven" twice and "Steven Stayner" once are the same person: use the full name, keep the short one as an alias.
  for (const f of found) {
    const longer = [...names.values()].map((e) => e.label).filter((l) => l !== f.name && l.split(' ').includes(f.name) && !known(l));
    if (longer.length) { const full = longer.sort((x, y) => y.length - x.length)[0]; f.aliases = [...new Set([f.name, ...f.aliases, ...longer.filter((l) => l !== full)])]; f.name = full; }
  }
  for (const e of places.values()) {
    if (e.slides.size < 2 || known(e.label)) continue;
    const named = /^[A-Z]/.test(e.label) || /['’]s\s/.test(e.label);
    if (!named && e.slides.size < 3) continue; // a generic "street" twice isn't a recurring place
    const nm = e.label.replace(/^(the|a|an)\s+/i, '');
    found.push({ id: bbCastId(), type: BB_VEHICLE.test(nm) ? 'thing' : 'place', name: nm, aliases: [], look: '', refImage: '', sheets: [], count: e.slides.size });
  }
  return found;
}

// A prompt the user pastes into an AI to get fixed descriptions for everything found.
function bbCastPrompt(cast, slides, styleLabel) {
  const lines = cast.map((m) => {
    const ex = slides.filter((s) => bbMentions(s.prompt, m)).slice(0, 2).map((s) => `"${s.prompt.slice(0, 140)}"`).join(' / ');
    return `${(BB_TYPE_LABEL[m.type] || 'Character').toUpperCase()} | ${m.name}${ex ? `   (appears in: ${ex})` : ''}`;
  }).join('\n');
  return `Write one fixed visual description for each character and place below, for a ${styleLabel || 'faceless'} video. The same description will be used in every image, so it must be specific and never change.

For each CHARACTER, always in this order: age and build; skin tone as one exact shade that stays identical in every lighting; face shape and eyes; hair with exact length, color, texture and parting; outfit layer by layer from top to bottom with a color for every item; then ONE identity marker that makes them instantly recognisable (a scar, glasses, a red scarf, a gold ring...). End each with "kept identical in every image". No vague words like "casual clothes" or "dark hair": name the item and the color. If a character appears at very different ages, make a separate entry for each, like "the boy, young" and "the boy, teenager". For anyone under 18, never write a number for their age and never use a real child's real name: use a role name like "the boy" or "the younger sister".
For each PLACE: what kind of place, size, materials, colors, key furniture or features, lighting, and one landmark detail that is always visible.
For each THING (vehicle, important object, uniform): exact type, make or model style, era, color, material, size, condition, and one detail that is always visible (a dent, a sticker, a number on a uniform badge).
For an ERA: the years and region, then what must match that time: vehicles, clothing, hairstyles, phones and technology, signs.
Do not mention any art style.

Answer ONLY with one code block, one line per entry, in exactly this format:
CHARACTER | Name | other names used for them, comma separated | description
PLACE | Name | other names used for it, comma separated | description
THING | Name | other names used for it, comma separated | description
ERA | Name | | description

${lines}`;
}

function bbCastLock(slide, cfg) {
  const cast = cfg.cast || [];
  if (!cast.length) return [];
  const { chars, places, things, eras } = bbSlideCast(slide, cast);
  const blocks = [];
  const heroName = (cfg.hero.name || '').toLowerCase();
  const withRef = (m) => (cfg.hero.attach !== 'off' && m.refImage ? ' Match the attached reference image of them exactly: same face, skin tone, hair and outfit.' : '');
  const c = chars.filter((m) => m.look && m.name.toLowerCase() !== heroName);
  if (c.length) blocks.push(`[CHARACTER LOCK, keep these people identical in every image: ${c.map((m) => `${m.name}: ${m.look}.${withRef(m)}`).join(' ')}]`);
  const p = places.filter((m) => m.look);
  if (p.length) blocks.push(`[LOCATION LOCK, keep this place identical in every image: ${p.map((m) => `${m.name}: ${m.look}.${withRef(m)}`).join(' ')}]`);
  const t = things.filter((m) => m.look);
  if (t.length) blocks.push(`[OBJECT LOCK, keep these exactly the same in every image (same model, color and details): ${t.map((m) => `${m.name}: ${m.look}.${withRef(m)}`).join(' ')}]`);
  if (eras.length) blocks.push(`[ERA: ${eras.map((m) => `${m.name}: ${m.look.trim().replace(/[.\s]*$/, '.')}`).join(' ')} Every vehicle, outfit, hairstyle, device and sign must belong to this period. Nothing modern.]`);
  return blocks;
}
