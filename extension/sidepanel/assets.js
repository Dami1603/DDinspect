// DDinspect - side panel asset tabs: Images, SVGs, Colors (with text contrast) and Fonts.
// The tab's content script scans the page (content/scan.js) and this file renders
// the results, keeps the per-scope cache that feeds the tab badges, and handles
// copy / download / ZIP. Loaded before sidepanel.js and uses its globals
// (h, t, icon, btn, iconBtn, state, render, command, toast, copyText, colorText)
// at call time.

const ASSET_TABS = ['images', 'svgs', 'colors', 'fonts'];

const IMAGE_FILTERS = [
  { id: 'all', label: 'filterAll', test: () => true },
  { id: 'img', label: 'filterImg', test: (it) => ['img', 'srcset', 'picture'].includes(it.type) },
  { id: 'css', label: 'filterCss', test: (it) => it.type === 'css' },
  { id: 'svg', label: 'filterSvg', test: (it) => it.svg },
  { id: 'other', label: 'filterOther', test: (it) => ['poster', 'icon', 'social', 'svg-image'].includes(it.type) }
];

const COLOR_ROLES = ['all', 'text', 'background', 'border', 'svg', 'shadow', 'gradient'];

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf'
};

// ---------------------------------------------------------------------------
// Scan cache (one result per scope: whole page / selected element)
// ---------------------------------------------------------------------------

function emptyAssets() {
  return { failed: true, images: [], svgs: [], colors: [], contrast: [], fonts: [], elementCount: 0 };
}

// A tab set to "selected element" falls back to the page while nothing is selected.
function scopeFor(tab) {
  return state.scope[tab] === 'selection' && state.info ? 'selection' : 'page';
}

function clearAssets(scope) {
  for (const s of scope ? [scope] : ['page', 'selection']) {
    state.assets[s] = null;
    state.scanning[s] = false;
    state.scanGen[s]++;
  }
}

async function scanAssets(scope) {
  const tabId = state.tabId;
  const gen = state.scanGen[scope];
  state.scanning[scope] = true;
  const resp = await command({ type: 'ddinspect:scan-assets', scope });
  // Drop the answer if the tab or the selection changed meanwhile.
  if (tabId !== state.tabId || gen !== state.scanGen[scope]) return;
  state.scanning[scope] = false;
  state.assets[scope] = resp && resp.ok && resp.assets ? resp.assets : emptyAssets();
  render();
}

// Called after every render: fills the cache for every scope a tab needs, which
// is also what keeps the badges up to date.
function ensureScans() {
  if (state.restricted || state.tabId === null) return;
  for (const tab of ASSET_TABS) {
    const scope = scopeFor(tab);
    if (!state.assets[scope] && !state.scanning[scope]) scanAssets(scope);
  }
}

function assetCount(tab) {
  const data = state.assets[scopeFor(tab)];
  return data && !data.failed ? data[tab].length : null;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function baseName(url, fallback) {
  if (url.startsWith('data:')) return fallback;
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return segment.replace(/[^\w.\-]+/g, '_').slice(-80) || fallback;
  } catch {
    return fallback;
  }
}

function withExtension(name, type) {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const ext = EXT_BY_TYPE[(type || '').split(';')[0]];
  return ext ? `${name}.${ext}` : name;
}

function uniqueName(name, used) {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  for (let i = 2; used.has(candidate); i++) {
    candidate = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
  }
  used.add(candidate);
  return candidate;
}

// Extension pages can fetch cross-origin thanks to the host permissions.
async function fetchBlob(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadUrl(url, fallbackName) {
  try {
    const blob = await fetchBlob(url);
    saveBlob(blob, withExtension(baseName(url, fallbackName), blob.type));
  } catch {
    toast(t('toastDownloadFallback'));
    window.open(url, '_blank', 'noopener');
  }
}

function pageSlug() {
  return (S.hostOf(state.tabUrl) || 'page').replace(/[^\w.-]+/g, '_');
}

// entries: [{ name, url } | { name, text }] → one ZIP download.
async function downloadZip(entries, zipName) {
  if (!entries.length) return;
  const files = [];
  const used = new Set();
  const queue = entries.slice();
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      try {
        let data;
        let type = '';
        if (entry.text !== undefined) {
          data = new TextEncoder().encode(entry.text);
        } else {
          const blob = await fetchBlob(entry.url);
          type = blob.type;
          data = new Uint8Array(await blob.arrayBuffer());
        }
        files.push({ name: uniqueName(withExtension(entry.name, type), used), data });
      } catch {
        failed++;
      }
      toast(t('toastPacking', ++done, entries.length));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, entries.length) }, worker));
  if (!files.length) {
    toast(t('toastNothingDownloaded'));
    return;
  }
  saveBlob(DDinspectZip.createZip(files), zipName);
  toast(failed ? t('toastZipPartial', failed) : t('toastZipReady', files.length));
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function smallIconBtn(label, iconName, onclick) {
  return iconBtn(label, iconName, onclick, 'wd-icon-btn wd-icon-btn-sm');
}

function chips(options, active, onSelect) {
  return h('div', { class: 'wd-chips', role: 'group' }, options.map((opt) => h('button', {
    class: 'wd-chip-btn' + (opt.id === active ? ' wd-chip-active' : ''),
    'aria-pressed': String(opt.id === active),
    disabled: opt.count === 0 && opt.id !== 'all' ? '' : null,
    onclick: () => onSelect(opt.id)
  }, opt.label, opt.count !== undefined && h('span', { class: 'wd-chip-count' }, String(opt.count)))));
}

// Hover → highlight on the page; "locate" → select it and open Inspect.
function assetHover(kind, item, scope) {
  if (item.ref < 0) return {};
  return {
    onmouseenter: () => command({ type: 'ddinspect:highlight', kind, index: item.ref, scope }),
    onmouseleave: () => command({ type: 'ddinspect:unhighlight' })
  };
}

function locate(kind, item, scope) {
  state.goInspect = true;
  command({ type: 'ddinspect:select-related', kind, index: item.ref, scope });
}

function assetToolbar(tab, scope) {
  const segment = (value, label, disabled, title) => h('button', {
    class: 'wd-seg-btn' + (scope === value ? ' wd-seg-active' : ''),
    'aria-pressed': String(scope === value),
    disabled: disabled ? '' : null,
    title,
    onclick: () => { state.scope[tab] = value; render({ resetScroll: true }); }
  }, label);

  return h('div', { class: 'wd-asset-bar' },
    h('div', { class: 'wd-seg', role: 'group', 'aria-label': t('scopeLabel') },
      segment('selection', t('scopeSelection'), !state.info,
        state.info ? t('scopeSelectionTitle', state.info.label) : t('scopeSelectionDisabled')),
      segment('page', t('scopePage'), false, t('scopePageTitle'))),
    iconBtn(t('rescanTitle'), 'refresh', () => { clearAssets(scope); render(); })
  );
}

function scopeNote(scope, data) {
  if (scope !== 'selection' || !state.info) return null;
  return h('p', { class: 'wd-scope-note' }, t('scopeNote', state.info.label, data.elementCount));
}

function summary(text, ...actions) {
  return h('div', { class: 'wd-asset-summary' }, h('strong', {}, text), h('div', { class: 'wd-actions' }, actions));
}

function renderAssetTab(tab) {
  const scope = scopeFor(tab);
  const data = state.assets[scope];
  const toolbar = assetToolbar(tab, scope);

  if (state.restricted) {
    return h('div', {}, h('div', { class: 'wd-empty' }, h('p', {}, t('scanRestricted'))));
  }
  if (!data) {
    return h('div', {}, toolbar, h('div', { class: 'wd-empty' }, h('div', { class: 'wd-spinner' }), h('p', {}, t('scanning'))));
  }
  if (data.failed) {
    return h('div', {}, toolbar, h('div', { class: 'wd-empty' }, h('p', {}, t('scanFailed'))));
  }
  const view = { images: renderImages, svgs: renderSvgs, colors: renderColors, fonts: renderFonts }[tab];
  return h('div', { class: 'wd-assets' }, toolbar, scopeNote(scope, data), view(data, scope),
    data.truncated && h('p', { class: 'wd-muted wd-small' }, t('scanTruncated')));
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function imageCard(item, scope, index) {
  const dims = h('span', {}, item.width ? `${item.width}×${item.height}` : '…');
  const preview = h('img', { class: 'wd-asset-img', src: item.url, alt: item.alt || '', loading: 'lazy' });
  preview.addEventListener('load', () => {
    if (!item.width && preview.naturalWidth) {
      item.width = preview.naturalWidth;
      item.height = preview.naturalHeight;
      dims.textContent = `${item.width}×${item.height}`;
    }
  });
  preview.addEventListener('error', () => {
    preview.replaceWith(h('span', { class: 'wd-asset-broken' }, t('noPreview')));
    if (!item.width) dims.textContent = '—';
  });
  const name = baseName(item.url, `image-${index + 1}`);

  return h('div', { class: 'wd-asset-card', ...assetHover('image', item, scope) },
    h('div', { class: 'wd-asset-preview wd-checker' },
      S.isSafeUrl(item.url) ? preview : h('span', { class: 'wd-asset-broken' }, t('noPreview')),
      item.count > 1 && h('span', { class: 'wd-asset-count', title: t('usedTimes', item.count) }, `×${item.count}`)),
    h('div', { class: 'wd-asset-name', title: item.url }, name),
    h('div', { class: 'wd-asset-meta' }, h('span', { class: 'wd-badge' }, item.svg ? 'svg' : item.type), dims),
    h('div', { class: 'wd-asset-actions' },
      smallIconBtn(t('copyUrl'), 'copy', () => copyText(item.url, t('toastUrlCopied'))),
      smallIconBtn(t('download'), 'download', () => downloadUrl(item.url, name)),
      S.isSafeUrl(item.url) && h('a', {
        class: 'wd-icon-btn wd-icon-btn-sm', href: item.url, target: '_blank', rel: 'noopener noreferrer',
        title: t('openNewTab'), 'aria-label': t('openNewTab')
      }, icon('external')),
      item.ref >= 0 && smallIconBtn(t('locate'), 'locate', () => locate('image', item, scope)))
  );
}

function renderImages(data, scope) {
  if (!data.images.length) return h('div', { class: 'wd-empty' }, h('p', {}, t('noImages')));

  const filter = IMAGE_FILTERS.find((f) => f.id === state.filters.imageType) || IMAGE_FILTERS[0];
  const grid = h('div', { class: 'wd-asset-grid' });
  const count = h('strong', {});
  let visible = [];
  const fill = () => {
    const q = state.filters.imageQuery.trim().toLowerCase();
    visible = data.images.filter(filter.test).filter((it) => !q || `${it.url} ${it.alt}`.toLowerCase().includes(q));
    count.textContent = t('imagesCount', visible.length, data.images.length);
    grid.replaceChildren(...(visible.length
      ? visible.map((it) => imageCard(it, scope, data.images.indexOf(it)))
      : [h('p', { class: 'wd-muted' }, t('noImageMatch'))]));
  };
  fill();

  return h('div', {},
    h('div', { class: 'wd-asset-summary' }, count, h('div', { class: 'wd-actions' },
      btn('ZIP', 'download', () => downloadZip(
        visible.map((it) => ({ name: baseName(it.url, `image-${data.images.indexOf(it) + 1}`), url: it.url })),
        `${pageSlug()}-images.zip`), 'wd-btn wd-btn-small', { title: t('zipImagesTitle') }),
      btn(t('copyUrls'), 'copy', () => copyText(visible.map((it) => it.url).join('\n'), t('toastUrlsCopied')), 'wd-btn wd-btn-small'))),
    chips(IMAGE_FILTERS.map((f) => ({ id: f.id, label: f.id === 'img' ? '<img>' : t(f.label), count: data.images.filter(f.test).length })), filter.id,
      (id) => { state.filters.imageType = id; render(); }),
    h('input', {
      class: 'wd-input wd-search', type: 'search', value: state.filters.imageQuery,
      placeholder: t('filterImages'), 'aria-label': t('filterImages'),
      oninput: (e) => { state.filters.imageQuery = e.target.value; fill(); }
    }),
    grid
  );
}

// ---------------------------------------------------------------------------
// SVGs
// ---------------------------------------------------------------------------

function svgFileName(item, index) {
  return `${(item.label || 'icon').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'icon'}-${index + 1}.svg`;
}

function renderSvgs(data, scope) {
  if (!data.svgs.length) return h('div', { class: 'wd-empty' }, h('p', {}, t('noSvgs')));
  const dark = state.filters.svgBackground === 'dark';

  return h('div', {},
    summary(t('svgsCount', data.svgs.length),
      btn(dark ? t('lightBackground') : t('darkBackground'), dark ? 'sun' : 'moon',
        () => { state.filters.svgBackground = dark ? 'light' : 'dark'; render(); }, 'wd-btn wd-btn-small', { title: t('previewBackground') }),
      btn('ZIP', 'download', () => downloadZip(data.svgs.map((it, i) => ({ name: svgFileName(it, i), text: it.markup })), `${pageSlug()}-svgs.zip`),
        'wd-btn wd-btn-small', { title: t('zipSvgsTitle') })),
    h('div', { class: 'wd-svg-grid' }, data.svgs.map((item, i) => h('div', { class: 'wd-asset-card wd-svg-card', ...assetHover('svg', item, scope) },
      // Rendered through <img> so scripts inside the SVG can never run here.
      h('div', { class: 'wd-asset-preview wd-svg-preview' + (dark ? ' wd-preview-dark' : ' wd-checker') },
        h('img', { class: 'wd-svg-img', alt: item.label, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(item.markup) }),
        item.count > 1 && h('span', { class: 'wd-asset-count', title: t('usedTimes', item.count) }, `×${item.count}`)),
      h('div', { class: 'wd-asset-name', title: item.label }, item.label),
      h('div', { class: 'wd-asset-meta' }, `${item.width || '?'}×${item.height || '?'}`),
      h('div', { class: 'wd-asset-actions' },
        smallIconBtn(t('copyMarkup'), 'copy', () => copyText(item.markup, t('toastSvgCopied'))),
        smallIconBtn(t('downloadSvg'), 'download', () => saveBlob(new Blob([item.markup], { type: 'image/svg+xml' }), svgFileName(item, i))),
        item.ref >= 0 && smallIconBtn(t('locate'), 'locate', () => locate('svg', item, scope)))
    )))
  );
}

// ---------------------------------------------------------------------------
// Colors and text contrast
// ---------------------------------------------------------------------------

function colorsCss(list, uses) {
  return `:root {\n${list.map((c, i) => `  --color-${i + 1}: ${colorText(c.hex)}; /* ${Object.keys(c.roles).join(', ')} · ${uses(c)}× */`).join('\n')}\n}`;
}

function contrastRow(pair, scope) {
  const sample = h('span', { class: 'wd-contrast-sample wd-contrast-sample-lg' }, pair.sample || 'Aa');
  sample.style.color = pair.fg;
  sample.style.background = pair.bg;
  const fail = pair.level === 'fail';
  return h('div', { class: 'wd-contrast-row', ...assetHover('text', pair, scope) },
    sample,
    h('div', { class: 'wd-contrast-info' },
      h('div', {},
        h('strong', { class: 'wd-num' }, `${pair.approx ? '≈ ' : ''}${pair.ratio}:1`), ' ',
        h('span', { class: 'wd-badge ' + (fail ? 'wd-badge-bad' : 'wd-badge-good') }, fail ? t('wcagFail') : pair.level),
        pair.large && h('span', { class: 'wd-muted' }, ` · ${t('contrastLarge')}`)),
      h('div', { class: 'wd-muted wd-small' }, `${colorText(pair.fg)} / ${colorText(pair.bg)} · ${pair.count}×`)),
    pair.ref >= 0 && smallIconBtn(t('locate'), 'locate', () => locate('text', pair, scope))
  );
}

function renderContrast(data, scope) {
  const pairs = data.contrast || [];
  if (!pairs.length) return null;
  const failing = pairs.filter((p) => p.level === 'fail').length;
  return collapsible('contrast', 'wd-section wd-contrast-section',
    [icon('contrast'), ' ', t('contrastSection', pairs.length, failing)],
    h('div', { class: 'wd-section-body' },
      h('p', { class: 'wd-muted wd-small' }, t('contrastIntro')),
      pairs.map((p) => contrastRow(p, scope)))
  );
}

function renderColors(data, scope) {
  if (!data.colors.length) return h('div', { class: 'wd-empty' }, h('p', {}, t('noColors')));

  const role = state.filters.colorRole;
  const list = role === 'all'
    ? data.colors
    : data.colors.filter((c) => c.roles[role]).sort((a, b) => b.roles[role] - a.roles[role]);
  const uses = (c) => (role === 'all' ? c.count : c.roles[role]);
  const total = list.reduce((sum, c) => sum + uses(c), 0);

  return h('div', {},
    summary(t('colorsCount', list.length),
      btn(t('copyCssVars'), 'copy', () => copyText(colorsCss(list, uses), t('toastCssVarsCopied')), 'wd-btn wd-btn-small'),
      btn(t('copyList'), 'copy', () => copyText(list.map((c) => colorText(c.hex)).join('\n'), t('toastListCopied')), 'wd-btn wd-btn-small')),
    chips(COLOR_ROLES.map((id) => ({
      id, label: t(`role_${id}`), count: id === 'all' ? data.colors.length : data.colors.filter((c) => c.roles[id]).length
    })), role, (id) => { state.filters.colorRole = id; render(); }),
    // Proportional strip: each color's width follows how often it is used.
    h('div', { class: 'wd-palette wd-checker' }, list.slice(0, 48).map((c) => {
      const band = h('button', {
        class: 'wd-palette-band', title: `${colorText(c.hex)} · ${uses(c)}×`, 'aria-label': colorText(c.hex),
        onclick: () => copyText(colorText(c.hex), t('toastValueCopied', colorText(c.hex)))
      });
      band.style.background = c.hex;
      band.style.flexGrow = String(Math.max(uses(c) / total, 0.004));
      return band;
    })),
    renderContrast(data, scope),
    h('div', { class: 'wd-color-grid' }, list.map((c) => {
      const value = colorText(c.hex);
      const swatch = h('button', {
        class: 'wd-color-swatch', title: t('copyValue'), 'aria-label': `${t('copyValue')} ${value}`,
        onclick: () => copyText(value, t('toastValueCopied', value))
      });
      swatch.style.background = c.hex;
      const secondary = state.settings.colorFormat === 'hex' ? S.formatColor(c.hex, 'rgb') : c.hex;
      return h('div', { class: 'wd-color-card' },
        h('div', { class: 'wd-checker wd-color-swatch-wrap' }, swatch),
        h('div', { class: 'wd-color-info' },
          h('div', { class: 'wd-color-hex' }, value, h('span', { class: 'wd-muted' }, ` ${uses(c)}×`)),
          h('div', { class: 'wd-color-rgb', title: t('copyValue'), onclick: () => copyText(secondary, t('toastValueCopied', secondary)) }, secondary),
          h('div', { class: 'wd-color-roles' }, Object.entries(c.roles).map(([r, n]) => h('span', { class: 'wd-role' }, `${t(`role_${r}`)} ${n}`)))
        )
      );
    }))
  );
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const loadedFaces = new Set();

function fontAlias(family) {
  let hash = 0;
  for (const ch of family) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `ddinspect-${hash.toString(36)}`;
}

function bestSource(face) {
  const rank = (s) => ['woff2', 'woff', 'truetype', 'opentype'].indexOf(s.format.toLowerCase()) + 1 || 9;
  return face.sources.slice().sort((a, b) => rank(a) - rank(b))[0];
}

// Loads the page's @font-face files into the panel under an alias, so samples
// render in the real font. Fetched as bytes because extension pages may fetch
// cross-origin while FontFace(url) would be blocked by CORS.
function loadFontFaces(fonts) {
  for (const font of fonts) {
    for (const face of font.faces) {
      const source = bestSource(face);
      if (!source || loadedFaces.has(source.url)) continue;
      loadedFaces.add(source.url);
      fetch(source.url)
        .then((r) => r.arrayBuffer())
        .then((buffer) => new FontFace(fontAlias(font.family), buffer, { weight: face.weight, style: face.style }).load())
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => { /* the sample falls back to the font stack */ });
    }
  }
}

function fontCss(font, style) {
  return [
    `font-family: ${font.stack};`,
    `font-size: ${style.size};`,
    `font-weight: ${style.weight};`,
    `line-height: ${style.lineHeight};`,
    style.style !== 'normal' ? `font-style: ${style.style};` : ''
  ].filter(Boolean).join('\n');
}

function renderFonts(data) {
  if (!data.fonts.length) return h('div', { class: 'wd-empty' }, h('p', {}, t('noFonts')));
  loadFontFaces(data.fonts);

  return h('div', {},
    summary(t('fontsCount', data.fonts.length)),
    data.fonts.map((font) => {
      const familyCss = `"${fontAlias(font.family)}", ${font.stack}`;
      const title = h('div', { class: 'wd-font-family' }, font.family);
      title.style.fontFamily = familyCss;
      return h('div', { class: 'wd-font-card' },
        h('div', { class: 'wd-font-head' }, title, h('span', { class: 'wd-muted' }, t('fontUses', font.count, font.styles.length))),
        h('code', { class: 'wd-font-stack', title: t('copyFontFamily'), onclick: () => copyText(`font-family: ${font.stack};`, t('toastFontFamilyCopied')) }, font.stack),
        font.faces.length > 0 && h('div', { class: 'wd-font-faces' }, font.faces.map((face) => {
          const source = bestSource(face);
          return source && h('div', { class: 'wd-font-face' },
            h('span', { class: 'wd-badge' }, `${face.weight}${face.style !== 'normal' ? ' ' + face.style : ''}`),
            h('a', { class: 'wd-link', href: source.url, target: '_blank', rel: 'noopener noreferrer', title: source.url }, S.fileName(source.url)),
            smallIconBtn(t('downloadFont'), 'download', () => downloadUrl(source.url, `${font.family}-${face.weight}`)));
        })),
        font.styles.map((style) => {
          const sample = h('div', { class: 'wd-font-sample' }, style.sample || t('fontSample'));
          Object.assign(sample.style, {
            fontFamily: familyCss,
            fontWeight: style.weight,
            fontStyle: style.style,
            fontSize: `${Math.min(parseFloat(style.size) || 16, 30)}px`
          });
          return h('div', { class: 'wd-font-style' },
            sample,
            h('div', { class: 'wd-font-meta' },
              h('span', { class: 'wd-num' }, `${style.weight} · ${style.size} / ${style.lineHeight}${style.style !== 'normal' ? ' · ' + style.style : ''} · ${style.count}×`),
              smallIconBtn(t('copyCss'), 'copy', () => copyText(fontCss(font, style), t('toastFontCssCopied')))));
        })
      );
    })
  );
}
