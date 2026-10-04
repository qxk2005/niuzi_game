(() => {
  'use strict';
  const games = window.NiuziGames;
  const $ = id => document.getElementById(id);
  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Play without persistence when storage is unavailable. */ } }
  const saved = read('niuzi:favorites', []);
  const favorites = new Set(Array.isArray(saved) ? saved : []);
  let recent = read('niuzi:recent', null), category = 'all', selected = null, paused = false, lastFocus, loadTimer, messageTimer;
  const player = $('game-player'), frame = $('game-frame');
  function button(text, className) { const b = document.createElement('button'); b.className = className; b.textContent = text; return b; }
  function render() {
    const query = $('game-search').value.trim().toLowerCase();
    const visible = games.filter(g => (category === 'all' || (category === 'favorites' ? favorites.has(g.id) : category === g.category)) && `${g.title} ${g.description} ${g.tags.join(' ')}`.toLowerCase().includes(query));
    $('game-grid').replaceChildren();
    visible.forEach(g => {
      const card = document.createElement('article'); card.className = 'game-card'; card.dataset.game = g.id;
      const art = document.createElement('div'); art.className = 'game-art'; art.style.setProperty('--art-bg', `linear-gradient(145deg,${g.color.split(',').map(c => '#'+c).join(',')})`);
      for (const [className,text] of [['art-platform',''],['art-star','✦'],['art-main',g.icon],['art-side',g.side]]) {
        const el = document.createElement('span'); el.className = className; el.textContent = text; el.setAttribute('aria-hidden','true'); art.append(el);
      }
      const chip = document.createElement('span'); chip.className = 'game-chip'; chip.textContent = recent === g.id ? '最近玩过' : g.badge; art.append(chip);
      const favorite = button(favorites.has(g.id) ? '♥' : '♡','favorite-button'); favorite.setAttribute('aria-label', `收藏${g.title}`); favorite.setAttribute('aria-pressed',String(favorites.has(g.id)));
      favorite.onclick = () => {
        favorites.has(g.id) ? favorites.delete(g.id) : favorites.add(g.id); save('niuzi:favorites', [...favorites]);
        if (category === 'favorites') { render(); document.querySelector('[data-filter="favorites"]').focus(); }
        else { favorite.textContent = favorites.has(g.id) ? '♥' : '♡'; favorite.setAttribute('aria-pressed',String(favorites.has(g.id))); }
      };
      art.append(favorite);
      const info = document.createElement('div'); info.className = 'game-info';
      const title = document.createElement('h3'); title.textContent = g.title;
      const desc = document.createElement('p'); desc.textContent = g.description;
      const tags = document.createElement('div'); tags.className = 'game-tags';
      g.tags.forEach(t => { const tag = document.createElement('span'); tag.textContent = t; tags.append(tag); });
      const play = button('','game-play'); play.setAttribute('aria-label', `开始玩${g.title}`);
      play.innerHTML = '<span>开始冒险</span><span aria-hidden="true">↗</span>'; play.onclick = () => openGame(g,play);
      info.append(title,desc,tags,play); card.append(art,info); $('game-grid').append(card);
    });
    $('result-count').textContent = `${visible.length} 个世界，等你探索`; $('empty-state').hidden = visible.length > 0;
  }
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
    category = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(el => { const active = el === b; el.classList.toggle('selected',active); el.setAttribute('aria-pressed',String(active)); }); render();
  });
  $('game-search').addEventListener('input',render);
  $('reset-filter').onclick = () => { $('game-search').value = ''; document.querySelector('[data-filter="all"]').click(); };
  function post(type, extra = {}) { frame.contentWindow?.postMessage({type,...extra}, location.origin === 'null' ? '*' : location.origin); }
  function setPause(value) {
    paused = value; post('niuzi:pause',{paused}); $('player-paused').hidden = !paused;
    $('player-pause').setAttribute('aria-pressed',String(paused)); $('player-pause').innerHTML = paused ? '▶ <span>继续</span>' : 'Ⅱ <span>暂停</span>';
    if (paused) window.speechSynthesis?.cancel();
  }
  function loading() {
    clearTimeout(loadTimer); $('player-loading').hidden = false;
    loadTimer = setTimeout(() => { if (player.open) { $('player-loading').hidden = true; showMessage('加载较慢，可以点「重开」再试一次。'); } },10000);
  }
  function openGame(game, trigger) {
    selected = game; lastFocus = trigger; recent = game.id; save('niuzi:recent',recent);
    $('player-title').textContent = game.title; frame.title = game.title + '游戏画面';
    player.showModal(); document.body.style.overflow = 'hidden'; setPause(false); loading();
    frame.src = './' + encodeURI(game.file); $('player-close').focus();
  }
  function closeGame() {
    clearTimeout(loadTimer); clearTimeout(messageTimer); frame.src = 'about:blank'; window.speechSynthesis?.cancel();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (player.open) player.close(); document.body.style.overflow = ''; $('player-message').hidden = true;
    lastFocus?.focus(); selected = null;
  }
  frame.addEventListener('load', () => {
    if (!selected || !player.open) return;
    clearTimeout(loadTimer); $('player-loading').hidden = true; post('niuzi:pause',{paused});
  });
  player.addEventListener('cancel', e => { e.preventDefault(); closeGame(); });
  $('player-close').onclick = closeGame; $('player-pause').onclick = () => setPause(!paused);
  $('player-resume').onclick = () => setPause(false); $('player-help').onclick = () => post('niuzi:help');
  $('player-restart').onclick = () => { setPause(false); loading(); frame.contentWindow.location.reload(); };
  function showMessage(text) { $('player-message').textContent = text; $('player-message').hidden = false; clearTimeout(messageTimer); messageTimer = setTimeout(() => $('player-message').hidden = true,4000); }
  $('player-fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
      else showMessage('已使用整屏游戏视图，横屏可以看见更宽的战场。');
    } catch { showMessage('当前浏览器不支持全屏，横屏也能舒适游玩。'); }
  };
  window.addEventListener('message',e => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'niuzi:home') closeGame();
  });
  let voice = false;
  $('welcome-sound').onclick = () => {
    voice = !voice; $('welcome-sound').setAttribute('aria-pressed',String(voice)); $('welcome-sound').textContent = voice ? '♫ 语音开启' : '♫ 语音关闭';
    window.speechSynthesis?.cancel();
    if (voice && 'speechSynthesis' in window) { const message = new SpeechSynthesisUtterance('欢迎来到牛子的游戏库！挑一个喜欢的游戏，开始冒险吧。'); message.lang = 'zh-CN'; window.speechSynthesis.speak(message); }
  };
  render();
})();
