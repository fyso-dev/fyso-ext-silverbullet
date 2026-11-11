const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const picker = path.resolve(__dirname, '../extensions/silverbullet/picker/picker.js');

for (const nativeUUID of [false, true]) {
  test(`picker initializes and reports a batch with randomUUID=${nativeUUID}`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-'));
    t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
    fs.mkdirSync(path.join(dir, 'uppy'));
    fs.mkdirSync(path.join(dir, 'locales'));
    fs.copyFileSync(picker, path.join(dir, 'picker.mjs'));
    fs.writeFileSync(path.join(dir, 'uppy/uppy.min.mjs'), `
      export const Dashboard = {}, Tus = {};
      export class Uppy {
        constructor(options) { this.options = options; this.events = {}; globalThis.uploaders.push(this); }
        use() { return this; }
        on(event, callback) { this.events[event] = callback; return this; }
        getFiles() { return [{progress:{uploadComplete:true}}, {progress:{uploadComplete:false}}]; }
      }
    `);
    fs.writeFileSync(path.join(dir, 'locales/en_US.js'), 'export default {};');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import {webcrypto} from 'node:crypto';
      let nativeCalls = 0;
      const crypto = {getRandomValues: bytes => webcrypto.getRandomValues(bytes)};
      if (${nativeUUID}) crypto.randomUUID = () => { nativeCalls++; return webcrypto.randomUUID(); };
      Object.defineProperty(globalThis, 'crypto', {value:crypto});
      globalThis.location = {origin:'http://docs.team.private.test:38600', search:'?lang=en'};
      globalThis.uploaders = [];
      const messages = [];
      globalThis.parent = {postMessage:(message, target) => messages.push({message, target})};
      globalThis.addEventListener = () => {};
      await import(${JSON.stringify(pathToFileURL(path.join(dir, 'picker.mjs')).href)} + '?first');
      await import(${JSON.stringify(pathToFileURL(path.join(dir, 'picker.mjs')).href)} + '?second');
      uploaders[0].events.complete();
      console.log(JSON.stringify({batches:uploaders.map(u => u.options.meta.batch), messages, nativeCalls}));
    `], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    for (const id of output.batches) assert.match(id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-)4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.notEqual(output.batches[0], output.batches[1]);
    assert.equal(output.nativeCalls, nativeUUID ? 2 : 0);
    assert.equal(output.messages.filter(m => m.message.type === 'fyso-kb-picker-ready').length, 2);
    assert.deepEqual(output.messages.at(-1), {target:'http://panel.team.private.test:38600',
      message:{type:'fyso-kb-import', batch:output.batches[0], files:1, pending:1}});
  });
}
