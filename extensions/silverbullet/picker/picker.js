// Folder / zip picker for the knowledge import (D59). It runs on the knowledge base's
// own origin, framed by the panel's Knowledge page, because the gateway refuses writes
// from another origin. Uppy picks and uploads (tus); this file only wires it and tells
// the panel which batch finished. The panel starts the workflow, never this page.
import {Uppy, Dashboard, Tus} from './uppy/uppy.min.mjs';

const query = new URLSearchParams(location.search);
const english = query.get('lang') === 'en';
const {default: locale} = await import(`./locales/${english ? 'en_US' : 'es_ES'}.js`);
const panel = location.origin.replace('//docs.', '//panel.');
// One batch per page load: the workflow imports the uploads that carry this id.
const batch = crypto.randomUUID();
// Folders bring files nobody means to import.
const noise = file => `/${file.meta.relativePath || file.name}`.split('/')
  .some(part => part.startsWith('.') || part === 'node_modules' || part === '__MACOSX');

const uppy = new Uppy({
  locale, autoProceed: true, meta: {batch},
  restrictions: {maxNumberOfFiles: 300, maxFileSize: 1024 ** 3},
  onBeforeFileAdded: file => !noise(file),
})
  .use(Dashboard, {
    inline: true, target: '#picker', width: '100%', height: 250,
    fileManagerSelectionType: 'both', proudlyDisplayPoweredByUppy: false,
    theme: query.get('theme') === 'dark' ? 'dark' : 'light',
  })
  .use(Tus, {endpoint: '/.kb/upload/', removeFingerprintOnSuccess: true});

const report = () => {
  const files = uppy.getFiles();
  const done = files.filter(file => file.progress.uploadComplete).length;
  parent.postMessage({type: 'fyso-kb-import', batch, files: done, pending: files.length - done}, panel);
};
for (const event of ['complete', 'file-removed', 'upload', 'cancel-all']) uppy.on(event, report);

// Change presentation without replacing the picker or its resumable-upload batch.
addEventListener('message', event => {
  if (event.source !== parent || event.origin !== panel ||
      event.data?.type !== 'fyso-kb-theme' || !['light', 'dark'].includes(event.data.theme)) return;
  uppy.getPlugin('Dashboard').setOptions({theme: event.data.theme});
});
parent.postMessage({type: 'fyso-kb-picker-ready'}, panel);
