// Glue steps of `ext-silverbullet-import` (D59). The AI agent only ever sees a private
// work directory; these steps decide what goes in (prepare) and what comes out (gate,
// publish). They run from the project checkout, so the agent cannot change them.
//   prepare   uploads of one batch -> work/source (unzip, convert, secret scan, limits)
//   gate      work/out must hold only safe Markdown pages
//   publish   copy new pages into project/wiki, never overwrite, write the report page
//   cleanup   on failure: drop the uploaded originals
// Env: FYSO_ROOT, FYSO_DATA, DAG_RUN_ID, BATCH, LANG_UI. Tools from mise: extract-zip,
// pandoc, gitleaks.
const fs = require('node:fs'), path = require('node:path');
const {spawnSync} = require('node:child_process');

const TEXT = new Set(['md', 'markdown', 'txt', 'text', 'rst', 'org', 'adoc', 'csv', 'tsv', 'json', 'yaml', 'yml']);
const CONVERT = new Set(['docx', 'odt', 'rtf', 'epub', 'html', 'htm']);
const KEEP = new Set(['pdf']);            // not converted here; the agent reads it when its engine can
const LIMITS = {files: 200, sourceBytes: 4 * 1024 * 1024, pages: 300, pageBytes: 200 * 1024};
const NOISE = part => part.startsWith('.') || part === 'node_modules' || part === '__MACOSX';
const TEXTS = {
  es: {index: 'Importaciones', title: 'Importación', lead: n => `Páginas escritas por IA a partir de ${n} archivo(s) subidos. Revísalas antes de confiar en ellas.`,
    pages: 'Páginas nuevas', conflicts: 'No importadas: ya existía una página con ese nombre', skipped: 'Archivos no leídos', notes: 'Notas del agente',
    indexLead: 'Cada importación deja aquí su informe.'},
  en: {index: 'Imports', title: 'Import', lead: n => `Pages written by AI from ${n} uploaded file(s). Review them before relying on them.`,
    pages: 'New pages', conflicts: 'Not imported: a page with that name already existed', skipped: 'Files not read', notes: 'Agent notes',
    indexLead: 'Every import leaves its report here.'},
};

const fail = message => { console.error(`error: ${message}`); process.exit(1); };
const env = name => process.env[name] || fail(`${name} is not set`);
const root = env('FYSO_ROOT'), data = path.join(env('FYSO_DATA'), 'ext/silverbullet');
const run = env('DAG_RUN_ID');
if (!/^[A-Za-z0-9_-]{1,80}$/.test(run)) fail('unexpected run id');
const work = path.join(data, 'import', run), source = path.join(work, 'source'), out = path.join(work, 'out');
const wiki = path.join(root, 'project/wiki');
const ext = file => path.extname(file).slice(1).toLowerCase();

/** Regular files below dir, as relative POSIX paths. Symbolic links are removed, never followed. */
function walk(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), {withFileTypes: true})) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name, full = path.join(dir, rel);
    if (entry.isSymbolicLink() || NOISE(entry.name)) fs.rmSync(full, {recursive: true, force: true});
    else if (entry.isDirectory()) files.push(...walk(dir, rel));
    else if (entry.isFile()) files.push(rel);
    else fs.rmSync(full, {force: true});
  }
  return files.sort();
}
/** A client-supplied name as a safe relative path, or null. */
function safe(name) {
  if (typeof name !== 'string' || !name || name === 'null' || name === 'undefined') return null;
  const parts = name.replace(/[\u0000-\u001f]/g, '').split(/[\\/]+/).filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || NOISE(part))) return null;
  return parts.join('/');
}
function tool(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', ...options});
  if (result.error) fail(`${command} is not available: run mise install`);
  return result;
}
/** Paths (relative to dir) where gitleaks sees a credential. Values are never printed. */
function secrets(dir) {
  const report = path.join(work, 'gitleaks.json');
  const result = tool('gitleaks', ['dir', dir, '--no-banner', '--redact', '--exit-code', '3', '-f', 'json', '-r', report], {stdio: 'ignore'});
  if (result.status === 0) return [];
  if (result.status !== 3) fail('the secret scan could not run');
  const found = JSON.parse(fs.readFileSync(report, 'utf8')).map(finding => path.relative(dir, finding.File));
  fs.rmSync(report, {force: true});
  return [...new Set(found)].sort();
}

function prepare() {
  const batch = env('BATCH');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(batch)) fail('BATCH must be the id of an upload batch');
  if (fs.existsSync(work)) fail('this run was already prepared');
  const uploads = path.join(data, 'uploads');
  // Uploads nobody converted do not pile up: a day later they are dropped.
  for (const name of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
    const file = path.join(uploads, name);
    if (Date.now() - fs.statSync(file).mtimeMs > 24 * 3600 * 1000) fs.rmSync(file, {recursive: true, force: true});
  }
  const mine = (fs.existsSync(uploads) ? fs.readdirSync(uploads) : []).filter(name => name.endsWith('.info')).map(name => {
    try { return {name, info: JSON.parse(fs.readFileSync(path.join(uploads, name), 'utf8'))}; } catch { return null; }
  }).filter(upload => upload?.info?.MetaData?.batch === batch);
  if (!mine.length) fail('no uploads found for this batch');
  fs.mkdirSync(source, {recursive: true});
  fs.mkdirSync(out);
  const skipped = [];
  for (const {name, info} of mine) {
    const file = path.join(uploads, name.slice(0, -'.info'.length));
    const rel = safe(info.MetaData.relativePath) || safe(info.MetaData.name) || safe(info.MetaData.filename);
    const complete = fs.existsSync(file) && fs.statSync(file).size === info.Size;
    if (rel && complete && !fs.existsSync(path.join(source, rel))) {
      fs.mkdirSync(path.dirname(path.join(source, rel)), {recursive: true});
      fs.renameSync(file, path.join(source, rel));
    } else {
      skipped.push(rel || '(unnamed upload)');
      fs.rmSync(file, {force: true});
    }
    fs.rmSync(path.join(uploads, name), {force: true});
  }
  // Zip archives: extract-zip refuses entries that leave the target directory.
  for (const rel of walk(source).filter(file => ext(file) === 'zip')) {
    const target = path.join(source, rel.slice(0, -'.zip'.length));
    if (fs.existsSync(target) || tool('extract-zip', [path.join(source, rel), target], {stdio: 'ignore'}).status !== 0) skipped.push(rel);
    fs.rmSync(path.join(source, rel), {force: true});
  }
  let converted = 0;
  for (const rel of walk(source)) {
    const full = path.join(source, rel), kind = ext(rel);
    if (TEXT.has(kind) || KEEP.has(kind)) continue;
    if (CONVERT.has(kind) && !fs.existsSync(`${full}.md`) &&
        tool('pandoc', [full, '-t', 'gfm', '--wrap=none', '-o', `${full}.md`], {stdio: 'ignore'}).status === 0) converted++;
    else skipped.push(rel);
    fs.rmSync(full, {force: true});
  }
  const files = walk(source);
  if (!files.length) fail('nothing readable was uploaded (Markdown, text, Word, OpenDocument, HTML, EPUB, RTF, PDF)');
  if (files.length > LIMITS.files) fail(`${files.length} files: this import takes up to ${LIMITS.files}; import a smaller folder`);
  const bytes = files.filter(file => !KEEP.has(ext(file))).reduce((sum, file) => sum + fs.statSync(path.join(source, file)).size, 0);
  if (bytes > LIMITS.sourceBytes) fail(`${Math.ceil(bytes / 1048576)} MB of text: this import takes up to ${LIMITS.sourceBytes / 1048576} MB; import a smaller folder`);
  const leaks = secrets(source);
  if (leaks.length) fail(`possible credentials in: ${leaks.join(', ')}. Remove them and upload again`);
  const existing = fs.existsSync(wiki) ? walk(wiki).filter(file => ext(file) === 'md').map(file => file.slice(0, -3)) : [];
  fs.writeFileSync(path.join(work, 'existing-pages.txt'), existing.join('\n') + '\n');
  fs.writeFileSync(path.join(work, 'prepared.json'), JSON.stringify({files: files.length, skipped}));
  console.log(`${files.length} file(s) ready, ${converted} converted, ${skipped.length} skipped`);
}

/** The agent's pages, validated. A denied or empty run exits 0, so the result is checked here. */
function pages() {
  if (!fs.existsSync(out)) fail('the work directory is missing');
  const files = walk(out), bad = files.filter(file => ext(file) !== 'md' || !safe(file) || /[<>:"|?*#[\]]/.test(file));
  if (bad.length) fail(`the agent wrote files that are not pages: ${bad.slice(0, 5).join(', ')}`);
  if (!files.length) fail('the agent wrote no pages');
  if (files.length > LIMITS.pages) fail(`the agent wrote ${files.length} pages; the limit is ${LIMITS.pages}`);
  const big = files.filter(file => fs.statSync(path.join(out, file)).size > LIMITS.pageBytes);
  if (big.length) fail(`pages too large: ${big.slice(0, 5).join(', ')}`);
  return files;
}
function gate() {
  const files = pages(), leaks = secrets(out);
  if (leaks.length) fail(`possible credentials in the written pages: ${leaks.join(', ')}`);
  console.log(`${files.length} page(s) pass`);
}

function publish() {
  const files = pages(), t = TEXTS[process.env.LANG_UI === 'en' ? 'en' : 'es'];
  const prepared = JSON.parse(fs.readFileSync(path.join(work, 'prepared.json'), 'utf8'));
  const created = [], conflicts = [];
  for (const rel of files) {
    const target = path.join(wiki, rel);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    try {
      fs.copyFileSync(path.join(out, rel), target, fs.constants.COPYFILE_EXCL);
      created.push(rel.slice(0, -3));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      conflicts.push(rel.slice(0, -3));
    }
  }
  // Local time, as "2026-11-10 093012": sortable and valid in a file name.
  const now = new Date(), two = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const report = `${t.index}/${stamp}`, list = (title, items, link) => items.length
    ? [`## ${title}`, '', ...items.map(item => link ? `- [[${item}]]` : `- ${item}`), ''] : [];
  const notesFile = path.join(work, 'notes.md');
  const notes = fs.existsSync(notesFile) && !fs.lstatSync(notesFile).isSymbolicLink()
    ? fs.readFileSync(notesFile, 'utf8').slice(0, 20000).trim() : '';
  const body = [`# ${t.title} ${stamp}`, '', t.lead(prepared.files), '',
    ...list(t.pages, created, true), ...list(t.conflicts, conflicts, true), ...list(t.skipped, prepared.skipped, false),
    ...(notes ? [`## ${t.notes}`, '', notes, ''] : [])].join('\n');
  fs.mkdirSync(path.join(wiki, t.index), {recursive: true});
  fs.writeFileSync(path.join(wiki, `${report}.md`), body, {flag: 'wx'});
  const index = path.join(wiki, `${t.index}.md`);
  if (!fs.existsSync(index)) fs.writeFileSync(index, `# ${t.index}\n\n${t.indexLead}\n\n`);
  fs.appendFileSync(index, `- [[${report}]]\n`);
  // One link from the home page, added once, so imports are reachable.
  const home = path.join(wiki, 'index.md');
  if (fs.existsSync(home) && !fs.readFileSync(home, 'utf8').includes(`[[${t.index}]]`)) fs.appendFileSync(home, `\n- [[${t.index}]]\n`);
  fs.rmSync(work, {recursive: true, force: true});
  console.log(JSON.stringify({report, created, conflicts, skipped: prepared.skipped, files: prepared.files}));
}

// Uploaded originals never outlive a failed run; the written pages stay for inspection.
function cleanup() {
  fs.rmSync(source, {recursive: true, force: true});
  if (!fs.existsSync(out) || !walk(out).length) fs.rmSync(work, {recursive: true, force: true});
}

const steps = {prepare, gate, publish, cleanup};
(steps[process.argv[2]] || (() => fail('usage: import.cjs prepare|gate|publish|cleanup')))();
