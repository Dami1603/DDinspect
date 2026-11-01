// DDinspect - i18n check.
// Lists every message key the extension uses (t('key') in scripts, data-i18n*
// attributes in pages, __MSG_key__ in the manifest, plus the keys built at run
// time listed below) and compares them with each _locales/*/messages.json.
// Exits with 1 when a locale misses a key or has keys nobody uses.
//
// Usage:  node tools/check-i18n.js

const fs = require('fs');
const path = require('path');

const ext = path.join(__dirname, '..', 'extension');

// Keys composed at run time: t(`group${name}`), t(`role_${id}`), t(filter.label)…
const DYNAMIC = [
  'groupLayout', 'groupBox', 'groupBorders', 'groupTypography', 'groupBackground', 'groupEffects',
  'role_all', 'role_text', 'role_background', 'role_border', 'role_svg', 'role_shadow', 'role_gradient',
  'filterAll', 'filterImg', 'filterCss', 'filterSvg', 'filterOther',
  'exportHtml', 'exportJsx', 'exportTailwind',
  'sourceStyleShadow', 'sourceStylePage', 'sourceFile'
];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '_locales' ? [] : files(p);
    return [p];
  });
}

const used = new Set(DYNAMIC);
for (const file of files(ext)) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.js')) {
    for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  } else if (file.endsWith('.html')) {
    for (const m of text.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  } else if (file.endsWith('.json')) {
    for (const m of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  }
}

let failed = false;
const localesDir = path.join(ext, '_locales');
const locales = fs.existsSync(localesDir) ? fs.readdirSync(localesDir) : [];
if (!locales.length) {
  console.log('No locales yet. Keys used:\n' + [...used].sort().join('\n'));
  process.exit(1);
}
for (const locale of locales) {
  const messages = JSON.parse(fs.readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8'));
  const keys = new Set(Object.keys(messages));
  const missing = [...used].filter((k) => !keys.has(k));
  const unused = [...keys].filter((k) => !used.has(k));
  const empty = [...keys].filter((k) => !messages[k].message);
  const dollar = [...keys].filter((k) => messages[k].message.includes('$'));
  console.log(`${locale}: ${keys.size} messages · missing ${missing.length} · unused ${unused.length} · empty ${empty.length}`);
  if (missing.length) console.log('  missing: ' + missing.join(', '));
  if (unused.length) console.log('  unused: ' + unused.join(', '));
  if (empty.length) console.log('  empty: ' + empty.join(', '));
  if (dollar.length) console.log('  contains $ (needs $$): ' + dollar.join(', '));
  if (missing.length || unused.length || empty.length || dollar.length) failed = true;
}
console.log(`${used.size} keys used in the code.`);
process.exit(failed ? 1 : 0);
