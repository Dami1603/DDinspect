// DDinspect - options page: color format, default asset scope, theme and the
// keyboard shortcut. Settings go to chrome.storage.local (the panel and the
// content script listen for changes); the theme lives in localStorage (theme.js).

const S = globalThis.DDinspectShared;
const t = S.t;

const flag = document.getElementById('saved-flag');
let flagTimer = null;

function showSaved() {
  flag.textContent = t('optSaved');
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => { flag.textContent = ''; }, 1600);
}

function check(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

async function init() {
  document.documentElement.lang = S.LOCALE;
  document.title = `DDinspect · ${t('optionsHeading')}`;
  S.localize();

  const settings = await S.loadSettings();
  check('colorFormat', settings.colorFormat);
  check('scope', settings.scope);
  check('theme', DDinspectTheme.pref());

  for (const name of ['colorFormat', 'scope']) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
      input.addEventListener('change', async () => {
        await S.saveSettings({ [name]: input.value });
        showSaved();
      });
    }
  }
  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.addEventListener('change', () => {
      DDinspectTheme.set(input.value);
      showSaved();
    });
  }

  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = (commands.find((c) => c.name === 'toggle-ddinspect') || {}).shortcut;
  document.getElementById('shortcut-text').textContent = shortcut ? t('optShortcutCurrent', shortcut) : t('shortcutNotSet');

  // Chrome has a shortcuts page; Firefox manages them from about:addons (no API to open it).
  const button = document.getElementById('shortcuts');
  if (globalThis.browser?.runtime?.getBrowserInfo) {
    button.replaceWith(Object.assign(document.createElement('p'), { textContent: t('optShortcutFirefox') }));
  } else {
    button.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  }
}

init();
