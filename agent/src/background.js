// Bolblar Agent service worker.
// Desktop Chrome/Edge: the toolbar icon opens the side panel.
// Browsers without a side panel (Kiwi, Mises, Edge Canary on Android, Orion):
// the icon toggles a floating panel on the Flow page instead.

const FLOW_URL = 'https://labs.google/fx/tools/flow';

async function applyUiMode() {
  const hasSidePanel = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);
  const { bb_uiMode = 'auto' } = await chrome.storage.local.get('bb_uiMode');
  const useSide = hasSidePanel && bb_uiMode !== 'overlay';
  await chrome.storage.local.set({ bb_hasSidePanel: hasSidePanel, bb_useSidePanel: useSide });
  if (hasSidePanel) {
    try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: useSide }); } catch (e) {}
  }
}

chrome.runtime.onInstalled.addListener(applyUiMode);
chrome.runtime.onStartup.addListener(applyUiMode);
chrome.storage.onChanged.addListener((c) => { if (c.bb_uiMode) applyUiMode(); });

// Fires only when the side panel is not bound to the action click.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url || !/^https:\/\/(labs\.google|flow\.google\.com)\//.test(tab.url)) {
    await chrome.tabs.create({ url: FLOW_URL });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'overlay:toggle' });
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'overlay:toggle' }).catch(() => {}), 200);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return; // only this extension (security review EXT-12)
  if (msg && msg.type === 'bg:openFlow') {
    chrome.tabs.create({ url: FLOW_URL }).then(() => reply({ ok: true }));
    return true;
  }
});
