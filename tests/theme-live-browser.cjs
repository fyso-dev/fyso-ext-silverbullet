// Authenticated acceptance on an explicitly supplied disposable Fyso stack.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.FYSO_TEST_WEB_PANEL, passwordFile=process.env.FYSO_TEST_WEB_PASSWORD_FILE;
if(!base || !passwordFile)throw Error('Supply an isolated panel URL and its private password file');
const folder=path.resolve(__dirname,'../docs/evidence/panel-theme');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'es-AR',colorScheme:'light'});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?lang=es');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill(fs.readFileSync(passwordFile,'utf8').trimEnd());
  await page.locator('button[type="submit"]').click();
  await page.getByRole('navigation').getByRole('link',{name:'Conocimiento',exact:true}).first().click();
  const kb=page.frameLocator('iframe[title="Conocimiento"]'),editor=kb.frameLocator('.kb-frame');
  await editor.locator('.cm-content').filter({hasText:/\S/}).waitFor({timeout:30000});
  await editor.locator('html[data-fyso-theme="light"][style*="--fy-surface"]').waitFor();
  fs.mkdirSync(folder,{recursive:true});
  await page.screenshot({animations:'disabled',path:path.join(folder,'live-stack-light.png')});
  await editor.locator('body').evaluate(()=>{window.liveThemeMarker=true;});
  await page.getByRole('button',{name:'Cambiar a tema oscuro',exact:true}).click();
  await editor.locator('html[data-fyso-theme="dark"]').waitFor();
  assert.equal(await editor.locator('body').evaluate(()=>window.liveThemeMarker),true);
  await page.screenshot({animations:'disabled',path:path.join(folder,'live-stack-dark.png')});
  const docs=base.replace('//panel.','//docs.');
  for(const asset of ['editor.css','editor.js','fonts/Gilroy-Regular.woff2'])assert.equal((await ctx.request.get(docs+'/.kb/theme/'+asset)).status(),200);
  const anonymous=await browser.newContext();
  const denied=await anonymous.request.get(docs+'/.kb/theme/editor.js',{maxRedirects:0});
  assert.equal(denied.status(),302);
  assert.match(denied.headers().location,/\/login/);
  await anonymous.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: real web login, live panel configuration, real editor, light/dark without reload, protected assets; no JS page errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
