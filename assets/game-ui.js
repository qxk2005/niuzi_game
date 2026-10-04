/* Shared touch, navigation and lifecycle support. No dependencies. */
(() => {
  'use strict';
  const embedded = window.parent !== window;
  document.documentElement.classList.toggle('embedded', embedded);
  const hints = {
    1: '点选小车，再点前进、停下或后退。也可以开启自动服务。',
    2: '点选食材制作汉堡。削土豆时按住并滑动，完成后跟着按钮继续。',
    3: '在迷宫中按住并滑动手指移动角色，松手停下。跟着黄色脚印找钥匙。',
    4: '点选上方角色卡片，再点草坪格子放置。点掉落的能量收集。',
    5: '左手按住摇杆移动，右手点攻击、吃肉或陷阱。两只手可以同时操作。',
    6: '左右滑动卡片栏选植物，再点草坪放置。点阳光收集能量。',
    7: '左右滑动选牌栏，点卡片后点草坪种植。超级射线按钮可以释放大招。',
    8: '点卡片，再点草坪种植，无需拖拽。向左滑动卡片栏查看更多植物。',
    9: '先选植物和僵尸，再点下方零件拼装。拼好后点开始决战。',
    10: '点雪地移动，点资源采集。靠近熔炉投放木头和冰块，升级营地。',
    11: '滑动卡片栏选择植物，再点草坪格子种植。点阳光可以补充能量。',
    12: '选火柴人再点草坪放置；选铲子再点目标。红蓝荣誉按钮可以强化队伍。',
    13: '点发光方块拼装，再跟着底部指引和大按钮探索、收获与战斗。',
    14: '在传送带上选坚果，再点草坪上的目标跑道发射。每点一次只发射一次。'
  };
  let manualPause = false;
  let hostPause = false;
  let helpOpen = false;
  const paused = () => manualPause || hostPause || helpOpen || document.hidden;
  const audioContexts = new Set();
  const resumeContexts = new Set();
  // Track synthesized game audio so pausing also silences ongoing tones/music.
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const NativeAudio = window[name];
    if (!NativeAudio) continue;
    window[name] = new Proxy(NativeAudio, { construct(target, args) {
      const context = Reflect.construct(target, args);
      audioContexts.add(context);
      return context;
    } });
  }
  const clocks = new WeakMap();
  const nativeFrame = window.requestAnimationFrame.bind(window);
  // Keep legacy frame-based simulations at 60 steps/s on 90/120 Hz displays.
  // Virtual timestamps freeze while paused, preventing spawn bursts after resume.
  function requestFrame(callback) {
    let clock = clocks.get(callback);
    if (!clock) { clock = { last: null, time: 0 }; clocks.set(callback, clock); }
    let currentHandle;
    const token = { cancelled: false };
    function tick(now) {
      if (token.cancelled) return;
      if (paused()) { clock.last = null; currentHandle = nativeFrame(tick); return; }
      if (clock.last === null) clock.last = now - 1000 / 60;
      if (now - clock.last < 1000 / 60 - 0.8) { currentHandle = nativeFrame(tick); return; }
      clock.last += 1000 / 60;
      if (now - clock.last > 1000 / 60) clock.last = now;
      clock.time += 1000 / 60;
      callback(clock.time);
    }
    currentHandle = nativeFrame(tick);
    token.cancel = () => { token.cancelled = true; cancelAnimationFrame(currentHandle); };
    return token;
  }
  function cancelFrame(token) { if (token?.cancel) token.cancel(); }
  function timer(callback, delay = 0, repeat = false, args = []) {
    const duration = Math.max(0, Number(delay) || 0);
    const token = { cancelled: false, remaining: duration, last: performance.now() };
    function tick() {
      if (token.cancelled) return;
      const now = performance.now();
      if (!paused()) token.remaining -= Math.min(now - token.last, 100);
      token.last = now;
      if (token.remaining <= 0 && !paused()) {
        callback(...args);
        if (!repeat || token.cancelled) return;
        token.remaining = duration;
      }
      token.handle = setTimeout(tick, Math.min(50, Math.max(10, token.remaining)));
    }
    token.handle = setTimeout(tick, Math.min(50, Math.max(0, duration)));
    return token;
  }
  const clearTimer = token => { if (token) { token.cancelled = true; clearTimeout(token.handle); } };
  function point(canvas, event) {
    const r = canvas.getBoundingClientRect();
    const p = event.touches?.[0] || event.changedTouches?.[0] || event;
    return { x: (p.clientX - r.left) * canvas.width / r.width,
      y: (p.clientY - r.top) * canvas.height / r.height };
  }
  function home() {
    if (embedded) parent.postMessage({ type: 'niuzi:home' }, location.origin === 'null' ? '*' : location.origin);
    else location.href = './index.html';
  }
  function syncPause() {
    document.documentElement.classList.toggle('game-paused', paused());
    const b = document.getElementById('game-pause');
    if (b) { b.textContent = manualPause ? '▶ 继续' : 'Ⅱ 暂停'; b.setAttribute('aria-pressed', String(manualPause)); }
    if (paused()) window.speechSynthesis?.cancel();
    for (const context of audioContexts) {
      if (context.state === 'closed') { audioContexts.delete(context); resumeContexts.delete(context); continue; }
      if (paused() && context.state === 'running') {
        resumeContexts.add(context); context.suspend().catch(() => {});
      } else if (!paused() && resumeContexts.has(context)) {
        resumeContexts.delete(context); context.resume().catch(() => {});
      }
    }
    window.dispatchEvent(new Event('niuzi:release-input'));
  }
  window.GameUI = { requestFrame, cancelFrame, point, home,
    setTimeout: (fn, delay, ...args) => timer(fn, delay, false, args),
    setInterval: (fn, delay, ...args) => timer(fn, delay, true, args),
    clearTimeout: clearTimer, clearInterval: clearTimer,
    get paused() { return paused(); } };
  window.addEventListener('message', e => {
    if (e.source !== parent || e.origin !== location.origin) return;
    if (e.data?.type === 'niuzi:pause') { hostPause = !!e.data.paused; syncPause(); }
    if (e.data?.type === 'niuzi:help') openHelp();
  });
  document.addEventListener('visibilitychange', syncPause);
  const blockPausedInput = e => {
    if (e.key === 'Escape') return;
    if (paused() && !e.target.closest?.('.game-nav,.touch-help')) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  };
  for (const type of ['pointerdown', 'click', 'keydown']) document.addEventListener(type, blockPausedInput, true);
  window.addEventListener('blur', () => window.dispatchEvent(new Event('niuzi:release-input')));
  let help;
  function openHelp() { helpOpen = true; help.showModal(); syncPause(); }
  document.addEventListener('DOMContentLoaded', () => {
    const id = Number(document.body.dataset.game);
    if (!embedded) {
      const nav = document.createElement('nav'); nav.className = 'game-nav'; nav.setAttribute('aria-label', '游戏工具栏');
      nav.innerHTML = '<button id="game-home">‹ 游戏大厅</button><span>牛子的游戏库</span><button id="game-pause" aria-pressed="false">Ⅱ 暂停</button><button id="game-help">? 玩法</button>';
      document.body.prepend(nav);
      nav.querySelector('#game-home').onclick = home;
      nav.querySelector('#game-pause').onclick = () => { manualPause = !manualPause; syncPause(); };
      nav.querySelector('#game-help').onclick = openHelp;
    }
    help = document.createElement('dialog'); help.className = 'touch-help';
    const heading = document.createElement('h2'); heading.textContent = '动动手指，开始冒险';
    const text = document.createElement('p'); text.textContent = hints[id];
    const tip = document.createElement('p'); tip.className = 'help-tip'; tip.textContent = '手机竖屏也能玩，横屏能看见更宽的战场。平板横竖屏均可操作。';
    const close = document.createElement('button'); close.textContent = '知道啦，继续玩'; close.onclick = () => help.close();
    help.append(heading, text, tip, close); document.body.append(help);
    help.addEventListener('close', () => { helpOpen = false; syncPause(); });
    // Make existing clickable cards usable with a keyboard and screen reader.
    const enhance = element => {
      if (element.matches('button,a,input,select,textarea')) return;
      if (element.onclick || element.hasAttribute('onclick')) {
        element.setAttribute('role', 'button'); element.tabIndex = 0;
      }
    };
    document.querySelectorAll('[onclick],.plant-card,.nut-card,.lego-part-card,.char-card').forEach(enhance);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return; enhance(n);
      n.querySelectorAll('[onclick],.plant-card,.nut-card,.lego-part-card,.char-card').forEach(enhance);
    }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
        e.preventDefault(); e.target.click();
      }
    });
    document.querySelectorAll('canvas').forEach(c => {
      if (!c.getAttribute('aria-label')) c.setAttribute('aria-label', '游戏画布：' + hints[id]);
      c.addEventListener('contextmenu', e => { if (e.pointerType === 'touch') e.preventDefault(); });
    });
    window.dispatchEvent(new Event('resize'));
    const syncOverlays = () => {
      document.querySelectorAll('.screen-overlay,.overlay-screen,.screen-modal,.modal-overlay,#modal-overlay,#victory-modal,#gameover-modal').forEach(el => {
        const style = getComputedStyle(el);
        // Opacity can still be zero at the start of a fade-in transition.
        // Interaction state must follow display/pointer-events, not an animation frame.
        const hidden = style.display === 'none' || style.pointerEvents === 'none';
        el.inert = hidden;
        el.setAttribute('aria-hidden', String(hidden));
      });
    };
    syncOverlays();
    const overlaySelector = '.screen-overlay,.overlay-screen,.screen-modal,.modal-overlay,#modal-overlay,#victory-modal,#gameover-modal';
    new MutationObserver(records => {
      if (records.some(r => r.target.matches(overlaySelector))) syncOverlays();
    }).observe(document.body, { attributes:true, subtree:true, attributeFilter:['class','style'] });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && embedded && !helpOpen) { e.preventDefault(); home(); }
    });
  });
})();
