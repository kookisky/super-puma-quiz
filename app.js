/* 超級PUMA語錄王：遊戲本體（純靜態，無框架）第二版 */
(() => {
'use strict';
const CFG = Object.assign({api: '', version: 'dev', site: location.origin + location.pathname, sfx: false}, window.PUMA_CONFIG || {});
const $ = id => document.getElementById(id);
const LEVELS = [
  {key: '初', name: '初級', peril: 'water', pts: 3, title: '水面上', desc: '奔奔抱抱飄到水面上了！', music: 'm02'},
  {key: '中', name: '中級', peril: 'pit', pts: 3, title: '大洞上', desc: '風把他們吹到大洞上面！', music: 'm03'},
  {key: '高', name: '高級', peril: 'fire', pts: 4, title: '營火上', desc: '最後一關，下面是熱呼呼的營火！', music: 'm04'},
];
const PER_LEVEL = 10, TOTAL = 30, GOAL = 60, SLOTS = 6; // 每10分一顆氣球，集滿6顆（60分）得救
const LS = {seen: 'puma.seen.v2', board: 'puma.board.v2', name: 'puma.name', mute: 'puma.mute', best: 'puma.best.v1'};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ } },
  arr(k, ok) { const v = this.get(k, []); return Array.isArray(v) ? v.filter(ok) : []; },
};
const fmtTime = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
async function fetchTimed(url, opt = {}, ms = 15000) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null; const t = setTimeout(() => ac && ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opt, ac ? {signal: ac.signal} : {})); } finally { clearTimeout(t); }
}

/* ---------- 聲音 ---------- */
const Sound = (() => {
  let ctx = null, muted = !!store.get(LS.mute, false), unlocked = false, wantTrack = null;
  const buffers = new Map(), missing = new Set();
  const SFX = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08'];
  const synth = { // 音效檔還沒做好時用的合成音
    s01: [[660, 0, .09], [880, .09, .09], [1320, .18, .16]], s02: [[330, 0, .14], [247, .14, .22]], s03: [[520, 0, .05]],
    s04: [[740, 0, .08], [622, .1, .08], [740, .2, .08]], s05: [[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .25]],
    s06: [[784, 0, .1], [988, .1, .1], [1175, .2, .1], [1568, .3, .4]], s07: [[600, 0, .5, 200]], s08: [[900, 0, .04]],
  };
  function ensureCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx && ctx.state !== 'running' && !document.hidden) { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 略 */ } }
    return ctx;
  }
  function loadSfx(name) {
    if (!CFG.sfx || buffers.has(name) || missing.has(name) || !ctx) return;
    missing.add(name);
    fetch(`./audio/${name}.mp3`).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)))
      .then(buf => { buffers.set(name, buf); missing.delete(name); }).catch(() => {});
  }
  function unlock() { if (unlocked) return; unlocked = true; ensureCtx(); SFX.forEach(loadSfx); }
  function sfx(name, vol = .7) {
    if (muted || !unlocked || !ensureCtx()) return;
    const t = ctx.currentTime, buf = buffers.get(name);
    if (buf) { const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = vol; s.connect(g); g.connect(ctx.destination); s.start(); return; }
    (synth[name] || []).forEach(([f, at, dur, f2]) => {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t + at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + dur);
      e.gain.setValueAtTime(0, t + at); e.gain.linearRampToValueAtTime(vol * .35, t + at + .01); e.gain.exponentialRampToValueAtTime(.001, t + at + dur);
      o.connect(e); e.connect(ctx.destination); o.start(t + at); o.stop(t + at + dur + .02);
    });
  }
  // 配樂用 Web Audio 的緩衝循環（接縫無空隙）；只留正在播的那一首
  let cur = null, curName = null, loading = null;
  function loadMusic(name) {
    return fetch(`./audio/${name}.mp3`).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no))).catch(() => null);
  }
  function stopMusic() {
    if (!cur) return; const {src, gain} = cur; cur = null; curName = null;
    try { const t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + .35); src.stop(t + .4); } catch (e) { /* 已停 */ }
  }
  function play(name) {
    wantTrack = name;
    if (!unlocked || !ensureCtx()) return;
    if (muted || !name) { stopMusic(); return; }
    if (curName === name || loading === name) return;
    stopMusic(); loading = name;
    loadMusic(name).then(buf => {
      if (loading === name) loading = null;
      if (!buf || wantTrack !== name || muted || curName === name || document.hidden) return;
      const src = ctx.createBufferSource(), gain = ctx.createGain(); src.buffer = buf; src.loop = true;
      gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(.34, ctx.currentTime + .5);
      src.connect(gain); gain.connect(ctx.destination); src.start(); cur = {src, gain}; curName = name;
    });
  }
  function setMuted(m) { muted = m; store.set(LS.mute, m); if (m) stopMusic(); else { unlock(); play(wantTrack); } }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopMusic(); if (ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) { /* 略 */ } } }
    else { ensureCtx(); if (!muted) play(wantTrack); }
  });
  return {unlock, sfx, play, setMuted, get muted() { return muted; }};
})();

/* ---------- 狀態 ---------- */
let BANK = [], BANK_VER = '', G = null, lastSubmitted = null;
function show(name) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 's-' + name; });
  $('app').dataset.screen = name; window.scrollTo(0, 0);
}
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); }
function syncSoundBtns() { document.querySelectorAll('.js-sound').forEach(b => b.setAttribute('aria-pressed', String(!Sound.muted))); }

/* ---------- 題庫 ---------- */
async function loadBank() {
  let d;
  try {
    const r = await fetchTimed(`./data/questions.json?v=${encodeURIComponent(CFG.version)}`, {cache: 'no-cache'});
    if (!r.ok) throw 0; d = await r.json();
  } catch (e) { throw new Error('網路不穩，題庫沒載入，請按重新載入'); }
  BANK = Array.isArray(d.questions) ? d.questions : []; BANK_VER = String(d.version || '');
  if (d.pts) LEVELS.forEach(lv => { if (d.pts[lv.key]) lv.pts = d.pts[lv.key]; });
  $('about-ver').textContent = `題庫版本 ${BANK_VER}，共 ${BANK.length} 題。`;
  $('about-pts').textContent = `計分：初級每題${LEVELS[0].pts}分、中級每題${LEVELS[1].pts}分、高級每題${LEVELS[2].pts}分，滿分100分。每10分得到一顆氣球，集滿6顆（60分）就救回奔奔抱抱。排行榜先比分數，同分比解題時間；每局題目隨機抽。`;
  for (const lv of LEVELS) if (BANK.filter(q => q.d === lv.key).length < PER_LEVEL) throw new Error('題庫題數不足，請稍後再試');
}
// 抽題：沒看過的優先；同一級同一場次最多2題、同題組整局1題、純數字題每級最多3題；高級一半取較易、一半取較難
function pickQuestions() {
  const seen = new Set(store.arr(LS.seen, x => typeof x === 'string'));
  const groups = new Set(), out = [];
  const tryPick = (cands, n, per, st, relax) => {
    let got = 0;
    for (const q of cands) {
      if (got === n) break;
      if (out.includes(q) || st.sel.includes(q) || (q.g && groups.has(q.g))) continue;
      const c = per[q.j] || 0;
      if (relax < 2 && c >= 2) continue;
      if (relax < 1 && q.n && st.num >= 3) continue;
      per[q.j] = c + 1; st.num += q.n ? 1 : 0; if (q.g) groups.add(q.g); got++; st.sel.push(q);
    }
  };
  for (const lv of LEVELS) {
    const pool = BANK.filter(q => q.d === lv.key);
    let fresh = pool.filter(q => !seen.has(q.id));
    if (fresh.length < PER_LEVEL + 6) fresh = pool.slice();
    const order = shuffle(fresh.slice()).concat(shuffle(pool.filter(q => !fresh.includes(q))));
    const per = {}, st = {num: 0, sel: []};
    if (lv.key === '高') { tryPick(order.filter(q => !q.h), 5, per, st, 0); tryPick(order.filter(q => q.h), 5, per, st, 0); }
    for (let relax = 0; relax <= 2 && st.sel.length < PER_LEVEL; relax++) tryPick(order, PER_LEVEL - st.sel.length, per, st, relax);
    if (fresh.length === pool.length) store.set(LS.seen, [...seen].filter(id => !pool.some(q => q.id === id))); // 這一級輪完了，重新開始記
    out.push(...shuffle(st.sel));
  }
  return out.map(q => {
    const options = shuffle([q.a, ...q.x].map(text => ({text, right: text === q.a})));
    // 選原話、接話題：四個選項開頭相同時，把共同開頭移到題面，選項只留不同的部分
    let pre = 0;
    if (q.t !== '挖空') {
      const ts = options.map(o => o.text); const m = Math.min(...ts.map(t => t.length));
      while (pre < m && ts.every(t => t[pre] === ts[0][pre])) pre++;
      if (pre < 8 || ts.some(t => t.length - pre < 2)) pre = 0;
    }
    options.forEach(o => { o.show = pre ? '…' + o.text.slice(pre) : o.text; });
    return {q, options, prefix: pre ? options[0].text.slice(0, pre) : ''};
  });
}
function markSeen(id) { const s = store.arr(LS.seen, x => typeof x === 'string'); if (!s.includes(id)) { s.push(id); store.set(LS.seen, s); } }

/* ---------- 遊戲流程 ---------- */
function startGame() {
  if (G && G.shareURL) { try { URL.revokeObjectURL(G.shareURL); } catch (e) { /* 略 */ } }
  G = {items: pickQuestions(), i: 0, score: 0, ms: 0, correct: 0, log: [], t0: 0, answered: true, perLevel: [0, 0, 0], run: null, submitted: false, submitting: false, hiddenAt: 0};
  lastSubmitted = null;
  if (CFG.api) { const g = G; fetchTimed(CFG.api + '/start', {method: 'POST'}, 10000).then(r => r.ok ? r.json() : null).then(d => { if (d && d.rid) g.run = {rid: d.rid, t: d.t, sig: d.sig}; }).catch(() => {}); }
  levelIntro(0);
}
const maxPossible = () => G.score + LEVELS.reduce((a, lv, li) => a + lv.pts * Math.max(0, Math.min(PER_LEVEL, (li + 1) * PER_LEVEL - G.log.length)), 0);
function levelIntro(li) {
  const lv = LEVELS[li];
  $('s-level').dataset.peril = lv.peril;
  $('lv-no').textContent = `第${li + 1}關／3`;
  $('lv-name').textContent = `${lv.name}・${lv.title}`;
  $('lv-desc').textContent = lv.desc;
  let line2 = `目前${G.score}分，救援線${GOAL}分。`;
  if (li === LEVELS.length - 1) {
    if (G.score >= GOAL) line2 = `目前${G.score}分，已經救到了，衝高分！`;
    else { const need = Math.ceil((GOAL - G.score) / lv.pts); line2 = need <= PER_LEVEL ? `目前${G.score}分，這關答對${need}題就救回他們！` : `目前${G.score}分，這局救不到了，衝高分！`; }
  }
  $('lv-pts').innerHTML = `<span>10題，每題${lv.pts}分。</span><span>${esc(line2)}</span>`;
  [...$('lv-dots').children].forEach((d, k) => d.classList.toggle('on', k <= li));
  show('level'); Sound.play(lv.music); if (li > 0) Sound.sfx('s05');
}
function renderRescue(animate) {
  const all = Math.floor(G.score / 10), n = Math.min(SLOTS, all), extra = Math.max(0, all - SLOTS);
  const b = $('balloons'); const had = b.querySelectorAll('.balloon:not(.empty)').length;
  b.innerHTML = '';
  for (let k = 0; k < SLOTS; k++) { const i = document.createElement('i'); i.className = 'balloon' + (k < n ? '' : ' empty') + (animate && k < n && k >= had ? ' pop-in' : ''); b.appendChild(i); }
  $('balloons-extra').textContent = extra ? `＋${extra}` : '';
  $('hud-balloons').textContent = `氣球${n}／${SLOTS}${extra ? '＋' + extra : ''}`;
  $('gauge-fill').style.width = Math.min(100, G.score) + '%';
  $('gauge-num').textContent = '目前' + G.score + '分';
  const need = GOAL - G.score, can = maxPossible() >= GOAL;
  $('gauge-need').textContent = need <= 0 ? '已過60分救援線！' : can ? `還差${need}分救回他們` : '這局救不到了，衝高分！';
  const gauge = $('gauge'); gauge.classList.toggle('safe', need <= 0);
  gauge.setAttribute('aria-label', `目前${G.score}分，救援線${GOAL}分`);
  // 氣球越多升得越高；分數為零時掛在最低處，仍完整留在場景內
  requestAnimationFrame(() => {
    const sc = $('scene'), h = $('hang'); const room = Math.max(0, sc.clientHeight - h.offsetHeight - 6);
    h.style.setProperty('--drop-px', Math.round(room * (1 - Math.min(GOAL, G.score) / GOAL)) + 'px');
  });
}
function quoteHTML(it) {
  const q = it.q;
  if (q.t === '挖空') return esc(q.s).replace(/＿＿+/g, '<span class="blank">？</span>');
  if (q.t === '接話') return esc(q.s + it.prefix) + '<span class="blank">？</span>';
  return it.prefix ? esc(it.prefix) + '<span class="blank">？</span>' : '下面哪一句是他說的？';
}
function showQuestion() {
  const it = G.items[G.i], q = it.q, li = Math.floor(G.i / PER_LEVEL), lv = LEVELS[li];
  $('hud-q').textContent = `第${G.i + 1}題／${TOTAL}`; $('hud-lv').textContent = `${lv.name}・${lv.pts}分`;
  $('scene').dataset.peril = lv.peril; renderRescue(false);
  $('q-context').textContent = q.c || '';
  const qq = $('q-quote'); qq.innerHTML = quoteHTML(it); qq.classList.toggle('is-pick', q.t === '選原話' && !it.prefix);
  const box = $('q-options'); box.innerHTML = ''; box.classList.remove('answered');
  it.options.forEach((o, k) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'opt';
    b.innerHTML = `<span class="opt-key">${'ABCD'[k]}</span><span class="opt-text">${esc(o.show)}</span><span class="opt-tag" hidden></span>`;
    b.addEventListener('click', () => answer(k)); box.appendChild(b);
  });
  $('q-reveal').hidden = true; $('next-bar').hidden = true; $('scene-hint').hidden = G.i > 1;
  show('quiz'); markSeen(q.id);
  G.answered = false; G.t0 = performance.now(); G.hiddenAt = 0; tick();
}
const elapsedQ = () => Math.min(Math.max(0, performance.now() - G.t0), 120000); // 單題最多計兩分鐘
let tickTimer = 0;
function tick() {
  clearInterval(tickTimer);
  const upd = () => { $('hud-time').textContent = fmtTime(G.ms + (G.answered ? 0 : elapsedQ())); };
  upd(); tickTimer = setInterval(upd, 500);
}
document.addEventListener('visibilitychange', () => { // 切到背景時暫停這一題的計時
  if (!G || G.answered) return;
  if (document.hidden) G.hiddenAt = performance.now(); else if (G.hiddenAt) { G.t0 += performance.now() - G.hiddenAt; G.hiddenAt = 0; }
});
function fx(text, color) {
  const e = document.createElement('span'); e.className = 'fx-pop'; e.textContent = text; e.style.color = color;
  $('scene-fx').appendChild(e); setTimeout(() => e.remove(), 900);
}
function answer(k) {
  if (!G || G.answered || performance.now() - G.t0 < 400) return; // 新題出現0.4秒內的點擊不算作答（防連點誤答）
  G.answered = true;
  const it = G.items[G.i], q = it.q, li = Math.floor(G.i / PER_LEVEL), lv = LEVELS[li];
  const used = Math.round(elapsedQ());
  G.ms += used; clearInterval(tickTimer); $('hud-time').textContent = fmtTime(G.ms);
  const right = it.options[k].right, before = G.score, ballBefore = Math.floor(before / 10);
  const box = $('q-options'); box.classList.add('answered');
  [...box.children].forEach((b, j) => {
    const o = it.options[j], tag = b.querySelector('.opt-tag'); tag.hidden = false;
    b.classList.add(o.right ? 'is-right' : 'is-wrong'); if (j === k) b.classList.add('is-picked');
    tag.textContent = o.right ? '✓ 他說的' : (j === k ? '你選的・不是他說的' : '不是他說的'); b.disabled = true;
    b.setAttribute('aria-label', `${'ABCD'[j]}，${o.show}，${o.right ? '這是他說的' : '這不是他說的'}`);
  });
  G.log.push({id: q.id, c: it.options[k].text, ok: right, ms: used});
  const sc = $('scene'), hud = $('hud');
  if (right) {
    G.score += lv.pts; G.correct++; G.perLevel[li]++;
    Sound.sfx('s01'); fx('+' + lv.pts, '#246B45'); sc.classList.add('cheer'); setTimeout(() => sc.classList.remove('cheer'), 900);
    hud.classList.add('bump'); setTimeout(() => hud.classList.remove('bump'), 600);
  } else {
    Sound.sfx('s02'); fx('差一點！', '#A3324B'); sc.classList.add('shake'); setTimeout(() => sc.classList.remove('shake'), 500);
  }
  renderRescue(true);
  const gotBalloon = Math.floor(G.score / 10) > ballBefore;
  if (before < GOAL && G.score >= GOAL) { setTimeout(() => { Sound.sfx('s06'); toast('集滿6顆氣球，救到了！繼續衝高分', 2400); sc.classList.add('saved'); setTimeout(() => sc.classList.remove('saved'), 2600); }, 300); }
  else if (gotBalloon) setTimeout(() => Sound.sfx('s05', .5), 250);
  // 揭曉
  const v = $('rv-verdict');
  v.textContent = right ? `答對了，+${lv.pts}分${gotBalloon ? '，多一顆氣球！' : ''}` : '答錯了，這題沒有得分';
  v.className = 'rv-verdict ' + (right ? 'ok' : 'no');
  let html = `<small>他的原話</small>「${esc(q.f || q.a)}」`;
  if (q.r) html += `<small style="margin-top:6px">同一段話裡他還說</small>「${esc(q.r)}」`;
  $('rv-quote').innerHTML = html;
  const link = srcLink(q);
  $('rv-source').innerHTML = `<span>${esc(q.e || '')}${q.dt ? '，' + esc(q.dt) : ''}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">看原片</a>` : ''}`;
  const nb = $('btn-next'); nb.textContent = G.i === G.items.length - 1 ? '看救援結果 →' : ((G.i + 1) % PER_LEVEL === 0 ? '進下一關 →' : '下一題 →');
  nb.disabled = true; setTimeout(() => { nb.disabled = false; try { nb.focus({preventScroll: true}); } catch (e) { /* 略 */ } }, 600);
  $('q-reveal').hidden = false; $('next-bar').hidden = false;
  // 先讓玩家看到氣球與分數的變化，再把揭曉內容捲進畫面
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { if (G && G.answered && $('app').dataset.screen === 'quiz') $('next-bar').scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block: 'end'}); }, 850);
}
function srcLink(q) {
  if (!q.u || !/^https:\/\//.test(q.u)) return '';
  const t = Math.max(0, Math.floor(q.ts || 0));
  if (/youtube\.com\/watch|youtu\.be\//.test(q.u) && t) return q.u + (q.u.includes('?') ? '&' : '?') + 't=' + t + 's';
  if (/youtube\.com\/live\//.test(q.u) && t) return q.u + '?t=' + t + 's';
  return q.u;
}
function next() {
  if (!G || !G.answered || $('btn-next').disabled) return;
  $('btn-next').disabled = true;
  Sound.sfx('s03', .5);
  G.i++;
  if (G.i >= G.items.length) return endGame();
  if (G.i % PER_LEVEL === 0) return levelIntro(G.i / PER_LEVEL);
  showQuestion();
}
function rankTitle(s) { return s >= 100 ? '超級PUMA語錄王' : s >= 80 ? '語錄達人' : s >= GOAL ? '救援成功隊員' : s >= 40 ? '差一點救援隊' : '見習救援員'; }
function endGame() {
  const win = G.score >= GOAL, es = $('end-scene'), gap = GOAL - G.score;
  es.className = 'end-scene ' + (win ? 'win' : 'lose'); es.dataset.peril = 'fire';
  $('end-title').innerHTML = win ? '救援成功！<small>奔奔抱抱平安落地</small>' : `還差${gap}分<small>奔奔抱抱還掛在半空中</small>`;
  $('end-sub').textContent = win ? (G.score === 100 ? '滿分！你就是超級PUMA語錄王。' : `你得到的稱號：${rankTitle(G.score)}`)
    : (gap <= 10 ? '只差一點點，再救一次就上來了。' : gap <= 25 ? '氣球還撐著，多認識他幾句再來救。' : '先看看你答的題，下一局會更熟。');
  $('btn-share').classList.toggle('btn-primary', win); $('btn-again').classList.toggle('btn-primary', !win);
  $('end-score').textContent = G.score; $('end-time').textContent = fmtTime(G.ms); $('end-correct').textContent = G.correct + '／' + TOTAL;
  const best = store.get(LS.best, null); let bestLine = '';
  if (best && typeof best.score === 'number') bestLine = G.score > best.score ? `比你之前的最高分多${G.score - best.score}分！` : `你的最高分：${best.score}分。`;
  if (!best || typeof best.score !== 'number' || G.score > best.score || (G.score === best.score && G.ms < best.ms)) store.set(LS.best, {score: G.score, ms: G.ms});
  $('end-levels').textContent = `初級答對${G.perLevel[0]}題、中級${G.perLevel[1]}題、高級${G.perLevel[2]}題。${bestLine}`;
  const cf = $('confetti'); cf.innerHTML = '';
  if (win) { const cols = ['#F0637A', '#FFD467', '#5FB884', '#8FCDEB']; for (let k = 0; k < 26; k++) { const i = document.createElement('i'); i.style.left = Math.random() * 100 + '%'; i.style.background = cols[k % 4]; i.style.animationDuration = 2.4 + Math.random() * 2.4 + 's'; i.style.animationDelay = -Math.random() * 4 + 's'; cf.appendChild(i); } }
  $('name-input').value = String(store.get(LS.name, '') || '').slice(0, 12); $('name-msg').textContent = ''; $('btn-submit').disabled = false; $('name-form').hidden = false;
  $('share-box').hidden = true; $('btn-share').disabled = true;
  show('end'); Sound.play(win ? 'm05' : 'm06'); Sound.sfx(win ? 's06' : 's07');
  // 先在背景把分享圖做好，按分享時才能立刻呼叫系統分享（Safari 對點擊後的時效要求很短）
  const g = G;
  makeShare(g).then(blob => {
    if (G !== g || !blob) { if (G === g) $('btn-share').disabled = false; return; }
    g.shareBlob = blob; g.shareURL = URL.createObjectURL(blob);
    $('share-img').src = g.shareURL; $('share-dl').href = g.shareURL; $('btn-share').disabled = false;
  }).catch(() => { if (G === g) $('btn-share').disabled = false; });
}

/* ---------- 排行榜 ---------- */
const BAD = ['幹', '屌', '屄', '肏', '雞巴', '機掰', '雞掰', '機歪', '靠北', '靠腰', '三小', '婊', '妓', '賤', '智障', '白痴', '白癡', '垃圾', '去死', '死全家', '殺', '強姦', '性侵', '支那', '納粹', '共匪', '台巴子', '塔綠班', '綠共', '藍蛆', '9.2', '五毛', '習近平', '沈伯洋', '撲馬本人', '競選總部', '官方', '管理員', 'admin', 'fuck', 'shit', 'bitch', 'dick', 'cunt', 'nigg', 'porn', 'sex', 'http', 'www', '.com', '.tw', '@'];
function cleanName(raw) {
  let s = String(raw || '');
  try { s = s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Me}ᅟᅠㅤﾠ⠀᠎<>]/gu, '').replace(/\p{Mn}{2,}/gu, ''); } catch (e) { s = s.replace(/[\u0000-\u001f​-‏‪-‮﻿<>]/g, ''); }
  s = [...s.replace(/\s+/g, ' ').trim()].slice(0, 12).join('');
  const low = s.toLowerCase().replace(/[\s.\-_*·・,，。!！?？'"]/g, '');
  if (!s || !low) return {err: '請輸入ID'};
  if (BAD.some(w => low.includes(w.replace(/\./g, '')))) return {err: '這個ID不能用，換一個吧'};
  return {name: s};
}
const sortBoard = a => a.sort((x, y) => y.score - x.score || x.ms - y.ms || x.at - y.at);
const readLocalBoard = () => store.arr(LS.board, x => x && typeof x.name === 'string' && Number.isFinite(x.score) && Number.isFinite(x.ms));
function saveLocal(g, name) {
  const ms = g.log.reduce((a, l) => a + l.ms, 0), rec = {name, score: g.score, ms, at: g.localAt || (g.localAt = Date.now())};
  const local = readLocalBoard().filter(r => r.at !== rec.at); local.push(rec); store.set(LS.board, sortBoard(local).slice(0, 50));
  return rec;
}
const SUBMIT_MSG = {too_fast: '這次成績沒有登上線上排行榜（作答時間太短），已記在這台裝置', slow_down: '送出太頻繁了，這次成績先記在這台裝置', bad_name: '這個ID不能用，換一個吧',
  version: '題庫剛更新過，這局成績只能記在這台裝置；重新整理頁面後再玩一局就能上榜', bad_run: '這局沒有連上排行榜，成績已記在這台裝置', run_expired: '這局放太久了，成績已記在這台裝置'};
async function submitScore(g, name) {
  const rec = saveLocal(g, name); lastSubmitted = rec;
  if (!CFG.api) return {mode: 'local'};
  if (!g.run) { const e = new Error('norun'); e.code = 'bad_run'; throw e; }
  let r, d = null;
  try { r = await fetchTimed(CFG.api + '/submit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, v: BANK_VER, run: g.run, picks: g.log.map(l => ({id: l.id, c: l.c, ms: l.ms}))})}); d = await r.json(); }
  catch (e) { const er = new Error('net'); er.code = 'net'; throw er; }
  if (!r.ok || !d || !d.ok) { const e = new Error('rejected'); e.code = (d && d.error) || 'net'; throw e; }
  lastSubmitted = {name: d.name, score: d.score, ms: d.ms};
  return {mode: 'online', rank: d.rank};
}
async function loadBoard() {
  if (!CFG.api) return {rows: readLocalBoard(), mode: 'local'};
  try {
    const r = await fetchTimed(CFG.api + '/top', {cache: 'no-store'}, 12000); if (!r.ok) throw 0;
    const d = await r.json(); return {rows: Array.isArray(d.rows) ? d.rows : [], mode: 'online', total: d.total};
  } catch (e) { return {rows: readLocalBoard(), mode: 'offline'}; }
}
async function openBoard(from) {
  openBoard.from = from || 'title'; show('board'); Sound.play('m07');
  $('btn-board-play').textContent = G && G.log.length === TOTAL ? '再挑戰一次' : '開始挑戰';
  const ol = $('board'); ol.innerHTML = '<li class="board-empty">排行榜載入中…</li>';
  const {rows, mode, total} = await loadBoard();
  if ($('app').dataset.screen !== 'board') return;
  $('board-note').textContent = '先比分數；同分比解題時間，快的在前。每局題目隨機抽。' + (mode === 'local' ? '（目前顯示這台裝置上的紀錄）' : mode === 'offline' ? '（連不上排行榜，先顯示這台裝置上的紀錄）' : total ? `共${total}筆成績。` : '');
  if (!rows.length) { ol.innerHTML = '<li class="board-empty">還沒有人上榜，搶第一名！</li>'; return; }
  ol.innerHTML = rows.slice(0, 100).map((r, i) => `<li class="${lastSubmitted && r.name === lastSubmitted.name && r.score === lastSubmitted.score && r.ms === lastSubmitted.ms ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${Number(r.score) || 0}分</span><span class="tm">${fmtTime(Number(r.ms) || 0)}</span></li>`).join('');
  const me = ol.querySelector('.me'); if (me) me.scrollIntoView({block: 'nearest'});
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
// 斷行：行首不放標點、連續英數字不從中間切；回傳各行
function wrapLines(c, text, maxW, maxLines) {
  const toks = String(text).match(/[A-Za-z0-9０-９.%％]+|[\s\S]/g) || [], HEAD = '，。、！？」』）：；…—';
  const lines = []; let line = '';
  for (const tk of toks) {
    if (c.measureText(line + tk).width > maxW && line) {
      const chars = [...line];
      if (HEAD.includes(tk) && chars.length > 1) { const last = chars.pop(); lines.push(chars.join('')); line = last + tk; }
      else { lines.push(line); line = tk.trim() ? tk : ''; }
    } else line += tk;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = [...lines[maxLines - 1]].slice(0, -1).join('') + '…'; }
  return lines;
}
async function makeShare(g) {
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const win = g.score >= GOAL, F = '"Noto Sans TC","PingFang TC","Heiti TC","Microsoft JhengHei",sans-serif';
  c.fillStyle = '#FFF7E8'; c.fillRect(0, 0, W, H);
  try { const bg = await loadImg(win ? './img/bg_win.webp' : './img/bg_title.webp'); c.globalAlpha = .5; c.drawImage(bg, 0, H - 1620, W, 1620); c.globalAlpha = 1; } catch (e) { /* 無底圖也可 */ }
  c.textAlign = 'center'; c.lineJoin = 'round';
  const rr = (x, y, w, h, r) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); };
  const stroke = (t, x, y, size, fill) => { c.font = `900 ${size}px ${F}`; c.lineWidth = size * .14; c.strokeStyle = '#30281F'; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y); };
  const card = (x, y, w, h) => { c.fillStyle = '#FFFCF5'; c.strokeStyle = '#30281F'; c.lineWidth = 6; rr(x, y, w, h, 32); c.fill(); c.stroke(); };
  stroke('超級PUMA語錄王', W / 2, 150, 104, '#F0637A');
  c.fillStyle = '#30281F'; c.font = `900 60px ${F}`; c.fillText(win ? '我救回奔奔抱抱了！' : `還差${GOAL - g.score}分就救到奔奔抱抱`, W / 2, 258);
  c.font = `700 38px ${F}`; c.fillStyle = '#685F54'; c.fillText(`稱號：${rankTitle(g.score)}`, W / 2, 314);
  card(90, 350, 900, 240);
  c.fillStyle = '#30281F'; c.font = `900 164px ${F}`; c.textAlign = 'right'; c.fillText(String(g.score), 430, 530); c.textAlign = 'left'; c.font = `700 44px ${F}`; c.fillText('分', 444, 524);
  c.textAlign = 'center'; c.font = `900 84px ${F}`; c.fillText(fmtTime(g.ms), 760, 478); c.font = `700 36px ${F}`; c.fillStyle = '#685F54'; c.fillText('解題時間', 760, 538);
  const sx = 115, sy = 634, cell = 70, gap = 14;
  g.log.forEach((l, i) => { const x = sx + (i % 10) * (cell + gap), y = sy + Math.floor(i / 10) * (cell + gap);
    c.fillStyle = l.ok ? '#5FB884' : '#E9DFCC'; c.strokeStyle = '#30281F'; c.lineWidth = 4; rr(x, y, cell, cell, 14); c.fill(); c.stroke(); });
  c.textAlign = 'left'; c.fillStyle = '#685F54'; c.font = `700 30px ${F}`;
  ['初級', '中級', '高級'].forEach((t, k) => c.fillText(t, sx + 10 * (cell + gap) + 4, sy + k * (cell + gap) + 46));
  // 一句原話：優先用玩家答對、而且兩行內排得下的題
  c.font = `700 40px ${F}`;
  const cands = g.log.map((l, i) => ({l, q: g.items[i].q})).filter(o => o.l.ok).map(o => ({q: o.q, n: wrapLines(c, o.q.f || o.q.a, 760, 9).length}));
  const pick = (cands.filter(o => o.n <= 2).pop() || cands.sort((a, b) => a.n - b.n)[0] || {q: g.items[0].q}).q;
  const lines = wrapLines(c, pick.f || pick.a, 760, 3), top = 912, ch = 96 + lines.length * 58 + 44;
  card(90, top, 900, ch); c.fillStyle = '#F0637A'; c.font = `900 78px ${F}`; c.fillText('「', 108, top + 82);
  c.fillStyle = '#30281F'; c.font = `700 40px ${F}`; lines.forEach((ln, k) => c.fillText(ln, 182, top + 78 + k * 58));
  c.fillStyle = '#685F54'; c.font = `500 28px ${F}`; c.fillText(wrapLines(c, `沈伯洋，${pick.e || ''}`, 760, 1)[0], 182, top + 78 + lines.length * 58 + 6);
  try { const sp = await loadImg('./img/pat.webp'); const fw = sp.width / 8; c.drawImage(sp, 0, 0, fw, sp.height, W - 320, 1150, 280, 280 * sp.height / fw); } catch (e) { /* 無吉祥物也可 */ }
  c.textAlign = 'left'; c.fillStyle = '#30281F'; c.font = `900 40px ${F}`; c.fillText('你也來救救看', 90, 1262);
  c.font = `500 30px ${F}`; c.fillStyle = '#685F54'; c.fillText(CFG.site.replace(/^https?:\/\//, '').replace(/\/$/, ''), 90, 1310);
  return new Promise(ok => { try { cv.toBlob(b => ok(b), 'image/png'); } catch (e) { ok(null); } });
}
function share() {
  const g = G; if (!g) return;
  const text = `我在「超級PUMA語錄王」拿到${g.score}分（${fmtTime(g.ms)}），${g.score >= GOAL ? '救回奔奔抱抱了' : '差一點救到奔奔抱抱'}！ ${CFG.site}`;
  const showBox = () => { $('share-box').hidden = false; $('share-box').scrollIntoView({block: 'center'}); };
  if (!g.shareBlob) { if (navigator.share) navigator.share({text}).catch(() => {}); else toast('成績圖還在準備，稍等一下再按一次'); return; }
  let file = null; try { file = new File([g.shareBlob], 'puma-quiz.png', {type: 'image/png'}); } catch (e) { /* 舊瀏覽器 */ }
  if (file && navigator.canShare && navigator.canShare({files: [file]})) navigator.share({files: [file], text}).catch(e => { if (!e || e.name !== 'AbortError') showBox(); });
  else showBox(); // 不支援系統分享（或在通訊軟體的內建瀏覽器）：直接把圖顯示出來，長按即可儲存
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
  tap('btn-board-back', () => { if (openBoard.from === 'end' && G && G.log.length === TOTAL) { show('end'); Sound.play(G.score >= GOAL ? 'm05' : 'm06'); } else { show('title'); Sound.play('m01'); } });
  tap('btn-about', () => show('about'));
  tap('btn-about-back', () => show('title'));
  document.querySelectorAll('.js-sound').forEach(b => b.addEventListener('click', () => { Sound.setMuted(!Sound.muted); syncSoundBtns(); if (!Sound.muted && $('app').dataset.screen === 'title') Sound.play('m01'); }));
  syncSoundBtns();
  $('name-form').addEventListener('submit', async e => {
    e.preventDefault(); Sound.unlock();
    const g = G; if (!g || g.submitting || g.submitted) return;
    const r = cleanName($('name-input').value), msg = $('name-msg');
    if (r.err) { msg.textContent = r.err; return; }
    g.submitting = true; $('btn-submit').disabled = true; msg.textContent = '送出中…'; store.set(LS.name, r.name);
    try {
      const res = await submitScore(g, r.name); g.submitted = true;
      if (G === g) { msg.textContent = res.mode === 'online' ? (res.rank ? `上榜了！目前第${res.rank}名` : '上榜了！（目前在300名以外）') : '已記錄在這台裝置的排行榜'; $('name-input').blur(); }
    } catch (err) {
      const code = err && err.code;
      if (G === g) msg.textContent = SUBMIT_MSG[code] || '排行榜暫時連不上，成績已先記在這台裝置；可以再按一次送出';
      if (code && code !== 'net' && code !== 'bad_name' && code !== 'slow_down' && code !== 'server') g.submitted = true; // 重試也不會成功的情況，不再重送
    } finally { g.submitting = false; if (G === g) $('btn-submit').disabled = g.submitted; }
  });
  document.addEventListener('keydown', e => {
    if ($('app').dataset.screen !== 'quiz' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || !G) return;
    const k = 'abcd'.indexOf(e.key.toLowerCase()), n = '1234'.indexOf(e.key);
    const idx = k >= 0 ? k : n; if (idx >= 0 && !G.answered) answer(idx);
    else if ((e.key === 'Enter' || e.key === ' ') && G.answered && !$('btn-next').disabled && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); next(); }
  });
  document.addEventListener('touchstart', () => {}, {passive: true}); // 讓 iOS 套用按下去的樣式
}
async function boot() {
  bind();
  try { await loadBank(); show('title'); Sound.play('m01'); }
  catch (e) { $('boot-status').textContent = (e && e.message) || '載入失敗，請按重新載入'; const b = $('boot-retry'); b.hidden = false; b.onclick = () => location.reload(); }
}
window.__puma = {get state() { return G; }, get bank() { return BANK; }, makeShare};
boot();
})();
