// DDinspect - utilities shared by the content script, the side panel and the
// options / welcome pages. Exposed as globalThis.DDinspectShared (no ES modules,
// so it can be loaded both as a content script and with a <script> tag).

(() => {
  if (globalThis.DDinspectShared) return;

  const STORAGE_KEY = 'ddinspect:saved';
  const LEGACY_STORAGE_KEY = 'webdam:saved'; // collection saved by WebDAM 1.x, moved on first load
  const SETTINGS_KEY = 'ddinspect:settings';
  const DEFAULT_SETTINGS = { colorFormat: 'hex', scope: 'selection' };

  // ---------------------------------------------------------------------------
  // i18n
  // ---------------------------------------------------------------------------

  const LOCALE = (() => {
    try { return chrome.i18n.getUILanguage() || 'en'; } catch { return 'en'; }
  })();

  // Message from _locales with {0}, {1}… placeholders. Falls back to the key, so a
  // missing message is visible instead of an empty label.
  function t(key, ...args) {
    let msg = '';
    try { msg = chrome.i18n.getMessage(key); } catch { /* outside an extension page */ }
    if (!msg) return key;
    return args.length ? msg.replace(/\{(\d)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : msg;
  }

  // Fills static pages: data-i18n (text), data-i18n-title / -placeholder / -aria-label.
  function localize(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    }
  }

  // ---------------------------------------------------------------------------
  // Storage: saved elements and settings
  // ---------------------------------------------------------------------------

  async function loadSaved() {
    const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    if (!data[STORAGE_KEY] && Array.isArray(data[LEGACY_STORAGE_KEY])) {
      await chrome.storage.local.set({ [STORAGE_KEY]: data[LEGACY_STORAGE_KEY] });
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
      return data[LEGACY_STORAGE_KEY];
    }
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  }

  async function storeSaved(list) {
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  }

  async function updateSaved(id, changes) {
    const list = await loadSaved();
    const item = list.find((it) => it.id === id);
    if (item) Object.assign(item, changes);
    await storeSaved(list);
  }

  async function removeSaved(id) {
    const list = await loadSaved();
    await storeSaved(list.filter((it) => it.id !== id));
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  }

  async function saveSettings(changes) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...(await loadSettings()), ...changes } });
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleString(LOCALE, {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch { return url; }
  }

  function fileName(url) {
    try {
      const u = new URL(url);
      return u.pathname.split('/').filter(Boolean).pop() || u.host;
    } catch {
      return url;
    }
  }

  // Splits by a separator, ignoring anything inside (), [] and quotes.
  function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = '';
    for (const ch of text) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === sep && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  // Keeps a URL or selector from closing the CSS comment early.
  function safeComment(text) {
    return String(text).replace(/\*\//g, '*\\/');
  }

  // Clickable links are only created for safe protocols.
  function isSafeUrl(url) {
    return /^(https?:|data:image\/|blob:|ftp:)/i.test(url || '');
  }

  // ---------------------------------------------------------------------------
  // Colors: formats and WCAG contrast
  // ---------------------------------------------------------------------------

  // '#rrggbb' or '#rrggbbaa' → [r, g, b, a].
  function hexToRgba(hex) {
    const n = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
    const a = n.length === 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }

  function rgbaToHex([r, g, b, a = 1]) {
    const hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return a < 0.995 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex;
  }

  function trim(n, digits) {
    return String(Number(n.toFixed(digits)));
  }

  function toHsl([r, g, b]) {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    let hue = 0;
    let s = 0;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === rn) hue = ((gn - bn) / d) % 6;
      else if (max === gn) hue = (bn - rn) / d + 2;
      else hue = (rn - gn) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return [hue, s * 100, l * 100];
  }

  // sRGB → OKLCH (Björn Ottosson's OKLab matrices).
  function toOklch([r, g, b]) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const C = Math.sqrt(A * A + B * B);
    const H = C < 0.0001 ? 0 : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
    return [L * 100, C, H];
  }

  // Hex → the color format picked in the options (hex | rgb | hsl | oklch).
  function formatColor(hex, format) {
    const rgba = hexToRgba(hex);
    const a = rgba[3];
    const alpha = a < 0.995 ? trim(a, 2) : null;
    switch (format) {
      case 'rgb':
        return alpha ? `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${alpha})` : `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`;
      case 'hsl': {
        const [h, s, l] = toHsl(rgba);
        const body = `${trim(h, 0)}, ${trim(s, 0)}%, ${trim(l, 0)}%`;
        return alpha ? `hsla(${body}, ${alpha})` : `hsl(${body})`;
      }
      case 'oklch': {
        const [L, C, H] = toOklch(rgba);
        return `oklch(${trim(L, 1)}% ${trim(C, 3)} ${trim(H, 1)}${alpha ? ` / ${alpha}` : ''})`;
      }
      default:
        return hex;
    }
  }

  // WCAG 2.x relative luminance and contrast ratio, for opaque [r, g, b].
  function luminance([r, g, b]) {
    const f = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function contrastRatio(fg, bg) {
    const a = luminance(fg) + 0.05;
    const b = luminance(bg) + 0.05;
    return Math.max(a, b) / Math.min(a, b);
  }

  // Paints a translucent [r, g, b, a] over an opaque [r, g, b].
  function blend(top, bottom) {
    const a = top[3] ?? 1;
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
  }

  // Large text: 24 px, or 18.66 px (14 pt) bold.
  function isLargeText(sizePx, weight) {
    return sizePx >= 24 || (sizePx >= 18.66 && Number(weight) >= 700);
  }

  // 'AAA' | 'AA' | 'fail' for normal or large text.
  function wcagLevel(ratio, large) {
    if (ratio >= (large ? 4.5 : 7)) return 'AAA';
    if (ratio >= (large ? 3 : 4.5)) return 'AA';
    return 'fail';
  }

  // ---------------------------------------------------------------------------
  // Cascade: which declarations are overridden
  // ---------------------------------------------------------------------------

  const SIDES = ['top', 'right', 'bottom', 'left', 'block-start', 'block-end', 'inline-start', 'inline-end'];

  // Shorthand → the longhands it sets ('x*' = every property starting with x).
  const SHORTHANDS = {
    margin: ['margin-*'],
    padding: ['padding-*'],
    inset: ['top', 'right', 'bottom', 'left', 'inset-*'],
    border: ['border-top*', 'border-right*', 'border-bottom*', 'border-left*', 'border-block*', 'border-inline*',
      'border-width', 'border-style', 'border-color', 'border-image*'],
    'border-width': SIDES.map((s) => `border-${s}-width`),
    'border-style': SIDES.map((s) => `border-${s}-style`),
    'border-color': SIDES.map((s) => `border-${s}-color`),
    'border-radius': ['border-*'],
    background: ['background-*'],
    font: ['font-*', 'line-height'],
    flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
    'flex-flow': ['flex-direction', 'flex-wrap'],
    grid: ['grid-template-*', 'grid-auto-*'],
    'grid-template': ['grid-template-*'],
    'grid-area': ['grid-row*', 'grid-column*'],
    'grid-row': ['grid-row-*'],
    'grid-column': ['grid-column-*'],
    gap: ['row-gap', 'column-gap'],
    overflow: ['overflow-x', 'overflow-y'],
    outline: ['outline-width', 'outline-style', 'outline-color'],
    transition: ['transition-*'],
    animation: ['animation-*'],
    'list-style': ['list-style-*'],
    'text-decoration': ['text-decoration-*'],
    'place-items': ['align-items', 'justify-items'],
    'place-content': ['align-content', 'justify-content'],
    'place-self': ['align-self', 'justify-self'],
    columns: ['column-width', 'column-count'],
    mask: ['mask-*']
  };
  for (const side of SIDES) SHORTHANDS[`border-${side}`] = [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`];

  // Does a declaration of `by` set `prop`?
  function covers(by, prop) {
    if (by === prop) return true;
    if (by.startsWith('--') || prop.startsWith('--')) return false;
    // Only border-radius (and its longhands) touch the radius properties.
    if (prop.endsWith('-radius') !== by.endsWith('radius')) return false;
    return (SHORTHANDS[by] || []).some((p) => (p.endsWith('*') ? prop.startsWith(p.slice(0, -1)) : prop === p));
  }

  // Priority of a declaration, compared element by element (higher wins):
  // [tier, layer, specificity a, b, c, source order, position in the rule].
  // Normal: style="" > unlayered > layers (later layer wins).
  // !important flips layers: style="" > layers (earlier layer wins) > unlayered.
  function priority(rule, decl, index, layerPos) {
    const inline = rule.source.type === 'inline';
    const layered = !!rule.layer;
    const pos = layered ? layerPos.get(rule.layer) : 0;
    const spec = rule.specificity || [0, 0, 0];
    const order = inline ? 1e9 : rule.order;
    let tier;
    let layer = 0;
    if (!decl.important) {
      tier = inline ? 3 : layered ? 1 : 2;
      layer = layered ? pos : 0;
    } else {
      tier = inline ? 7 : layered ? 6 : 5;
      layer = layered ? -pos : 0;
    }
    return [tier, layer, spec[0], spec[1], spec[2], order, index];
  }

  function comparePriority(x, y) {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  }

  // For every rule, one boolean per declaration: true when another declaration
  // that also applies to the element beats it. Pseudo-element rules style a
  // different box, so they are compared only among rules for the same pseudo.
  function overriddenFlags(rules) {
    const layerPos = new Map();
    rules.filter((r) => r.layer).sort((a, b) => a.order - b.order).forEach((r) => {
      if (!layerPos.has(r.layer)) layerPos.set(r.layer, layerPos.size + 1);
    });
    const entries = [];
    rules.forEach((rule, ri) => rule.declarations.forEach((decl, di) => {
      entries.push({ ri, di, prop: decl.prop.toLowerCase(), box: rule.pseudo || '', prio: priority(rule, decl, di, layerPos) });
    }));
    const flags = rules.map((rule) => rule.declarations.map(() => false));
    for (const e of entries) {
      flags[e.ri][e.di] = entries.some((o) => o !== e && o.box === e.box &&
        covers(o.prop, e.prop) && comparePriority(o.prio, e.prio) > 0);
    }
    return flags;
  }

  // ---------------------------------------------------------------------------
  // CSS export and JSON import / export
  // ---------------------------------------------------------------------------

  // Builds readable CSS with the rules that apply to the element and its key
  // computed values. Used by "Copy CSS" and the saved elements view.
  function buildCss(info) {
    const out = [
      `/* DDinspect · ${safeComment(info.name || info.label)}`,
      ` * Page:     ${safeComment(info.page.url)}`,
      ` * Selector: ${safeComment(info.selector)}`,
      ` * Size:     ${round(info.rect.width)} × ${round(info.rect.height)} px */`,
      ''
    ];
    const flags = overriddenFlags(info.rules);

    info.rules.forEach((rule, ri) => {
      const origin = rule.source.url ? `${rule.source.label} — ${rule.source.url}` : rule.source.label;
      const selector = rule.source.type === 'inline' ? `${info.selector} /* style="" */` : rule.selector;
      const decls = rule.declarations.map((d, di) =>
        `${d.prop}: ${d.value}${d.important ? ' !important' : ''};${flags[ri][di] ? ' /* overridden */' : ''}`);
      const wrappers = [...(rule.media || []).map((m) => `@media ${m}`)];
      if (rule.supports) wrappers.push(`@supports ${rule.supports}`);
      if (rule.layer) wrappers.push(`@layer ${rule.layer}`);

      out.push(`/* ${safeComment(origin)} */`);
      let indent = '';
      for (const w of wrappers) {
        out.push(`${indent}${w} {`);
        indent += '  ';
      }
      out.push(`${indent}${selector} {`);
      decls.forEach((d) => out.push(`${indent}  ${d}`));
      out.push(`${indent}}`);
      for (let i = wrappers.length - 1; i >= 0; i--) {
        indent = indent.slice(2);
        out.push(`${indent}}`);
      }
      out.push('');
    });

    out.push('/* Key computed values */', `${info.selector} {`);
    for (const props of Object.values(info.computed.groups)) {
      for (const [prop, value] of props) out.push(`  ${prop}: ${value};`);
    }
    out.push('}');
    return out.join('\n');
  }

  function downloadJson(data, filename, container = document.body) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    container.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const isStr = (v) => typeof v === 'string';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isFour = (v) => Array.isArray(v) && v.length === 4 && v.every(isNum);

  // One imported element, rebuilt field by field with the shape the panel renders.
  // Anything that doesn't fit returns null (the element is skipped).
  function normalizeItem(it) {
    if (!it || typeof it !== 'object' || !isStr(it.id) || !isStr(it.selector) || !isStr(it.tag)) return null;
    const { page, rect, box, composition: c, computed } = it;
    if (!page || !isStr(page.url) || !rect || !isNum(rect.width) || !isNum(rect.height)) return null;
    if (!box || !isFour(box.margin) || !isFour(box.border) || !isFour(box.padding) || !box.content) return null;
    if (!c || !Array.isArray(c.ancestors) || !computed || typeof computed.groups !== 'object' || !Array.isArray(it.rules)) return null;

    const rules = it.rules.filter((r) => r && isStr(r.selector) && r.source && isStr(r.source.type) && Array.isArray(r.declarations))
      .map((r) => ({
        selector: r.selector,
        matched: Array.isArray(r.matched) ? r.matched.filter(isStr) : [],
        pseudo: isStr(r.pseudo) ? r.pseudo : null,
        specificity: Array.isArray(r.specificity) && r.specificity.length === 3 && r.specificity.every(isNum) ? r.specificity : null,
        order: isNum(r.order) ? r.order : 0,
        source: { type: r.source.type, url: isStr(r.source.url) ? r.source.url : null, label: isStr(r.source.label) ? r.source.label : r.source.type },
        media: Array.isArray(r.media) ? r.media.filter(isStr) : [],
        supports: isStr(r.supports) ? r.supports : null,
        layer: isStr(r.layer) ? r.layer : null,
        container: isStr(r.container) ? r.container : null,
        declarations: r.declarations.filter((d) => d && isStr(d.prop) && isStr(d.value))
          .map((d) => ({ prop: d.prop, value: d.value, important: d.important === true }))
      }));
    const pairs = (list) => (Array.isArray(list) ? list.filter((p) => Array.isArray(p) && isStr(p[0]) && isStr(p[1])).map((p) => [p[0], p[1]]) : []);
    const groups = {};
    for (const [name, props] of Object.entries(computed.groups)) groups[name] = pairs(props);
    const all = {};
    for (const [k, v] of Object.entries(computed.all || {})) if (isStr(v)) all[k] = v;

    return {
      ...it,
      name: isStr(it.name) ? it.name : it.tag,
      label: isStr(it.label) ? it.label : it.tag,
      savedAt: isNum(it.savedAt) ? it.savedAt : Date.now(),
      // Only an embedded image: never a remote URL that would load from the panel.
      thumbnail: isStr(it.thumbnail) && /^data:image\/(png|jpeg|webp|gif);base64,/.test(it.thumbnail) ? it.thumbnail : null,
      page: { url: page.url, title: isStr(page.title) ? page.title : '' },
      rect: { x: rect.x || 0, y: rect.y || 0, width: rect.width, height: rect.height, pageX: rect.pageX || 0, pageY: rect.pageY || 0 },
      box: {
        margin: box.margin, border: box.border, padding: box.padding,
        content: { width: Number(box.content.width) || 0, height: Number(box.content.height) || 0 },
        boxSizing: String(box.boxSizing || ''), display: String(box.display || ''), position: String(box.position || '')
      },
      rules,
      blockedSheets: Array.isArray(it.blockedSheets) ? it.blockedSheets.filter(isStr) : [],
      computed: { groups, all },
      resources: Array.isArray(it.resources) ? it.resources.filter((r) => r && isStr(r.type) && isStr(r.url))
        .map((r) => ({ type: r.type, url: r.url, from: isStr(r.from) ? r.from : '', truncated: !!r.truncated })) : [],
      composition: {
        ancestors: c.ancestors.filter(isStr),
        children: Array.isArray(c.children) ? c.children.filter((ch) => ch && isStr(ch.label))
          .map((ch) => ({ label: ch.label, width: Number(ch.width) || 0, height: Number(ch.height) || 0 })) : [],
        childCount: Number(c.childCount) || 0,
        descendantCount: Number(c.descendantCount) || 0,
        text: isStr(c.text) ? c.text : '',
        attributes: pairs(c.attributes),
        html: isStr(c.html) ? c.html : '',
        htmlTruncated: !!c.htmlTruncated
      },
      contrast: null
    };
  }

  // Parsed JSON (an exported array, or { items: [...] }) → { items, rejected },
  // or null when it is not a DDinspect / WebDAM export at all.
  function parseImport(data) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
    if (!list) return null;
    const items = [];
    let rejected = 0;
    for (const raw of list) {
      const item = normalizeItem(raw);
      if (item) items.push(item);
      else rejected++;
    }
    return { items, rejected };
  }

  globalThis.DDinspectShared = {
    STORAGE_KEY,
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    LOCALE,
    t,
    localize,
    loadSaved,
    storeSaved,
    updateSaved,
    removeSaved,
    loadSettings,
    saveSettings,
    uid,
    formatDate,
    round,
    hostOf,
    fileName,
    splitTopLevel,
    isSafeUrl,
    hexToRgba,
    rgbaToHex,
    formatColor,
    contrastRatio,
    blend,
    isLargeText,
    wcagLevel,
    covers,
    overriddenFlags,
    buildCss,
    downloadJson,
    parseImport
  };
})();
