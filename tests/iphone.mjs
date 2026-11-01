// iPhone / foldable checks: no element fullscreen API (iPhone Safari), DPR 3,
// and live viewport changes between folded, unfolded and landscape sizes.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import vm from 'node:vm';
const sandbox={window:{}};vm.runInNewContext(readFileSync('assets/games.js','utf8'),sandbox);
const games=sandbox.window.NiuziGames;
const server=createServer((req,res)=>{
  const file=resolve('.','.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(resolve('.')+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.webmanifest':'application/manifest+json','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.NIUZI_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
mkdirSync('test-results',{recursive:true});
// Folded phone portrait -> unfolded (near-square) -> unfolded landscape -> folded landscape -> folded portrait.
const states=[{width:390,height:844},{width:760,height:860},{width:860,height:760},{width:844,height:390},{width:390,height:844}];
try{
  const context=await browser.newContext({viewport:states[0],hasTouch:true,isMobile:true,deviceScaleFactor:3,
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'});
  // iPhone Safari: no element fullscreen API at all.
  await context.addInitScript(()=>{for(const k of ['requestFullscreen','webkitRequestFullscreen'])delete Element.prototype[k];});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/index.html');
  for(const game of games){
    await page.setViewportSize(states[0]);
    await page.locator(`[data-game="${game.id}"] .game-play`).tap();
    const child=page.frames().find(f=>f!==page.mainFrame());
    await child.waitForFunction(()=>!!window.GameUI&&document.body.dataset.game);
    await page.locator('#player-loading').waitFor({state:'hidden'});
    // Fullscreen falls back to immersive mode: toolbar hidden, game gets the screen.
    await page.locator('#player-fullscreen').tap();
    assert.equal(await page.locator('#game-player').evaluate(el=>el.classList.contains('immersive')),true,`${game.file}: immersive fallback`);
    assert.equal(await page.locator('.player-toolbar').isVisible(),false);
    for(const [i,size] of states.entries()){
      await page.setViewportSize(size);await page.waitForTimeout(700);
      const r=await child.evaluate(()=>{
        const vw=document.documentElement.clientWidth,vh=innerHeight;
        return {vw,vh,overflow:document.documentElement.scrollWidth>vw+2,
          canvases:[...document.querySelectorAll('canvas')].filter(c=>c.getClientRects().length&&getComputedStyle(c).visibility!=='hidden').map(c=>{const b=c.getBoundingClientRect();return {id:c.id,w:b.width,h:b.height,left:b.left,right:b.right,top:b.top,bw:c.width,bh:c.height};})};
      });
      const frame=await page.locator('#game-frame').boundingBox();
      assert.ok(Math.abs(frame.width-size.width)<=2,`${game.file}: iframe follows width ${size.width}, got ${frame.width}`);
      assert.equal(r.overflow,false,`${game.file}: horizontal overflow at ${size.width}x${size.height} (${JSON.stringify(r)})`);
      for(const c of r.canvases){
        if(c.w<150||c.h<100)continue; // card previews in scrollable trays, decorations
        assert.ok(c.left>=-1&&c.right<=r.vw+1,`${game.file}#${c.id}: canvas leaves screen at ${size.width}x${size.height}`);
        assert.ok(c.bw>0&&c.bh>0);
      }
      if(game.id===4){const c=r.canvases[0];assert.ok(c.top>=-1&&c.top+c.h<=r.vh+1,`game 4 canvas must fit vertically at ${size.width}x${size.height}`);}
      if(game.id===3||game.id===5){const c=r.canvases[0];assert.ok(Math.abs(c.bw/c.w-2)<0.05,`${game.file}: Retina canvas (dpr capped at 2)`);}
      if(i===2)await page.screenshot({path:`test-results/fold-${game.id}-unfolded-landscape.png`});
    }
    // Paused + fold: the frozen scene must stay visible (not a cleared canvas).
    await page.locator('#player-exit-immersive').tap();
    assert.equal(await page.locator('.player-toolbar').isVisible(),true);
    await page.locator('#player-pause').tap();await child.waitForFunction(()=>GameUI.paused);
    const painted=()=>child.evaluate(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];if(!c)return null;
      const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4*97)if(d[i])n++;return n;});
    const before=await painted();
    await page.setViewportSize(states[1]);await page.waitForTimeout(700);
    const after=await painted();
    if(before)assert.ok(after>0,`${game.file}: paused canvas went blank after fold change`);
    await page.locator('#player-resume').tap();
    await page.locator('#player-close').tap();
    assert.equal(await page.locator('#game-player').evaluate(el=>el.classList.contains('immersive')),false);
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: iPhone fullscreen fallback, ${games.length} games across ${states.length} fold/rotation states, Retina canvases, paused frames survive resizes.`);
  await context.close();
}finally{await browser.close();server.close();}
