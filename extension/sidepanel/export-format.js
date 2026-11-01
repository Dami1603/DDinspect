// DDinspect - formats for "Export as component".
// Takes what content/export.js builds ({ html, rules, fontFaces }) and writes
// it as a standalone HTML document, a React component (JSX + CSS) or HTML with
// Tailwind arbitrary-property classes. Markup is re-parsed with DOMParser,
// which never runs scripts, and serialized by hand.

(() => {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

  const JSX_ATTRS = {
    class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
    minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan', srcset: 'srcSet', crossorigin: 'crossOrigin',
    autocomplete: 'autoComplete', autoplay: 'autoPlay', playsinline: 'playsInline', datetime: 'dateTime',
    inputmode: 'inputMode', referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority',
    checked: 'defaultChecked', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'xmlns:xlink': 'xmlnsXlink'
  };

  function cssText(result) {
    const rules = result.rules.map((r) => `${r.selector} {\n${r.decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`);
    return [...result.fontFaces, ...rules].join('\n\n') + '\n';
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function documentFor(body, head, title) {
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(title)}</title>`,
      head,
      '</head>',
      '<body>',
      body,
      '</body>',
      '</html>',
      ''
    ].join('\n');
  }

  // A complete page: the component and its CSS in a <style>.
  function htmlDocument(result, title = 'Component') {
    const css = cssText(result).replace(/<\//g, '<\\/');
    return documentFor(result.html, `<style>\n${css}</style>`, title);
  }

  function parse(html) {
    return new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body;
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  function jsxName(name, tag) {
    if (JSX_ATTRS[name]) return JSX_ATTRS[name];
    if (name === 'value' && /^(input|textarea|select)$/.test(tag)) return 'defaultValue';
    if (/^(aria|data)-/.test(name)) return name;
    return name.replace(/[-:]([a-z])/g, (m, c) => c.toUpperCase());
  }

  function jsxValue(value) {
    return /["\\\n{}]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
  }

  function jsxText(text) {
    return text.replace(/[{}<>]/g, (c) => ({ '{': "{'{'}", '}': "{'}'}", '<': '&lt;', '>': '&gt;' }[c]));
  }

  function toJsxNode(node, depth) {
    const pad = '  '.repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(/\s+/g, ' ');
      return text.trim() ? pad + jsxText(text.trim()) : '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.localName;
    const attrs = Array.from(node.attributes).map((a) => {
      const name = jsxName(a.name, tag);
      return a.value === '' && a.name !== 'alt' && a.name !== 'value' ? name : `${name}=${jsxValue(a.value)}`;
    });
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    const children = Array.from(node.childNodes).map((c) => toJsxNode(c, depth + 1)).filter(Boolean);
    if (VOID.has(tag) || !children.length) return `${pad}${open} />`;
    return `${pad}${open}>\n${children.join('\n')}\n${pad}</${tag}>`;
  }

  function toJsx(result) {
    const root = parse(result.html).firstElementChild;
    return [
      "import './Component.css';",
      '',
      'export default function Component() {',
      '  return (',
      root ? toJsxNode(root, 2) : '    null',
      '  );',
      '}',
      ''
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Tailwind (arbitrary properties: works with Tailwind 3.3+ and 4)
  // ---------------------------------------------------------------------------

  function utility(prop, value, variant) {
    const v = value.trim().replace(/"/g, "'").replace(/_/g, '\\_').replace(/\s+/g, '_');
    return `${variant ? variant + ':' : ''}[${prop}:${v}]`;
  }

  function tailwindBody(result) {
    const classes = new Map();
    for (const rule of result.rules) {
      const m = rule.selector.match(/^\.(dd-\d+)(?:::(before|after))?$/);
      if (!m) continue;
      const list = classes.get(m[1]) || [];
      list.push(...rule.decls.map(([p, v]) => utility(p, v, m[2])));
      classes.set(m[1], list);
    }
    const body = parse(result.html);
    for (const el of body.querySelectorAll('[class]')) {
      const list = classes.get(el.getAttribute('class'));
      if (list && list.length) el.setAttribute('class', list.join(' '));
      else el.removeAttribute('class');
    }
    return body.innerHTML;
  }

  function toTailwind(result) {
    const fonts = result.fontFaces.length
      ? `<!-- Fonts: add these @font-face rules to your CSS.\n${result.fontFaces.join('\n').replace(/--/g, '- -')}\n-->\n`
      : '';
    return `${fonts}${tailwindBody(result)}\n`;
  }

  // Page with the Tailwind Play CDN, to open the export directly in a browser.
  function tailwindDocument(result, title = 'Component') {
    const fonts = result.fontFaces.length ? `\n<style>\n${result.fontFaces.join('\n\n').replace(/<\//g, '<\\/')}\n</style>` : '';
    return documentFor(tailwindBody(result), `<script src="https://cdn.tailwindcss.com/3.4.16"></script>${fonts}`, title);
  }

  globalThis.DDinspectFormat = { cssText, htmlDocument, toJsx, toTailwind, tailwindDocument };
})();
