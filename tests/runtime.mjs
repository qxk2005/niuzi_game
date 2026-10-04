import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('assets/game-ui.js','utf8');
function harness(){
  let now=0,serial=0;const frames=new Map(),timers=new Map();
  const document={hidden:false,documentElement:{classList:{toggle(){}}},addEventListener(){}};
  const window={document,addEventListener(){},dispatchEvent(){},requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id;}};
  window.parent=window;
  const scope={window,document,performance:{now:()=>now},Event,
    cancelAnimationFrame:id=>frames.delete(id),
    setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,due:now+ms});return id;},
    clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,scope);
  return {ui:window.GameUI,document,frame(time){now=time;const ready=[...frames.values()];frames.clear();ready.forEach(fn=>fn(now));},
    advance(ms){const end=now+ms;while(true){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;}};
}
for(const hz of [60,90,120,144]){
  const h=harness();let ticks=0,time=0;
  const loop=t=>{ticks++;time=t;h.ui.requestFrame(loop);};h.ui.requestFrame(loop);
  for(let i=0;i<hz*2;i++)h.frame(i*1000/hz);
  assert.ok(Math.abs(ticks-120)<=1,`${hz} Hz must produce 60 game steps/s, got ${ticks/2}`);
  h.document.hidden=true;const frozen=time;for(let i=0;i<hz;i++)h.frame(2000+i*1000/hz);
  assert.equal(time,frozen);h.document.hidden=false;h.frame(3000);
  assert.ok(Math.abs(time-frozen-1000/60)<.001,'resume must advance only one simulation step');
  let cancelled=false;const handle=h.ui.requestFrame(()=>cancelled=true);h.ui.cancelFrame(handle);h.frame(3020);assert.equal(cancelled,false);
}
const h=harness();let count=0;
const interval=h.ui.setInterval(()=>count++,100);h.advance(100);assert.equal(count,1);
h.document.hidden=true;h.advance(500);assert.equal(count,1);
h.document.hidden=false;h.advance(100);assert.equal(count,2);
h.ui.clearInterval(interval);h.advance(500);assert.equal(count,2);
console.log('PASS: 60/90/120/144 Hz pacing, frozen virtual time, frame cancellation and paused timers.');
