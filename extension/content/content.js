// DDinspect - content script
// Injected in every page but does nothing until it is activated.
//  - Picker mode: hijacks the click and highlights the box model on hover.
//  - Collects the element data (size, box, CSS rules with their origin,
//    computed styles, resources, composition, contrast) and sends it to the
//    side panel. Cross-origin stylesheets the page can't read are fetched by
//    the background script and parsed here.
//  - The overlay lives in a Shadow DOM isolated from the page styles.
//
// Asset scanning (images, SVGs, colors, fonts) lives in content/scan.js and the
// component export in content/export.js.
//
// Messages sent:    ddinspect:selected { info }  ·  ddinspect:state { active }
// Messages handled: see chrome.runtime.onMessage at the end of the file.

(() => {
  if (window.__ddinspectLoaded) return;
  window.__ddinspectLoaded = true;

  const S = globalThis.DDinspectShared;
  const t = S.t;

  // Pointer events blocked in picker mode so the page does not react.
  const BLOCKED_EVENTS = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'];

  const COMPUTED_GROUPS = {
    'Layout': ['display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'overflow',
      'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'gap', 'flex', 'order',
      'grid-template-columns', 'grid-template-rows', 'box-sizing'],
    'Box': ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'padding'],
    'Borders': ['border', 'border-radius', 'outline'],
    'Typography': ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color',
      'text-align', 'text-transform', 'text-decoration', 'white-space'],
    'Background': ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat'],
    'Effects': ['opacity', 'box-shadow', 'transform', 'transition', 'filter', 'backdrop-filter', 'cursor', 'visibility']
  };

  const PSEUDO_ELEMENT = /::[\w-]+(\([^)]*\))?|:(before|after|first-line|first-letter)(?![\w-])/i;

  const state = {
    active: false,
    hovered: null,        // Highlighted element (parent of the leaf by default, moved with ↑ / ↓)
    leaf: null,           // Exact element under the pointer
    selected: null,       // Live selected element
    selectedInfo: null,   // Serializable data of the selected element
    selectedRefs: null,   // Live references to ancestors and children (the panel navigates by index)
    assetRefs: { page: null, selection: null }, // Elements behind each scanned image / SVG / text, per scope
    lastContextTarget: null,
    selectToken: 0,       // the latest selectElement() call wins
    colorFormat: S.DEFAULT_SETTINGS.colorFormat
  };

  // Cross-origin stylesheets, fetched once per page: url → Promise<CSSStyleSheet | null>.
  const remoteSheets = new Map();

  let host = null;
  let root = null;
  let cursorSheet = null;
  let rafPending = false;
  const ui = {};

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function h(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function isOurs(e) {
    return !!host && e.composedPath().includes(host);
  }

  function targetFrom(e) {
    const node = e.composedPath()[0];
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const rootNode = el.getRootNode();
    return rootNode && rootNode !== document && rootNode.host ? rootNode.host : null;
  }

  function labelOf(el) {
    let label = el.tagName.toLowerCase();
    if (el.id) label += '#' + el.id;
    const classes = Array.from(el.classList);
    if (classes.length) label += '.' + classes.slice(0, 2).join('.') + (classes.length > 2 ? '…' : '');
    return label;
  }

  function absUrl(raw) {
    try { return new URL(raw, document.baseURI).href; } catch { return raw; }
  }

  function px(value) {
    return parseFloat(value) || 0;
  }

  function fmt(n) {
    return String(S.round(n));
  }

  function nextFrames(n) {
    return new Promise((resolve) => {
      const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
      step();
    });
  }

  // Message to the side panel / service worker. Nobody may be listening.
  function notify(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch { /* extension reloaded: context invalidated */ }
  }

  // ---------------------------------------------------------------------------
  // Element data collection
  // ---------------------------------------------------------------------------

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      const rootNode = node.getRootNode();
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part = '#' + CSS.escape(node.id);
      } else {
        const classes = Array.from(node.classList).slice(0, 2);
        part += classes.map((c) => '.' + CSS.escape(c)).join('');
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      try {
        if (rootNode.querySelectorAll(selector).length === 1) break;
      } catch { /* invalid selector: keep going up */ }
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // Approximate specificity (a, b, c). Good enough to sort the rules.
  function specificity(selector) {
    let s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    s = s.replace(/:(?:not|is|has|matches)\(/g, ' ').replace(/[()]/g, ' ');
    let a = 0, b = 0, c = 0;
    s = s.replace(/\[[^\]]*\]/g, () => { b++; return ' '; });
    s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });
    s = s.replace(/\.[\w-]+/g, () => { b++; return ' '; });
    s = s.replace(/::[\w-]+|:(before|after|first-line|first-letter)(?![\w-])/gi, () => { c++; return ' '; });
    s = s.replace(/:[\w-]+/g, () => { b++; return ' '; });
    s.replace(/(^|[\s>+~])[a-zA-Z][\w-]*/g, () => { c++; return ''; });
    return [a, b, c];
  }

  function compareSpecificity(x, y) {
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  }

  function matchRule(el, selectorText) {
    const matched = [];
    let pseudo = null;
    let best = null;
    for (const raw of S.splitTopLevel(selectorText, ',')) {
      const sel = raw.trim();
      let test = sel;
      let pe = null;
      const m = sel.match(PSEUDO_ELEMENT);
      if (m) {
        pe = m[0];
        test = sel.replace(PSEUDO_ELEMENT, '').trim();
        if (!test || /[\s>+~]$/.test(test)) test += '*';
      }
      let ok = false;
      try { ok = el.matches(test); } catch { /* selector not supported by matches() */ }
      if (!ok) continue;
      matched.push(sel);
      if (pe) pseudo = pe;
      const spec = specificity(sel);
      if (!best || compareSpecificity(spec, best) > 0) best = spec;
    }
    return matched.length ? { matched, pseudo, specificity: best } : null;
  }

  // CSS nesting: turns "&:hover" or ".child" inside ".parent" into a full selector.
  function resolveNested(selector, parent) {
    return S.splitTopLevel(selector, ',')
      .map((s) => s.trim())
      .map((s) => (s.includes('&') ? s.replaceAll('&', `:is(${parent})`) : `:is(${parent}) ${s}`))
      .join(', ');
  }

  function parseDeclarations(cssText) {
    return S.splitTopLevel(cssText, ';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        if (i < 0) return null;
        const prop = d.slice(0, i).trim();
        let value = d.slice(i + 1).trim();
        let important = false;
        if (/!important$/i.test(value)) {
          important = true;
          value = value.replace(/\s*!important$/i, '');
        }
        return { prop, value, important };
      })
      .filter(Boolean);
  }

  function describeSheet(sheet, origin) {
    if (origin === 'adopted' || origin === 'shadow-adopted') {
      return { type: 'adopted', url: null, label: 'adoptedStyleSheets' + (origin === 'shadow-adopted' ? ' (shadow DOM)' : '') };
    }
    if (sheet.href) return { type: 'file', url: sheet.href, label: S.fileName(sheet.href) };
    const node = sheet.ownerNode;
    const scope = origin === 'shadow' ? node?.getRootNode() : document;
    const index = node && scope ? Array.from(scope.querySelectorAll('style')).indexOf(node) + 1 : 0;
    let label = t(origin === 'shadow' ? 'sourceStyleShadow' : 'sourceStylePage', index);
    // Origin hint for CSS-in-JS (styled-components, emotion, etc.).
    const hint = node && Array.from(node.attributes).find((a) => a.name.startsWith('data-'));
    if (node?.id) label += ` (#${node.id})`;
    else if (hint) label += ` (${hint.name})`;
    return { type: 'style', url: null, label };
  }

  // "[object CSSStyleRule]" → "CSSStyleRule". Works through Firefox's Xray
  // wrappers too, where constructor.name is less reliable.
  function kindOf(rule) {
    return Object.prototype.toString.call(rule).slice(8, -1);
  }

  // The background script fetches the file (extension host permissions skip CORS)
  // and it is parsed into a constructed sheet. Such sheets ignore @import.
  function remoteSheet(url) {
    if (!remoteSheets.has(url)) {
      remoteSheets.set(url, (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'ddinspect:fetch-css', url });
          if (!resp || !resp.ok) return null;
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(resp.text);
          return sheet;
        } catch {
          return null;
        }
      })());
    }
    return remoteSheets.get(url);
  }

  // URLs of the stylesheets (and @imports) the browser won't let us read.
  function unreadableUrls(sheets) {
    const urls = new Set();
    const visit = (sheet) => {
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        if (sheet.href) urls.add(sheet.href);
        return;
      }
      for (const rule of list) {
        if (kindOf(rule) === 'CSSImportRule' && rule.styleSheet) visit(rule.styleSheet);
      }
    };
    sheets.forEach(({ sheet }) => visit(sheet));
    return [...urls];
  }

  async function collectRules(el) {
    const rules = [];
    const blocked = [];
    const sheets = [];
    const rootNode = el.getRootNode();
    let order = 0;

    // Our own picker cursor sheet is not part of the page.
    const push = (list, origin) => { for (const sheet of list || []) if (sheet !== cursorSheet) sheets.push({ sheet, origin }); };
    push(document.styleSheets, 'document');
    push(document.adoptedStyleSheets, 'adopted');
    if (rootNode !== document) {
      push(rootNode.styleSheets, 'shadow');
      push(rootNode.adoptedStyleSheets, 'shadow-adopted');
    }

    const fetched = new Map();
    await Promise.all(unreadableUrls(sheets).map(async (url) => fetched.set(url, await remoteSheet(url))));
    // Rules of a sheet the page blocked: our fetched copy, or null (listed as blocked).
    const remoteRules = (url) => {
      const sheet = fetched.get(url);
      if (!sheet) return null;
      try { return sheet.cssRules; } catch { return null; }
    };

    const addIfMatches = (selector, cssText, ctx) => {
      const match = matchRule(el, selector);
      if (!match) return;
      rules.push({
        selector,
        matched: match.matched,
        pseudo: match.pseudo,
        specificity: match.specificity,
        order: order++,
        source: ctx.source,
        media: ctx.media,
        supports: ctx.supports,
        layer: ctx.layer,
        container: ctx.container,
        declarations: parseDeclarations(cssText)
      });
    };

    const walk = (list, ctx) => {
      for (const rule of list) {
        const kind = kindOf(rule);
        if (kind === 'CSSStyleRule') {
          const selector = ctx.parent ? resolveNested(rule.selectorText, ctx.parent) : rule.selectorText;
          addIfMatches(selector, rule.style.cssText, ctx);
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, { ...ctx, parent: selector });
        } else if (kind === 'CSSNestedDeclarations' && ctx.parent) {
          // Loose declarations inside an @media nested in a rule (CSS nesting).
          addIfMatches(ctx.parent, rule.style.cssText, ctx);
        } else if (kind === 'CSSMediaRule') {
          if (window.matchMedia(rule.media.mediaText).matches) {
            walk(rule.cssRules, { ...ctx, media: [...ctx.media, rule.media.mediaText] });
          }
        } else if (kind === 'CSSSupportsRule') {
          if (CSS.supports(rule.conditionText)) walk(rule.cssRules, { ...ctx, supports: rule.conditionText });
        } else if (kind === 'CSSLayerBlockRule') {
          const name = rule.name || '(anonymous)';
          walk(rule.cssRules, { ...ctx, layer: ctx.layer ? `${ctx.layer}.${name}` : name });
        } else if (kind === 'CSSContainerRule') {
          // Container queries cannot be evaluated from JS: listed with a note.
          walk(rule.cssRules, { ...ctx, container: rule.conditionText });
        } else if (kind === 'CSSScopeRule') {
          walk(rule.cssRules, ctx);
        } else if (kind === 'CSSImportRule' && rule.styleSheet) {
          const url = rule.styleSheet.href || absUrl(rule.href);
          if (rule.media?.mediaText && !window.matchMedia(rule.media.mediaText).matches) continue;
          let imported;
          let remote = false;
          try {
            imported = rule.styleSheet.cssRules;
          } catch {
            imported = remoteRules(url);
            remote = true;
            if (!imported) { blocked.push(url); continue; }
          }
          walk(imported, { ...ctx, source: { type: 'import', url, label: `${S.fileName(url)} (@import)`, fetched: remote } });
        }
      }
    };

    for (const { sheet, origin } of sheets) {
      if (sheet.disabled) continue;
      let list;
      const source = describeSheet(sheet, origin);
      try {
        list = sheet.cssRules;
      } catch {
        // Cross-origin sheet without CORS: the browser does not allow reading its
        // rules, so use the copy the background script fetched.
        list = remoteRules(sheet.href);
        if (!list) {
          blocked.push(sheet.href);
          continue;
        }
        source.fetched = true;
      }
      walk(list, { source, media: [], supports: null, layer: null, container: null, parent: null });
    }

    // What wins the cascade first: higher specificity and, on ties, the later one.
    rules.sort((x, y) => compareSpecificity(y.specificity, x.specificity) || y.order - x.order);

    const inline = el.getAttribute('style');
    if (inline && inline.trim()) {
      rules.unshift({
        selector: 'element.style',
        matched: [],
        pseudo: null,
        specificity: null,
        order: -1,
        source: { type: 'inline', url: null, label: t('sourceInlineLabel') },
        media: [],
        supports: null,
        layer: null,
        container: null,
        declarations: parseDeclarations(el.style.cssText)
      });
    }

    return { rules, blocked: blocked.filter(Boolean) };
  }

  function collectComputed(cs) {
    const groups = {};
    for (const [group, props] of Object.entries(COMPUTED_GROUPS)) {
      groups[group] = props.map((p) => [p, cs.getPropertyValue(p)]).filter(([, v]) => v !== '');
    }
    const all = {};
    for (let i = 0; i < cs.length; i++) all[cs[i]] = cs.getPropertyValue(cs[i]);
    return { groups, all };
  }

  function extractUrls(value) {
    if (!value || !value.includes('url(')) return [];
    return [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]).filter(Boolean);
  }

  function resourceType(tag, attr) {
    if (attr === 'poster') return 'poster';
    if (attr === 'action') return 'form';
    if (tag === 'img' || (tag === 'input' && attr === 'src')) return 'image';
    if (tag === 'a' || tag === 'area') return 'link';
    if (tag === 'link') return 'resource';
    if (tag === 'script') return 'script';
    if (tag === 'iframe' || tag === 'frame') return 'iframe';
    if (['video', 'audio', 'source', 'track'].includes(tag)) return 'media';
    if (tag === 'object' || tag === 'embed') return 'object';
    if (tag === 'use' || tag === 'image') return 'svg';
    return attr;
  }

  function collectResources(el) {
    const list = [];
    const seen = new Set();

    const add = (type, raw, from) => {
      if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return;
      let url = absUrl(raw.trim());
      let truncated = false;
      if (url.startsWith('data:') && url.length > 500) {
        url = url.slice(0, 500) + '…';
        truncated = true;
      }
      const key = `${type}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ type, url, from, truncated });
    };

    const fromNode = (node, from, deep) => {
      const tag = node.tagName.toLowerCase();
      for (const attr of ['src', 'href', 'poster', 'data', 'action', 'xlink:href']) {
        const value = node.getAttribute(attr);
        if (value) add(resourceType(tag, attr), value, from);
      }
      const srcset = node.getAttribute('srcset');
      if (srcset) srcset.split(/,\s+/).forEach((entry) => add('srcset', entry.trim().split(/\s+/)[0], from));
      if (node.currentSrc) add('currentSrc', node.currentSrc, from);

      const cs = getComputedStyle(node);
      extractUrls(cs.backgroundImage).forEach((u) => add('background', u, from));
      if (!deep) return;
      for (const prop of ['mask-image', 'list-style-image', 'border-image-source']) {
        extractUrls(cs.getPropertyValue(prop)).forEach((u) => add(prop, u, from));
      }
      for (const pseudo of ['::before', '::after']) {
        const pcs = getComputedStyle(node, pseudo);
        extractUrls(pcs.backgroundImage).forEach((u) => add('background', u, `${from} ${pseudo}`));
        extractUrls(pcs.content).forEach((u) => add('content', u, `${from} ${pseudo}`));
      }
    };

    fromNode(el, 'element', true);
    let scanned = 0;
    for (const d of el.querySelectorAll('*')) {
      if (++scanned > 400 || list.length >= 120) break;
      fromNode(d, labelOf(d), false);
    }
    return list;
  }

  // Contrast of the element's own text or, for a wrapper (a <button> around a
  // <span>), of the first descendant that has text.
  function contrastFor(el, cs) {
    const scan = globalThis.DDinspectScan;
    const own = scan.contrastOf(el, cs);
    if (own) return own;
    let checked = 0;
    for (const d of el.querySelectorAll('*')) {
      if (++checked > 200) break;
      if (d.getClientRects().length === 0) continue;
      const c = scan.contrastOf(d);
      if (c) return c;
    }
    return null;
  }

  async function collectInfo(el) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const four = (pattern) => ['top', 'right', 'bottom', 'left'].map((side) => px(cs.getPropertyValue(pattern.replace('%', side))));
    const margin = four('margin-%');
    const border = four('border-%-width');
    const padding = four('padding-%');

    const ancestors = [];
    for (let p = parentOf(el); p; p = parentOf(p)) ancestors.unshift(p);
    const children = Array.from(el.children).filter((c) => c !== host).slice(0, 60);
    const { rules, blocked } = await collectRules(el);
    const html = el.outerHTML;

    const info = {
      version: 2,
      page: { url: location.href, title: document.title },
      tag: el.tagName.toLowerCase(),
      idAttr: el.id || '',
      classes: Array.from(el.classList),
      label: labelOf(el),
      selector: cssPath(el),
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        pageX: rect.left + window.scrollX,
        pageY: rect.top + window.scrollY
      },
      box: {
        margin,
        border,
        padding,
        content: {
          width: rect.width - border[1] - border[3] - padding[1] - padding[3],
          height: rect.height - border[0] - border[2] - padding[0] - padding[2]
        },
        boxSizing: cs.boxSizing,
        display: cs.display,
        position: cs.position
      },
      rules,
      blockedSheets: blocked,
      computed: collectComputed(cs),
      resources: collectResources(el),
      contrast: contrastFor(el, cs),
      composition: {
        ancestors: ancestors.map(labelOf),
        children: children.map((c) => {
          const r = c.getBoundingClientRect();
          return { label: labelOf(c), width: r.width, height: r.height };
        }),
        childCount: el.children.length,
        descendantCount: el.getElementsByTagName('*').length,
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
        attributes: Array.from(el.attributes).map((a) => [a.name, a.value.slice(0, 300)]),
        html: html.slice(0, 5000),
        htmlTruncated: html.length > 5000
      }
    };

    return { info, refs: { ancestors, children } };
  }

  // ---------------------------------------------------------------------------
  // Overlay (Shadow DOM)
  // ---------------------------------------------------------------------------

  function ensureUI() {
    if (host) {
      if (!host.isConnected) document.documentElement.append(host);
      return;
    }
    host = document.createElement('ddinspect-root');
    host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; ' +
      'pointer-events: none !important; z-index: 2147483647 !important;';
    root = host.attachShadow({ mode: 'closed' });
    loadStyles();

    ui.hover = buildBoxOverlay();
    ui.selectedOutline = h('div', 'wd-selected-outline wd-hidden');
    ui.tip = h('div', 'wd-tip wd-hidden');
    root.append(ui.hover.wrap, ui.selectedOutline, ui.tip);
    document.documentElement.append(host);
  }

  // Constructable stylesheet: the page CSP does not block it (unlike a <style> tag).
  // If the browser refuses it from a content script (possible in Firefox), fall back
  // to a <link> to the web-accessible stylesheet.
  async function loadStyles() {
    const url = chrome.runtime.getURL('content/overlay.css');
    try {
      const css = await fetch(url).then((r) => r.text());
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      if (root.adoptedStyleSheets.length === 1) return;
    } catch { /* use the fallback below */ }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    root.prepend(link);
  }

  function setPageCursor(on) {
    try {
      if (on) {
        cursorSheet = cursorSheet || new CSSStyleSheet();
        cursorSheet.replaceSync('*, *::before, *::after { cursor: crosshair !important; }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, cursorSheet];
      } else if (cursorSheet) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== cursorSheet);
      }
    } catch { /* some documents (XML, SVG) do not support it */ }
  }

  function buildBoxOverlay() {
    const wrap = h('div', 'wd-box wd-hidden');
    const layers = {
      margin: h('div', 'wd-box-margin'),
      border: h('div', 'wd-box-border'),
      padding: h('div', 'wd-box-padding'),
      content: h('div', 'wd-box-content')
    };
    wrap.append(...Object.values(layers));
    return { wrap, ...layers };
  }

  function placeLayer(node, x, y, w, hgt, borders) {
    Object.assign(node.style, {
      left: x + 'px',
      top: y + 'px',
      width: Math.max(0, w) + 'px',
      height: Math.max(0, hgt) + 'px',
      borderWidth: borders ? borders.map((v) => Math.max(0, v) + 'px').join(' ') : '0px'
    });
  }

  function drawHover(el) {
    ensureUI();
    if (!el || !el.isConnected) return hideHover();
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const four = (pattern) => ['top', 'right', 'bottom', 'left'].map((s) => px(cs.getPropertyValue(pattern.replace('%', s))));
    const m = four('margin-%').map((v) => Math.max(0, v));
    const b = four('border-%-width');
    const p = four('padding-%');
    const o = ui.hover;

    placeLayer(o.margin, r.left - m[3], r.top - m[0], r.width + m[1] + m[3], r.height + m[0] + m[2], m);
    placeLayer(o.border, r.left, r.top, r.width, r.height, b);
    placeLayer(o.padding, r.left + b[3], r.top + b[0], r.width - b[1] - b[3], r.height - b[0] - b[2], p);
    placeLayer(o.content, r.left + b[3] + p[3], r.top + b[0] + p[0],
      r.width - b[1] - b[3] - p[1] - p[3], r.height - b[0] - b[2] - p[0] - p[2], null);
    o.wrap.classList.remove('wd-hidden');

    const head = h('div', 'wd-tip-head');
    const label = h('span', 'wd-tip-label');
    label.textContent = labelOf(el);
    const size = h('span', 'wd-tip-size');
    size.textContent = `${fmt(r.width)} × ${fmt(r.height)}`;
    head.append(label, size);

    const color = globalThis.DDinspectScan.colorHex(cs.color);
    const background = globalThis.DDinspectScan.colorHex(cs.backgroundColor);
    const contrast = globalThis.DDinspectScan.contrastOf(el, cs);
    const position = `${fmt(r.left + window.scrollX)}, ${fmt(r.top + window.scrollY)}` +
      (cs.position !== 'static' ? ` · ${cs.position}` : '');
    const rows = [
      tipRow(t('tipPosition'), position),
      color && tipRow(t('tipColor'), S.formatColor(color, state.colorFormat), color),
      background && tipRow(t('tipBackground'), S.formatColor(background, state.colorFormat), background),
      contrast && tipRow(t('tipContrast'), contrastText(contrast), null, contrast.level === 'fail' ? 'wd-tip-bad' : 'wd-tip-good'),
      tipRow(t('tipFont'), cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')),
      tipRow(t('tipFontSize'), cs.fontSize),
      tipRow(t('tipWeight'), cs.fontWeight),
      tipRow(t('tipLineHeight'), cs.lineHeight),
      tipRow(t('tipPadding'), boxShorthand(p)),
      tipRow(t('tipMargin'), boxShorthand(four('margin-%')))
    ].filter(Boolean);
    if (state.active && el === state.hovered) {
      const hint = h('div', 'wd-tip-hint');
      hint.textContent = el !== state.leaf && el.contains(state.leaf) ? t('tipHintInner') : t('tipHint');
      rows.push(hint);
    }
    ui.tip.replaceChildren(head, ...rows);
    ui.tip.classList.remove('wd-hidden');
    const tipRect = ui.tip.getBoundingClientRect();
    let top = r.top - m[0] - tipRect.height - 6;
    if (top < 4) top = Math.min(window.innerHeight - tipRect.height - 4, r.bottom + m[2] + 6);
    const left = Math.min(Math.max(4, r.left), window.innerWidth - tipRect.width - 4);
    Object.assign(ui.tip.style, { top: top + 'px', left: left + 'px' });
  }

  // "4.52:1 · AA", with ≈ when a background image makes it an estimate.
  function contrastText(c) {
    return `${c.approx ? '≈ ' : ''}${c.ratio}:1 · ${c.level === 'fail' ? t('wcagFail') : c.level}`;
  }

  function tipRow(key, value, swatchColor, valueClass) {
    const row = h('div', 'wd-tip-row');
    const k = h('span', 'wd-tip-key');
    k.textContent = key;
    const v = h('span', 'wd-tip-val' + (valueClass ? ' ' + valueClass : ''));
    if (swatchColor) {
      const swatch = h('span', 'wd-tip-swatch');
      swatch.style.background = swatchColor;
      v.append(swatch);
    }
    v.append(value);
    row.append(k, v);
    return row;
  }

  // [top, right, bottom, left] → shortest CSS shorthand ("0", "8px 16px", ...).
  function boxShorthand(values) {
    const v = values.map((n) => (n ? `${fmt(n)}px` : '0'));
    if (v.every((x) => x === v[0])) return v[0];
    if (v[0] === v[2] && v[1] === v[3]) return `${v[0]} ${v[1]}`;
    return v.join(' ');
  }

  function hideHover() {
    if (!host) return;
    ui.hover.wrap.classList.add('wd-hidden');
    ui.tip.classList.add('wd-hidden');
  }

  function drawSelectedOutline() {
    if (!host) return;
    const el = state.selected;
    if (!el || !el.isConnected) {
      ui.selectedOutline.classList.add('wd-hidden');
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(ui.selectedOutline.style, {
      left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px'
    });
    ui.selectedOutline.classList.remove('wd-hidden');
  }

  function scheduleRedraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (state.active && state.hovered) drawHover(state.hovered);
      drawSelectedOutline();
    });
  }

  // ---------------------------------------------------------------------------
  // Selection, saving and picker mode
  // ---------------------------------------------------------------------------

  async function selectElement(el, { scroll = false } = {}) {
    if (!el || el === host || el === document) return;
    ensureUI();
    const token = ++state.selectToken;
    const { info, refs } = await collectInfo(el);
    if (token !== state.selectToken) return; // a newer selection arrived meanwhile
    state.selected = el;
    state.selectedInfo = info;
    state.selectedRefs = refs;
    if (scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    drawSelectedOutline();
    notify({ type: 'ddinspect:selected', info });
  }

  function clearSelection() {
    state.selected = null;
    state.selectedInfo = null;
    state.selectedRefs = null;
    drawSelectedOutline();
  }

  function currentInfo() {
    return state.selected && state.selected.isConnected ? state.selectedInfo : null;
  }

  // Element by index: { kind: 'ancestor' | 'child' } of the selection, or
  // { kind: 'image' | 'svg' | 'text', scope } from the last asset scan of that scope.
  function relatedElement(kind, index, scope) {
    const assetList = { image: 'images', svg: 'svgs', text: 'texts' }[kind];
    if (assetList) {
      const refs = state.assetRefs[scope === 'selection' ? 'selection' : 'page'];
      return refs ? refs[assetList][index] || null : null;
    }
    if (!state.selectedRefs) return null;
    const list = kind === 'ancestor' ? state.selectedRefs.ancestors : state.selectedRefs.children;
    return list[index] || null;
  }

  async function captureThumbnail(el) {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const width = Math.min(window.innerWidth, r.right) - x;
    const height = Math.min(window.innerHeight, r.bottom) - y;
    if (width < 2 || height < 2) return null; // off screen

    host.style.setProperty('visibility', 'hidden', 'important');
    try {
      await nextFrames(2);
      const resp = await chrome.runtime.sendMessage({
        type: 'ddinspect:capture', rect: { x, y, width, height }, viewportWidth: window.innerWidth
      });
      return resp && resp.ok ? resp.dataUrl : null;
    } catch {
      return null;
    } finally {
      host.style.removeProperty('visibility');
    }
  }

  async function saveSelected() {
    const info = currentInfo();
    if (!info) return false;
    const item = {
      ...info,
      id: S.uid(),
      name: info.label,
      savedAt: Date.now(),
      thumbnail: await captureThumbnail(state.selected)
    };
    const list = await S.loadSaved();
    list.unshift(item);
    await S.storeSaved(list); // storage.onChanged refreshes the side panel
    return true;
  }

  // Parent first: the pointer usually lands on an inner piece (a <span>, an icon
  // path…), so DDinspect grabs its parent, the component. Never body/html, though.
  function pickTarget(leaf) {
    const parent = leaf && parentOf(leaf);
    return parent && parent !== document.body && parent !== document.documentElement ? parent : leaf;
  }

  function onMouseMove(e) {
    if (isOurs(e)) return;
    const leaf = targetFrom(e);
    if (!leaf || leaf === state.leaf) return;
    state.leaf = leaf;
    state.hovered = pickTarget(leaf);
    scheduleRedraw();
  }

  function onBlockedEvent(e) {
    if (isOurs(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== 'click' || e.button !== 0) return;
    // Keep whatever ↑ / ↓ chose for the element under the pointer.
    const leaf = targetFrom(e);
    selectElement(leaf === state.leaf && state.hovered ? state.hovered : pickTarget(leaf));
  }

  // ↓ walks back toward the exact element under the pointer, then into first children.
  function childToward(el) {
    for (let node = state.leaf; node && node !== el; node = parentOf(node)) {
      if (parentOf(node) === el) return node;
    }
    return el.firstElementChild;
  }

  function onKeyDown(e) {
    const hovered = state.hovered;
    let handled = true;
    if (e.key === 'Escape') {
      setActive(false);
    } else if (e.key === 'ArrowUp' && hovered && parentOf(hovered)) {
      state.hovered = parentOf(hovered);
    } else if (e.key === 'ArrowDown' && hovered && childToward(hovered)) {
      state.hovered = childToward(hovered);
    } else if (e.key === 'Enter' && hovered) {
      selectElement(hovered);
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      scheduleRedraw();
    }
  }

  function setActive(on) {
    if (state.active === on) return;
    state.active = on;
    ensureUI();
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('mousemove', onMouseMove, true);
    window[method]('keydown', onKeyDown, true);
    BLOCKED_EVENTS.forEach((type) => window[method](type, onBlockedEvent, { capture: true, passive: false }));
    setPageCursor(on);
    if (!on) {
      state.hovered = null;
      state.leaf = null;
      hideHover();
    }
    notify({ type: 'ddinspect:state', active: on });
  }

  // ---------------------------------------------------------------------------
  // Global events and messages
  // ---------------------------------------------------------------------------

  // Remember the right-clicked element for "Inspect this element with DDinspect".
  document.addEventListener('contextmenu', (e) => {
    if (!isOurs(e)) state.lastContextTarget = targetFrom(e);
  }, true);

  // Color format for the hover card (options page).
  S.loadSettings().then((s) => { state.colorFormat = s.colorFormat; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[S.SETTINGS_KEY]) {
      state.colorFormat = { ...S.DEFAULT_SETTINGS, ...changes[S.SETTINGS_KEY].newValue }.colorFormat;
    }
  });

  window.addEventListener('scroll', scheduleRedraw, { capture: true, passive: true });
  window.addEventListener('resize', scheduleRedraw, { passive: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const reply = (extra = {}) => sendResponse({ ok: true, active: state.active, ...extra });

    switch (msg.type) {
      case 'ddinspect:toggle':
        setActive(!state.active);
        break;
      case 'ddinspect:set-active':
        setActive(!!msg.active);
        break;
      case 'ddinspect:inspect-context-target':
        setActive(true);
        if (state.lastContextTarget) selectElement(pickTarget(state.lastContextTarget));
        break;
      case 'ddinspect:get-state':
        reply({ info: currentInfo() });
        return false;
      case 'ddinspect:select-related':
        selectElement(relatedElement(msg.kind, msg.index, msg.scope), { scroll: true });
        break;
      case 'ddinspect:highlight':
        drawHover(relatedElement(msg.kind, msg.index, msg.scope));
        break;
      case 'ddinspect:scan-assets': {
        // 'selection' scans the selected element and its descendants; falls back to the page.
        const useSelection = msg.scope === 'selection' && !!currentInfo();
        const scope = useSelection ? 'selection' : 'page';
        const result = globalThis.DDinspectScan.scan({
          root: useSelection ? state.selected : document.documentElement,
          page: !useSelection,
          exclude: host
        });
        state.assetRefs[scope] = result.refs;
        delete result.refs;
        reply({ scope, assets: result });
        return false;
      }
      case 'ddinspect:unhighlight':
        if (state.active && state.hovered) drawHover(state.hovered);
        else hideHover();
        break;
      case 'ddinspect:save':
        saveSelected().then((saved) => reply({ saved }));
        return true; // async response
      case 'ddinspect:export': {
        if (!currentInfo()) {
          reply({ result: null });
          return false;
        }
        ensureUI();
        let result = null;
        // The picker's crosshair cursor must not end up in the exported styles.
        setPageCursor(false);
        try {
          result = globalThis.DDinspectExport.build(state.selected, { exclude: host, mount: root });
        } catch (err) {
          console.warn('[DDinspect] Export failed:', err);
        } finally {
          if (state.active) setPageCursor(true);
        }
        reply({ result });
        return false;
      }
      case 'ddinspect:panel-closed':
        setActive(false);
        clearSelection();
        break;
      default:
        break;
    }
    reply();
    return false;
  });
})();
