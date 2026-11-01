// DDinspect - background script
// Runs as a service worker in Chrome and as an event page in Firefox
// (manifest "background": service_worker for Chrome, scripts for Firefox).
// Responsibilities:
//  - Open the side panel / sidebar (extension icon, context menu and keyboard shortcut).
//  - Create the context menu (right click) entries.
//  - Turn picker mode on / off in the tab.
//  - Forward side panel commands to the tab (injecting the script if it is missing).
//  - Keep the per-tab "ON" badge.
//  - Capture the visible tab to build thumbnails of saved elements.
//  - Fetch cross-origin stylesheets the page can't read (host permissions skip CORS).
//  - Tell the tab when the side panel is closed.
//  - Open the welcome page on first install.

const MENU_TOGGLE = 'ddinspect-toggle';
const MENU_INSPECT = 'ddinspect-inspect';
const MENU_PANEL = 'ddinspect-panel';
const PANEL_TAB_KEY = 'ddinspect:panel-tab';
const CONTENT_SCRIPTS = ['shared/ddinspect-shared.js', 'content/scan.js', 'content/export.js', 'content/content.js'];
const MAX_CSS_BYTES = 5 * 1024 * 1024;

const t = (key) => chrome.i18n.getMessage(key) || key;

// Chrome has chrome.sidePanel; Firefox has sidebarAction (manifest "sidebar_action").
const sidebarAction = globalThis.browser?.sidebarAction || chrome.sidebarAction;

// Clicking the extension icon opens the panel.
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
} else if (sidebarAction) {
  chrome.action.onClicked.addListener(() => sidebarAction.toggle());
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TOGGLE,
      title: t('menuToggle'),
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: MENU_INSPECT,
      title: t('menuInspect'),
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: MENU_PANEL,
      title: t('menuSaved'),
      contexts: ['all']
    });
  });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});

// Cross-origin stylesheet → its text. Only http(s) and only CSS-looking answers,
// capped in size; credentials are not sent.
async function fetchCss(url) {
  if (!/^https?:/i.test(url)) return { ok: false };
  try {
    const resp = await fetch(url, { credentials: 'omit' });
    const type = resp.headers.get('content-type') || '';
    if (!resp.ok || (type && !/text\/css|text\/plain/i.test(type))) return { ok: false };
    const text = await resp.text();
    return text.length > MAX_CSS_BYTES ? { ok: false } : { ok: true, text };
  } catch {
    return { ok: false };
  }
}

// Sends a message to the content script; if it is not loaded (tab opened before the
// extension was installed) it injects it and retries.
async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPTS
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (injectErr) {
      // Restricted pages: chrome://, about:, extension stores, PDF viewer, etc.
      return { ok: false, error: 'restricted' };
    }
  }
}

// sidePanel.open() / sidebarAction.open() only work as a direct response to a user
// gesture (menu click, shortcut...), so this is called before any await.
function openSidePanel(tab) {
  const opening = chrome.sidePanel
    ? chrome.sidePanel.open({ windowId: tab.windowId })
    : sidebarAction?.open();
  Promise.resolve(opening).catch((err) => {
    console.warn('[DDinspect] Could not open the side panel:', err.message);
  });
}

// Captures the tab and crops it to the element rectangle. Done here (not in the
// content script) because some pages' CSP blocks data: images.
const THUMB_MAX_W = 480;
const THUMB_MAX_H = 360;

async function captureElement(windowId, rect, viewportWidth) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

  // The capture is in physical pixels: scale = captured width / viewport width in CSS px.
  const scale = bitmap.width / viewportWidth;
  const sx = Math.round(rect.x * scale);
  const sy = Math.round(rect.y * scale);
  const sw = Math.max(1, Math.round(rect.width * scale));
  const sh = Math.max(1, Math.round(rect.height * scale));
  const k = Math.min(1, THUMB_MAX_W / sw, THUMB_MAX_H / sh);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)));
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return 'data:image/jpeg;base64,' + btoa(binary);
}

function setBadge(tabId, active) {
  chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#7C4DFF' });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id === undefined || tab.id < 0) return;
  openSidePanel(tab);
  if (info.menuItemId === MENU_TOGGLE) sendToTab(tab.id, { type: 'ddinspect:toggle' });
  if (info.menuItemId === MENU_INSPECT) sendToTab(tab.id, { type: 'ddinspect:inspect-context-target' });
  if (info.menuItemId === MENU_PANEL) {
    // The panel may still be loading: leave the requested tab in storage.session
    // (read on startup) and notify in case it is already open.
    chrome.storage.session.set({ [PANEL_TAB_KEY]: 'saved' });
    chrome.runtime.sendMessage({ type: 'ddinspect:show-tab', tab: 'saved' }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-ddinspect' || !tab || tab.id === undefined) return;
  openSidePanel(tab);
  sendToTab(tab.id, { type: 'ddinspect:toggle' });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Side panel commands: forward to the given tab.
  if (msg.type === 'ddinspect:panel-command') {
    sendToTab(msg.tabId, msg.payload).then(sendResponse);
    return true;
  }

  // The content script reports its state to update the badge.
  if (msg.type === 'ddinspect:state' && sender.tab) {
    setBadge(sender.tab.id, msg.active);
    return false;
  }

  // A stylesheet the page can't read (cross-origin without CORS).
  if (msg.type === 'ddinspect:fetch-css' && sender.tab) {
    fetchCss(String(msg.url || '')).then(sendResponse);
    return true;
  }

  // Visible tab capture cropped to the element (thumbnail).
  if (msg.type === 'ddinspect:capture' && sender.tab) {
    captureElement(sender.tab.windowId, msg.rect, msg.viewportWidth)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

// The side panel keeps a port open and reports which tab it is showing.
// When the panel closes the port disconnects: picker mode is turned off in that tab.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ddinspect-sidepanel') return;
  let tabId = null;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'tab') tabId = msg.tabId;
  });
  port.onDisconnect.addListener(() => {
    if (tabId !== null) chrome.tabs.sendMessage(tabId, { type: 'ddinspect:panel-closed' }).catch(() => {});
  });
});

// On navigation the content script reloads turned off: clear the badge.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') setBadge(tabId, false);
});
