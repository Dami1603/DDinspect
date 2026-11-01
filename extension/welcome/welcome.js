// DDinspect - welcome page, opened once after install (background.js).

const S = globalThis.DDinspectShared;
const t = S.t;

async function init() {
  document.documentElement.lang = S.LOCALE;
  document.title = `DDinspect · ${t('welcomeHeading')}`;
  S.localize();

  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = (commands.find((c) => c.name === 'toggle-ddinspect') || {}).shortcut;
  document.getElementById('step2-text').textContent = shortcut ? t('welcomeStep2Text', shortcut) : t('welcomeStep2NoShortcut');
  document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

init();
