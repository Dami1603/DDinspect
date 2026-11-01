// DDinspect - unit checks for the pure helpers in extension/shared/ddinspect-shared.js
// (color formats, WCAG contrast, cascade / overridden declarations, JSON import).
// Runs the file in a sandbox with a minimal fake `chrome`.
//
// Usage:  node tools/test-shared.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'shared', 'ddinspect-shared.js'), 'utf8');
const sandbox = { chrome: { i18n: { getUILanguage: () => 'en', getMessage: () => '' } } };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const S = sandbox.DDinspectShared;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

// --- Colors ---------------------------------------------------------------

test('formatColor hex / rgb / hsl', () => {
  assert.strictEqual(S.formatColor('#7c4dff', 'hex'), '#7c4dff');
  assert.strictEqual(S.formatColor('#7c4dff', 'rgb'), 'rgb(124, 77, 255)');
  assert.strictEqual(S.formatColor('#7c4dff80', 'rgb'), 'rgba(124, 77, 255, 0.5)');
  assert.strictEqual(S.formatColor('#ff0000', 'hsl'), 'hsl(0, 100%, 50%)');
  assert.strictEqual(S.formatColor('#808080', 'hsl'), 'hsl(0, 0%, 50%)');
});

test('formatColor oklch matches reference values', () => {
  // CSS Color 4 reference: red = oklch(62.8% 0.2577 29.23), white = oklch(100% 0 0).
  assert.strictEqual(S.formatColor('#ff0000', 'oklch'), 'oklch(62.8% 0.258 29.2)');
  assert.strictEqual(S.formatColor('#ffffff', 'oklch'), 'oklch(100% 0 0)');
  assert.strictEqual(S.formatColor('#000000', 'oklch'), 'oklch(0% 0 0)');
});

test('contrast ratio known pairs', () => {
  assert.strictEqual(S.contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(2), '21.00');
  assert.strictEqual(S.contrastRatio([255, 255, 255], [255, 255, 255]).toFixed(2), '1.00');
  // #767676 on white is the classic "just passes AA" grey: 4.54:1.
  assert.strictEqual(S.contrastRatio([0x76, 0x76, 0x76], [255, 255, 255]).toFixed(2), '4.54');
  // #777777 on white just fails: 4.48:1.
  assert.strictEqual(S.contrastRatio([0x77, 0x77, 0x77], [255, 255, 255]).toFixed(2), '4.48');
});

test('wcagLevel thresholds and large text', () => {
  assert.strictEqual(S.wcagLevel(4.54, false), 'AA');
  assert.strictEqual(S.wcagLevel(4.48, false), 'fail');
  assert.strictEqual(S.wcagLevel(4.48, true), 'AA');
  assert.strictEqual(S.wcagLevel(7.1, false), 'AAA');
  assert.strictEqual(S.wcagLevel(2.9, true), 'fail');
  assert.strictEqual(S.isLargeText(24, 400), true);
  assert.strictEqual(S.isLargeText(19, 700), true);
  assert.strictEqual(S.isLargeText(19, 400), false);
});

test('blend half-transparent black over white', () => {
  assert.deepStrictEqual(Array.from(S.blend([0, 0, 0, 0.5], [255, 255, 255, 1])), [127.5, 127.5, 127.5, 1]);
});

// --- Cascade --------------------------------------------------------------

const rule = (selector, spec, order, decls, extra = {}) => ({
  selector, specificity: spec, order, pseudo: null, layer: null,
  source: { type: 'file', url: 'a.css', label: 'a.css' },
  declarations: decls.map(([prop, value, important]) => ({ prop, value, important: !!important })),
  ...extra
});

test('higher specificity overrides lower', () => {
  const rules = [rule('#a', [1, 0, 0], 1, [['color', 'red']]), rule('.a', [0, 1, 0], 2, [['color', 'blue'], ['margin', '0']])];
  const f = S.overriddenFlags(rules);
  assert.deepStrictEqual(f.map((r) => Array.from(r)), [[false], [true, false]]);
});

test('later rule wins on equal specificity', () => {
  const rules = [rule('.b', [0, 1, 0], 5, [['color', 'red']]), rule('.a', [0, 1, 0], 2, [['color', 'blue']])];
  assert.deepStrictEqual(S.overriddenFlags(rules).map((r) => Array.from(r)), [[false], [true]]);
});

test('!important beats specificity, inline beats normal', () => {
  const inline = rule('element.style', null, -1, [['color', 'green']], { source: { type: 'inline', url: null, label: 'x' } });
  const imp = rule('.a', [0, 1, 0], 1, [['color', 'red', true], ['padding', '1px']]);
  const id = rule('#a', [1, 0, 0], 2, [['padding', '2px']]);
  const f = S.overriddenFlags([inline, id, imp]).map((r) => Array.from(r));
  assert.deepStrictEqual(f, [[true], [false], [false, true]]);
});

test('shorthand overrides longhands, not the other way round', () => {
  const rules = [rule('#a', [1, 0, 0], 1, [['padding', '4px']]), rule('.a', [0, 1, 0], 2, [['padding-top', '8px'], ['border-top-left-radius', '2px']])];
  const f = S.overriddenFlags(rules).map((r) => Array.from(r));
  assert.deepStrictEqual(f, [[false], [true, false]]);
  // A stronger longhand only partly overrides the shorthand: the shorthand stays.
  const g = S.overriddenFlags([rule('#a', [1, 0, 0], 1, [['padding-top', '8px']]), rule('.a', [0, 1, 0], 2, [['padding', '4px']])]).map((r) => Array.from(r));
  assert.deepStrictEqual(g, [[false], [false]]);
});

test('border does not override border-radius', () => {
  assert.strictEqual(S.covers('border', 'border-top-left-radius'), false);
  assert.strictEqual(S.covers('border-radius', 'border-top-left-radius'), true);
  assert.strictEqual(S.covers('border', 'border-top-color'), true);
  assert.strictEqual(S.covers('flex', 'flex-direction'), false);
  assert.strictEqual(S.covers('font', 'line-height'), true);
});

test('unlayered beats layered; !important flips layers', () => {
  const layered = rule('#a', [1, 0, 0], 1, [['color', 'red'], ['margin', '1px', true]], { layer: 'base' });
  const plain = rule('.a', [0, 1, 0], 2, [['color', 'blue'], ['margin', '2px', true]]);
  const f = S.overriddenFlags([layered, plain]).map((r) => Array.from(r));
  assert.deepStrictEqual(f, [[true, false], [false, true]]);
});

test('pseudo-element rules do not override the element', () => {
  const before = rule('.a::before', [0, 1, 1], 9, [['color', 'red']], { pseudo: '::before' });
  const el = rule('.a', [0, 1, 0], 1, [['color', 'blue']]);
  assert.deepStrictEqual(S.overriddenFlags([before, el]).map((r) => Array.from(r)), [[false], [false]]);
});

// --- Import ---------------------------------------------------------------

const sample = {
  id: 'abc', selector: 'div.card', tag: 'div', label: 'div.card', name: 'Card', savedAt: 1700000000000,
  thumbnail: 'data:image/jpeg;base64,AAAA',
  page: { url: 'https://example.com/', title: 'Example' },
  rect: { x: 0, y: 0, width: 100, height: 50, pageX: 0, pageY: 0 },
  box: { margin: [0, 0, 0, 0], border: [1, 1, 1, 1], padding: [8, 8, 8, 8], content: { width: 82, height: 32 }, boxSizing: 'border-box', display: 'block', position: 'static' },
  rules: [rule('.card', [0, 1, 0], 1, [['color', 'red']])],
  blockedSheets: [],
  computed: { groups: { Layout: [['display', 'block']] }, all: { display: 'block' } },
  resources: [],
  composition: { ancestors: ['body'], children: [], childCount: 0, descendantCount: 0, text: 'Hi', attributes: [['class', 'card']], html: '<div class="card">Hi</div>', htmlTruncated: false }
};

test('import keeps valid items and rejects broken ones', () => {
  const res = S.parseImport([sample, { id: 'x' }, null, { ...sample, id: 'def', rect: { width: 'wide' } }]);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.rejected, 3);
  assert.strictEqual(res.items[0].rules[0].declarations[0].prop, 'color');
});

test('import accepts { items } and drops remote thumbnails', () => {
  const res = S.parseImport({ items: [{ ...sample, thumbnail: 'https://evil.example/pixel.png' }] });
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].thumbnail, null);
});

test('import rejects anything that is not an export', () => {
  assert.strictEqual(S.parseImport({ hello: 1 }), null);
  assert.strictEqual(S.parseImport('text'), null);
});

test('round trip: export JSON → import gives the same rendering fields', () => {
  const res = S.parseImport(JSON.parse(JSON.stringify([sample])));
  const item = res.items[0];
  for (const key of ['id', 'selector', 'tag', 'name', 'savedAt', 'thumbnail']) assert.strictEqual(item[key], sample[key]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(item.box)), sample.box);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(item.composition)), sample.composition);
});

test('buildCss marks overridden declarations', () => {
  const info = { ...sample, rules: [rule('#a', [1, 0, 0], 1, [['color', 'red']]), rule('.a', [0, 1, 0], 2, [['color', 'blue']])] };
  const css = S.buildCss(info);
  assert.ok(css.includes('color: blue; /* overridden */'));
  assert.ok(!css.includes('color: red; /* overridden */'));
});

console.log(`${passed} checks passed${process.exitCode ? ', some failed' : ''}`);
