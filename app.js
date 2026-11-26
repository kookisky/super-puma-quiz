/* 超級PUMA語錄王：遊戲本體（純靜態，無框架） */
(() => {
'use strict';
const CFG = Object.assign({api: '', version: 'dev', site: location.origin + location.pathname}, window.PUMA_CONFIG || {});
const $ = id => document.getElementById(id);
const LEVELS = [
  {key: '初', name: '初級', peril: 'water', pts: 2, title: '水面上', desc: '奔奔抱抱飄到水面上了！', music: 'm02'},
  {key: '中', name: '中級', peril: 'pit', pts: 3, title: '大洞上', desc: '風把他們吹到大洞上面！', music: 'm03'},
  {key: '高', name: '高級', peril: 'fire', pts: 5, title: '營火上', desc: '最後一關，下面是熱呼呼的營火！', music: 'm04'},
];
const PER_LEVEL = 10, GOAL = 60, MAX_BALLOONS = 6, START_BALLOONS = 4;
const LS = {seen: 'puma.seen.v1', board: 'puma.board.v1', name: 'puma.name', mute: 'puma.mute'};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ } },
};
const fmtTime = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/* ---------- 聲音 ---------- */
const Sound = (() => {
  let ctx = null, muted = !!store.get(LS.mute, false), unlocked = false, wantTrack = null;
  const music = new Map(), buffers = new Map(), missing = new Set();
  const SFX = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08'];
  const synth = { // 檔案缺時的備援：簡單合成音
    s01: [[660, 0, .09], [880, .09, .09], [1320, .18, .16]], s02: [[330, 0, .14], [247, .14, .22]], s03: [[520, 0, .05]],
    s04: [[740, 0, .08], [622, .1, .08], [740, .2, .08]], s05: [[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .25]],
    s06: [[784, 0, .1], [988, .1, .1], [1175, .2, .1], [1568, .3, .4]], s07: [[600, 0, .5, 200]], s08: [[900, 0, .04]],
  };
  function ensureCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function loadSfx(name) {
    if (buffers.has(name) || missing.has(name) || !ctx) return;
    missing.add(name);
    fetch(`./audio/${name}.mp3`).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)))
      .then(buf => { buffers.set(name, buf); missing.delete(name); }).catch(() => {});
  }
  function unlock() {
    if (unlocked) return; unlocked = true; ensureCtx(); SFX.forEach(loadSfx);
    if (wantTrack) play(wantTrack);
  }
  function sfx(name, vol = .7) {
    if (muted || !unlocked || !ensureCtx()) return;
    const t = ctx.currentTime, g = ctx.createGain(); g.connect(ctx.destination);
    const buf = buffers.get(name);
    if (buf) { const s = ctx.createBufferSource(); s.buffer = buf; g.gain.value = vol; s.connect(g); s.start(); return; }
    (synth[name] || []).forEach(([f, at, dur, f2]) => {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t + at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + dur);
      e.gain.setValueAtTime(0, t + at); e.gain.linearRampToValueAtTime(vol * .35, t + at + .01); e.gain.exponentialRampToValueAtTime(.001, t + at + dur);
      o.connect(e); e.connect(ctx.destination); o.start(t + at); o.stop(t + at + dur + .02);
    });
  }
  function play(name) {
    wantTrack = name;
    if (!unlocked) return;
    music.forEach((a, k) => { if (k !== name) { a.pause(); } });
    if (muted || !name) return;
    let a = music.get(name);
    if (!a) { a = new Audio(`./audio/${name}.mp3`); a.loop = true; a.preload = 'auto'; a.volume = .42; a.addEventListener('error', () => music.delete(name)); music.set(name, a); }
    const p = a.play(); if (p && p.catch) p.catch(() => {});
  }
  function setMuted(m) { muted = m; store.set(LS.mute, m); if (m) music.forEach(a => a.pause()); else play(wantTrack); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) music.forEach(a => a.pause()); else if (!muted) play(wantTrack); });
  return {unlock, sfx, play, setMuted, get muted() { return muted; }};
})();

/* ---------- 狀態 ---------- */
let BANK = [], G = null, boardCache = null, lastSubmitted = null;
function show(name) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 's-' + name; });
  $('app').dataset.screen = name; window.scrollTo(0, 0);
}
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- 題庫 ---------- */
async function loadBank() {
  const r = await fetch(`./data/questions.json?v=${encodeURIComponent(CFG.version)}`, {cache: 'no-cache'});
  if (!r.ok) throw new Error('題庫下載失敗');
  const d = await r.json(); BANK = d.questions || [];
  $('about-ver').textContent = `題庫版本 ${d.version || ''}，共 ${BANK.length} 題。`;
  for (const lv of LEVELS) if (BANK.filter(q => q.d === lv.key).length < PER_LEVEL) throw new Error('題庫題數不足');
}
function pickQuestions() {
  const seen = new Set(store.get(LS.seen, [])); const out = [], groups = new Set();
  for (const lv of LEVELS) {
    const pool = BANK.filter(q => q.d === lv.key);
    let fresh = shuffle(pool.filter(q => !seen.has(q.id)));
    if (fresh.length < PER_LEVEL + 4) { pool.forEach(q => seen.delete(q.id)); fresh = fresh.concat(shuffle(pool.filter(q => !fresh.includes(q)))); }
    // 同一場次在同一級最多兩題；同一主張（g 相同）整局只出一題
    const picked = [], perEvent = {};
    const take = (q, strict) => {
      if (picked.includes(q) || (q.g && groups.has(q.g))) return;
      const n = perEvent[q.j] || 0; if (strict && n >= 2) return;
      perEvent[q.j] = n + 1; if (q.g) groups.add(q.g); picked.push(q);
    };
    for (const q of fresh) { if (picked.length === PER_LEVEL) break; take(q, true); }
    for (const q of fresh) { if (picked.length === PER_LEVEL) break; take(q, false); }
    for (const q of fresh) { if (picked.length === PER_LEVEL) break; if (!picked.includes(q)) picked.push(q); }
    out.push(...picked);
  }
  out.forEach(q => seen.add(q.id)); store.set(LS.seen, [...seen]);
  return out.map(q => ({q, options: shuffle([q.a, ...q.x].map(text => ({text, right: text === q.a})))}));
}

/* ---------- 遊戲流程 ---------- */
function startGame() {
  G = {items: pickQuestions(), i: 0, score: 0, ms: 0, correct: 0, log: [], balloons: START_BALLOONS, t0: 0, answered: false, perLevel: [0, 0, 0]};
  lastSubmitted = null; levelIntro(0);
}
function levelIntro(li) {
  const lv = LEVELS[li];
  $('s-level').dataset.peril = lv.peril;
  $('lv-no').textContent = `第${li + 1}關／3`;
  $('lv-name').textContent = `${lv.name}・${lv.title}`;
  $('lv-desc').textContent = lv.desc;
  $('lv-pts').textContent = `10題，每題${lv.pts}分。目前${G.score}分，救援線${GOAL}分。`;
  [...$('lv-dots').children].forEach((d, k) => d.classList.toggle('on', k <= li));
  show('level'); Sound.play(lv.music); if (li > 0) Sound.sfx('s05');
}
function renderBalloons() {
  const b = $('balloons'); b.innerHTML = '';
  for (let k = 0; k < MAX_BALLOONS; k++) { const i = document.createElement('i'); i.className = 'balloon' + (k < G.balloons ? '' : ' popped'); b.appendChild(i); }
  // 氣球越少掛得越低；最低時整隻角色仍完整留在場景內
  requestAnimationFrame(() => {
    const sc = $('scene'), h = $('hang'); const room = Math.max(0, sc.clientHeight - h.offsetHeight - 8);
    h.style.setProperty('--drop-px', Math.round(room * (MAX_BALLOONS - G.balloons) / (MAX_BALLOONS - 1)) + 'px');
  });
}
function renderGauge() {
  $('gauge-fill').style.width = Math.min(100, G.score) + '%';
  $('gauge-num').textContent = '目前' + G.score + '分';
  $('gauge-need').textContent = G.score >= GOAL ? '已過60分救援線！' : `還差${GOAL - G.score}分到救援線`;
  $('gauge-fill').parentElement.classList.toggle('safe', G.score >= GOAL);
}
function quoteHTML(q) {
  if (q.t === '挖空') return esc(q.s).replace(/＿＿+/g, '<span class="blank">？</span>');
  if (q.t === '接話') return esc(q.s) + '<span class="blank">？</span>';
  return '下面哪一句是他說的？';
}
function showQuestion() {
  const it = G.items[G.i], q = it.q, li = Math.floor(G.i / PER_LEVEL), lv = LEVELS[li];
  G.answered = false;
  $('hud-q').textContent = `第${G.i + 1}題／30`; $('hud-lv').textContent = `${lv.name}・${lv.pts}分`;
  $('scene').dataset.peril = lv.peril; renderBalloons(); renderGauge();
  $('q-context').textContent = q.c || '';
  const qq = $('q-quote'); qq.innerHTML = quoteHTML(q); qq.classList.toggle('is-pick', q.t === '選原話');
  const box = $('q-options'); box.innerHTML = ''; box.classList.remove('answered');
  it.options.forEach((o, k) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'opt';
    b.innerHTML = `<span class="opt-key">${'ABCD'[k]}</span><span class="opt-text">${esc(o.text)}</span><span class="opt-tag" hidden></span>`;
    b.addEventListener('click', () => answer(k)); box.appendChild(b);
  });
  $('q-reveal').hidden = true; $('scene-hint').hidden = G.i > 1;
  show('quiz'); $('q-body').scrollTop = 0;
  G.t0 = performance.now(); tick();
}
let tickTimer = 0;
function tick() {
  clearInterval(tickTimer);
  const upd = () => { $('hud-time').textContent = fmtTime(G.ms + (G.answered ? 0 : performance.now() - G.t0)); };
  upd(); tickTimer = setInterval(upd, 500);
}
function fx(text, color) {
  const e = document.createElement('span'); e.className = 'fx-pop'; e.textContent = text; e.style.color = color;
  e.style.left = '50%'; e.style.top = '34%'; e.style.marginLeft = '34px'; $('scene-fx').appendChild(e); setTimeout(() => e.remove(), 900);
}
function answer(k) {
  if (G.answered) return; G.answered = true;
  const it = G.items[G.i], q = it.q, li = Math.floor(G.i / PER_LEVEL), lv = LEVELS[li];
  const used = Math.min(performance.now() - G.t0, 120000); // 單題最多計兩分鐘，避免切出去再回來灌時間
  G.ms += used; clearInterval(tickTimer); $('hud-time').textContent = fmtTime(G.ms);
  const right = it.options[k].right;
  const box = $('q-options'); box.classList.add('answered');
  [...box.children].forEach((b, j) => {
    const o = it.options[j], tag = b.querySelector('.opt-tag'); tag.hidden = false;
    b.classList.add(o.right ? 'is-right' : 'is-wrong'); if (j === k) b.classList.add('is-picked');
    tag.textContent = o.right ? '✓ 他說的' : (j === k ? '你選的・不是他說的' : '不是他說的'); b.disabled = true;
    b.setAttribute('aria-label', `${'ABCD'[j]}，${o.text}，${o.right ? '這是他說的' : '這不是他說的'}`);
  });
  const sc = $('scene');
  if (right) {
    G.score += lv.pts; G.correct++; G.perLevel[li]++; G.balloons = Math.min(MAX_BALLOONS, G.balloons + 1);
    Sound.sfx('s01'); fx('+' + lv.pts, '#2F8F5B'); sc.classList.add('cheer'); setTimeout(() => sc.classList.remove('cheer'), 900);
  } else {
    G.balloons = Math.max(1, G.balloons - 1);
    Sound.sfx('s02'); setTimeout(() => Sound.sfx('s04', .45), 260); fx('啪！', '#B5475A'); sc.classList.add('shake'); setTimeout(() => sc.classList.remove('shake'), 500);
  }
  const before = G.score - (right ? lv.pts : 0);
  renderBalloons(); renderGauge();
  if (before < GOAL && G.score >= GOAL) { setTimeout(() => { Sound.sfx('s05'); toast('過救援線了！繼續衝高分'); }, 350); }
  G.log.push({id: q.id, c: it.options[k].text, ok: right, ms: Math.round(used)});
  // 揭曉
  const v = $('rv-verdict'); v.textContent = right ? `答對了，+${lv.pts}分` : '答錯了，氣球破了一顆'; v.className = 'rv-verdict ' + (right ? 'ok' : 'no');
  const full = q.f || q.a;
  let html = `<small>他的原話</small>「${esc(full)}」`;
  if (q.r) html += `<small style="margin-top:6px">他接著（或前面）還說</small>「${esc(q.r)}」`;
  $('rv-quote').innerHTML = html;
  const link = srcLink(q);
  $('rv-source').innerHTML = `${esc(q.e || '')}${q.dt ? '，' + esc(q.dt) : ''}${link ? `　<a href="${esc(link)}" target="_blank" rel="noopener">看原片</a>` : ''}`;
  const nb = $('btn-next'); nb.textContent = G.i === G.items.length - 1 ? '看救援結果 →' : ((G.i + 1) % PER_LEVEL === 0 ? '進下一關 →' : '下一題 →');
  nb.disabled = true; setTimeout(() => { nb.disabled = false; }, 600);
  $('q-reveal').hidden = false;
  requestAnimationFrame(() => { $('rv-verdict').scrollIntoView({behavior: 'smooth', block: 'center'}); });
}
function srcLink(q) {
  if (!q.u) return '';
  const t = Math.max(0, Math.floor(q.ts || 0));
  if (/youtube\.com\/watch|youtu\.be\//.test(q.u) && t) return q.u + (q.u.includes('?') ? '&' : '?') + 't=' + t + 's';
  if (/youtube\.com\/live\//.test(q.u) && t) return q.u + '?t=' + t + 's';
  return q.u;
}
function next() {
  Sound.sfx('s03', .5);
  G.i++;
  if (G.i >= G.items.length) return endGame();
  if (G.i % PER_LEVEL === 0) { G.balloons = START_BALLOONS; return levelIntro(G.i / PER_LEVEL); }
  showQuestion();
}
function endGame() {
  const win = G.score >= GOAL, es = $('end-scene');
  es.className = 'end-scene ' + (win ? 'win' : 'lose'); es.dataset.peril = 'fire';
  $('end-title').innerHTML = win ? '救援成功！<small>奔奔抱抱平安落地</small>' : `還差${GOAL - G.score}分<small>奔奔抱抱還掛在半空中</small>`;
  $('btn-share').classList.toggle('btn-primary', win); $('btn-again').classList.toggle('btn-primary', !win); 
  $('end-sub').textContent = win ? (G.score === 100 ? '滿分！你是超級PUMA語錄王。' : '謝謝你，他們要抱抱你一下。') : '氣球還撐著，再救一次就上來了。';
  $('end-score').textContent = G.score; $('end-time').textContent = fmtTime(G.ms); $('end-correct').textContent = G.correct + '／30';
  $('end-levels').textContent = `初級答對${G.perLevel[0]}題、中級${G.perLevel[1]}題、高級${G.perLevel[2]}題。`;
  const cf = $('confetti'); cf.innerHTML = '';
  if (win) { const cols = ['#F0637A', '#FFD467', '#5FB884', '#8FCDEB']; for (let k = 0; k < 26; k++) { const i = document.createElement('i'); i.style.left = Math.random() * 100 + '%'; i.style.background = cols[k % 4]; i.style.animationDuration = 2.4 + Math.random() * 2.4 + 's'; i.style.animationDelay = -Math.random() * 4 + 's'; cf.appendChild(i); } }
  $('name-input').value = store.get(LS.name, ''); $('name-msg').textContent = ''; $('btn-submit').disabled = false; $('name-form').hidden = false;
  show('end'); Sound.play(win ? 'm05' : 'm06'); Sound.sfx(win ? 's06' : 's07');
}

/* ---------- 排行榜 ---------- */
const BAD = ['幹', '屌', '屄', '肏', '雞巴', '機掰', '雞掰', '婊', '妓', '賤', '智障', '白痴', '垃圾', '去死', '死全家', '殺', '強姦', '性侵', '支那', '納粹', 'fuck', 'shit', 'bitch', 'dick', 'cunt', 'nigg', 'http', 'www', '.com', '@'];
function cleanName(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f​-‏‪-‮﻿<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  if (!s) return {err: '請輸入ID'};
  const low = s.toLowerCase().replace(/\s/g, '');
  if (BAD.some(w => low.includes(w))) return {err: '這個ID不能用，換一個吧'};
  return {name: s};
}
const sortBoard = a => a.sort((x, y) => y.score - x.score || x.ms - y.ms || x.at - y.at);
async function submitScore(name) {
  const rec = {name, score: G.score, ms: Math.round(G.ms), at: Date.now()};
  const local = store.get(LS.board, []); local.push(rec); store.set(LS.board, sortBoard(local).slice(0, 50));
  lastSubmitted = rec;
  if (!CFG.api) return {mode: 'local'};
  const r = await fetch(CFG.api + '/submit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, v: CFG.version, picks: G.log.map(l => ({id: l.id, c: l.c, ms: l.ms}))})});
  if (!r.ok) throw new Error('排行榜暫時連不上');
  const d = await r.json(); boardCache = null; return {mode: 'online', rank: d.rank};
}
async function loadBoard() {
  if (!CFG.api) return {rows: store.get(LS.board, []), mode: 'local'};
  if (boardCache && Date.now() - boardCache.at < 30000) return boardCache.data;
  try {
    const r = await fetch(CFG.api + '/top'); if (!r.ok) throw 0;
    const d = await r.json(); const data = {rows: d.rows || [], mode: 'online', total: d.total}; boardCache = {at: Date.now(), data}; return data;
  } catch (e) { return {rows: store.get(LS.board, []), mode: 'offline'}; }
}
async function openBoard(from) {
  openBoard.from = from || 'title'; show('board'); Sound.play('m07');
  const ol = $('board'); ol.innerHTML = '<li class="board-empty">載入中…</li>';
  const {rows, mode, total} = await loadBoard();
  $('board-note').textContent = '先比分數；同分比解題時間，快的在前。' + (mode === 'local' ? '（目前顯示這台裝置上的紀錄）' : mode === 'offline' ? '（連不上排行榜，先顯示這台裝置上的紀錄）' : total ? `　共${total}人挑戰` : '');
  if (!rows.length) { ol.innerHTML = '<li class="board-empty">還沒有人上榜，搶第一名！</li>'; return; }
  $('btn-board-play').textContent = G && G.log.length === 30 ? '再挑戰一次' : '開始挑戰';
  ol.innerHTML = rows.slice(0, 100).map((r, i) => `<li class="${lastSubmitted && r.name === lastSubmitted.name && r.score === lastSubmitted.score && r.ms === lastSubmitted.ms ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score}分</span><span class="tm">${fmtTime(r.ms)}</span></li>`).join('');
}

/* ---------- 作答回顧 ---------- */
function openReview(filter) {
  const f = typeof filter === 'string' ? filter : 'all', nOk = G.log.filter(l => l.ok).length;
  $('review-tabs').innerHTML = [['all', `全部${G.log.length}題`], ['ok', `答對${nOk}題`], ['no', `答錯${G.log.length - nOk}題`]].map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${k === f}">${t}</button>`).join('');
  $('review-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => openReview(b.dataset.f)));
  $('review').innerHTML = G.items.map((it, i) => {
    const q = it.q, l = G.log[i]; if (!l || (f === 'ok' && !l.ok) || (f === 'no' && l.ok)) return ''; const link = srcLink(q);
    return `<div class="rv-item"><div class="hd"><span>第${i + 1}題・${LEVELS[Math.floor(i / PER_LEVEL)].name}</span><span class="res ${l.ok ? 'ok' : 'no'}">${l.ok ? '✓ 答對' : '✕ 答錯'}</span></div>
      <q>${esc(q.f || q.a)}</q>${l.ok ? '' : `<div class="yours">你選的（不是他說的）：${esc(l.c)}</div>`}
      <div class="meta"><span>${esc(q.e || '')}${q.dt ? '，' + esc(q.dt) : ''}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">看原片</a>` : ''}</div></div>`;
  }).join('');
  show('review');
}

/* ---------- 分享圖 ---------- */
function loadImg(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }); }
function wrap(c, text, x, y, maxW, lh, maxLines) {
  let line = '', n = 0;
  for (const ch of text) {
    if (c.measureText(line + ch).width > maxW) { n++; if (n === maxLines) { c.fillText(line.slice(0, -1) + '…', x, y); return y + lh; } c.fillText(line, x, y); y += lh; line = ch; } else line += ch;
  }
  if (line) { c.fillText(line, x, y); y += lh; } return y;
}
async function makeShare() {
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const win = G.score >= GOAL, F = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  c.fillStyle = '#FBF4E6'; c.fillRect(0, 0, W, H);
  try { const bg = await loadImg(win ? './img/bg_win.webp' : './img/bg_title.webp'); c.globalAlpha = .55; c.drawImage(bg, 0, H - 1620, W, 1620); c.globalAlpha = 1; } catch (e) { /* 無底圖也可 */ }
  c.textAlign = 'center'; c.lineJoin = 'round';
  const stroke = (t, x, y, size, fill) => { c.font = `900 ${size}px ${F}`; c.lineWidth = size * .14; c.strokeStyle = '#2B2118'; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y); };
  stroke('超級PUMA語錄王', W / 2, 150, 104, '#F0637A');
  c.fillStyle = '#2B2118'; c.font = `900 60px ${F}`; c.fillText(win ? '我救回奔奔抱抱了！' : `還差${GOAL - G.score}分就救到奔奔抱抱`, W / 2, 262);
  // 成績卡
  const card = (x, y, w, h) => { c.fillStyle = '#FFFDF7'; c.strokeStyle = '#2B2118'; c.lineWidth = 6; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, 32) : c.rect(x, y, w, h); c.fill(); c.stroke(); };
  card(90, 320, 900, 250);
  c.fillStyle = '#2B2118'; c.font = `900 170px ${F}`; c.fillText(String(G.score), 330, 505); c.font = `700 44px ${F}`; c.fillText('分', 480, 500);
  c.font = `900 84px ${F}`; c.fillText(fmtTime(G.ms), 750, 460); c.font = `700 38px ${F}`; c.fillStyle = '#6B5D50'; c.fillText('解題時間', 750, 520);
  // 30格
  const sx = 115, sy = 620, cell = 72, gap = 14;
  G.log.forEach((l, i) => { const x = sx + (i % 10) * (cell + gap), y = sy + Math.floor(i / 10) * (cell + gap);
    c.fillStyle = l.ok ? '#5FB884' : '#E9DFCC'; c.strokeStyle = '#2B2118'; c.lineWidth = 4; c.beginPath(); c.roundRect ? c.roundRect(x, y, cell, cell, 14) : c.rect(x, y, cell, cell); c.fill(); c.stroke(); });
  c.textAlign = 'left'; c.fillStyle = '#6B5D50'; c.font = `700 30px ${F}`;
  ['初級', '中級', '高級'].forEach((t, k) => c.fillText(t, sx + 10 * (cell + gap) + 4, sy + k * (cell + gap) + 48));
  // 一句原話（優先用答對的題）
  const pick = (G.log.map((l, i) => ({l, q: G.items[i].q})).filter(o => o.l.ok && (o.q.f || o.q.a).length <= 46).pop() || {q: G.items[0].q}).q;
  card(90, 910, 900, 250); c.fillStyle = '#F0637A'; c.font = `900 80px ${F}`; c.fillText('「', 110, 990);
  c.fillStyle = '#2B2118'; c.font = `700 40px ${F}`; let y = wrap(c, (pick.f || pick.a), 180, 985, 770, 58, 3);
  c.fillStyle = '#6B5D50'; c.font = `500 28px ${F}`; c.fillText(`沈伯洋，${pick.e || ''}`.slice(0, 30), 180, Math.min(y + 8, 1130));
  try { const sp = await loadImg('./img/pat.webp'); const fw = sp.width / 8; c.drawImage(sp, 0, 0, fw, sp.height, W - 330, 1140, 290, 290 * sp.height / fw); } catch (e) { /* 無吉祥物也可 */ }
  c.textAlign = 'left'; c.fillStyle = '#2B2118'; c.font = `900 40px ${F}`; c.fillText('你也來救救看', 90, 1250);
  c.font = `500 30px ${F}`; c.fillStyle = '#6B5D50'; c.fillText(CFG.site.replace(/^https?:\/\//, '').replace(/\/$/, ''), 90, 1300);
  return new Promise(ok => cv.toBlob(b => ok(b), 'image/png'));
}
async function share() {
  const b = $('btn-share'); b.disabled = true;
  try {
    const blob = await makeShare(); const file = new File([blob], 'puma-quiz.png', {type: 'image/png'});
    const text = `我在「超級PUMA語錄王」拿到${G.score}分（${fmtTime(G.ms)}），${G.score >= GOAL ? '救回奔奔抱抱了' : '差一點救到奔奔抱抱'}！`;
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], text, url: CFG.site}); }
    else { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'puma-quiz.png'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); toast('成績圖已存下來；存不了的話請長按圖片儲存', 3200); if (/Line|FBAN|FBAV|Instagram/i.test(navigator.userAgent)) window.open(url, '_blank'); }
  } catch (e) { if (e && e.name !== 'AbortError') toast('分享沒有成功，再試一次'); }
  b.disabled = false;
}

/* ---------- 綁定 ---------- */
function bind() {
  const tap = (id, fn) => $(id).addEventListener('click', e => { Sound.unlock(); fn(e); });
  tap('btn-start', () => { Sound.sfx('s03'); startGame(); });
  tap('btn-level-go', () => { Sound.sfx('s03'); showQuestion(); });
  tap('btn-next', next);
  tap('btn-again', () => { Sound.sfx('s03'); startGame(); });
  tap('btn-share', share);
  tap('btn-review', () => openReview('all'));
  tap('btn-board-play', () => { Sound.sfx('s03'); startGame(); });
  tap('btn-review-back', () => show('end'));
  tap('btn-board', () => openBoard('title'));
  tap('btn-board2', () => openBoard('end'));
  tap('btn-board-back', () => { if (openBoard.from === 'end' && G) { show('end'); Sound.play(G.score >= GOAL ? 'm05' : 'm06'); } else { show('title'); Sound.play('m01'); } });
  tap('btn-about', () => show('about'));
  tap('btn-about-back', () => show('title'));
  tap('btn-sound', () => { const m = !Sound.muted; Sound.setMuted(m); $('btn-sound').setAttribute('aria-pressed', String(!m)); });
  $('btn-sound').setAttribute('aria-pressed', String(!Sound.muted));
  $('name-form').addEventListener('submit', async e => {
    e.preventDefault(); Sound.unlock();
    const r = cleanName($('name-input').value), msg = $('name-msg');
    if (r.err) { msg.textContent = r.err; return; }
    $('btn-submit').disabled = true; msg.textContent = '送出中…'; store.set(LS.name, r.name);
    try { const res = await submitScore(r.name); msg.textContent = res.mode === 'online' ? `上榜了！目前第${res.rank}名` : '已記錄在這台裝置的排行榜'; $('name-input').blur(); }
    catch (err) { msg.textContent = '排行榜暫時連不上，成績已先記在這台裝置'; }
  });
  document.addEventListener('keydown', e => {
    if ($('app').dataset.screen !== 'quiz') return;
    const k = 'abcd'.indexOf(e.key.toLowerCase()), n = '1234'.indexOf(e.key);
    const idx = k >= 0 ? k : n; if (idx >= 0 && !G.answered) answer(idx);
    else if ((e.key === 'Enter' || e.key === ' ') && G.answered && !$('btn-next').disabled && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); next(); }
  });
}
async function boot() {
  bind();
  try { await loadBank(); show('title'); Sound.play('m01'); }
  catch (e) { $('boot-status').textContent = (e && e.message) || '載入失敗'; const b = $('boot-retry'); b.hidden = false; b.onclick = () => location.reload(); }
}
window.__puma = {get state() { return G; }, get bank() { return BANK; }};
boot();
})();
