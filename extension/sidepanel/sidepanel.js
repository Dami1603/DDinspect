// DDinspect - side panel
// Shows the inspector for the element selected in the active tab, the page assets
// (Images, SVGs, Colors, Fonts: see assets.js) and the saved collection.
// The tab's content script does the picking and sends the data with
// 'ddinspect:selected'; the panel sends commands back through the service worker
// ('ddinspect:panel-command'), which injects the script if needed.
//
// The UI is built with DOM APIs (textContent), never innerHTML, because it shows
// page data (classes, attributes, URLs) that is not trusted.

const S = globalThis.DDinspectShared;
const t = S.t;

const PANEL_TAB_KEY = 'ddinspect:panel-tab';
const TABS = ['inspector', 'images', 'svgs', 'colors', 'fonts', 'saved'];

// 'imagen' keeps thumbnails working for items saved by the Spanish 1.x builds.
const IMAGE_TYPES = new Set(['image', 'imagen', 'srcset', 'currentSrc', 'background', 'poster', 'mask-image', 'list-style-image', 'border-image-source', 'content']);

// Values shown dimmed because they are usually the default.
const DEFAULTISH = /^(none|normal|auto|0px|0s|0|static|visible|start|stretch|nowrap|row|baseline|rgba\(0, 0, 0, 0\)|0px none rgb\(.*\))$/;

const state = {
  tabId: null,
  tabUrl: '',
  restricted: false,
  active: false,
  info: null,           // Selection in the active tab (live: can be navigated)
  viewingSaved: null,   // id of the saved element shown in the inspector
  tab: 'inspector',     // one of TABS
  saved: [],
  search: '',
  settings: { ...S.DEFAULT_SETTINGS },
  shortcut: '',
  openSections: { composition: true, box: true, resources: true, rules: true, computed: false, export: false, cors: false, contrast: true },
  // Asset scans, cached per scope ('page' = whole document, 'selection' = selected element subtree).
  assets: { page: null, selection: null },
  scanning: { page: false, selection: false },
  scanGen: { page: 0, selection: 0 },
  // "Selected element" first by default (options page); scopeFor() falls back to the page while nothing is selected.
  scope: { images: 'selection', svgs: 'selection', colors: 'selection', fonts: 'selection' },
  filters: { imageType: 'all', imageQuery: '', colorRole: 'all', svgBackground: 'light' },
  // Component export of the live selection: null | { loading } | { result, format }.
  exported: null,
  goInspect: false      // set by "locate" so the next selection opens Inspect
};

const ui = {
  mode: document.getElementById('mode'),
  toggle: document.getElementById('toggle'),
  options: document.getElementById('options'),
  theme: document.getElementById('theme'),
  close: document.getElementById('close'),
  restricted: document.getElementById('restricted'),
  tabs: Array.from(document.querySelectorAll('.wd-tab')),
  body: document.getElementById('body'),
  toast: document.getElementById('toast')
};

let toastTimer = null;
let port = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Line icons (24×24, stroked with currentColor). Each entry: [tag, attributes].
const ICONS = {
  copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }]],
  download: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
  upload: [['path', { d: 'M12 20V9M7 14l5-5 5 5M5 4h14' }]],
  external: [['path', { d: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }]],
  locate: [['circle', { cx: 12, cy: 12, r: 7 }], ['circle', { cx: 12, cy: 12, r: 2 }], ['path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3' }]],
  refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.4-5.7L20 8.5M20 4v4.5h-4.5' }]],
  star: [['path', { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
  moon: [['path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  sliders: [['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }], ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 17, r: 2 }]],
  parent: [['path', { d: 'M12 19V5M6 11l6-6 6 6' }]],
  code: [['path', { d: 'M8 7l-5 5 5 5M16 7l5 5-5 5' }]],
  trash: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' }]],
  eye: [['path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  back: [['path', { d: 'M19 12H5M11 6l-6 6 6 6' }]],
  zip: [['path', { d: 'M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 3v2M11 7v2M11 11v2' }], ['rect', { x: 9.5, y: 14, width: 3, height: 3, rx: 0.5 }]],
  contrast: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 3a9 9 0 0 1 0 18z', fill: 'currentColor' }]]
};

function icon(name, cls = 'wd-icon') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

// Button with an icon and a visible label.
function btn(label, iconName, onclick, cls = 'wd-btn', extra = {}) {
  return h('button', { class: cls, onclick, ...extra }, iconName && icon(iconName), h('span', {}, label));
}

// Icon-only button: the label goes to title and aria-label.
function iconBtn(label, iconName, onclick, cls = 'wd-icon-btn') {
  return h('button', { class: cls, title: label, 'aria-label': label, onclick }, icon(iconName));
}

function fmt(n) {
  return String(S.round(n));
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('wd-toast-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('wd-toast-show'), 1800);
}

async function copyText(text, message = t('toastCopied')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(t('toastCopyFailed'));
  }
}

function colorText(hex) {
  return S.formatColor(hex, state.settings.colorFormat);
}

// Command to the active tab (through the service worker).
async function command(payload) {
  if (state.tabId === null) return null;
  try {
    return await chrome.runtime.sendMessage({ type: 'ddinspect:panel-command', tabId: state.tabId, payload });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Active tab and service worker connection
// ---------------------------------------------------------------------------

// Port so the service worker knows when the panel closes (and turns the picker
// off). If the service worker goes idle the port drops: reconnect.
function connectPort() {
  port = chrome.runtime.connect({ name: 'ddinspect-sidepanel' });
  port.onDisconnect.addListener(() => setTimeout(connectPort, 200));
  if (state.tabId !== null) port.postMessage({ type: 'tab', tabId: state.tabId });
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const changed = tab?.id !== state.tabId;
  state.tabId = tab ? tab.id : null;
  state.tabUrl = tab?.url || '';
  if (changed) {
    clearAssets();
    state.exported = null;
  }
  if (port && state.tabId !== null) port.postMessage({ type: 'tab', tabId: state.tabId });

  const resp = await command({ type: 'ddinspect:get-state' });
  state.restricted = !(resp && resp.ok);
  state.active = !!(resp && resp.active);
  state.info = resp && resp.info ? resp.info : null;
  render({ resetScroll: changed });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render({ resetScroll = false } = {}) {
  ui.restricted.classList.toggle('wd-hidden', !state.restricted);
  ui.toggle.disabled = state.restricted || state.tabId === null;
  ui.toggle.setAttribute('aria-checked', String(state.active));
  ui.toggle.classList.toggle('wd-on', state.active);
  ui.toggle.title = state.active ? t('pickerPauseTitle') : t('pickerStartTitle');
  ui.mode.textContent = state.restricted
    ? t('modeRestricted')
    : state.active ? t('modeOn') : t('modeOff');
  renderTabBar();

  const scroll = ui.body.scrollTop;
  ui.body.replaceChildren(
    state.tab === 'inspector' ? renderInspector()
      : state.tab === 'saved' ? renderSavedList()
        : renderAssetTab(state.tab)
  );
  ui.body.scrollTop = resetScroll ? 0 : scroll;
  ensureScans();
}

// Active tab (ARIA tabs with a roving tabindex) + counter badges.
function renderTabBar() {
  for (const button of ui.tabs) {
    const tab = button.dataset.tab;
    const selected = state.tab === tab;
    button.classList.toggle('wd-tab-active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) ui.body.setAttribute('aria-labelledby', button.id);
    const badge = button.querySelector('.wd-count');
    if (!badge) continue;
    const count = tab === 'saved' ? state.saved.length : assetCount(tab);
    badge.textContent = count === null ? '' : count > 999 ? '999+' : String(count);
    badge.classList.toggle('wd-hidden', count === null);
    badge.classList.toggle('wd-count-zero', count === 0);
  }
}

function switchTab(tab) {
  state.tab = tab;
  render({ resetScroll: true });
}

// Collapsible block that remembers whether it was open across re-renders.
function collapsible(key, cls, title, content) {
  const details = h('details', { class: cls, open: state.openSections[key] ? '' : null },
    h('summary', {}, title),
    content
  );
  details.addEventListener('toggle', () => {
    state.openSections[key] = details.open;
  });
  return details;
}

function section(key, title, content) {
  return collapsible(key, 'wd-section', title, h('div', { class: 'wd-section-body' }, content));
}

function linkOrText(url, text, cls = 'wd-link') {
  if (S.isSafeUrl(url)) {
    return h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, text || url);
  }
  return h('span', { class: cls, title: url }, text || url);
}

// List item that, in live mode, highlights and selects a real node in the page.
// ref = { kind: 'ancestor' | 'child', index }, or null when viewing a saved element.
function liveItem(tag, cls, text, ref) {
  if (!ref) return h(tag, { class: cls }, text);
  return h(tag, {
    class: cls + ' wd-clickable',
    title: t('clickToSelect'),
    tabindex: '0',
    onmouseenter: () => command({ type: 'ddinspect:highlight', ...ref }),
    onmouseleave: () => command({ type: 'ddinspect:unhighlight' }),
    onclick: () => command({ type: 'ddinspect:select-related', ...ref }),
    onkeydown: (e) => { if (e.key === 'Enter') command({ type: 'ddinspect:select-related', ...ref }); }
  }, text);
}

function kbdCombo(combo) {
  const keys = combo.split('+');
  return keys.map((key, i) => [h('kbd', {}, key), i < keys.length - 1 ? '+' : '']);
}

function renderInspector() {
  if (state.viewingSaved) {
    const item = state.saved.find((it) => it.id === state.viewingSaved);
    if (item) {
      return h('div', {},
        btn(t('backToInspector'), 'back', () => { state.viewingSaved = null; render({ resetScroll: true }); }, 'wd-btn wd-btn-ghost wd-back'),
        h('div', { class: 'wd-saved-note' },
          t('savedFrom'), ' ', linkOrText(item.page.url, S.hostOf(item.page.url)), ` · ${S.formatDate(item.savedAt)}`),
        renderInfo(item, false)
      );
    }
    state.viewingSaved = null;
  }

  if (!state.info) {
    return h('div', { class: 'wd-empty' },
      h('img', { class: 'wd-empty-logo', src: '../icons/logo.svg', alt: '' }),
      h('p', {}, h('strong', {}, t('emptyStartTitle')), ' ', t('emptyStartText')),
      h('ul', { class: 'wd-keys' },
        h('li', {}, t('emptyParentFirst')),
        h('li', {}, h('kbd', {}, '↑'), ' ', t('emptyKeyUp')),
        h('li', {}, h('kbd', {}, '↓'), ' ', t('emptyKeyDown')),
        h('li', {}, h('kbd', {}, 'Enter'), ' ', t('emptyKeyEnter')),
        h('li', {}, h('kbd', {}, 'Esc'), ' ', t('emptyKeyEsc')),
        h('li', {}, state.shortcut ? kbdCombo(state.shortcut) : h('em', {}, t('shortcutNotSet')), ' ', t('emptyKeyToggle')),
        h('li', {}, t('emptyContextMenu'))
      ),
      !state.active && !state.restricted && btn(t('pickerStart'), null, () => setActive(true), 'wd-btn wd-btn-primary')
    );
  }
  return renderInfo(state.info, true);
}

// live === false → viewing a saved element (no links to live nodes).
function renderInfo(info, live) {
  return h('div', { class: 'wd-info' },
    section('composition', t('sectionComposition', info.composition.childCount), renderComposition(info, live)),
    section('box', t('sectionBox'), renderBox(info)),
    section('resources', t('sectionResources', info.resources.length), renderResources(info)),
    section('rules', t('sectionRules', info.rules.length), renderRules(info)),
    section('computed', t('sectionComputed'), renderComputed(info)),
    live && section('export', t('sectionExport'), renderExport(info))
  );
}

// "Aa" sample in the element's colors + ratio + WCAG level.
function contrastPill(c) {
  const sample = h('span', { class: 'wd-contrast-sample' }, 'Aa');
  sample.style.color = c.fg;
  sample.style.background = c.bg;
  const level = c.level === 'fail' ? t('wcagFail') : c.level;
  return h('span', {
    class: 'wd-contrast-pill ' + (c.level === 'fail' ? 'wd-contrast-bad' : 'wd-contrast-good'),
    title: t('contrastTitle', c.fg, c.bg) + (c.large ? ` · ${t('contrastLarge')}` : '') + (c.approx ? ` · ${t('contrastApprox')}` : '')
  }, sample, `${c.approx ? '≈ ' : ''}${c.ratio}:1 · ${level}`);
}

// Element summary: thumbnail, tag, size, selector, breadcrumbs and actions.
function renderSummary(info, live) {
  const isSaved = live && state.saved.some((it) => it.page.url === info.page.url && it.selector === info.selector);
  const ancestorsCount = info.composition.ancestors.length;

  const crumbs = h('div', { class: 'wd-crumbs' },
    info.composition.ancestors.slice(-4).map((label, i, arr) => {
      const ref = live ? { kind: 'ancestor', index: ancestorsCount - arr.length + i } : null;
      return [liveItem('span', 'wd-crumb', label, ref), h('span', { class: 'wd-crumb-sep' }, '›')];
    }),
    h('span', { class: 'wd-crumb wd-crumb-current' }, info.label)
  );

  const actions = h('div', { class: 'wd-actions' },
    live && btn(isSaved ? t('saveAgain') : t('save'), 'star', saveSelected, 'wd-btn wd-btn-primary'),
    btn(t('copySelector'), 'copy', () => copyText(info.selector, t('toastSelectorCopied'))),
    btn(t('copyCss'), 'copy', () => copyText(S.buildCss(info), t('toastCssCopied'))),
    btn(t('copyHtml'), 'copy', () => copyText(info.composition.html, t('toastHtmlCopied'))),
    live && ancestorsCount > 0 && btn(t('parent'), 'parent',
      () => command({ type: 'ddinspect:select-related', kind: 'ancestor', index: ancestorsCount - 1 }), 'wd-btn', { title: t('parentTitle') })
  );

  return h('div', { class: 'wd-head' },
    info.thumbnail && h('img', { class: 'wd-thumb', src: info.thumbnail, alt: t('thumbnailAlt') }),
    h('div', { class: 'wd-tagline' },
      h('span', { class: 'wd-chip' }, `<${info.tag}>`),
      h('span', { class: 'wd-size-pill' }, `${fmt(info.rect.width)} × ${fmt(info.rect.height)} px`),
      info.contrast && contrastPill(info.contrast)
    ),
    h('code', { class: 'wd-selector', title: info.selector }, info.selector),
    crumbs,
    actions
  );
}

function renderComposition(info, live) {
  const c = info.composition;
  return h('div', {},
    renderSummary(info, live),
    h('div', { class: 'wd-stats' },
      h('div', { class: 'wd-stat' }, h('span', {}, t('statChildren')), h('strong', {}, String(c.childCount))),
      h('div', { class: 'wd-stat' }, h('span', {}, t('statDescendants')), h('strong', {}, String(c.descendantCount))),
      h('div', { class: 'wd-stat' }, h('span', {}, t('statDepth')), h('strong', {}, String(c.ancestors.length)))
    ),
    c.children.length > 0 && h('div', { class: 'wd-subtitle' }, t('subtitleChildren')),
    c.children.length > 0 && h('ul', { class: 'wd-children' }, c.children.map((child, i) =>
      liveItem('li', 'wd-child', [
        h('span', { class: 'wd-child-label' }, child.label),
        h('span', { class: 'wd-muted' }, `${fmt(child.width)} × ${fmt(child.height)}`)
      ], live ? { kind: 'child', index: i } : null)
    )),
    c.attributes.length > 0 && h('div', { class: 'wd-subtitle' }, t('subtitleAttributes')),
    c.attributes.length > 0 && h('div', { class: 'wd-attrs' }, c.attributes.map(([name, value]) => h('div', { class: 'wd-crow' },
      h('span', { class: 'wd-prop' }, name), h('span', { class: 'wd-val' }, value)))),
    c.text && h('div', { class: 'wd-subtitle' }, t('subtitleText')),
    c.text && h('p', { class: 'wd-text' }, c.text),
    h('div', { class: 'wd-subtitle' }, c.htmlTruncated ? t('subtitleHtmlTrimmed') : 'HTML'),
    h('pre', { class: 'wd-pre' }, c.html)
  );
}

function renderBox(info) {
  const { box, rect } = info;
  const stat = (label, value) => h('div', { class: 'wd-stat' }, h('span', {}, label), h('strong', {}, value));
  const v = (n) => (n ? fmt(n) : '–');
  const layer = (name, values, inner) => h('div', { class: `wd-bm wd-bm-${name}` },
    h('span', { class: 'wd-bm-name' }, name),
    h('span', { class: 'wd-bm-top' }, v(values[0])),
    h('span', { class: 'wd-bm-left' }, v(values[3])),
    inner,
    h('span', { class: 'wd-bm-right' }, v(values[1])),
    h('span', { class: 'wd-bm-bottom' }, v(values[2]))
  );

  return h('div', {},
    h('div', { class: 'wd-stats' },
      stat(t('statWidth'), `${fmt(rect.width)}px`),
      stat(t('statHeight'), `${fmt(rect.height)}px`),
      stat(t('statPageX'), `${fmt(rect.pageX)}px`),
      stat(t('statPageY'), `${fmt(rect.pageY)}px`),
      stat('display', box.display),
      stat('position', box.position),
      stat('box-sizing', box.boxSizing),
      stat(t('statArea'), `${Math.round(rect.width * rect.height).toLocaleString(S.LOCALE)} px²`)
    ),
    layer('margin', box.margin,
      layer('border', box.border,
        layer('padding', box.padding,
          h('div', { class: 'wd-bm-content' }, `${fmt(box.content.width)} × ${fmt(box.content.height)}`))))
  );
}

function renderResources(info) {
  if (!info.resources.length) {
    return h('p', { class: 'wd-muted' }, t('noResources'));
  }
  return h('ul', { class: 'wd-resources' }, info.resources.map((res) => h('li', { class: 'wd-resource' },
    IMAGE_TYPES.has(res.type) && !res.truncated && S.isSafeUrl(res.url)
      ? h('img', { class: 'wd-res-preview', src: res.url, alt: '', loading: 'lazy' })
      : h('div', { class: 'wd-res-preview wd-res-icon' }, res.type.slice(0, 3).toUpperCase()),
    h('div', { class: 'wd-res-main' },
      h('div', { class: 'wd-res-meta' },
        h('span', { class: 'wd-badge' }, res.type),
        h('span', { class: 'wd-muted' }, res.from === 'element' ? t('resourceFromElement') : res.from)),
      res.truncated ? h('span', { class: 'wd-link', title: t('trimmedDataUri') }, res.url) : linkOrText(res.url)
    ),
    !res.truncated && iconBtn(t('copyUrl'), 'copy', () => copyText(res.url, t('toastUrlCopied')))
  )));
}

const SOURCE_LABELS = { file: 'sourceFile', import: '@import', style: '<style>', inline: 'style=""', adopted: 'JS' };

function renderRules(info) {
  const out = [];
  // Sheets that could not be fetched either: collapsed by default, usually noise.
  if (info.blockedSheets.length) {
    out.push(collapsible('cors', 'wd-cors',
      t('corsBlocked', info.blockedSheets.length),
      h('div', { class: 'wd-cors-body' },
        t('corsBlockedText'),
        h('ul', {}, info.blockedSheets.map((url) => h('li', {}, linkOrText(url, S.fileName(url)))))
      )
    ));
  }
  if (!info.rules.length) out.push(h('p', { class: 'wd-muted' }, t('noRules')));

  const flags = S.overriddenFlags(info.rules);
  info.rules.forEach((rule, ri) => {
    const notes = [];
    rule.media.forEach((m) => notes.push(`@media ${m}`));
    if (rule.supports) notes.push(`@supports ${rule.supports}`);
    if (rule.layer) notes.push(`@layer ${rule.layer}`);
    if (rule.container) notes.push(`@container ${rule.container} ${t('notEvaluated')}`);
    const typeKey = SOURCE_LABELS[rule.source.type];

    out.push(h('div', { class: `wd-rule wd-rule-${rule.source.type}` },
      h('div', { class: 'wd-rule-head' },
        h('code', { class: 'wd-rule-selector' },
          rule.matched.length
            ? S.splitTopLevel(rule.selector, ',').map((sel, i, arr) => h('span', {
              class: rule.matched.includes(sel.trim()) ? 'wd-sel-match' : 'wd-sel-other'
            }, sel.trim() + (i < arr.length - 1 ? ', ' : '')))
            : rule.selector),
        rule.pseudo && h('span', { class: 'wd-badge wd-badge-pseudo' }, rule.pseudo),
        rule.specificity && h('span', { class: 'wd-spec', title: t('specificityTitle') }, `(${rule.specificity.join(',')})`)
      ),
      h('div', { class: 'wd-rule-source' },
        h('span', { class: 'wd-source-type' }, typeKey === 'sourceFile' ? t('sourceFile') : typeKey || rule.source.type),
        rule.source.url ? linkOrText(rule.source.url, rule.source.label) : h('span', {}, rule.source.label),
        rule.source.fetched && h('span', { class: 'wd-badge wd-badge-fetched', title: t('ruleFetchedTitle') }, t('ruleFetched'))
      ),
      notes.length > 0 && h('div', { class: 'wd-rule-notes' }, notes.join('  ·  ')),
      h('div', { class: 'wd-decls' }, rule.declarations.map((d, di) => h('div', {
        class: 'wd-decl' + (flags[ri][di] ? ' wd-decl-overridden' : ''),
        title: flags[ri][di] ? t('overriddenTitle') : null
      },
      h('span', { class: 'wd-prop' }, d.prop), ': ',
      h('span', { class: 'wd-val' }, d.value),
      d.important && h('span', { class: 'wd-important' }, ' !important'), ';'
      )))
    ));
  });
  return out;
}

function colorSwatch(value) {
  if (!/^(rgb|hsl|#|oklch|lab|color\()/.test(value) || value === 'rgba(0, 0, 0, 0)') return null;
  const sw = h('span', { class: 'wd-swatch' });
  sw.style.background = value;
  return sw;
}

// rgb()/rgba() → '#rrggbb' / '#rrggbbaa', or '' for anything else.
function toHex(value) {
  const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!m) return '';
  return S.rgbaToHex([+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]);
}

function computedRow(prop, value) {
  const isColor = /color|^fill$|^stroke$/.test(prop);
  const hex = isColor ? toHex(value) : '';
  // The computed value is already rgb(): show the picked format next to it (hex when rgb is picked).
  const extra = hex ? S.formatColor(hex, state.settings.colorFormat === 'rgb' ? 'hex' : state.settings.colorFormat) : '';
  return h('div', { class: 'wd-crow' + (DEFAULTISH.test(value) ? ' wd-crow-dim' : ''), 'data-search': `${prop} ${value}`.toLowerCase() },
    h('span', { class: 'wd-prop' }, prop),
    h('span', { class: 'wd-val' }, isColor && colorSwatch(value), value, extra && h('span', { class: 'wd-muted' }, `  ${extra}`))
  );
}

function renderComputed(info) {
  const groups = Object.entries(info.computed.groups).map(([name, props]) => h('div', { class: 'wd-cgroup' },
    h('div', { class: 'wd-cgroup-title' }, t(`group${name}`)),
    props.map(([p, v]) => computedRow(p, v))
  ));
  const allEntries = Object.entries(info.computed.all).sort(([a], [b]) => a.localeCompare(b));
  const all = h('details', { class: 'wd-all' },
    h('summary', {}, t('allProperties', allEntries.length)),
    allEntries.map(([p, v]) => computedRow(p, v))
  );
  const container = h('div', {}, groups, all);

  // Filters in the DOM (no re-render) so the input keeps focus.
  const filter = h('input', {
    class: 'wd-input', type: 'search', placeholder: t('filterProperties'), 'aria-label': t('filterProperties'),
    oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      all.open = q.length > 0 || all.open;
      container.querySelectorAll('.wd-crow').forEach((row) => {
        row.classList.toggle('wd-hidden', q.length > 0 && !row.dataset.search.includes(q));
      });
    }
  });
  return [filter, container];
}

// ---------------------------------------------------------------------------
// Export as component (live selection only)
// ---------------------------------------------------------------------------

const EXPORT_FORMATS = [['html', 'exportHtml'], ['jsx', 'exportJsx'], ['tailwind', 'exportTailwind']];
const EXPORT_PREVIEW_MAX = 40000;

async function generateExport() {
  state.exported = { loading: true };
  render();
  const resp = await command({ type: 'ddinspect:export' });
  if (!state.exported || !state.exported.loading) return; // the selection changed meanwhile
  state.exported = resp && resp.result ? { result: resp.result, format: 'html' } : null;
  if (!state.exported) toast(t('exportFailed'));
  render();
}

function exportCode(result, format, info) {
  const F = DDinspectFormat;
  if (format === 'jsx') return { main: F.toJsx(result), css: F.cssText(result) };
  if (format === 'tailwind') return { main: F.toTailwind(result) };
  return { main: F.htmlDocument(result, info.label), css: F.cssText(result) };
}

async function downloadExport(result, format, info) {
  const F = DDinspectFormat;
  const name = (info.label.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'component').slice(0, 40);
  if (format === 'jsx') {
    await downloadZip([{ name: 'Component.jsx', text: F.toJsx(result) }, { name: 'Component.css', text: F.cssText(result) }], `${name}-react.zip`);
  } else if (format === 'tailwind') {
    saveBlob(new Blob([F.tailwindDocument(result, info.label)], { type: 'text/html' }), `${name}-tailwind.html`);
  } else {
    saveBlob(new Blob([F.htmlDocument(result, info.label)], { type: 'text/html' }), `${name}.html`);
  }
}

function renderExport(info) {
  const ex = state.exported;
  if (!ex) {
    return h('div', { class: 'wd-export-intro' },
      h('p', { class: 'wd-muted' }, t('exportIntro')),
      btn(t('exportGenerate'), 'code', generateExport, 'wd-btn wd-btn-primary'));
  }
  if (ex.loading) return h('div', { class: 'wd-empty' }, h('div', { class: 'wd-spinner' }), h('p', {}, t('exportWorking')));

  const { result, format } = ex;
  const code = exportCode(result, format, info);
  // Sandboxed and without scripts: the preview only renders markup and styles.
  const preview = h('iframe', { class: 'wd-export-preview', sandbox: '', title: t('exportPreview') });
  preview.srcdoc = DDinspectFormat.htmlDocument(result, info.label);
  const shown = (text) => (text.length > EXPORT_PREVIEW_MAX ? text.slice(0, EXPORT_PREVIEW_MAX) + '\n…' : text);

  return h('div', { class: 'wd-export' },
    h('div', { class: 'wd-seg', role: 'group', 'aria-label': t('exportFormat') }, EXPORT_FORMATS.map(([id, key]) => h('button', {
      class: 'wd-seg-btn' + (format === id ? ' wd-seg-active' : ''),
      'aria-pressed': String(format === id),
      onclick: () => { state.exported = { ...ex, format: id }; render(); }
    }, t(key)))),
    h('p', { class: 'wd-muted wd-small' },
      t('exportStats', result.count, result.rules.length),
      result.truncated ? ` ${t('exportTruncated')}` : '',
      format === 'tailwind' ? ` ${t('exportTailwindNote')}` : ''),
    h('div', { class: 'wd-subtitle' }, t('exportPreview')),
    preview,
    h('div', { class: 'wd-actions' },
      btn(format === 'jsx' ? t('copyJsx') : t('copyCode'), 'copy', () => copyText(code.main, t('toastCodeCopied')), 'wd-btn wd-btn-primary'),
      code.css && btn(t('copyCss'), 'copy', () => copyText(code.css, t('toastCssCopied'))),
      btn(format === 'jsx' ? t('downloadZip') : t('downloadHtml'), 'download', () => downloadExport(result, format, info)),
      btn(t('exportRegenerate'), 'refresh', generateExport, 'wd-btn wd-btn-ghost')
    ),
    h('pre', { class: 'wd-pre wd-export-code' }, shown(code.main)),
    code.css && h('pre', { class: 'wd-pre wd-export-code' }, shown(code.css))
  );
}

// ---------------------------------------------------------------------------
// Saved elements
// ---------------------------------------------------------------------------

function savedCard(item) {
  return h('div', { class: 'wd-saved' },
    item.thumbnail
      ? h('img', { class: 'wd-saved-thumb', src: item.thumbnail, alt: '' })
      : h('div', { class: 'wd-saved-thumb wd-res-icon' }, item.tag),
    h('div', { class: 'wd-saved-main' },
      h('input', {
        class: 'wd-saved-name', value: item.name || item.label, title: t('renameTitle'), 'aria-label': t('renameTitle'),
        onchange: (e) => S.updateSaved(item.id, { name: e.target.value })
      }),
      h('div', { class: 'wd-muted wd-saved-meta', title: item.selector }, item.selector),
      h('div', { class: 'wd-muted wd-saved-meta' },
        linkOrText(item.page.url, S.hostOf(item.page.url), ''),
        ` · ${fmt(item.rect.width)}×${fmt(item.rect.height)} · ${S.formatDate(item.savedAt)}`),
      h('div', { class: 'wd-actions' },
        btn(t('view'), 'eye', () => { state.viewingSaved = item.id; switchTab('inspector'); }, 'wd-btn wd-btn-small'),
        btn(t('copyCss'), 'copy', () => copyText(S.buildCss(item), t('toastCssCopied')), 'wd-btn wd-btn-small'),
        btn(t('delete'), 'trash', () => S.removeSaved(item.id), 'wd-btn wd-btn-small wd-btn-danger')
      )
    )
  );
}

// Reads a JSON export and merges it into the collection (ids already saved are skipped).
async function importSaved(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast(t('importInvalid'));
    return;
  }
  const parsed = S.parseImport(data);
  if (!parsed) {
    toast(t('importInvalid'));
    return;
  }
  const list = await S.loadSaved();
  const known = new Set(list.map((it) => it.id));
  const fresh = parsed.items.filter((it) => !known.has(it.id));
  await S.storeSaved([...fresh, ...list]);
  toast(t('importDone', fresh.length, parsed.items.length - fresh.length + parsed.rejected));
}

function importButton() {
  const input = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'wd-hidden',
    onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importSaved(file);
      e.target.value = '';
    }
  });
  return [btn(t('importJson'), 'upload', () => input.click()), input];
}

function renderSavedList() {
  if (!state.saved.length) {
    return h('div', { class: 'wd-empty' },
      h('div', { class: 'wd-empty-icon' }, icon('star')),
      h('p', {}, t('savedEmpty')),
      h('div', { class: 'wd-actions' }, importButton()));
  }

  const list = h('div', {});
  const fill = () => {
    const q = state.search.trim().toLowerCase();
    const items = state.saved.filter((it) => !q ||
      [it.name, it.label, it.selector, it.page.url, it.page.title].join(' ').toLowerCase().includes(q));
    list.replaceChildren(...(items.length
      ? items.map(savedCard)
      : [h('p', { class: 'wd-muted' }, t('savedNoMatch'))]));
  };
  fill();

  return h('div', {},
    h('div', { class: 'wd-actions wd-saved-toolbar' },
      btn(t('exportJson'), 'download', () => S.downloadJson(state.saved, `ddinspect-${Date.now()}.json`)),
      importButton(),
      // Two-step confirm instead of confirm(): Firefox sidebars don't reliably show dialogs.
      h('button', {
        class: 'wd-btn wd-btn-danger',
        onclick: async (e) => {
          const button = e.currentTarget;
          if (button.dataset.armed) {
            await S.storeSaved([]);
            return;
          }
          button.dataset.armed = '1';
          button.textContent = t('deleteAllConfirm');
          setTimeout(() => {
            delete button.dataset.armed;
            button.textContent = t('deleteAll');
          }, 3000);
        }
      }, t('deleteAll'))
    ),
    h('input', {
      class: 'wd-input wd-search', type: 'search', value: state.search,
      placeholder: t('savedSearch'), 'aria-label': t('savedSearch'),
      oninput: (e) => { state.search = e.target.value; fill(); }
    }),
    list
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function setActive(on) {
  const resp = await command({ type: 'ddinspect:set-active', active: on });
  if (resp && resp.ok) state.active = resp.active;
  render();
}

async function saveSelected() {
  toast(t('toastSaving'));
  const resp = await command({ type: 'ddinspect:save' });
  toast(resp && resp.saved ? t('toastSaved') : t('toastSaveFailed'));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// The button shows the theme you would switch to.
function renderThemeButton() {
  const dark = DDinspectTheme.get() === 'dark';
  const label = dark ? t('themeLight') : t('themeDark');
  ui.theme.replaceChildren(icon(dark ? 'sun' : 'moon'));
  ui.theme.title = label;
  ui.theme.setAttribute('aria-label', label);
}

function applySettings(settings) {
  const scopeChanged = settings.scope !== state.settings.scope;
  state.settings = settings;
  if (scopeChanged) for (const tab of Object.keys(state.scope)) state.scope[tab] = settings.scope;
}

ui.toggle.addEventListener('click', () => setActive(!state.active));
ui.theme.addEventListener('click', () => DDinspectTheme.toggle());
ui.options.addEventListener('click', () => chrome.runtime.openOptionsPage());
// Chrome closes its side panel with window.close(); Firefox needs sidebarAction.close().
ui.close.addEventListener('click', () => {
  const sidebarAction = globalThis.browser?.sidebarAction;
  if (sidebarAction) sidebarAction.close();
  else window.close();
});
DDinspectTheme.onChange(renderThemeButton);

for (const button of ui.tabs) {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
  // Arrow keys move between tabs (ARIA tabs pattern), Home / End jump to the ends.
  button.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(button.dataset.tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = TABS[(next + TABS.length) % TABS.length];
    switchTab(tab);
    ui.tabs.find((b) => b.dataset.tab === tab).focus();
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'ddinspect:show-tab') {
    chrome.storage.session.remove(PANEL_TAB_KEY);
    switchTab(msg.tab);
    return;
  }
  // Only messages from the tab being shown matter.
  if (!sender.tab || sender.tab.id !== state.tabId) return;
  if (msg.type === 'ddinspect:selected') {
    state.info = msg.info;
    state.viewingSaved = null;
    state.exported = null;
    clearAssets('selection');
    // On an asset tab (e.g. Colors) stay there and show the new element's assets;
    // otherwise, or after "locate", open Inspect.
    if (state.goInspect || !ASSET_TABS.includes(state.tab)) state.tab = 'inspector';
    state.goInspect = false;
    render({ resetScroll: true });
  } else if (msg.type === 'ddinspect:state') {
    state.active = msg.active;
    render();
  }
});

chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== state.tabId) return;
  if (changeInfo.status === 'loading') {
    // The page is reloading: the picker turns off, the element and the scans are gone.
    state.info = null;
    state.active = false;
    state.exported = null;
    clearAssets();
    render();
  } else if (changeInfo.status === 'complete') {
    refreshTab();
  }
});
chrome.windows.onFocusChanged.addListener(refreshTab);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[S.STORAGE_KEY]) state.saved = changes[S.STORAGE_KEY].newValue || [];
  if (changes[S.SETTINGS_KEY]) applySettings({ ...S.DEFAULT_SETTINGS, ...changes[S.SETTINGS_KEY].newValue });
  if (changes[S.STORAGE_KEY] || changes[S.SETTINGS_KEY]) render();
});

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    state.shortcut = (commands.find((c) => c.name === 'toggle-ddinspect') || {}).shortcut || '';
  } catch {
    state.shortcut = '';
  }
}

async function init() {
  document.documentElement.lang = S.LOCALE;
  S.localize();
  for (const el of document.querySelectorAll('[data-icon]')) el.replaceChildren(icon(el.dataset.icon));
  renderThemeButton();

  const session = await chrome.storage.session.get(PANEL_TAB_KEY);
  if (session[PANEL_TAB_KEY]) {
    state.tab = session[PANEL_TAB_KEY];
    chrome.storage.session.remove(PANEL_TAB_KEY);
  }
  const settings = await S.loadSettings();
  state.settings = settings;
  for (const tab of Object.keys(state.scope)) state.scope[tab] = settings.scope;
  state.saved = await S.loadSaved();
  await loadShortcut();
  connectPort();
  await refreshTab();
}

init();
