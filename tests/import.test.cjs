// Glue steps of the knowledge import (D59): what may enter the agent's work directory
// and what may leave it. The secret scanner is stubbed; the live test uses the real one.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../extensions/silverbullet/import.cjs');
const BATCH = '11111111-2222-3333-4444-555555555555', OTHER = '99999999-2222-3333-4444-555555555555';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-import-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const bin = path.join(root, 'bin'), data = path.join(root, '.data/ext/silverbullet');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, 'project/wiki'), {recursive: true});
  fs.mkdirSync(path.join(data, 'uploads'), {recursive: true});
  fs.writeFileSync(path.join(bin, 'gitleaks'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  const step = (name, env = {}) => spawnSync(process.execPath, [script, name], {encoding: 'utf8',
    env: {PATH: `${bin}:${process.env.PATH}`, FYSO_ROOT: root, FYSO_DATA: path.join(root, '.data'), DAG_RUN_ID: 'run1', BATCH, ...env}});
  let n = 0;
  const upload = (meta, text, size) => {
    const id = `u${++n}`;
    fs.writeFileSync(path.join(data, 'uploads', id), text);
    fs.writeFileSync(path.join(data, 'uploads', `${id}.info`), JSON.stringify({ID: id, Size: size ?? Buffer.byteLength(text), MetaData: {batch: BATCH, ...meta}}));
  };
  return {root, data, wiki: path.join(root, 'project/wiki'), work: path.join(data, 'import/run1'), step, upload};
}

test('prepare takes only the batch, with safe names and readable files', t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.wiki, 'Decisiones.md'), '# Decisiones\n');
  p.upload({name: 'a.md', relativePath: 'docs/sub/a.md'}, '# A\n');
  p.upload({name: 'b.txt', relativePath: 'null'}, 'b\n');
  p.upload({name: 'evil.md', relativePath: '../../evil.md'}, 'x\n');
  p.upload({name: 'half.md'}, 'part', 4000);
  p.upload({name: 'tool.exe'}, 'MZ');
  p.upload({name: 'theirs.md', batch: OTHER}, 'not mine\n');
  const result = p.step('prepare');
  assert.equal(result.status, 0, result.stderr);
  const source = fs.readdirSync(path.join(p.work, 'source'), {recursive: true}).filter(f => /\.\w+$/.test(f)).sort();
  // A path that climbs out is ignored: the file lands under its plain name, inside the work directory.
  assert.deepEqual(source, ['b.txt', 'docs/sub/a.md', 'evil.md']);
  assert.ok(!fs.existsSync(path.join(p.root, 'evil.md')) && !fs.existsSync(path.join(p.data, 'evil.md')));
  assert.equal(fs.readFileSync(path.join(p.work, 'existing-pages.txt'), 'utf8'), 'Decisiones\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.work, 'prepared.json'))), {files: 3, skipped: ['half.md', 'tool.exe']});
  // Another batch stays for its own run.
  assert.deepEqual(fs.readdirSync(path.join(p.data, 'uploads')).sort(), ['u6', 'u6.info']);
});

test('prepare refuses a caller-made batch id and an empty batch', t => {
  const p = project(t);
  assert.match(p.step('prepare', {BATCH: '../x'}).stderr, /BATCH must be/);
  assert.match(p.step('prepare').stderr, /no uploads found/);
  assert.ok(!fs.existsSync(p.work));
});

test('prepare stops on a credential and cleanup drops the originals', t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.root, 'bin/gitleaks'), `#!/bin/sh\nfor a; do r="$a"; done\nprintf '[{"File":"%s/keys.md"}]' "$2" > "$r"\nexit 3\n`, {mode: 0o755});
  p.upload({name: 'keys.md'}, 'token\n');
  const result = p.step('prepare');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /possible credentials in: keys\.md/);
  assert.equal(p.step('cleanup').status, 0);
  assert.ok(!fs.existsSync(p.work));
});

test('gate accepts only Markdown pages', t => {
  const p = project(t);
  p.upload({name: 'a.md'}, '# A\n');
  assert.equal(p.step('prepare').status, 0);
  assert.match(p.step('gate').stderr, /wrote no pages/);
  fs.writeFileSync(path.join(p.work, 'out/A.md'), '# A\n');
  assert.equal(p.step('gate').status, 0);
  fs.writeFileSync(path.join(p.work, 'out/run.sh'), 'echo\n');
  assert.match(p.step('gate').stderr, /not pages: run\.sh/);
  fs.rmSync(path.join(p.work, 'out/run.sh'));
  fs.symlinkSync(path.join(p.root, 'bin/gitleaks'), path.join(p.work, 'out/Link.md'));
  assert.equal(p.step('gate').status, 0);
  assert.ok(!fs.existsSync(path.join(p.work, 'out/Link.md')), 'links are removed, never followed');
});

test('publish adds new pages, never overwrites, and reports', t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.wiki, 'index.md'), '# Home\n');
  fs.writeFileSync(path.join(p.wiki, 'Mine.md'), 'kept\n');
  p.upload({name: 'a.md'}, '# A\n');
  p.upload({name: 'tool.exe'}, 'MZ');
  assert.equal(p.step('prepare').status, 0);
  fs.mkdirSync(path.join(p.work, 'out/Topic'));
  fs.writeFileSync(path.join(p.work, 'out/Topic/New.md'), '# New\n');
  fs.writeFileSync(path.join(p.work, 'out/Mine.md'), 'replaced\n');
  fs.writeFileSync(path.join(p.work, 'notes.md'), '- tool.exe: not a document\n');
  const result = p.step('publish', {LANG_UI: 'en'});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.created, output.conflicts, output.skipped, output.files], [['Topic/New'], ['Mine'], ['tool.exe'], 1]);
  assert.match(output.report, /^Imports\/\d{4}-\d\d-\d\d \d{6}$/);
  assert.equal(fs.readFileSync(path.join(p.wiki, 'Mine.md'), 'utf8'), 'kept\n');
  assert.equal(fs.readFileSync(path.join(p.wiki, 'Topic/New.md'), 'utf8'), '# New\n');
  const report = fs.readFileSync(path.join(p.wiki, `${output.report}.md`), 'utf8');
  for (const part of ['- [[Topic/New]]', '- [[Mine]]', '- tool.exe', 'not a document']) assert.ok(report.includes(part), part);
  assert.equal(fs.readFileSync(path.join(p.wiki, 'Imports.md'), 'utf8').match(/\[\[Imports\//g).length, 1);
  assert.equal(fs.readFileSync(path.join(p.wiki, 'index.md'), 'utf8'), '# Home\n\n- [[Imports]]\n');
  assert.ok(!fs.existsSync(p.work), 'the work directory is removed');
});
