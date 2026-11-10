// Real SilverBullet + Caddy + built Fyso panel; synthetic panel configuration only.
// Requires Playwright and the pinned runtime tools on PATH. No user services are used.
const {chromium} = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const net = require('node:net');
const framework = process.env.FYSO_TEST_FRAMEWORK_ROOT;
if (!framework) throw Error('Set FYSO_TEST_FRAMEWORK_ROOT to the matching framework checkout');
const extension = path.resolve(__dirname, '../extensions/silverbullet');
const evidence = path.resolve(__dirname, '../docs/evidence/panel-theme');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fyso-sb-theme-'));
const children = [];
const port = () => new Promise(resolve => {const s = net.createServer(); s.listen(0, '127.0.0.1', () => {const p=s.address().port;s.close(()=>resolve(p));});});
(async () => {
  let browser;
  try {
    const gateway = await port(), service = await port();
    const base = `http://panel.localhost:${gateway}`, docs = `http://docs.localhost:${gateway}`;
    const panel = path.join(tmp, 'framework/panel');
    fs.cpSync(path.join(framework, 'template/framework/panel/dist'), path.join(panel, 'dist'), {recursive:true});
    fs.cpSync(path.join(framework, 'template/framework/panel/src/assets/fonts'), path.join(panel, 'src/assets/fonts'), {recursive:true});
    fs.cpSync(extension,path.join(tmp,'extensions/silverbullet'),{recursive:true});
    fs.mkdirSync(path.join(tmp,'project/wiki'),{recursive:true});
    const initial='# Theme acceptance\n\nSynthetic content for visual verification.\n\n## Shared knowledge\n\nA [[Linked page]] and `inline code`.\n\n- Read before editing\n- Keep the existing editor\n';
    fs.writeFileSync(path.join(tmp,'project/wiki/index.md'),initial);
    const data=path.join(tmp,'.data/ext/silverbullet');
    fs.mkdirSync(data,{recursive:true});
    for(const [tool,pattern,name] of [['npm:uppy','**/node_modules/uppy/dist','uppy'],['npm:@uppy/locales','**/node_modules/@uppy/locales/lib','uppy-locales']]) {
      const installed=execFileSync('mise',['where',tool],{encoding:'utf8'}).trim();
      const directory=[...fs.globSync(path.join(installed,pattern))][0];
      assert.ok(directory,`${tool} assets installed`);
      fs.symlinkSync(directory,path.join(data,name));
    }
    fs.writeFileSync(path.join(tmp,'extensions/silverbullet/panel/raw.html'),'<p>Plain HTML extension</p>');
    const env={...process.env,FYSO_ROOT:tmp,FYSO_DATA:path.join(tmp,'.data'),FYSO_WEB_DOMAIN:'localhost',FYSO_HTTP_PORT:String(gateway),FYSO_EXT_SILVERBULLET_PORT:String(service)};
    const launch=(command,args)=> {const log=fs.openSync(path.join(tmp,`${command}.log`),'w');const p=spawn(command,args,{cwd:tmp,env,stdio:['ignore',log,log]});fs.closeSync(log);children.push(p);};
    const hash=execFileSync('caddy',['hash-password','--plaintext','fixture'],{encoding:'utf8'}).trim();
    fs.writeFileSync(path.join(tmp,'Caddyfile'),`{\n admin off\n auto_https off\n default_bind 127.0.0.1\n}\n(fyso_login) {\n basic_auth {\n fixture ${hash}\n }\n}\nimport extensions/silverbullet/Caddyfile\nhttp://panel.localhost:${gateway} {\n import fyso_login\n handle_path /extensions/silverbullet/panel/* {\n root * ${tmp}/extensions/silverbullet/panel\n file_server\n }\n handle {\n root * ${panel}/dist\n try_files {path} /index.html\n file_server\n }\n}\n`);
    launch('bash',['extensions/silverbullet/start.sh']);
    launch('caddy',['run','--config','Caddyfile','--adapter','caddyfile']);
    browser=await chromium.launch({headless:true});
    const anonymous=await browser.newContext();
    for(let i=0;i<100;i++) {try {if((await anonymous.request.get(`${docs}/.kb/theme/editor.css`)).status()===401)break;}catch{} if(i===99)throw Error('Gateway did not start');await new Promise(r=>setTimeout(r,100));}
    for(const asset of ['editor.css','editor.js','fonts/Gilroy-Regular.woff2']) assert.equal((await anonymous.request.get(`${docs}/.kb/theme/${asset}`)).status(),401);
    await anonymous.close();
    const ctx=await browser.newContext({httpCredentials:{username:'fixture',password:'fixture'},viewport:{width:1440,height:1000},locale:'es-AR',colorScheme:'light'});
    await ctx.route(`${base}/config/**`,route=>{
      const name=new URL(route.request().url()).pathname.split('/').pop();
      const values={
        'project.json':{name:'Theme acceptance',slug:'theme-test',env:'local',urls:{dagu:base,omb:base}},
        'apps.json':[{id:'silverbullet',name:'SilverBullet',description:'Knowledge',icon:'book-open',url:docs,group:'extension',enabled:true}],
        'extensions.json':[{id:'silverbullet',src:'fixture',version:null,apps:['silverbullet'],secrets:[],mcpServers:[],workflows:[],skills:[],pages:[{id:'knowledge',name:'Conocimiento',url:'/extensions/silverbullet/panel/index.html'},{id:'raw',name:'Raw',url:'/extensions/silverbullet/panel/raw.html'}]}],
        'team.yaml':'bots: []\n','bot-versioning.json':{bots:[]},'observability.json':{}
      };
      return route.fulfill({status:200,contentType:name==='team.yaml'?'text/yaml':'application/json',body:typeof values[name]==='string'?values[name]:JSON.stringify(values[name]||{})});
    });
    await ctx.route(`${base}/api/**`,route=>route.fulfill({status:404,body:'fixture: no workflow execution'}));
    const page=await ctx.newPage(), errors=[], consoleErrors=[];
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push({text:message.text(),url:message.location().url});});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/?lang=es#/extensions/silverbullet/knowledge');
    const kb=page.frameLocator('iframe[title="Conocimiento"]');
    const editor=kb.frameLocator('.kb-frame');
    await editor.locator('.cm-content').filter({hasText:'Theme acceptance'}).waitFor({timeout:30000});
    await editor.locator('html[data-fyso-theme="light"][style*="--fy-surface"]').waitFor();
    const color=()=>editor.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--root-background-color').trim());
    assert.match(await color(),/^#fff(?:fff)?$/);
    await editor.locator('body').evaluate(()=>document.fonts.ready);
    assert.match(await editor.locator('.cm-content').evaluate(el=>getComputedStyle(el).fontFamily),/Gilroy/);
    fs.mkdirSync(evidence,{recursive:true});
    await page.screenshot({animations:'disabled',path:path.join(evidence,'light.png')});
    await kb.getByRole('button',{name:'Importar con IA',exact:true}).click();
    const picker=kb.frameLocator('.kb-picker');
    await picker.locator('.uppy-Dashboard[data-uppy-theme="light"]').waitFor();
    const pickerFrame=page.frames().find(f=>f.url().includes('/.kb/picker/index.html'));
    await pickerFrame.evaluate(()=>{window.themeAcceptanceMarker='upload-retained';});
    // Both iframe windows and editor state must survive a host theme switch.
    const before=page.frames().find(f=>f.url().startsWith(docs)&&!f.url().includes('/.kb/'));
    await before.evaluate(()=>{window.themeAcceptanceMarker='retained';});
    await page.getByRole('button',{name:'Cambiar a tema oscuro',exact:true}).click();
    await editor.locator('html[data-fyso-theme="dark"]').waitFor();
    assert.equal(await color(),'#1a1920');
    await picker.locator('.uppy-Dashboard[data-uppy-theme="dark"]').waitFor();
    assert.equal(await pickerFrame.evaluate(()=>window.themeAcceptanceMarker),'upload-retained');
    assert.equal(await before.evaluate(()=>window.themeAcceptanceMarker),'retained');
    await page.screenshot({animations:'disabled',path:path.join(evidence,'import-dark.png')});
    await kb.getByRole('button',{name:'Cerrar importación',exact:true}).click();
    await page.screenshot({animations:'disabled',path:path.join(evidence,'dark.png')});
    // Wrong-origin and wrong-source messages cannot change editor presentation.
    await before.evaluate(()=>dispatchEvent(new MessageEvent('message',{origin:'https://foreign.invalid',source:parent,data:{type:'fyso-kb-theme',theme:'light'}})));
    await before.evaluate(origin=>dispatchEvent(new MessageEvent('message',{origin,source:window,data:{type:'fyso-kb-theme',theme:'light'}})),base);
    assert.equal(await editor.locator('html').getAttribute('data-fyso-theme'),'dark');
    // Native editing and command picker remain available.
    await editor.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nTheme edit acceptance');
    await page.keyboard.press('Control+s');
    for(let i=0;i<100;i++) {if(fs.readFileSync(path.join(tmp,'project/wiki/index.md'),'utf8').includes('Theme edit acceptance'))break;if(i===99)throw Error('Native edit was not saved');await new Promise(r=>setTimeout(r,100));}
    await page.keyboard.press(process.platform==='darwin'?'Meta+/':'Control+/');
    await editor.locator('.sb-modal').waitFor();
    await page.screenshot({animations:'disabled',path:path.join(evidence,'command-picker.png')});
    await page.keyboard.press('Escape');
    const [tab]=await Promise.all([ctx.waitForEvent('page'),kb.getByRole('link',{name:/Abrir.*pestaña/}).click()]);
    await tab.locator('.cm-content').filter({hasText:'Theme acceptance'}).waitFor();
    await tab.locator('html[data-fyso-theme="dark"]').waitFor();
    await tab.screenshot({animations:'disabled',path:path.join(evidence,'standalone.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({animations:'disabled',path:path.join(evidence,'mobile.png')});
    assert.equal(await editor.locator('html').evaluate(el=>el.scrollWidth<=innerWidth),true);
    for(const asset of ['editor.css','editor.js','fonts/Gilroy-Regular.woff2'])assert.equal((await ctx.request.get(`${docs}/.kb/theme/${asset}`)).status(),200);
    // Non-SDK HTML extensions retain the previous query-string theme contract.
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(base+'/?lang=es#/extensions/silverbullet/raw');
    const raw=page.frameLocator('iframe[title="Raw"]');
    await raw.getByText('Plain HTML extension').waitFor();
    await raw.locator('body').evaluate(()=>{window.rawMarker=true;});
    await page.getByRole('button',{name:'Cambiar a tema claro',exact:true}).click();
    await page.locator('iframe[title="Raw"][src*="theme=light"]').waitFor();
    await raw.getByText('Plain HTML extension').waitFor();
    assert.equal(await raw.locator('body').evaluate(()=>window.rawMarker),undefined);
    assert.deepEqual(errors,[]);
    assert.deepEqual(consoleErrors.filter(e=>!((e.url.startsWith(base+'/api/') && e.text.includes('404')) || (e.url===docs+'/' && e.text.includes('401')) || (e.url===docs+'/.fs/CONFIG.md' && e.text.includes('404')) || (e.url.startsWith(docs+'/.client/') && e.text.includes('Blocked autofocusing')))),[]);
    console.log('PASS: real panel → theme bridge → real SilverBullet; live light/dark without reload, message boundary, native edit/save, command picker, new tab, mobile, assets/login; no page errors');
  } finally {
    await browser?.close();
    for(const child of children.reverse()) {child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
