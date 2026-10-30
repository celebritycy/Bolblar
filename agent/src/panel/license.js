// Bolblar subscription check. The agent works only with an active access code, on at most 2 devices.
// It checks with the Bolblar server when it opens and once a day; offline it keeps working for up to 3 days after the
// last successful check, whatever date is stored (security review EXT-01).
const BBLicense = (() => {
  const API = (typeof BB_LICENSE_CONFIG !== 'undefined' && BB_LICENSE_CONFIG.api) || '';
  const DAY = 86400000, OFFLINE_MAX = 3 * DAY;
  // Addresses the server hands out are opened only on the sites they belong to (security review EXT-08, SITE-08).
  const ALLOWED = {
    checkout: /^https:\/\/(checkout\.paystack\.com|paystack\.com|[a-z0-9-]+\.paystack\.com)\//i,
    manage: /^https:\/\/([a-z0-9-]+\.)?paystack\.com\//i,
    update: /^https:\/\/(github\.com\/celebritycy\/bolblar\/releases\/|bolblar\.com\/|www\.bolblar\.com\/)/i,
    telegram: /^https:\/\/t\.me\//i,
  };
  const safeLink = (kind, url) => (typeof url === 'string' && ALLOWED[kind].test(url) ? url : '');
  const get = (k) => new Promise((ok) => chrome.storage.local.get([k], (r) => ok(r[k])));
  const set = (k, v) => chrome.storage.local.set({ [k]: v });
  let state = null;

  async function deviceId() {
    let id = await get('bb_device');
    if (!id) { id = crypto.randomUUID(); await set('bb_device', id); }
    return id;
  }
  function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : 'Computer';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : 'Chrome';
    return `${br} on ${os}`;
  }
  async function call(action, body = {}) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({ ok: false, reason: 'server' }));
    if (res.status >= 500) throw new Error('server');
    return j;
  }

  // ok: true when the agent may be used right now.
  async function check(force) {
    if (!API) return (state = { ok: true, free: true });
    const saved = (await get('bb_license')) || {};
    const now = Date.now();
    if (!saved.code) return (state = { ok: false, reason: 'none' });
    const fresh = saved.ok && saved.checkedAt && now - saved.checkedAt < DAY && now - saved.checkedAt >= 0 && now < new Date(saved.checkAgainBy || 0).getTime();
    if (fresh && !force) return (state = saved);
    try {
      const r = await call('license', { code: saved.code, device_id: await deviceId(), label: deviceLabel() });
      state = { ...r, code: r.ok ? r.code : saved.code, checkedAt: now };
      await set('bb_license', state);
      return state;
    } catch (e) {
      // No internet or the server is down: keep working until the last "check again by" date, and never more than 3 days
      // after the last check that the server answered.
      const lastOk = Number(saved.checkedAt) || 0;
      if (saved.ok && now < new Date(saved.checkAgainBy || 0).getTime() && now - lastOk >= 0 && now - lastOk < OFFLINE_MAX) return (state = { ...saved, offline: true });
      return (state = { ok: false, reason: 'offline', code: saved.code });
    }
  }
  async function activate(code) {
    if (!API) return { ok: true, free: true };
    try {
      const r = await call('license', { code, device_id: await deviceId(), label: deviceLabel() });
      state = { ...r, code: r.ok ? r.code : code, checkedAt: Date.now() };
      if (r.ok) await set('bb_license', state);
      return state;
    } catch (e) { return { ok: false, reason: 'offline' }; }
  }
  // After a reinstall or on a new computer: sign out every other device and keep this one.
  async function swap(code) {
    if (!API) return { ok: true, free: true };
    if (!code) code = ((await get('bb_license')) || {}).code;
    try {
      const r = await call('swap', { code, device_id: await deviceId(), label: deviceLabel() });
      state = { ...r, code: r.ok ? r.code : code, checkedAt: Date.now() };
      if (r.ok) await set('bb_license', state);
      return state;
    } catch (e) { return { ok: false, reason: 'offline' }; }
  }
  // Subscribe: open Paystack in a new tab, then wait for the payment and unlock by itself.
  async function subscribe(email, onWaiting) {
    const r = await call('start', { email });
    if (!r.ok) return r;
    const url = safeLink('checkout', r.url);
    if (!url) return { ok: false, reason: 'server' };
    await set('bb_checkout', { reference: r.reference, at: Date.now() });
    chrome.tabs.create({ url });
    if (onWaiting) onWaiting();
    return waitForPayment(r.reference);
  }
  async function waitForPayment(reference) {
    const until = Date.now() + 20 * 60000;
    while (Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, 4000));
      try {
        const c = await call('claim', { reference });
        if (c.ok && c.code) { await set('bb_checkout', null); return activate(c.code); }
      } catch (e) {}
    }
    return { ok: false, reason: 'not_paid' };
  }
  async function pendingCheckout() { const c = await get('bb_checkout'); return c && Date.now() - c.at < 30 * 60000 ? c.reference : null; }
  async function manage() {
    const s = (await get('bb_license')) || {};
    const r = await call('manage', { code: s.code });
    const link = r.ok ? safeLink('manage', r.link) : '';
    if (link) chrome.tabs.create({ url: link });
    return r;
  }
  async function resend(email) { return call('resend', { email }); }
  async function signOut() {
    const s = (await get('bb_license')) || {};
    if (API && s.code) await call('release', { code: s.code, device_id: await deviceId() }).catch(() => {});
    await set('bb_license', null); state = { ok: false, reason: 'none' };
  }
  // Is a newer version out? The latest number and its download link are set in the server's secrets.
  async function update() {
    if (!API) return null;
    try {
      const c = await call('config');
      const mine = chrome.runtime.getManifest().version;
      const link = safeLink('update', c.updateLink);
      return c.latest && link && newer(c.latest, mine) ? { latest: c.latest, link, sha256: /^[0-9a-f]{64}$/i.test(c.sha256 || '') ? c.sha256 : '' } : null;
    } catch (e) { return null; }
  }
  function newer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
    return false;
  }
  async function price() { if (!API) return ''; try { return (await call('config')).price || ''; } catch (e) { return ''; } }

  return { enabled: !!API, safeLink, check, activate, swap, subscribe, waitForPayment, pendingCheckout, manage, resend, signOut, price, update, newer, current: () => state };
})();
