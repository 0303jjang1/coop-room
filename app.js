// =====================================================
// CO-OP ROOM 동작 코드 (내용은 data.js에서 고치기)
// =====================================================
(() => {
  const G = window.GAME;
  const KEY = 'coop-room-v1';

  // ---------- 저장 ----------
  let S = load();
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  // ---------- 요소 ----------
  const $ = (id) => document.getElementById(id);
  const $stage = $('stage'), $scene = $('scene'), $layer = $('layer');
  const $dialog = $('dialog'), $dlgText = $('dlg-text'), $dlgNext = $('dlg-next'), $catcher = $('catcher');
  const $popupWrap = $('popup-wrap'), $popup = $('popup'), $fade = $('fade');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function place(parent, r, cls) {
    const e = el('div', cls);
    Object.assign(e.style, { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%' });
    parent.appendChild(e);
    return e;
  }
  // 누르는 영역: 사물보다 넉넉하게 잡는다 (표시는 하지 않음)
  function hotspot(parent, r, fn) {
    const pad = 2;
    const e = place(parent, { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }, 'hotspot');
    e.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
    return e;
  }
  // 배경: 이미지가 있으면 이미지, 없으면 자리표시. 자리표시면 true 반환
  function background(parent, img, label) {
    const b = el('div', 'bg');
    parent.appendChild(b);
    if (img) { b.style.backgroundImage = `url("${img}")`; return false; }
    parent.appendChild(el('div', 'ph-label', '이미지 자리: ' + esc(label)));
    return true;
  }

  // ---------- 화면 크기 (16:9) ----------
  function fit() {
    const w = Math.min(window.innerWidth, window.innerHeight * 16 / 9);
    $stage.style.width = w + 'px';
    $stage.style.height = (w * 9 / 16) + 'px';
    document.documentElement.style.setProperty('--u', (w / 100) + 'px');
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- 효과음 (파일 없이 브라우저에서 합성) ----------
  const SFX = {
    ctx: null, muted: true,
    init() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, dur, type = 'sine', vol = 0.2, when = 0) {
      const c = this.ctx, t = c.currentTime + when;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, filterType, freq, when = 0) {
      const c = this.ctx, t = c.currentTime + when;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource(); s.buffer = buf;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(c.destination); s.start(t);
    },
    play(name) {
      if (this.muted || !this.ctx) return;
      try {
        switch (name) {
          case 'click': this.tone(1300, 0.04, 'square', 0.05); break;
          case 'unlock': this.tone(900, 0.06, 'square', 0.08); this.tone(1500, 0.1, 'square', 0.08, 0.09); break;
          case 'door': this.noise(0.7, 0.35, 'lowpass', 500); this.tone(110, 0.5, 'sine', 0.15); break;
          case 'slam': this.noise(0.35, 0.8, 'lowpass', 300); this.tone(55, 0.4, 'sine', 0.5); break;
          case 'chalk': this.noise(0.06, 0.12, 'bandpass', 3200); break;
          case 'paper': this.noise(0.25, 0.15, 'highpass', 2000); break;
          case 'wrong': this.tone(180, 0.18, 'sawtooth', 0.08); break;
          case 'success': [523, 659, 784].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.15, i * 0.12)); break;
        }
      } catch (e) {}
    }
  };
  // 첫 터치에서 오디오 활성화
  document.addEventListener('pointerdown', () => SFX.init());
  const $sound = $('sound-btn');
  $sound.addEventListener('click', (ev) => {
    ev.stopPropagation();
    SFX.init();
    SFX.muted = !SFX.muted;
    $sound.textContent = SFX.muted ? '🔇' : '🔊';
  });

  // ---------- 교사용 초기화: 왼쪽 위 모서리 5번 빠르게 누르기 ----------
  let resetTaps = [];
  $('reset-corner').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const now = Date.now();
    resetTaps = resetTaps.filter((t) => now - t < 3000);
    resetTaps.push(now);
    if (resetTaps.length >= 5) {
      resetTaps = [];
      if (confirm('처음부터 다시 시작할까요? (번호도 다시 고릅니다)')) {
        try { localStorage.removeItem(KEY); } catch (e) {}
        location.reload();
      }
    }
  });

  // ---------- 페이드 ----------
  async function fadeTo(fn) {
    $fade.classList.add('on');
    await wait(650);
    fn();
    await wait(120);
    $fade.classList.remove('on');
    await wait(600);
  }

  // ---------- 대화창 ----------
  let dlg = null;
  function say(lines) {
    return new Promise((res) => {
      dlg = { lines: lines.slice(), i: -1, res, typing: false, timer: null, full: '' };
      $catcher.classList.add('on');
      $dialog.classList.add('on');
      nextLine();
    });
  }
  function nextLine() {
    dlg.i++;
    if (dlg.i >= dlg.lines.length) {
      $dialog.classList.remove('on');
      $catcher.classList.remove('on');
      const r = dlg.res; dlg = null; r();
      return;
    }
    let L = dlg.lines[dlg.i];
    if (typeof L === 'string') L = { t: L };
    if (L.sfx) SFX.play(L.sfx);
    dlg.full = L.t;
    dlg.typing = true;
    $dlgText.textContent = '';
    $dlgNext.classList.remove('on');
    let n = 0;
    clearInterval(dlg.timer);
    dlg.timer = setInterval(() => {
      n++;
      $dlgText.textContent = dlg.full.slice(0, n);
      if (n >= dlg.full.length) { clearInterval(dlg.timer); dlg.typing = false; $dlgNext.classList.add('on'); }
    }, 45);
  }
  $catcher.addEventListener('click', () => {
    if (!dlg) return;
    if (dlg.typing) {
      clearInterval(dlg.timer); dlg.typing = false;
      $dlgText.textContent = dlg.full; $dlgNext.classList.add('on');
    } else nextLine();
  });

  // ---------- 팝업 ----------
  let popupResolve = null;
  function popup(content, opts = {}) {
    const { closable = true, closeLabel = '닫기' } = opts;
    return new Promise((res) => {
      popupResolve = res;
      $popup.innerHTML = '';
      $popup.classList.remove('shake');
      $popup.appendChild(content);
      if (closable) {
        const row = el('div', 'btn-row');
        const b = el('button', 'btn', closeLabel);
        b.onclick = closePopup;
        row.appendChild(b);
        $popup.appendChild(row);
      }
      $popupWrap.classList.add('on');
    });
  }
  function closePopup() {
    $popupWrap.classList.remove('on');
    $popup.innerHTML = '';
    const r = popupResolve; popupResolve = null;
    if (r) r();
  }
  function shake(node = $popup) {
    node.classList.remove('shake');
    void node.offsetWidth;
    node.classList.add('shake');
    SFX.play('wrong');
  }

  // ---------- 클로즈업 (한 컷 화면 + 뒤로 가기) ----------
  function openCloseup(build) {
    $layer.innerHTML = '';
    $layer.classList.add('on');
    build($layer);
    const back = el('button', 'btn back-btn', '← 뒤로');
    back.onclick = closeCloseup;
    $layer.appendChild(back);
  }
  function closeCloseup() { $layer.classList.remove('on'); $layer.innerHTML = ''; }

  // =====================================================
  // 장면
  // =====================================================
  const scenes = {};

  async function changeScene(name, fresh = true) {
    closeCloseup();
    await fadeTo(() => { S.scene = name; save(); scenes[name].build(); });
    if (fresh && scenes[name].enter) await scenes[name].enter();
    else if (!fresh && scenes[name].resume) await scenes[name].resume();
  }

  // ---------- 시작 화면 ----------
  function showStart() {
    $scene.innerHTML = '';
    const s = el('div', 'start');
    s.innerHTML = `<div class="title">${esc(G.title)}</div><div class="sub">모둠에서 정한 내 번호를 고르세요</div>`;
    const row = el('div', 'role-row');
    [1, 2, 3, 4].forEach((n) => {
      const b = el('button', 'btn', n + '번');
      b.onclick = () => { SFX.init(); confirmRole(n); };
      row.appendChild(b);
    });
    s.appendChild(row);
    $scene.appendChild(s);
  }
  function confirmRole(n) {
    const c = el('div', '', `<p><b>${n}번</b>으로 시작할까요?</p><p class="small-text">한 번 고르면 바꿀 수 없어요.</p>`);
    const row = el('div', 'btn-row');
    const no = el('button', 'btn', '아니요');
    const yes = el('button', 'btn', '시작');
    row.append(no, yes);
    c.appendChild(row);
    popup(c, { closable: false });
    no.onclick = closePopup;
    yes.onclick = () => {
      closePopup();
      S = { role: n, scene: 'opening', stage: 0, chalk: 0, chalkWritten: false };
      save();
      changeScene('opening');
    };
  }

  // ---------- ⓪ 오프닝 ----------
  scenes.opening = {
    build() { $scene.innerHTML = ''; $scene.appendChild(el('div', 'bg black')); },
    async enter() {
      const O = G.opening;
      await wait(300);
      await say(O.part1);
      SFX.play('paper');
      const note = el('div', 'paper note');
      note.textContent = O.note;
      await popup(note);
      await say(O.part2);
      await fadeTo(() => {
        $scene.innerHTML = '';
        if (background($scene, G.images.school, '학교 외관 (해 질 무렵)')) {
          $scene.appendChild(el('div', 'ph-sky'));
          const sch = el('div', 'ph-school');
          for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
            const w = el('div', 'ph-school-win');
            Object.assign(w.style, { left: (6 + c * 15.5) + '%', top: (12 + r * 29) + '%', width: '9%', height: '16%' });
            sch.appendChild(w);
          }
          $scene.appendChild(sch);
          $scene.appendChild(el('div', 'ph-ground'));
        }
      });
      await say(O.school);
      changeScene('window');
    },
    resume() { return this.enter(); }
  };

  // ---------- ① 창문 밖 (개수 세기) ----------
  function drawWindowPlaceholder(parent, role) {
    parent.appendChild(el('div', 'ph-room'));
    const show = G.windowScene.show[role];

    if (show === 'desk') {
      // 책상 15개: 5개씩 3모둠
      const offs = [[-7, -5], [1, -5], [-11, 4], [-3, 4], [5, 4]];
      [[33, 48], [60, 66], [82, 46]].forEach(([gx, gy]) => {
        offs.forEach(([dx, dy]) => place(parent, { x: gx + dx, y: gy + dy, w: 7, h: 6 }, 'ph-desk'));
      });
    }
    if (show === 'pot') {
      // 화분 3개: 크기 다양
      [[26, 26, 4, 9], [71, 24, 3, 7], [89, 74, 5.5, 13]].forEach(([x, y, w, h]) => {
        const p = place(parent, { x, y, w, h }, 'ph-pot');
        p.appendChild(el('div', 'leaf'));
        p.appendChild(el('div', 'pot'));
      });
    }
    if (show === 'umbrella') {
      // 우산 2개
      [[48, 20, 2.6, 16], [95, 28, 2.6, 16]].forEach(([x, y, w, h]) => place(parent, { x, y, w, h }, 'ph-umbrella'));
    }

    // 창틀
    [[20, 0, 1.2, 100], [46, 0, 1, 100], [98.8, 0, 1.2, 100]].forEach(([x, y, w, h]) => place(parent, { x, y, w, h }, 'ph-frame'));
    place(parent, { x: 20, y: 0, w: 80, h: 2.5 }, 'ph-frame');
    place(parent, { x: 20, y: 96, w: 80, h: 4 }, 'ph-frame');
    // 문 (자물쇠)
    const door = place(parent, G.hotspots.windowDoor, 'ph-door');
    door.appendChild(el('div', 'ph-lock'));

    if (show === 'none') {
      const n = place(parent, { x: 64, y: 14, w: 14, h: 18 }, 'ph-note');
      n.textContent = G.windowScene.note4;
    }
  }
  scenes.window = {
    build() {
      $scene.innerHTML = '';
      const role = S.role;
      const ph = background($scene, G.images.window[role], `창문 밖에서 본 교실 (${role}번 화면)`);
      if (ph) drawWindowPlaceholder($scene, role);
      else if (G.windowScene.show[role] === 'none') {
        const n = place($scene, { x: 64, y: 14, w: 14, h: 18 }, 'ph-note');
        n.textContent = G.windowScene.note4;
      }
      hotspot($scene, G.hotspots.windowDoor, openNumberLock);
    },
    async enter() { await say(G.windowScene.intro); }
  };

  function openNumberLock() {
    const digits = [0, 0, 0, 0];
    const c = el('div', '', '<div>숫자 자물쇠</div><div class="small-text">숫자를 눌러 바꾸세요</div>');
    const row = el('div', 'lock-digits');
    digits.forEach((_, i) => {
      const d = el('button', 'digit', '0');
      d.onclick = () => { digits[i] = (digits[i] + 1) % 10; d.textContent = digits[i]; SFX.play('click'); };
      row.appendChild(d);
    });
    c.appendChild(row);
    const btns = el('div', 'btn-row');
    const close = el('button', 'btn', '닫기');
    const open = el('button', 'btn', '열기');
    btns.append(close, open);
    c.appendChild(btns);
    popup(c, { closable: false });
    close.onclick = closePopup;
    open.onclick = async () => {
      if (digits.join('') === G.windowScene.answer) {
        SFX.play('unlock');
        closePopup();
        await wait(500);
        SFX.play('door');
        await wait(400);
        await changeScene('classroom');
      } else shake();
    };
  }

  // ---------- 교실 ----------
  function drawClassroomPlaceholder(parent) {
    parent.appendChild(el('div', 'ph-cwall'));
    parent.appendChild(el('div', 'ph-cfloor'));
    parent.appendChild(el('div', 'ph-window'));
    place(parent, G.hotspots.board, 'ph-board');
    place(parent, G.hotspots.clock, 'ph-clock');
    place(parent, G.hotspots.drawer, 'ph-tdesk');
    // 책상 6개 (3줄 × 2칸), D 자리는 2줄 왼쪽
    [44, 62, 80].forEach((y) => [28, 48].forEach((x) => place(parent, { x, y, w: 16, h: 13 }, 'ph-desk')));
  }
  function drawArtworkSmall(parent) {
    const a = place(parent, G.hotspots.artwork, 'ph-art');
    const word = S.stage >= 3 ? G.artwork.answer : G.artwork.start;
    a.innerHTML = word.split('').map((ch) => `<span>${esc(ch)}</span>`).join('');
  }
  scenes.classroom = {
    build() {
      $scene.innerHTML = '';
      const ph = background($scene, G.images.classroom, '교실 안 전체');
      if (ph) drawClassroomPlaceholder($scene);
      drawArtworkSmall($scene);
      const H = G.hotspots;
      hotspot($scene, H.clock, openClock);
      hotspot($scene, H.drawer, openDrawer);
      hotspot($scene, H.deskD, openDeskD);
      hotspot($scene, H.artwork, openArtwork);
      hotspot($scene, H.board, () => { if (S.stage >= 3) changeScene('chalk', false); });
    },
    async enter() { await say(G.enterLines); }
  };

  // ② 시계
  function clockSVG(hand) {
    const nums = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1, a = (n * 30 - 90) * Math.PI / 180;
      return `<text x="${100 + 72 * Math.cos(a)}" y="${100 + 72 * Math.sin(a) + 7}" text-anchor="middle" font-size="20" fill="#2b2620" font-family="Noto Sans KR">${n}</text>`;
    }).join('');
    const ang = (hand % 12) * 30;
    return `<svg class="clock-svg" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="96" fill="#e9e1cf" stroke="#3a2f27" stroke-width="6"/>
      ${nums}
      <line x1="100" y1="100" x2="100" y2="22" stroke="#2b2620" stroke-width="3" stroke-linecap="round"/>
      <line x1="100" y1="100" x2="100" y2="48" stroke="#2b2620" stroke-width="7" stroke-linecap="round" transform="rotate(${ang} 100 100)"/>
      <circle cx="100" cy="100" r="6" fill="#2b2620"/>
    </svg>`;
  }
  function openClock() {
    const F = G.clock.faces[S.role];
    openCloseup((layer) => {
      background(layer, G.images.clock, '시계 클로즈업');
      const front = el('div', 'clock-wrap', clockSVG(F.hand) + `<div class="clock-label">${esc(F.label)}</div>`);
      if (F.note) {
        const st = el('div', 'sticky', esc(F.note));
        Object.assign(st.style, { right: '14%', top: '18%' });
        front.appendChild(st);
      }
      const back = el('div', 'clock-back');
      back.innerHTML = '<div class="squares"><div></div><div></div><div></div><div></div></div>' +
        `<div class="back-text">${esc(G.clock.back)}</div>`;
      back.style.display = 'none';
      layer.append(front, back);
      const flip = el('button', 'btn closeup-btn', '뒤집어 보기');
      flip.onclick = () => {
        const showBack = back.style.display === 'none';
        back.style.display = showBack ? 'flex' : 'none';
        front.style.display = showBack ? 'none' : 'flex';
        flip.textContent = showBack ? '앞면 보기' : '뒤집어 보기';
        SFX.play('click');
      };
      layer.appendChild(flip);
    });
    say([G.clock.stoppedLine]);
  }

  // 교사 서랍 (화살표 자물쇠)
  const ARROW = { up: '↑', right: '→', down: '↓', left: '←' };
  function openDrawer() {
    openCloseup((layer) => {
      const ph = background(layer, G.images.drawer, '교사 서랍 클로즈업');
      if (ph) layer.appendChild(el('div', 'ph-cfloor'));
    });
    if (S.stage >= 1) { showPapers(); return; }

    const input = [];
    const c = el('div', '', '<div>화살표 자물쇠</div>');
    const slots = el('div', 'arrow-slots');
    const slotEls = [0, 1, 2, 3].map(() => { const s = el('div', 'arrow-slot'); slots.appendChild(s); return s; });
    const pad = el('div', 'arrow-pad');
    const render = () => slotEls.forEach((s, i) => { s.textContent = input[i] ? ARROW[input[i]] : ''; });
    ['up', 'right', 'down', 'left'].forEach((dir) => {
      const b = el('button', 'btn', ARROW[dir]);
      b.onclick = async () => {
        if (input.length >= 4) return;
        input.push(dir); render(); SFX.play('click');
        if (input.length === 4) {
          await wait(250);
          if (input.join() === G.clock.answer.join()) {
            SFX.play('unlock');
            S.stage = Math.max(S.stage, 1); save();
            closePopup();
            await say(G.drawerOpenedLines);
            showPapers();
          } else {
            shake(); input.length = 0; render();
          }
        }
      };
      pad.appendChild(b);
    });
    c.append(slots, pad);
    const btns = el('div', 'btn-row');
    const clear = el('button', 'btn', '지우기');
    clear.onclick = () => { input.length = 0; render(); };
    const close = el('button', 'btn', '닫기');
    close.onclick = () => { closePopup(); closeCloseup(); };
    btns.append(clear, close);
    c.appendChild(btns);
    popup(c, { closable: false });
    say([G.drawerLockedLine]);
  }

  // ③ 책상 배치도 + 협동 체크리스트
  function seatChart() {
    const p = el('div', 'paper');
    p.innerHTML = '<h3>책상 배치도</h3>';
    const g = el('div', 'seat-chart');
    g.appendChild(el('div', '', ''));
    g.appendChild(el('div', 'board', '칠판'));
    const win = el('div', 'win', '창문');
    win.style.gridRow = '2 / 5';
    win.style.gridColumn = '1';
    g.appendChild(win);
    for (let i = 0; i < 6; i++) g.appendChild(el('div', 'seat'));
    p.appendChild(g);
    return p;
  }
  function checklistPaper() {
    const p = el('div', 'paper torn');
    const mine = G.checklist[S.role], d = G.checklist.D;
    p.innerHTML = '<h3>협동 체크리스트</h3>' +
      '<table class="check-table"><tr><th></th><th>관찰 기록</th><th>선생님 메모</th></tr>' +
      [mine, d].map((r) => `<tr><td class="who">${esc(r.who)}</td><td>${esc(r.record)}</td><td>${esc(r.memo)}</td></tr>`).join('') +
      '</table>';
    return p;
  }
  function showPapers() {
    const c = el('div');
    const tabs = el('div', 'tabs');
    const t1 = el('button', 'btn on', '책상 배치도');
    const t2 = el('button', 'btn', '협동 체크리스트');
    tabs.append(t1, t2);
    const body = el('div');
    const a = seatChart(), b = checklistPaper();
    body.appendChild(a);
    t1.onclick = () => { body.replaceChildren(a); t1.classList.add('on'); t2.classList.remove('on'); SFX.play('paper'); };
    t2.onclick = () => { body.replaceChildren(b); t2.classList.add('on'); t1.classList.remove('on'); SFX.play('paper'); };
    c.append(tabs, body);
    SFX.play('paper');
    popup(c);
  }

  // ④ D의 자리 → 일기 + 계획서
  function pages(list) {
    let i = 0;
    const c = el('div');
    const body = el('div');
    const row = el('div', 'btn-row');
    const prev = el('button', 'btn', '◀ 앞 장');
    const next = el('button', 'btn', '다음 장 ▶');
    const close = el('button', 'btn', '닫기');
    const render = () => {
      body.replaceChildren(list[i]());
      prev.style.display = i > 0 ? '' : 'none';
      next.style.display = i < list.length - 1 ? '' : 'none';
    };
    prev.onclick = () => { i--; render(); SFX.play('paper'); };
    next.onclick = () => { i++; render(); SFX.play('paper'); };
    close.onclick = closePopup;
    row.append(prev, next, close);
    c.append(body, row);
    render();
    return popup(c, { closable: false });
  }
  function diaryPaper() { const p = el('div', 'paper lined'); p.textContent = G.diary; return p; }
  function planPaper() {
    const P = G.plan, p = el('div', 'paper');
    p.innerHTML = `<h3>${esc(P.title)}</h3><div>${esc(P.body)}</div><div style="margin-top:.6em">${esc(P.question)}</div>` +
      `<div class="word-list">${esc(P.words.join(', '))} ...</div>`;
    return p;
  }
  function openDeskD() {
    if (S.stage < 1) return; // 배치도를 얻기 전에는 아무 일도 없음
    S.stage = Math.max(S.stage, 2); save();
    SFX.play('paper');
    pages([diaryPaper, planPaper]);
  }

  // ⑤ 작품 순서 바꾸기
  function openArtwork() {
    if (S.stage < 2) return;
    openCloseup((layer) => {
      const ph = background(layer, G.images.artwork, '게시판 작품 클로즈업');
      const wall = el('div', 'art-wall');
      if (!ph) wall.style.background = 'none';
      const board = el('div', 'art-board');
      const letters = (S.stage >= 3 ? G.artwork.answer : G.artwork.start).split('');
      let sel = -1;
      const render = () => {
        board.innerHTML = '';
        letters.forEach((ch, i) => {
          const t = el('button', 'tile' + (i === sel ? ' sel' : ''), esc(ch));
          t.onclick = () => onTile(i);
          board.appendChild(t);
        });
      };
      const onTile = async (i) => {
        if (S.stage >= 3) return;
        SFX.play('click');
        if (sel === -1) { sel = i; render(); return; }
        if (sel !== i) [letters[sel], letters[i]] = [letters[i], letters[sel]];
        sel = -1; render();
        if (letters.join('') === G.artwork.answer) {
          S.stage = 3; save();
          SFX.play('success');
          await wait(1200);
          changeScene('chalk');
        }
      };
      render();
      wall.appendChild(board);
      layer.appendChild(wall);
    });
  }

  // ---------- ⑥ 칠판 ----------
  let $board = null;
  function boardLines() { return Array.from($board.querySelectorAll('.chalk-line')); }
  function markAnswers() {
    G.chalk.answers.forEach((a, i) => {
      if (S.chalk > i) {
        const line = boardLines()[i];
        if (line && !line.querySelector('.chalk-ans')) line.appendChild(el('span', 'chalk-ans', '→ ' + esc(a)));
      }
    });
  }
  scenes.chalk = {
    build() {
      $scene.innerHTML = '';
      const ph = background($scene, G.images.chalkboard, '칠판 클로즈업');
      if (ph) $scene.appendChild(el('div', 'chalk-room'));
      $board = el('div', 'chalkboard');
      if (!ph) $board.style.background = 'transparent';
      G.chalk.board.forEach((t, i) => {
        const line = el('div', 'chalk-line' + (i >= 3 ? ' small' : ''));
        line.dataset.text = t;
        $board.appendChild(line);
      });
      $scene.appendChild($board);
    },
    async enter() {
      await say([G.chalk.firstLine]);
      await writeChalk();
      S.chalkWritten = true; save();
      await say(G.chalk.afterLines);
      nextChalkStep();
    },
    async resume() {
      if (!S.chalkWritten) return this.enter();
      boardLines().forEach((l) => { l.textContent = l.dataset.text; });
      markAnswers();
      nextChalkStep(true);
    }
  };
  async function writeChalk() {
    for (const line of boardLines()) {
      const t = line.dataset.text;
      for (let i = 0; i < t.length; i++) {
        line.textContent = t.slice(0, i + 1);
        if (t[i] !== ' ') SFX.play('chalk');
        await wait(t[i] === ' ' ? 60 : 160);
      }
      await wait(350);
    }
  }
  async function nextChalkStep(resuming = false) {
    if (S.chalk < G.chalk.answers.length) { showAnswerInput(); return; }
    if (!resuming) await say([G.chalk.finalLine]);
    showFinalButton();
  }
  function showAnswerInput() {
    const row = el('div', 'answer-row');
    const input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    const ok = el('button', 'btn', '확인');
    row.append(input, ok);
    $scene.appendChild(row);
    const check = async () => {
      const v = input.value.replace(/\s/g, '');
      if (v === G.chalk.answers[S.chalk]) {
        SFX.play('unlock');
        S.chalk++; save();
        markAnswers();
        input.blur();
        row.remove();
        await wait(500);
        nextChalkStep();
      } else {
        shake(input); input.value = '';
      }
    };
    ok.onclick = check;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  }
  function showFinalButton() {
    const b = el('button', 'btn final-btn', esc(G.chalk.finalButton));
    b.onclick = () => { b.remove(); playSuccess(); };
    $scene.appendChild(b);
  }

  // ---------- ⑦ 최종 성공 ----------
  async function playSuccess() {
    $board.classList.add('erase');
    await wait(1600);
    SFX.play('unlock');
    await say(G.success.lines);
    await changeScene('ending');
  }
  scenes.ending = {
    build() {
      $scene.innerHTML = '';
      const ph = background($scene, G.images.deskD, 'D의 책상 위 일기장');
      const wrap = el('div', 'ending');
      if (!ph) wrap.style.background = 'none';
      const p = el('div', 'paper lined');
      p.textContent = G.diary;
      const nl = el('div', 'new-line');
      p.appendChild(nl);
      wrap.appendChild(p);
      $scene.appendChild(wrap);
      $scene.appendChild(el('div', 'lights'));
    },
    async enter() {
      await wait(900);
      const nl = $scene.querySelector('.new-line');
      const t = G.success.diaryNewLine;
      for (let i = 0; i < t.length; i++) {
        nl.textContent = t.slice(0, i + 1);
        if (t[i] !== ' ') SFX.play('chalk');
        await wait(140);
      }
      await wait(1500);
      $scene.querySelector('.lights').classList.add('on');
      SFX.play('success');
      await say([G.success.lightLine]);
      await changeScene('done');
    },
    resume() { return changeScene('done'); }
  };
  scenes.done = {
    build() {
      $scene.innerHTML = '';
      const d = el('div', 'done');
      d.appendChild(el('div', 'done-title', esc(G.success.title)));
      $scene.appendChild(d);
    }
  };

  // ---------- 시작 ----------
  if (!S.role || !scenes[S.scene]) showStart();
  else changeScene(S.scene, false);
})();
