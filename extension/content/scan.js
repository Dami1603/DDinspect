// DDinspect - page asset scanner.
// Collects the images, SVGs, colors (with text contrast pairs) and fonts used by
// the whole page or by one element and its descendants, reading each element's
// computed style once. Loaded as a content script before content.js, which calls
// DDinspectScan.scan() when the side panel asks, and uses colorHex() / contrastOf()
// for the hover card and fontFaces() for the component export.

(() => {
  if (globalThis.DDinspectScan) return;

  const S = globalThis.DDinspectShared;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const MAX_STYLE_ELEMENTS = 8000;   // elements whose computed style is read
  const MAX_PSEUDO_ELEMENTS = 3000;  // ::before / ::after are only read below this
  const MAX_DATA_URL = 300000;       // larger data: URIs are skipped
  const MAX_SVG_MARKUP = 150000;
  const MAX_SVG_NODES = 400;         // nodes per SVG whose paint gets inlined
  const NON_TEXT = new Set(['script', 'style', 'noscript', 'template', 'title', 'desc']);
  const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
  const PAINTED = new Set(['svg', 'g', 'use', ...SHAPES]);
  const SPRITE_CHILDREN = new Set(['defs', 'symbol', 'title', 'desc', 'style']);
  const COLOR_TOKEN = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;

  // ---------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------

  let ctx = null;
  const colorCache = new Map();

  // Any CSS color → [r, g, b, a]. rgb()/rgba() is parsed directly; anything else
  // (oklch(), color(), named colors…) goes through a 1×1 canvas.
  function parseColor(value) {
    if (!value) return null;
    if (colorCache.has(value)) return colorCache.get(value);
    let rgba = null;
    const m = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i);
    if (m) {
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
      rgba = [+m[1], +m[2], +m[3], alpha];
    } else {
      try {
        ctx = ctx || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#010203';
        ctx.fillStyle = value;
        // fillStyle ignores invalid values, so an unchanged sentinel means "not a color".
        if (ctx.fillStyle !== '#010203' || /^#010203$/i.test(value)) {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          rgba = [d[0], d[1], d[2], d[3] / 255];
        }
      } catch { /* not parseable */ }
    }
    colorCache.set(value, rgba);
    return rgba;
  }

  function toHex([r, g, b, a]) {
    const hex = '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    return a < 0.995 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex;
  }

  // Hex for a CSS color, or null when it is invalid or fully transparent.
  function colorHex(value) {
    const c = parseColor(value);
    return c && c[3] > 0.004 ? toHex(c) : null;
  }

  // ---------------------------------------------------------------------------
  // Text contrast
  // ---------------------------------------------------------------------------

  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode && el.getRootNode();
    return root && root.host ? root.host : null;
  }

  // Opaque color painted behind an element: its own background blended over its
  // ancestors' (white below the root). approx = a background image is involved,
  // so the real backdrop may differ. memo (a Map) shares the work across a scan.
  function backgroundOf(el, memo) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return { rgb: [255, 255, 255, 1], approx: false };
    if (memo && memo.has(el)) return memo.get(el);
    const cs = getComputedStyle(el);
    const own = parseColor(cs.backgroundColor) || [0, 0, 0, 0];
    const image = cs.backgroundImage !== 'none';
    let result;
    if (own[3] >= 0.995) {
      result = { rgb: [own[0], own[1], own[2], 1], approx: image };
    } else {
      const below = backgroundOf(parentOf(el), memo);
      result = { rgb: own[3] > 0.004 ? S.blend(own, below.rgb) : below.rgb, approx: below.approx || image };
    }
    if (memo) memo.set(el, result);
    return result;
  }

  // Contrast of an element's own text against what is behind it, or null when it
  // has no text of its own.
  function contrastOf(el, cs = getComputedStyle(el), memo = null) {
    if (NON_TEXT.has(el.tagName.toLowerCase()) || !ownText(el)) return null;
    const color = parseColor(cs.color);
    if (!color || color[3] <= 0.004) return null;
    const bg = backgroundOf(el, memo);
    const fg = S.blend(color, bg.rgb);
    const ratio = S.contrastRatio(fg, bg.rgb);
    const large = S.isLargeText(px(cs.fontSize), cs.fontWeight);
    return {
      fg: toHex(fg),
      bg: toHex(bg.rgb),
      ratio: Math.round(ratio * 100) / 100,
      large,
      level: S.wcagLevel(ratio, large),
      approx: bg.approx
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function absUrl(raw, base = document.baseURI) {
    try { return new URL(raw, base).href; } catch { return raw; }
  }

  function urlsIn(value) {
    if (!value || !value.includes('url(')) return [];
    return [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]).filter(Boolean);
  }

  function srcsetUrls(srcset) {
    if (!srcset) return [];
    return srcset.split(/,\s+/).map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean);
  }

  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.data;
    }
    return text.trim().replace(/\s+/g, ' ');
  }

  function unquote(text) {
    return (text || '').trim().replace(/^["']|["']$/g, '');
  }

  function px(value) {
    return parseFloat(value) || 0;
  }

  function within(root, selector) {
    const found = Array.from(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) found.unshift(root);
    return found;
  }

  // ---------------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------------

  function createImageCollector() {
    const items = new Map();
    const refs = [];
    return {
      refs,
      list: () => Array.from(items.values()),
      add(raw, type, el, extra = {}) {
        if (!raw) return;
        raw = raw.trim();
        if (!raw || raw === 'none' || /^(about:|javascript:)/i.test(raw)) return;
        const url = absUrl(raw);
        if (url.startsWith('data:') && url.length > MAX_DATA_URL) return;
        let item = items.get(url);
        if (!item) {
          item = {
            url,
            type,
            width: 0,
            height: 0,
            alt: '',
            count: 0,
            ref: -1,
            svg: /^data:image\/svg/i.test(url) || /\.svg(\?|#|$)/i.test(url)
          };
          items.set(url, item);
        }
        item.count++;
        if (extra.width && !item.width) {
          item.width = extra.width;
          item.height = extra.height;
        }
        if (extra.alt && !item.alt) item.alt = extra.alt.slice(0, 120);
        if (item.ref < 0 && el) item.ref = refs.push(el) - 1;
      }
    };
  }

  function collectImageElements(root, page, images) {
    for (const img of within(root, 'img')) {
      images.add(img.currentSrc || img.getAttribute('src'), 'img', img,
        { width: img.naturalWidth, height: img.naturalHeight, alt: img.getAttribute('alt') });
      // The src fallback, when the browser picked a srcset / <picture> candidate instead.
      const src = img.getAttribute('src');
      if (src && img.currentSrc && absUrl(src) !== img.currentSrc) images.add(src, 'img', img, { alt: img.getAttribute('alt') });
      srcsetUrls(img.getAttribute('srcset')).forEach((u) => images.add(u, 'srcset', img));
    }
    for (const source of within(root, 'source[srcset]')) {
      const img = source.parentElement && source.parentElement.querySelector('img');
      srcsetUrls(source.getAttribute('srcset')).forEach((u) => images.add(u, 'picture', img || null));
    }
    for (const video of within(root, 'video[poster]')) images.add(video.getAttribute('poster'), 'poster', video);
    for (const input of within(root, 'input[type="image"]')) images.add(input.getAttribute('src'), 'img', input);
    for (const image of within(root, 'image')) {
      images.add(image.getAttribute('href') || image.getAttributeNS(XLINK_NS, 'href'), 'svg-image', image);
    }
    if (page) {
      for (const link of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]')) {
        images.add(link.getAttribute('href'), 'icon', null);
      }
      for (const meta of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
        images.add(meta.getAttribute('content'), 'social', null);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Colors and fonts (per element)
  // ---------------------------------------------------------------------------

  function collectColors(el, cs, hasText, colors) {
    const seen = new Set();
    const add = (value, role) => {
      const hex = colorHex(value);
      if (!hex || seen.has(hex + role)) return;
      seen.add(hex + role);
      let color = colors.get(hex);
      if (!color) colors.set(hex, (color = { hex, count: 0, roles: {} }));
      color.count++;
      color.roles[role] = (color.roles[role] || 0) + 1;
    };

    if (hasText) {
      add(cs.color, 'text');
      if (cs.textDecorationLine !== 'none') add(cs.textDecorationColor, 'text');
    }
    add(cs.backgroundColor, 'background');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (cs.getPropertyValue(`border-${side}-style`) !== 'none' && px(cs.getPropertyValue(`border-${side}-width`)) > 0) {
        add(cs.getPropertyValue(`border-${side}-color`), 'border');
      }
    }
    if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0) add(cs.outlineColor, 'border');
    if (el.namespaceURI === SVG_NS && SHAPES.has(el.tagName.toLowerCase())) {
      if (cs.fill !== 'none') add(cs.fill, 'svg');
      if (cs.stroke !== 'none') add(cs.stroke, 'svg');
    }
    for (const shadow of [cs.boxShadow, cs.textShadow]) {
      if (shadow && shadow !== 'none') (shadow.match(COLOR_TOKEN) || []).forEach((t) => add(t, 'shadow'));
    }
    if (cs.backgroundImage.includes('gradient')) {
      (cs.backgroundImage.match(COLOR_TOKEN) || []).forEach((t) => add(t, 'gradient'));
    }
  }

  function collectFont(el, cs, fonts) {
    const stack = cs.fontFamily;
    const family = unquote(stack.split(',')[0]) || 'default';
    let fam = fonts.get(family.toLowerCase());
    if (!fam) fonts.set(family.toLowerCase(), (fam = { family, stack, count: 0, styles: new Map() }));
    fam.count++;
    const key = [cs.fontWeight, cs.fontSize, cs.lineHeight, cs.fontStyle].join('|');
    let style = fam.styles.get(key);
    if (!style) {
      style = {
        weight: cs.fontWeight,
        size: cs.fontSize,
        lineHeight: cs.lineHeight,
        style: cs.fontStyle,
        count: 0,
        sample: ownText(el).slice(0, 80)
      };
      fam.styles.set(key, style);
    }
    style.count++;
  }

  // @font-face rules from every readable stylesheet, with absolute source URLs.
  function collectFontFaces() {
    const faces = [];
    const walk = (rules, base) => {
      for (const rule of rules) {
        const kind = Object.prototype.toString.call(rule).slice(8, -1);
        if (kind === 'CSSFontFaceRule') {
          const src = rule.style.getPropertyValue('src');
          faces.push({
            family: unquote(rule.style.getPropertyValue('font-family')),
            weight: rule.style.getPropertyValue('font-weight') || 'normal',
            style: rule.style.getPropertyValue('font-style') || 'normal',
            sources: [...src.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/g)]
              .map((m) => ({ url: absUrl(m[2], base), format: m[3] || '' }))
          });
        } else if (kind === 'CSSImportRule' && rule.styleSheet) {
          try { walk(rule.styleSheet.cssRules, rule.styleSheet.href || base); } catch { /* cross-origin */ }
        } else if (rule.cssRules) {
          try { walk(rule.cssRules, base); } catch { /* ignore */ }
        }
      }
    };
    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin without CORS
      walk(rules, sheet.href || document.baseURI);
    }
    return faces;
  }

  // ---------------------------------------------------------------------------
  // SVGs
  // ---------------------------------------------------------------------------

  function paint(value) {
    if (!value || value === 'none') return 'none';
    const ref = value.match(/url\(\s*["']?[^"')]*?(#[^"')]+)["']?\s*\)/);
    if (ref) return `url(${ref[1]})`;
    return colorHex(value) || value;
  }

  // Replaces <use href="#id"> with a copy of what it points to, so the markup
  // still renders once it leaves the page.
  function resolveUses(clone) {
    for (const use of Array.from(clone.querySelectorAll('use'))) {
      const href = use.getAttribute('href') || use.getAttributeNS(XLINK_NS, 'href');
      if (!href || !href.startsWith('#')) continue;
      const target = document.getElementById(href.slice(1));
      if (!target) continue;
      let replacement;
      if (target.tagName.toLowerCase() === 'symbol') {
        replacement = document.createElementNS(SVG_NS, 'svg');
        for (const attr of ['viewBox', 'preserveAspectRatio']) {
          if (target.hasAttribute(attr)) replacement.setAttribute(attr, target.getAttribute(attr));
        }
        for (const child of target.childNodes) replacement.append(child.cloneNode(true));
      } else {
        replacement = target.cloneNode(true);
        replacement.removeAttribute('id');
      }
      for (const attr of Array.from(use.attributes)) {
        if (attr.localName !== 'href') replacement.setAttribute(attr.name, attr.value);
      }
      use.replaceWith(replacement);
    }
  }

  function cleanSvg(svg, rect) {
    const clone = svg.cloneNode(true);
    const source = [svg, ...svg.querySelectorAll('*')].slice(0, MAX_SVG_NODES);
    const target = [clone, ...clone.querySelectorAll('*')];
    const color = colorHex(getComputedStyle(svg).color) || '#000000';

    // Inline the paint that page CSS gives each shape (the page CSS won't travel).
    source.forEach((node, i) => {
      if (!PAINTED.has(node.tagName.toLowerCase())) return;
      const cs = getComputedStyle(node);
      const out = target[i];
      if (!node.hasAttribute('fill')) out.setAttribute('fill', paint(cs.fill));
      if (!node.hasAttribute('stroke') && cs.stroke !== 'none') {
        out.setAttribute('stroke', paint(cs.stroke));
        if (!node.hasAttribute('stroke-width')) out.setAttribute('stroke-width', cs.strokeWidth);
      }
    });

    resolveUses(clone);
    clone.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        else if (/currentcolor/i.test(attr.value)) node.setAttribute(attr.name, attr.value.replace(/currentcolor/gi, color));
      }
    }
    if (!clone.hasAttribute('width') && rect.width >= 1) clone.setAttribute('width', Math.round(rect.width));
    if (!clone.hasAttribute('height') && rect.height >= 1) clone.setAttribute('height', Math.round(rect.height));
    return new XMLSerializer().serializeToString(clone);
  }

  function viewBoxSize(el) {
    const vb = (el.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    return vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { width: vb[2], height: vb[3] } : { width: 24, height: 24 };
  }

  function symbolMarkup(symbol) {
    const size = viewBoxSize(symbol);
    const svg = document.createElementNS(SVG_NS, 'svg');
    if (symbol.hasAttribute('viewBox')) svg.setAttribute('viewBox', symbol.getAttribute('viewBox'));
    svg.setAttribute('width', size.width);
    svg.setAttribute('height', size.height);
    for (const child of symbol.childNodes) svg.append(child.cloneNode(true));
    return new XMLSerializer().serializeToString(svg);
  }

  function svgLabel(svg) {
    const title = svg.querySelector('title');
    const use = svg.querySelector('use');
    const useId = use && (use.getAttribute('href') || use.getAttributeNS(XLINK_NS, 'href') || '').split('#')[1];
    const labelled = svg.closest('[aria-label]');
    const label = svg.getAttribute('aria-label') || (title && title.textContent) || svg.id || useId ||
      svg.classList[0] || (labelled && labelled.getAttribute('aria-label')) || 'svg';
    return label.trim().slice(0, 40);
  }

  function scanSvgs(root, exclude) {
    const byMarkup = new Map();
    const refs = [];
    const add = (markup, label, el, width, height) => {
      if (!markup || markup.length > MAX_SVG_MARKUP) return;
      let item = byMarkup.get(markup);
      if (!item) {
        item = { markup, label, width: Math.round(width), height: Math.round(height), count: 0, ref: el ? refs.push(el) - 1 : -1 };
        byMarkup.set(markup, item);
      }
      item.count++;
    };

    const svgs = within(root, 'svg').filter((svg) => svg !== exclude && !(svg.parentElement && svg.parentElement.closest('svg')));
    for (const svg of svgs) {
      const children = Array.from(svg.children);
      const onlyDefs = children.length > 0 && children.every((c) => SPRITE_CHILDREN.has(c.tagName.toLowerCase()));
      if (onlyDefs) {
        // Sprite sheet: every <symbol> is an icon of its own. Defs-only SVGs are skipped.
        for (const symbol of svg.querySelectorAll('symbol')) {
          const size = viewBoxSize(symbol);
          add(symbolMarkup(symbol), symbol.id || 'symbol', null, size.width, size.height);
        }
        continue;
      }
      try {
        const rect = svg.getBoundingClientRect();
        add(cleanSvg(svg, rect), svgLabel(svg), svg, rect.width, rect.height);
      } catch { /* odd markup: skip this one */ }
    }
    return { list: Array.from(byMarkup.values()), refs };
  }

  // ---------------------------------------------------------------------------
  // Scan
  // ---------------------------------------------------------------------------

  // root: element to scan (with its descendants). page: true when root is the whole
  // document (adds favicons / social images). exclude: DDinspect's own overlay host.
  function scan({ root = document.documentElement, page = true, exclude = null } = {}) {
    const all = page ? Array.from(document.querySelectorAll('*')) : within(root, '*');
    const elements = exclude ? all.filter((el) => el !== exclude) : all;
    const styled = elements.slice(0, MAX_STYLE_ELEMENTS);
    const withPseudo = styled.length <= MAX_PSEUDO_ELEMENTS;

    const images = createImageCollector();
    const colors = new Map();
    const fonts = new Map();
    const pairs = new Map();      // text contrast: one entry per text / background / size class
    const textRefs = [];
    const backgrounds = new Map(); // backgroundOf() memo
    collectImageElements(root, page, images);

    for (const el of styled) {
      const cs = getComputedStyle(el);
      for (const prop of ['background-image', 'mask-image', 'list-style-image', 'border-image-source']) {
        urlsIn(cs.getPropertyValue(prop)).forEach((u) => images.add(u, 'css', el));
      }
      if (withPseudo) {
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(el, pseudo);
          if (ps.content === 'none' || ps.content === 'normal') continue;
          [...urlsIn(ps.backgroundImage), ...urlsIn(ps.content)].forEach((u) => images.add(u, 'css', el));
          const hex = colorHex(ps.backgroundColor);
          if (hex) collectColors(el, { ...EMPTY_STYLE, backgroundColor: ps.backgroundColor }, false, colors);
        }
      }

      // Colors and fonts only count for elements that are actually rendered.
      if (el.getClientRects().length === 0) continue;
      const tag = el.tagName.toLowerCase();
      const hasText = !NON_TEXT.has(tag) && ownText(el).length > 0;
      collectColors(el, cs, hasText, colors);
      if (hasText) {
        collectFont(el, cs, fonts);
        const contrast = contrastOf(el, cs, backgrounds);
        if (contrast) {
          const key = `${contrast.fg}|${contrast.bg}|${contrast.large}`;
          let pair = pairs.get(key);
          if (!pair) {
            pair = { ...contrast, count: 0, sample: ownText(el).slice(0, 40), ref: textRefs.push(el) - 1 };
            pairs.set(key, pair);
          }
          pair.count++;
          pair.approx = pair.approx || contrast.approx;
        }
      }
    }

    const svgs = scanSvgs(root, exclude);
    const faces = collectFontFaces();
    const fontList = Array.from(fonts.values())
      .map((f) => ({
        family: f.family,
        stack: f.stack,
        count: f.count,
        styles: Array.from(f.styles.values()).sort((a, b) => px(b.size) - px(a.size) || px(b.weight) - px(a.weight)),
        faces: faces.filter((face) => face.family.toLowerCase() === f.family.toLowerCase())
      }))
      .sort((a, b) => b.count - a.count);

    return {
      images: images.list(),
      svgs: svgs.list,
      colors: Array.from(colors.values()).sort((a, b) => b.count - a.count),
      // Worst contrast first.
      contrast: Array.from(pairs.values()).sort((a, b) => a.ratio - b.ratio || b.count - a.count),
      fonts: fontList,
      elementCount: elements.length,
      truncated: elements.length > styled.length,
      refs: { images: images.refs, svgs: svgs.refs, texts: textRefs }
    };
  }

  // Minimal stand-in so a pseudo-element's background can reuse collectColors().
  const EMPTY_STYLE = {
    color: '', textDecorationLine: 'none', backgroundColor: '', outlineStyle: 'none', outlineWidth: '0',
    fill: 'none', stroke: 'none', boxShadow: 'none', textShadow: 'none', backgroundImage: 'none',
    getPropertyValue: () => 'none'
  };

  globalThis.DDinspectScan = { scan, colorHex, contrastOf, fontFaces: collectFontFaces };
})();
