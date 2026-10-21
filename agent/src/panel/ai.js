// Bolblar AI helper: talks to Google's Gemini API with the user's own key, so the shot list,
// the cast and the descriptions are written without any copy and paste.
const BBAI = (() => {
  const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']; // free tier models
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  let key = '';
  let works = null; // the model and address that answered last time are tried first
  chrome.storage.local.get(['bb_aiKey'], (r) => { key = r.bb_aiKey || ''; });
  chrome.storage.onChanged.addListener((c) => { if (c.bb_aiKey) key = c.bb_aiKey.newValue || ''; });

  // Collect every piece of generated text in a response, whatever its exact shape.
  function texts(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
    if (typeof node.text === 'string' && node.thought !== true && node.type !== 'thought') out.push(node.text);
    for (const [k, v] of Object.entries(node)) if (k !== 'text' && typeof v === 'object') texts(v, out);
    return out;
  }
  async function viaInteractions(model, prompt, k) {
    const res = await fetch(`${BASE}/interactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify({ model, input: prompt, generation_config: { temperature: 0.7, max_output_tokens: 32000, thinking_level: 'low' } })
    });
    if (!res.ok) throw Object.assign(new Error(await errText(res)), { status: res.status });
    const data = await res.json();
    if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
    const steps = data.steps || data.outputs || [];
    const last = Array.isArray(steps) && steps.length ? texts(steps[steps.length - 1]) : [];
    return (last.length ? last : texts(data)).join('');
  }
  async function viaGenerate(model, prompt, k) {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 32000 } })
    });
    if (!res.ok) throw Object.assign(new Error(await errText(res)), { status: res.status });
    const data = await res.json();
    return texts(data.candidates && data.candidates[0] && data.candidates[0].content).join('');
  }
  async function errText(res) {
    try { const j = await res.json(); return (j.error && j.error.message) || `HTTP ${res.status}`; } catch (e) { return `HTTP ${res.status}`; }
  }
  function friendly(e) {
    const m = String(e.message || e);
    if (e.status === 400 && /api key/i.test(m) || e.status === 401 || e.status === 403) return 'Google refused the API key. Check it in Settings → AI helper.';
    if (e.status === 429) return 'Google says too many requests or the free limit is reached. Wait a minute and try again.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection to Google. Check your internet.';
    return 'Gemini error: ' + m;
  }
  async function ask(prompt, onStatus) {
    if (!key) throw new Error('Add your free Gemini API key in Settings → AI helper.');
    let last;
    const plan = [];
    if (works) plan.push(works);
    for (const model of MODELS) for (const call of [viaInteractions, viaGenerate]) if (!works || works[0] !== model || works[1] !== call) plan.push([model, call]);
    for (const [model, call] of plan) {
      try {
        onStatus && onStatus(`Asking ${model}…`);
        const out = (await call(model, prompt, key)).trim();
        if (out) { works = [model, call]; return out; }
      } catch (e) {
        last = e;
        if (e.status === 401 || e.status === 403 || (e.status === 400 && /api key/i.test(e.message))) throw new Error(friendly(e));
        if (e.status === 429) break; // this model's limit: try the next model
      }
    }
    throw new Error(last ? friendly(last) : 'Gemini returned nothing. Try again.');
  }
  return { ask, hasKey: () => !!key, setKey: (k) => { key = k.trim(); return chrome.storage.local.set({ bb_aiKey: key }); }, friendly };
})();
