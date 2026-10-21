// Bolblar Agent prompt composer.
// Order: style prefix, hero lock, scene, avoid list, style suffix.

function bbStyle(cfg) {
  // Styles that were removed or merged map to their closest remaining style.
  const MOVED = { billionaire: 'darklux', cel: 'cartoon2d', paper: 'cartoon2d', flat2d: 'motion', kinetic: 'motion', watercolor: 'biography', gameplay: 'cine3d', cgi: 'cine3d' };
  const id = MOVED[cfg.style.id] || cfg.style.id;
  const base = BB_STYLES.find((s) => s.id === id) || (cfg.myStyles || []).find((s) => s.id === id) || BB_STYLES[0];
  return { ...base, prefix: cfg.style.prefix ?? base.prefix, suffix: cfg.style.suffix ?? base.suffix };
}

function bbSanitize(text, style) {
  if (!style.is2D) return text;
  let t = text;
  for (const [re, rep] of BB_REALISM_SWAPS) t = t.replace(re, rep);
  return t.replace(/\s{2,}/g, ' ').trim();
}

// Smart hero lock: only lock the hero into scenes that mention the hero,
// so establishing shots and object close ups are not forced to include a person.
function bbMentionsHero(prompt, cfg) {
  if (cfg.hero.lockMode === 'always') return true;
  if (cfg.hero.lockMode === 'off') return false;
  const words = ['hero', 'protagonist', 'main character', 'narrator'];
  if (cfg.hero.name) words.push(cfg.hero.name.toLowerCase());
  const p = prompt.toLowerCase();
  return words.some((w) => w && p.includes(w));
}

// When Flow blocks a slide, the same moment is told in an implied, non graphic way.
// Level 1 keeps the people but removes anything graphic. Level 2 tells it through place and objects only.
const BB_SAFE_SWAPS = [
  [/\b(blood(y|ied|stained)?|bleeding|gore|gory|wounds?|injur(y|ies|ed))\b/gi, ''],
  [/\b(the |a )?(corpses?|dead bod(y|ies)|bodies|body bags?|remains)( of (the |a |an )?[\w']+)?/gi, 'police tape around an empty spot'],
  [/\b(guns?|pistols?|rifles?|revolvers?|shotguns?|knives|knife|blades?|weapons?|machetes?)\b/gi, 'shadow'],
  [/\b(stabb?(ed|ing|s)?|shoot(s|ing)?|shot (dead|him|her|them)|murder(s|ed|ing)?|kill(s|ed|ing)?|strangl\w*|choking|chokes?|beat(s|ing)? (him|her|them)|attack(s|ed|ing)?|assault\w*|tortur\w*)\b/gi, 'confronting'],
  [/\b(kidnap\w*|abduct\w*|snatch\w*|grab(s|bed|bing)?)\b/gi, 'leading away'],
  [/\b(naked|nude|undress\w*|topless)\b/gi, 'fully clothed'],
  [/\b(scream(s|ing)?|terrified|horrified|crying in pain)\b/gi, 'worried'],
  [/\b(suicide|hang(ed|ing) (himself|herself)|overdos\w*)\b/gi, 'a quiet empty room'],
  [/\b(drugs?|cocaine|heroin|syringes?|needles?)\b/gi, 'a closed bag'],
  [/\b(corpse|dead|dying|lifeless)\b/gi, 'still']
];
function bbSafeScene(text, level) {
  let t = text;
  for (const [re, rep] of BB_SAFE_SWAPS) t = t.replace(re, rep);
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  if (level >= 2) return `A quiet symbolic shot that hints at this moment through the setting, light and objects only, with no people visible and nothing graphic: ${t}`;
  return `Implied, non graphic, calm and respectful scene: tell this moment through setting, light, shadows, objects and body language, with no violence shown, no injury, no weapons and nobody in danger. ${t}`;
}
// The scene text Flow will receive for this slide (safer versions after a block).
function bbScene(slide) {
  if (!slide.safe) return slide.prompt;
  if (slide.safe === 1 && slide.safePrompt) return slide.safePrompt;
  return bbSafeScene(slide.prompt, slide.safe);
}

function bbCompose(slide, cfg) {
  const style = bbStyle(cfg);
  const blocks = [];
  if (cfg.style.enforce && style.prefix) blocks.push(`[${style.prefix}]`);
  if (cfg.hero.spec && (slide.safe || 0) < 2 && bbMentionsHero(slide.prompt, cfg)) {
    const ref = cfg.hero.attach !== 'off' && cfg.hero.refImage
      ? 'Match the hero shown in the attached reference image exactly. ' : '';
    blocks.push(`[HERO LOCK: ${ref}${cfg.hero.spec}]`);
  }
  if ((slide.safe || 0) < 2) blocks.push(...bbCastLock(slide, cfg));
  if (slide.light) blocks.push(`[TIME AND LIGHT: ${slide.light}. Same time of day, weather and lighting as the other shots of this moment.]`);
  blocks.push(`SCENE: ${bbSanitize(bbScene(slide), style)}`);
  let avoid = (cfg.style.avoid || '').trim();
  if (style.allowText) avoid = avoid.replace(/readable text,?\s*|captions,?\s*/gi, '').replace(/^,\s*|,\s*$/g, '');
  if (avoid) blocks.push(`[AVOID: ${avoid}]`);
  if (cfg.style.enforce && style.suffix) blocks.push(`[${style.suffix}]`);
  // Single line by default: some prompt boxes submit on a newline.
  return blocks.join(cfg.settings.multiline ? '\n\n' : ' ');
}

function bbSheetPrompt(cfg, member) {
  const style = bbStyle(cfg);
  const place = member && member.type === 'place';
  const thing = member && member.type === 'thing';
  const look = member ? `${member.name}: ${member.look}` : cfg.hero.spec;
  const parts = [
    style.prefix ? `[${style.prefix}]` : '',
    thing
      ? `OBJECT REFERENCE SHEET of this one object: ${look}. Show the same object three times side by side on a plain flat light grey background: front three quarter view, side view, and a close detail view. Identical model, colors, materials and details in every view. No people, no background scene, no text labels.`
      : place
      ? `LOCATION REFERENCE SHEET of this place: ${look}. Show the same place three times side by side: a wide establishing view, a wide interior or ground level view, and a close detail view. Identical layout, materials, colors and lighting in every view. No people. No text labels.`
      : `CHARACTER REFERENCE SHEET of one single character: ${look}. Show this same person three times side by side, full body, on a plain flat light grey background with nothing else in it: (1) standing, facing three quarters toward the camera, (2) seated and relaxed, (3) an expressive reaction pose. Same face, same skin tone, same hair, same outfit and colors, same proportions in all three. Soft even studio light, no shadows on the background, no props, no other people, no text or labels.`,
    style.suffix ? `[${style.suffix}]` : ''
  ];
  return parts.filter(Boolean).join(cfg.settings.multiline ? '\n\n' : ' ');
}

// Prompt for turning a finished slide image into a short video (Flow Video mode, Frames, slide image as the start frame).
function bbVideoPrompt(slide, cfg) {
  const style = bbStyle(cfg);
  const move = (slide.movement || '').trim() || 'slow gentle camera push in, subtle natural movement in the scene';
  return [
    '[Animate this exact start frame. Keep every character, face, outfit, place, color and the art style exactly as they are in the frame.]',
    `MOTION: ${bbSanitize(move, style)}.`,
    style.is2D ? '[Keep it flat 2D animation, no 3D, no realism.]' : '',
    '[One continuous shot. No cuts, no new characters, no text, no logos.]'
  ].filter(Boolean).join(' ');
}

function bbFileName(slide, total, idx, ext, format) {
  const pad = Math.max(2, String(total).length);
  const num = `Slide_${String(slide.n).padStart(pad, '0')}`;
  const range = `${bbFileTime(slide.start)}-${bbFileTime(slide.end)}`;
  const v = idx > 0 ? `_v${idx + 1}` : '';
  const name = {
    'slide-time': `${num}_${range}`,
    'time-slide': `${range}_${num}`,
    'slide': num,
    'time': range
  }[format] || `${num}_${range}`;
  return `${name}${v}.${ext}`;
}

function bbMotherPrompt(o) {
  const wps = o.wordsPerSecond || 2.5;
  return `You are a storyboard artist and prompt writer for a faceless video channel.

TASK
Turn the script at the bottom into (1) a STORY BIBLE and (2) a shot list for an AI image generator. Output exactly TWO code blocks and nothing else.

STEP 1: STORY BIBLE (first code block)
- ERA: one line with the years and region the story happens in, and what must match that time (vehicles, clothing, hairstyles, phones and technology, signs). If the story is set today, say so.
- List every person or animal SHOWN in more than one image, every place that appears in more than one image (a house, apartment, office, courtroom, street, town...), and every THING that appears in more than one image: vehicles (cars, police cars, buses, boats), important objects (a backpack, a letter, a photo, a bag of money, evidence), and uniforms (police, school, nurse).
- Give each one ONE fixed, specific visual description that never changes. Be concrete enough that a stranger could draw the same person twice.
  - People, always in this order: age and build; skin tone, written as one exact shade that stays identical in every lighting; face shape and eyes; hair with exact length, color, texture and parting; outfit layer by layer from top to bottom with a color for every item (for example "navy wool coat over a white collared shirt, charcoal trousers, brown leather boots"); then ONE identity marker that makes them instantly recognisable (a scar, glasses, a red scarf, a gold ring...). End the description with "kept identical in every image".
  - Never use vague words like "casual clothes", "dark hair" or "average build". Name the item and the color.
  - People also need: height compared to the others, and family or group links ("older brother of the boy", "the boy's mother") so ages and sizes stay right next to each other.
  - Animals: species, breed, size, coat colors and one marking.
  - Places: type, size, materials, colors, key features, lighting, and one landmark detail that is always visible. If a place is seen inside and outside, describe both so they match.
  - Things: exact type, make or model style, era, color, material, size, condition, and one detail that is always visible (a dent, a sticker, a badge number). Example: "the man's car: 1970s white four door sedan, rust on the front left fender, cream vinyl seats".
- If a person appears at very different ages, make separate entries, like "the boy, young" and "the boy, teenager".
- Real people: give them a ROLE name ("the boy", "the man", "the mother", "the detective"), not their full real name, and describe them plainly and respectfully, no famous lookalikes.
- Children (anyone under 18): never write a number for their age and never use a real child's real name, anywhere.
- One line per entry, exactly:
ERA | Name | | description
CHARACTER | Name | other names used for them, comma separated | description
PLACE | Name | other names used for it, comma separated | description
THING | Name | other names used for it, comma separated | description
- If there is a main narrator figure or one recurring hero, call them "${o.heroWord}" and do NOT describe them; their design is added later.

STEP 2: SHOT LIST (second code block, CSV)
- Use every sentence of the script. Never skip or summarize a line.
- Speaking pace is about ${wps} words per second.
${o.secs ? `- PACING: every slide stays on screen for ${o.secs} second${o.secs > 1 ? 's' : ''} of narration (about ${Math.max(1, Math.round(o.secs * wps))} spoken word${Math.round(o.secs * wps) > 1 ? 's' : ''}). Make every slide as close to exactly ${o.secs} second${o.secs > 1 ? 's' : ''} as you can. The same length for the whole video, including the opening.
- COMBINE short sentences into ONE slide until it reaches about ${o.secs} second${o.secs > 1 ? 's' : ''}.
- SPLIT any sentence longer than ${o.secs} second${o.secs > 1 ? 's' : ''} at natural pauses (commas, "and", "but", "then") into slides of about ${o.secs} second${o.secs > 1 ? 's' : ''} each, each with its own image of that exact part.
- Never cut a word in half. If a slide must be a little longer or shorter to end on a natural pause, keep the difference under 1 second.${o.target ? `
- This script needs about ${o.target} slides in total. Stay close to that number.` : ''}
` : `- PACING: each slide stays on screen for ${o.minSecs} to ${o.maxSecs} seconds of narration (about ${Math.round(o.minSecs * wps)} to ${Math.round(o.maxSecs * wps)} spoken words).
- COMBINE short sentences that belong to the same idea, place or person into ONE slide until it reaches that length. Do NOT make a new slide for every line.
- SPLIT only a sentence that runs longer than ${o.maxSecs} seconds, into slides of one visual idea each.
- Start a new slide when the idea, place, person or moment changes, never just because a new sentence starts.
- HOOK: the first 15 seconds may change slides a little faster (down to ${Math.max(2, o.minSecs - 2)} seconds) to grab attention, then keep the pacing above.${o.target ? `
- This script needs about ${o.target} slides in total. Stay close to that number.` : ''}
`}- Timing is continuous: each slide starts exactly where the previous one ends. The first slide starts at 00:00.
- Prompt: describe only what is in the frame: subject, action, emotion, setting, camera angle (wide, medium, close up, over the shoulder, top down), lighting, props, visual metaphors.
- In the Prompt, refer to every character, place and thing by its EXACT name from the story bible (for example "the boy", "the man's cabin", "the man's car") and do NOT describe their looks again. Their descriptions are added automatically. Never write just "a car" when it is a story bible car.
- Characters column: the exact cast names of everyone visible in the image, separated by semicolons, or empty.
- Motion column: a score from 1 to 5 for how much this shot would gain from being animated. 5 = action, a reveal, the hook, an emotional peak. 1 = a map, a document, a calendar, a static object.
- Movement column: if Motion is 3 or more, one short line describing the movement for a video (camera move plus what moves in the scene, e.g. "slow push in as he turns his head, rain falling"); otherwise empty.
- Location column: the exact name of the place, or empty if it is not a story bible place.
- Things column: the exact names of story bible things visible in the image, separated by semicolons, or empty.
- Moment column: a short label for the continuous moment this shot belongs to (M1, M2, M3...). Shots that happen at the same time and place share the same label.
- Light column: time of day, weather and light for this moment, like "night, heavy rain, cold streetlight" or "late afternoon, warm sun". Keep it identical for every shot of the same moment.
- SAFE STORYTELLING (image generators block these, so follow strictly):
  - Never show a child in the same image as danger, a threatening adult, a stranger approaching, a vehicle taking them, being held, restrained, hurt or hidden. Tell those moments through places, objects, adults and aftermath instead: an empty street, a dropped backpack, a car driving away in the distance, a door closing, a newspaper headline, worried parents, police at a door.
  - Children appear only in safe everyday moments (home, school, family, playing).
  - Violence, crime and death are always implied, never shown: no weapons pointed at anyone, no blood, no injuries, no bodies.
- Do NOT mention any art style, medium, or rendering words (no "2D", "cartoon", "3D", "photorealistic", "anime", "cinematic", "4k"). The style is added later.
- No readable text, logos, or watermarks inside the image. Put any words for the screen in the Overlay column instead.
- Vary the camera angles so consecutive slides do not look the same.${o.extra ? `\n- ${o.extra}` : ''}
- Header exactly: Slide,Start,End,Narration,Overlay,Characters,Location,Things,Moment,Light,Motion,Movement,Prompt
- Start and End: MM:SS. Narration: the exact words spoken during this slide. Overlay: 1 to 4 punchy words or empty.
- Wrap every value in double quotes.

SCRIPT
${o.script || '[Paste your full script here]'}`;
}
