// DDinspect - "Export as component".
// Turns the selected element and its descendants into standalone markup plus
// one CSS rule per element (.dd-1, .dd-2…), built from computed styles:
//  - a property is kept only when it differs from the browser default for that
//    tag (read from a blank iframe), and inherited properties only when they
//    differ from the parent, so the output stays small;
//  - logical duplicates (margin-inline-start…) and colors that just repeat
//    `color` are dropped, and margin / padding / border / radius are folded
//    into shorthands;
//  - page classes, ids, inline styles, event handlers and scripts are removed;
//    URLs become absolute.
// The side panel formats the result as HTML + CSS, JSX or Tailwind.

(() => {
  if (globalThis.DDinspectExport) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const MAX_ELEMENTS = 400;

  const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant',
    'font-variant-caps', 'font-variant-ligatures', 'font-variant-numeric', 'font-variant-east-asian',
    'font-variant-alternates', 'font-variant-position', 'font-feature-settings', 'font-kerning',
    'font-optical-sizing', 'font-size-adjust', 'font-variation-settings', 'font-synthesis',
    'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'font-palette',
    'letter-spacing', 'line-height', 'word-spacing', 'text-align', 'text-align-last', 'text-indent',
    'text-transform', 'text-shadow', 'text-rendering', 'text-underline-position', 'text-wrap',
    'text-wrap-mode', 'text-wrap-style', 'text-size-adjust', 'text-emphasis-position', 'text-emphasis-style',
    'text-emphasis-color', 'white-space', 'white-space-collapse', 'word-break', 'overflow-wrap',
    'word-wrap', 'hyphens', 'hyphenate-character', 'tab-size', 'direction', 'writing-mode', 'visibility',
    'cursor', 'list-style-type', 'list-style-position', 'list-style-image', 'quotes', 'caret-color',
    'color-scheme', 'accent-color', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells',
    'orphans', 'widows', 'paint-order', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'stroke-opacity', 'pointer-events', 'image-rendering', 'shape-rendering', 'text-anchor',
    'dominant-baseline', 'clip-rule', 'color-interpolation', 'color-interpolation-filters', 'marker',
    'marker-start', 'marker-mid', 'marker-end', 'ruby-position', 'line-break', 'math-depth', 'math-style',
    '-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke-width',
    '-webkit-locale', '-webkit-font-smoothing', '-moz-osx-font-smoothing'
  ]);

  // Vendor-prefixed properties worth keeping; every other -webkit- / -moz- one is noise.
  const PREFIXED_KEEP = new Set([
    '-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke-width',
    '-webkit-background-clip', '-webkit-line-clamp', '-webkit-box-orient', '-webkit-mask-image',
    '-webkit-font-smoothing', '-moz-osx-font-smoothing'
  ]);

  // Geometry that SVG elements already carry as attributes.
  const SVG_GEOMETRY = new Set(['d', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry']);

  const HTML_ATTRS = new Set([
    'href', 'src', 'srcset', 'sizes', 'alt', 'title', 'type', 'name', 'value', 'placeholder', 'for', 'role',
    'width', 'height', 'colspan', 'rowspan', 'disabled', 'checked', 'selected', 'target', 'rel', 'loading',
    'poster', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'action', 'method', 'min', 'max', 'step',
    'maxlength', 'minlength', 'readonly', 'required', 'multiple', 'label', 'lang', 'dir', 'tabindex',
    'datetime', 'open', 'start', 'reversed', 'download', 'cite', 'scope', 'headers', 'abbr', 'pattern',
    'accept', 'autocomplete', 'inputmode', 'srclang', 'kind', 'default', 'preload', 'span', 'wrap', 'rows',
    'cols', 'decoding', 'fetchpriority', 'referrerpolicy', 'crossorigin'
  ]);

  const URL_ATTRS = new Set(['href', 'src', 'poster', 'action']);
  const REMOVED_TAGS = 'script, noscript, style, link, template, meta';
  const ROOT_PLACEMENT = ['position', 'top', 'right', 'bottom', 'left', 'z-index', 'inset'];

  function absUrl(raw) {
    try { return new URL(raw, document.baseURI).href; } catch { return raw; }
  }

  // Default computed styles per tag, from elements in a blank iframe.
  function createDefaults(mount) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;';
    mount.append(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    const svgRoot = doc.createElementNS(SVG_NS, 'svg');
    doc.body.append(svgRoot);
    const cache = new Map();

    const snapshot = (cs) => {
      const out = {};
      for (let i = 0; i < cs.length; i++) out[cs[i]] = cs.getPropertyValue(cs[i]);
      return out;
    };

    return {
      of(el) {
        const svg = el.namespaceURI === SVG_NS;
        const tag = el.localName;
        const key = (svg ? 'svg:' : '') + tag;
        if (!cache.has(key)) {
          const probe = svg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
          (svg && tag !== 'svg' ? svgRoot : doc.body).append(probe);
          cache.set(key, snapshot(win.getComputedStyle(probe)));
          probe.remove();
        }
        return cache.get(key);
      },
      pseudo() {
        if (!cache.has('::pseudo')) {
          const probe = doc.createElement('span');
          doc.body.append(probe);
          cache.set('::pseudo', snapshot(win.getComputedStyle(probe)));
          probe.remove();
        }
        return cache.get('::pseudo');
      },
      dispose() {
        frame.remove();
      }
    };
  }

  function keepProperty(prop) {
    if (prop.startsWith('-') && !prop.startsWith('--')) return PREFIXED_KEEP.has(prop);
    // Logical properties duplicate the physical ones the browser already resolved.
    return !/(^|-)(inline|block)(-|$)/.test(prop) && !/^border-(start|end)-(start|end)-radius$/.test(prop);
  }

  // Computed style → [[prop, value]] that differ from the defaults.
  // parent: the parent's computed style (inherited values equal to it are skipped).
  function diffStyle(el, cs, defaults, parent, isRoot) {
    const color = cs.getPropertyValue('color');
    const svgChild = el.namespaceURI === SVG_NS && el.localName !== 'svg';
    const decls = new Map();
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (!keepProperty(prop) || (svgChild && SVG_GEOMETRY.has(prop))) continue;
      const value = cs.getPropertyValue(prop);
      if (value === defaults[prop]) continue;
      if (INHERITED.has(prop) && parent && parent.getPropertyValue(prop) === value) continue;
      // Colors that only repeat `color` add nothing: they default to currentColor.
      if (prop !== 'color' && prop.endsWith('-color') && value === color) continue;
      if ((prop === 'transform-origin' && cs.transform === 'none') ||
          (prop === 'perspective-origin' && cs.perspective === 'none')) continue;
      if (isRoot && ROOT_PLACEMENT.includes(prop)) continue;
      decls.set(prop, value);
    }
    return shorthands(decls);
  }

  // [top, right, bottom, left] → shortest box shorthand.
  function box(values) {
    const [t, r, b, l] = values;
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return `${t} ${r}`;
    if (r === l) return `${t} ${r} ${b}`;
    return `${t} ${r} ${b} ${l}`;
  }

  function shorthands(decls) {
    const sides = ['top', 'right', 'bottom', 'left'];
    const fold = (name, longhands) => {
      if (!longhands.every((p) => decls.has(p))) return;
      decls.set(name, box(longhands.map((p) => decls.get(p))));
      longhands.forEach((p) => decls.delete(p));
    };
    fold('margin', sides.map((s) => `margin-${s}`));
    fold('padding', sides.map((s) => `padding-${s}`));
    fold('border-radius', ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => `border-${c}-radius`));
    for (const part of ['width', 'style', 'color']) fold(`border-${part}`, sides.map((s) => `border-${s}-${part}`));
    // border-width + border-style + border-color with one value each → border.
    const [w, s, c] = ['border-width', 'border-style', 'border-color'].map((p) => decls.get(p));
    if (w && s && !/\s/.test(w) && !/\s/.test(s) && (!c || !/\s(?![^(]*\))/.test(c))) {
      decls.set('border', [w, s, c].filter(Boolean).join(' '));
      ['border-width', 'border-style', 'border-color'].forEach((p) => decls.delete(p));
    }
    return Array.from(decls.entries());
  }

  function cleanAttributes(node) {
    const svg = node.namespaceURI === SVG_NS;
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const keep = svg
        ? !/^(on|data-)/.test(name) && name !== 'class' && name !== 'style'
        : HTML_ATTRS.has(name) || name.startsWith('aria-');
      if (!keep) {
        node.removeAttribute(attr.name);
        continue;
      }
      const value = attr.value.trim();
      if ((URL_ATTRS.has(name) || attr.localName === 'href') && value && !value.startsWith('#')) {
        if (/^javascript:/i.test(value)) node.removeAttribute(attr.name);
        else node.setAttribute(attr.name, absUrl(value));
      } else if (name === 'srcset') {
        node.setAttribute(attr.name, value.split(/,\s+/).map((entry) => {
          const [url, ...rest] = entry.trim().split(/\s+/);
          return [absUrl(url), ...rest].join(' ');
        }).join(', '));
      }
    }
  }

  // @font-face rules for the families the component uses.
  function fontFaceCss(families) {
    const scan = globalThis.DDinspectScan;
    if (!scan || !scan.fontFaces) return [];
    const wanted = new Set(families.map((f) => f.toLowerCase()));
    return scan.fontFaces()
      .filter((face) => wanted.has(face.family.toLowerCase()) && face.sources.length)
      .map((face) => [
        '@font-face {',
        `  font-family: "${face.family}";`,
        `  src: ${face.sources.map((s) => `url("${s.url}")${s.format ? ` format("${s.format}")` : ''}`).join(', ')};`,
        `  font-weight: ${face.weight};`,
        `  font-style: ${face.style};`,
        '}'
      ].join('\n'));
  }

  // el: element to export. exclude: DDinspect's overlay host. mount: where the
  // defaults iframe can live (our shadow root, so the page never sees it).
  function build(el, { exclude = null, mount = document.documentElement } = {}) {
    const nodes = [el, ...el.querySelectorAll('*')];
    const clone = el.cloneNode(true);
    const clones = [clone, ...clone.querySelectorAll('*')];
    const defaults = createDefaults(mount);
    const rules = [];
    const families = new Set();
    let styled = 0;

    try {
      nodes.forEach((node, i) => {
        const copy = clones[i];
        // Skip what sits inside a subtree already removed below.
        if (!copy || (copy !== clone && !clone.contains(copy))) return;
        if (node === exclude || node.matches(REMOVED_TAGS)) {
          copy.remove();
          return;
        }
        cleanAttributes(copy);
        if (styled >= MAX_ELEMENTS) return;
        const cs = getComputedStyle(node);
        if (cs.display === 'none') {
          copy.remove();
          return;
        }
        const cls = `dd-${++styled}`;
        const parent = node === el ? null : getComputedStyle(node.parentElement || el);
        const decls = diffStyle(node, cs, defaults.of(node), parent, node === el);
        families.add(cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''));
        if (decls.length) rules.push({ selector: `.${cls}`, decls });
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(node, pseudo);
          if (ps.content === 'none' || ps.content === 'normal') continue;
          const pdecls = diffStyle(node, ps, defaults.pseudo(), cs, false);
          rules.push({ selector: `.${cls}${pseudo}`, decls: [['content', ps.content], ...pdecls.filter(([p]) => p !== 'content')] });
        }
        copy.setAttribute('class', cls);
      });
    } finally {
      defaults.dispose();
    }
    clone.querySelectorAll(REMOVED_TAGS).forEach((n) => n.remove());

    return {
      html: clone.outerHTML,
      rules,
      fontFaces: fontFaceCss([...families].filter(Boolean)),
      count: styled,
      truncated: nodes.length > MAX_ELEMENTS
    };
  }

  globalThis.DDinspectExport = { build };
})();
