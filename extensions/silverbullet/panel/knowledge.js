// Knowledge page (extensions-contract §9): the SilverBullet editor inside the panel,
// with a short guide on how pages get there. No build step: panel SDK v1 as an ES module.
const sdk = await import(new URL('/assets/extension-sdk.js', location.origin).href);
const {mountExtensionPage, createElement: h, useState, useEffect, useRef, useTranslation, useStore, useDaguAction, ActionButton, ActionStatus, botRoster} = sdk;

const EXT = 'silverbullet';
const SKILL = '${FYSO_ROOT}/extensions/silverbullet/skills/project-knowledge/SKILL.md';
const FOLDER = 'project/wiki/';
const GUIDE_KEY = 'fyso.ext.silverbullet.guide';
const IMPORT_DAG = 'ext-silverbullet-import';
const BATCH = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const stored = () => { try { return localStorage.getItem(GUIDE_KEY); } catch { return null; } };

function Copy({text, code}) {
  const {t} = useTranslation();
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => {
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }, () => {});
  return h('div', {className: 'kb-copy'},
    h('span', null, code ? h('code', null, text) : text),
    h('button', {type: 'button', className: 'btn btn-sm btn-ghost', onClick: copy}, t(done ? 'kb.copied' : 'kb.copy')));
}

// Navigation happens in the panel that hosts this page (same origin, hash routes).
const panelLink = (hash, className, label, tip) =>
  h('a', {href: `/${hash}`, target: '_parent', className, ...(tip && {title: tip})}, label);

function Bots() {
  const {t} = useTranslation();
  const {rows, runtimeBots, mock} = useStore();
  // The same roster as the Bots screen: live OpenMausBot bots plus unapplied drafts.
  // A bot created natively has no team-file entry yet: it is imported first, on Bots.
  const roster = botRoster(rows, mock ? null : runtimeBots.data ?? null)
    .filter(r => r.configuration?.state !== 'deleted');
  if (!roster.length) return h('p', null, t('kb.ask.none'));
  return h('ul', {className: 'kb-bots'}, roster.map(({key, name, configuration}) => {
    let status;
    if (!configuration) status = panelLink('#/bots', 'btn btn-sm btn-soft', t('kb.ask.import'), t('kb.ask.importTip'));
    else {
      const {bot, state} = configuration;
      const on = bot.skillFiles.includes(SKILL);
      if (on && state === 'applied') status = h('span', {className: 'pill pill-ok'}, t('kb.ask.on'));
      else if (on) status = panelLink('#/bots/review', 'pill pill-warn', t('kb.ask.pending'), t('kb.ask.review'));
      else status = panelLink(`#/bots/${bot.index}?tab=perfil`, 'btn btn-sm btn-soft', t('kb.ask.give'), t('kb.ask.giveTip'));
    }
    return h('li', {key}, h('span', {className: 'name'}, name), status);
  }));
}

function Way({n, title, body, children}) {
  return h('section', {className: 'card kb-way'},
    h('h2', null, h('span', {className: 'kb-num', 'aria-hidden': 'true'}, n), title), h('p', null, body), children);
}

// Import with AI (D59): the picker (on the knowledge base's own origin) uploads a folder
// or zip and reports its batch; this page starts the workflow and shows what it wrote.
function Import({app, onReport, theme}) {
  const {t, i18n} = useTranslation();
  const {backend} = useStore();
  // loadLast: the last import's result and its report link survive a reload.
  const action = useDaguAction(backend, IMPORT_DAG, 'RESULT', {loadLast: true});
  const [upload, setUpload] = useState(null);
  const [round, setRound] = useState(0);
  const origin = new URL(app.url).origin;
  useEffect(() => {
    const listen = event => {
      const d = event.data;
      if (event.origin !== origin || d?.type !== 'fyso-kb-import' || !BATCH.test(d.batch)) return;
      setUpload({batch: d.batch, files: Number(d.files) || 0, pending: Number(d.pending) || 0});
    };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, [origin]);
  const lang = i18n.language?.startsWith('en') ? 'en' : 'es';
  const initialTheme = useRef(theme);
  const picker = useRef(null);
  useEffect(() => {
    const send = () => picker.current?.contentWindow?.postMessage({type: 'fyso-kb-theme', theme}, origin);
    const ready = event => {
      if (event.source === picker.current?.contentWindow && event.origin === origin &&
          event.data?.type === 'fyso-kb-picker-ready') send();
    };
    addEventListener('message', ready);
    send();
    return () => removeEventListener('message', ready);
  }, [theme, origin, round]);
  const running = action.phase === 'running';
  const ready = !!upload && upload.files > 0 && upload.pending === 0;
  const run = async () => {
    const result = await action.start({BATCH: upload.batch, LANG_UI: lang});
    // The workflow consumed the batch either way: a fresh picker, with a new one.
    setUpload(null);
    setRound(n => n + 1);
    if (result?.report) onReport(result.report);
  };
  const result = (action.phase === 'ok' || action.phase === 'idle') && action.output?.report && action.output;
  let status = h(ActionStatus, {action});
  if (!running && ready) status = h('span', {className: 'action-status', role: 'status'}, t('kb.import.ready', {count: upload.files}));
  else if (!running && upload?.pending) status = h('span', {className: 'action-status', role: 'status'}, t('kb.import.uploading'));
  else if (action.phase === 'never' || action.phase === 'loading') status = h('span', {className: 'action-status'}, t('kb.import.waiting'));
  return h('section', {className: 'card kb-import', 'aria-label': t('kb.import.title')},
    h('iframe', {key: round, ref: picker, className: 'kb-picker', title: t('kb.import.frame'),
      src: `${origin}/.kb/picker/index.html?lang=${lang}&theme=${initialTheme.current}`}),
    h('div', {className: 'kb-import-side'},
      h('h2', null, t('kb.import.title')),
      h('p', null, t('kb.import.lead')),
      h('p', {className: 'kb-privacy'}, t('kb.import.privacy')),
      h('div', {className: 'kb-import-run'},
        ready || running
          ? h(ActionButton, {action, label: t('kb.import.run'), busyLabel: t('kb.import.running'), onRun: run, primary: true})
          : h('button', {type: 'button', className: 'btn btn-sm btn-pri', disabled: true}, t('kb.import.run')),
        status),
      action.phase === 'failed' && h('p', {role: 'alert', className: 'action-error'},
        h('strong', null, action.error || t('kb.import.failed'))),
      result && h('p', {className: 'kb-result', role: 'status'},
        t('kb.import.done', {count: result.created.length}),
        result.conflicts.length > 0 && ` ${t('kb.import.conflicts', {count: result.conflicts.length})}`, ' ',
        h('button', {type: 'button', className: 'kb-link', onClick: () => onReport(result.report)}, t('kb.import.report')))));
}

function Page() {
  const {t} = useTranslation();
  const {apps} = useStore();
  const [guide, setGuide] = useState(() => stored() !== '0');
  const [importing, setImporting] = useState(false);
  // The page the editor shows. `n` changes on every request, so asking for the same
  // report again reloads the editor on it and brings it into view.
  const [page, setPage] = useState({path: '', n: 0});
  const open = path => setPage(p => ({path, n: p.n + 1}));
  useEffect(() => {
    if (page.n) document.querySelector('.kb-frame')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, [page.n]);
  const toggle = () => {
    try { localStorage.setItem(GUIDE_KEY, guide ? '0' : '1'); } catch { /* storage is optional */ }
    setGuide(!guide);
  };
  const app = apps.data?.find(a => a.id === EXT);
  const editor = useRef(null);
  const [theme, setTheme] = useState(() => document.documentElement.classList.contains('fy-dark') ? 'dark' : 'light');
  useEffect(() => {
    if (!app) return;
    const origin = new URL(app.url).origin;
    const send = () => {
      const styles = getComputedStyle(document.documentElement);
      const colors = Object.fromEntries(['surface', 'surface-2', 'bg', 'text', 'mute', 'line',
        'line-2', 'accent', 'accent-hover', 'accent-text', 'accent-soft', 'focus', 'scrim', 'warn', 'ok', 'down']
        .map(key => [key, styles.getPropertyValue(`--fy-${key}`).trim()]));
      const mode = document.documentElement.classList.contains('fy-dark') ? 'dark' : 'light';
      setTheme(mode);
      editor.current?.contentWindow?.postMessage({type: 'fyso-kb-theme', theme: mode, colors}, origin);
    };
    const ready = event => {
      if (event.origin === origin && event.source === editor.current?.contentWindow &&
          event.data?.type === 'fyso-kb-theme-ready') send();
    };
    addEventListener('message', ready);
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'style']});
    const frame = editor.current;
    frame?.addEventListener('load', send);
    send();
    return () => { removeEventListener('message', ready); observer.disconnect(); frame?.removeEventListener('load', send); };
  }, [app?.url, page.n]);
  const tabUrl = app && new URL(app.url);
  if (tabUrl) tabUrl.searchParams.set('theme', theme);
  document.title = t('kb.title');
  return h('main', {className: 'kb'},
    h('header', {className: 'kb-head'},
      h('div', {className: 'grow'}, h('h1', null, t('kb.title')), h('p', null, t('kb.lead'))),
      h('button', {type: 'button', className: 'btn btn-sm btn-soft', 'aria-expanded': guide, onClick: toggle},
        t(guide ? 'kb.guideHide' : 'kb.guideShow')),
      app && h('a', {className: 'btn btn-sm btn-soft', href: tabUrl.href, target: '_blank', rel: 'noreferrer'}, `${t('kb.openTab')} ↗`)),
    guide && h('div', {className: 'kb-guide'},
      h(Way, {n: 1, title: t('kb.write.title'), body: t('kb.write.body')}),
      h(Way, {n: 2, title: t('kb.ask.title'), body: t('kb.ask.body')}, h(Bots), h(Copy, {text: t('kb.ask.example')})),
      h(Way, {n: 3, title: t('kb.files.title'), body: t('kb.files.body')},
        app && h('button', {type: 'button', className: 'btn btn-sm btn-pri kb-import-open', 'aria-expanded': importing,
          onClick: () => setImporting(!importing)}, t(importing ? 'kb.import.close' : 'kb.import.open')),
        h(Copy, {text: FOLDER, code: true})),
      importing && app && h(Import, {app, onReport: open, theme}),
      h('p', {className: 'kb-note'}, t('kb.note'))),
    app ? h('iframe', {key: page.n, ref: editor, className: 'kb-frame', title: t('kb.frame'),
        src: page.path ? `${app.url.replace(/\/$/, '')}/${encodeURI(page.path)}` : app.url})
      : apps.status !== 'loading' && h('p', {className: 'kb-empty', role: 'alert'}, t('kb.unavailable')));
}

const messages = {};
for (const lang of ['es', 'en']) messages[lang] = await (await fetch(`./locales/${lang}.json`)).json();
void mountExtensionPage(Page, messages);
