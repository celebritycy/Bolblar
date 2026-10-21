// Bolblar Agent engine: talks to the Flow tab, and optionally drives it
// through Chrome's debugger ("Precision mode") for the most reliable typing and clicks.
// Precision mode is desktop only and needs the optional "debugger" permission.

const BBEngine = (() => {
  let tabId = null;

  async function flowTab() {
    try {
      const cur = await chrome.tabs.getCurrent(); // set when the panel runs as the floating overlay
      if (cur && cur.url && /^https:\/\/(labs\.google|flow\.google\.com)\//.test(cur.url)) return (tabId = cur.id, cur);
    } catch (e) {}
    const tabs = await chrome.tabs.query({ url: ['https://labs.google/*', 'https://flow.google.com/*'] });
    if (!tabs.length) return null;
    let win = null;
    try { win = await chrome.windows.getCurrent(); } catch (e) {}
    const t = tabs.find((x) => x.id === tabId) || tabs.find((x) => win && x.active && x.windowId === win.id) || tabs.find((x) => x.active) || tabs[0];
    tabId = t.id;
    return t;
  }

  async function send(msg) {
    const t = await flowTab();
    if (!t) throw new Error('Open Google Flow and open a project first.');
    try { return await chrome.tabs.sendMessage(t.id, msg); }
    catch (e) {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/content.js'] });
      await new Promise((r) => setTimeout(r, 250));
      return chrome.tabs.sendMessage(t.id, msg);
    }
  }

  // ---------- Precision mode ----------
  const attached = new Set();
  let lastDetach = '';
  const hasDebuggerApi = () => !!(chrome.debugger && chrome.debugger.attach);
  // The debugger permission is granted at install (Chrome does not allow it as optional).
  // It is only used when the user switches the engine to Precision.
  async function precisionAllowed() { return hasDebuggerApi(); }
  async function requestPrecision() { return hasDebuggerApi(); }
  if (chrome.debugger && chrome.debugger.onDetach) {
    chrome.debugger.onDetach.addListener((src, reason) => { attached.delete(src.tabId); lastDetach = reason || 'unknown'; });
  }
  async function attach() {
    const t = await flowTab();
    if (!t || !hasDebuggerApi()) return false;
    if (attached.has(t.id)) return true;
    try { await chrome.debugger.attach({ tabId: t.id }, '1.3'); attached.add(t.id); return true; }
    catch (e) { if (/already attached/i.test(e.message)) { attached.add(t.id); return true; } return false; }
  }
  async function detach() {
    for (const id of [...attached]) { try { await chrome.debugger.detach({ tabId: id }); } catch (e) {} attached.delete(id); }
  }
  async function cdp(method, params) {
    const t = await flowTab();
    return chrome.debugger.sendCommand({ tabId: t.id }, method, params);
  }
  async function cdpInsert(text) { await cdp('Input.insertText', { text }); }
  async function cdpClick(x, y) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await new Promise((r) => setTimeout(r, 70));
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async function cdpEnter() {
    const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await cdp('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...k });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  }

  return { flowTab, send, hasDebuggerApi, precisionAllowed, requestPrecision, attach, detach, cdpInsert, cdpClick, cdpEnter, isAttached: () => attached.size > 0, lastDetach: () => lastDetach };
})();
