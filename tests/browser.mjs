import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import vm from 'node:vm';
const sandbox={window:{}};vm.runInNewContext(readFileSync('assets/games.js','utf8'),sandbox);
const games=sandbox.window.NiuziGames;
const server=createServer((req,res)=>{
  const file=resolve('.','.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(resolve('.')+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.NIUZI_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
const report=[];mkdirSync('test-results',{recursive:true});
try{
  for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1024,height:768},{width:1366,height:900}]){
    const context=await browser.newContext({viewport,hasTouch:true,deviceScaleFactor:1});
    const page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const game of [{id:0,file:'index.html'},...games]){
      errors=[];await page.goto(`${base}/${encodeURIComponent(game.file)}`);await page.waitForTimeout(180);
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,displayWidth:c.getBoundingClientRect().width,displayHeight:c.getBoundingClientRect().height}))}));
      assert.deepEqual(errors,[],`${game.file}: ${errors.join(',')}`);
      assert.equal(layout.overflow,false,`${game.file}: horizontal overflow at ${viewport.width}`);
      for(const c of layout.canvas){assert.ok(c.width>0&&c.height>0);if(c.displayWidth||c.displayHeight)assert.ok(c.displayWidth>0&&c.displayHeight>0);}
      report.push({game:game.id,viewport,...layout});
    }
    await context.close();
  }
  console.log('PASS: 90 page/screen combinations, startup, canvas sizing and horizontal overflow.');
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/index.html');assert.equal(await page.locator('.game-card').count(),14);
  await page.locator('#game-search').fill('坚果');assert.equal(await page.locator('.game-card').count(),1);
  await page.locator('.favorite-button').tap();await page.locator('#game-search').fill('');
  await page.locator('[data-filter="favorites"]').tap();assert.equal(await page.locator('.game-card').count(),1);
  await page.reload();await page.locator('[data-filter="favorites"]').tap();assert.equal(await page.locator('.game-card').count(),1);
  await page.locator('[data-filter="all"]').tap();
  for(const game of games){
    await page.locator(`[data-game="${game.id}"] .game-play`).tap();
    const child=page.frames().find(f=>f!==page.mainFrame());
    await child.waitForFunction(()=>!!window.GameUI && document.body.dataset.game);
    await page.locator('#player-loading').waitFor({state:'hidden'});
    assert.equal(await child.locator('.game-nav').count(),0,'embedded games should not repeat the toolbar');
    await page.locator('#player-help').tap();await child.locator('.touch-help').waitFor({state:'visible'});
    await child.locator('.touch-help button').tap();
    await page.locator('#player-pause').tap();await child.waitForFunction(()=>GameUI.paused);
    await page.locator('#player-resume').tap();await child.waitForFunction(()=>!GameUI.paused);
    await page.locator('#player-restart').tap();await child.waitForFunction(()=>!!window.GameUI);
    await page.locator('#player-close').tap();assert.equal(await page.locator('#game-player').evaluate(el=>el.open),false);
  }
  console.log('PASS: search, persistent favorites, all 14 embedded games, help, pause, resume, restart and close.');
  // Start tower-defense games and plant through real touch events at scaled cell centers.
  for (const id of [6,7,8,11,12]) {
    await page.goto(base+'/'+encodeURIComponent(games.find(g=>g.id===id).file));
    if(id===6)await page.locator('.btn-primary').tap();
    if(id===7)await page.locator('#btn-start-game').tap();
    if(id===11)await page.locator('#btn-select-lvl-1').tap();
    const cards=id===6?'.card-slot':'.plant-card';
    await page.locator(cards).first().tap();
    const canvas=page.locator('canvas').first();await canvas.scrollIntoViewIfNeeded();
    const before = id===8 ? Number(await page.locator('#sun-val').textContent()) : await page.evaluate(()=>plants.length);
    const target=await page.evaluate(id=>{
      const c=document.querySelector('canvas'),r=c.getBoundingClientRect();let x,y;
      if(id===6){x=GRID.left+GRID.cw/2;y=GRID.top+GRID.ch/2;}
      if(id===7){x=gridOffsetX+gridWidth/2;y=gridOffsetY+gridHeight/2;}
      if(id===8){x=100+95/2;y=55+88/2;}
      if(id===11){x=GRID_LEFT+CELL_W/2;y=GRID_TOP+CELL_H/2;}
      if(id===12){x=gridOffsetX+cellWidth/2;y=gridOffsetY+cellHeight/2;}
      return{x:r.left+x*r.width/c.width,y:r.top+y*r.height/c.height};
    },id);
    await page.touchscreen.tap(target.x,target.y);
    if(id===8)assert.ok(Number(await page.locator('#sun-val').textContent())<before,'touch planting must consume energy');
    else assert.equal(await page.evaluate(()=>plants.length),before+1,`game ${id}: a tap must plant at the selected cell`);
  }
  // Assemble both LEGO characters through touchable pieces, then enter battle.
  await page.goto(base+'/'+encodeURIComponent(games.find(g=>g.id===9).file));
  for(let i=0;i<8;i++)await page.locator('.lego-part-card:not(.used)').first().tap();
  await page.locator('#start-battle-btn').tap();
  assert.equal(await page.evaluate(()=>gameState),'BATTLE');
  // All five kitchen stages remain inside a small phone; peeling uses canvas coordinates.
  await page.setViewportSize({width:320,height:740});
  await page.goto(base+'/'+encodeURIComponent(games.find(g=>g.id===2).file));
  const kitchenStage = async id => {
    await page.locator(id).waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`kitchen ${id}: overflow`);
  };
  const touchControl = async selector => {
    const control=page.locator(selector);await control.scrollIntoViewIfNeeded();
    const r=await control.boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
  };
  await kitchenStage('#stageOrder');await touchControl('#startCookBtn');
  await kitchenStage('#stageBurger');await touchControl('#pattyGrillBtn');
  await page.locator('#cardBottomBun:not(.disabled)').waitFor();
  for(const card of ['BottomBun','Patty','Nori','Lettuce','Tomato','Cheese','TopBun'])await touchControl('#card'+card);
  await kitchenStage('#stageFries');
  await page.locator('#peelCanvas').scrollIntoViewIfNeeded();
  const peel=await page.locator('#peelCanvas').boundingBox();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:peel.x+peel.width/2,y:peel.y+peel.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:peel.x+peel.width/2+10,y:peel.y+peel.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(()=>document.getElementById('peelCanvas').getContext('2d').getImageData(150,110,1,1).data[3]),0,'touch must erase potato skin');
  await touchControl('#btnNextToChop');
  for(let i=0;i<6;i++)await touchControl('#btnChopAction');
  await page.locator('#btnStartFry').waitFor({state:'visible'});await touchControl('#btnStartFry');
  await page.locator('#btnSqueezeSauce').waitFor({state:'visible'});await touchControl('#btnSqueezeSauce');
  await kitchenStage('#stageTruck');await touchControl('#btnDriveTruck');
  await kitchenStage('#stageServe');await touchControl('#btnServeFinal');
  assert.equal(await page.locator('#scoreVal').textContent(),'1');
  await page.setViewportSize({width:390,height:844});
  // Maze rotation preserves entities' cell coordinates and cannot strand a moving character.
  await page.goto(base+'/'+encodeURIComponent(games.find(g=>g.id===3).file));
  await page.locator('#btn-start-escape').tap();
  const cell=await page.evaluate(()=>({x:(player.x-offsetX)/TILE_SIZE,y:(player.y-offsetY)/TILE_SIZE}));
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(80);
  const rotated=await page.evaluate(()=>({x:(player.x-offsetX)/TILE_SIZE,y:(player.y-offsetY)/TILE_SIZE}));
  assert.ok(Math.abs(cell.x-rotated.x)<.01&&Math.abs(cell.y-rotated.y)<.01,'maze rotation preserves the player cell');
  await page.setViewportSize({width:390,height:844});
  console.log('PASS: touch planting in five defense games, LEGO assembly, five kitchen stages, potato peeling and maze rotation.');
  // Coordinates are converted from CSS pixels; a touch must consume exactly one card.
  await page.goto(base+'/'+encodeURIComponent(games.find(g=>g.id===14).file));
  const target=await page.evaluate(()=>{const r=gameCanvas.getBoundingClientRect();return{x:r.left+(gridLayout.left+100)*r.width/gameCanvas.width,y:r.top+(gridLayout.top+gridLayout.rowHeight/2)*r.height/gameCanvas.height};});
  const before=await page.evaluate(()=>conveyorQueue.length);
  await page.touchscreen.tap(target.x,target.y);
  assert.equal(await page.evaluate(()=>conveyorQueue.length),before-1,'one tap should launch one nut');
  assert.equal(await page.evaluate(()=>activeNuts.length),1);
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>gameCanvas.width),1000,'rotation must preserve logical board');
  await page.locator('#game-pause').tap();
  const frozen=await page.evaluate(()=>({timer:conveyorTimer,x:activeNuts[0].x}));await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(()=>({timer:conveyorTimer,x:activeNuts[0].x})),frozen,'pause freezes spawn timers and motion');
  const pausedQueue=await page.evaluate(()=>conveyorQueue.length);
  await page.locator('#lane-controls button').first().evaluate(el=>el.click());
  assert.equal(await page.evaluate(()=>conveyorQueue.length),pausedQueue,'pause blocks button activation as well as pointer input');
  await page.locator('#game-pause').tap();
  await page.screenshot({path:'test-results/bowling-landscape.png',fullPage:true});
  // A second finger on attack cannot steal or release the movement joystick.
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'/'+encodeURIComponent(games.find(g=>g.id===5).file));
  const stick=page.locator('#dpad');await stick.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:90,clientY:750});
  await stick.dispatchEvent('pointermove',{pointerId:1,pointerType:'touch',clientX:120,clientY:750});
  await page.locator('#btn-attack').dispatchEvent('pointerup',{pointerId:2,pointerType:'touch'});
  assert.equal(await page.evaluate(()=>dpadPointer),1);
  await stick.dispatchEvent('pointercancel',{pointerId:1,pointerType:'touch'});
  assert.deepEqual(await page.evaluate(()=>joystickVector),{x:0,y:0});
  // Timers and sound freeze together; resume does not dispatch a backlog.
  await page.evaluate(()=>{window.timerHits=0;window.timerToken=GameUI.setInterval(()=>timerHits++,60);});
  await page.waitForTimeout(100);await page.locator('#game-pause').tap();
  const count=await page.evaluate(()=>timerHits);await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>timerHits),count);
  await page.locator('#game-pause').tap();await page.waitForTimeout(80);
  assert.ok(await page.evaluate(()=>timerHits)<=count+2);await page.evaluate(()=>GameUI.clearInterval(timerToken));
  assert.deepEqual(errors,[]);
  console.log('PASS: single-tap bowling, scaled coordinates, rotation, frozen simulation/timers and joystick multi-pointer release.');
  await page.goto(base+'/index.html');await page.screenshot({path:'test-results/lobby-phone.png',fullPage:true});
  await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'test-results/lobby-tablet.png',fullPage:true});
  writeFileSync('test-results/report.json',JSON.stringify(report,null,2));await context.close();
}finally{await browser.close();server.close();}
