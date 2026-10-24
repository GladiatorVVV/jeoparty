/* The game: setup → title → rounds → Final Jeopardy → winner. */
(function () {
  const { h, money } = J;
  const SESSION_KEY = 'jeoparty.session';
  const MAX_TEAMS = 6;

  const stage = document.getElementById('stage');
  const hostToggle = document.getElementById('hostToggle');
  const hostMenu = document.getElementById('hostMenu');
  const modalRoot = document.getElementById('modalRoot');

  let index = { games: [] };
  let game = null; // the loaded game content
  let S = null;    // the session: teams, scores, used clues, where we are

  const save = () => J.store.set(SESSION_KEY, S);

  /* ================= helpers ================= */

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const hasContent = (side) => !!(side && (side.text.trim() || side.image || side.audio));
  const cellPlayable = (round, c, r) => hasContent(game.rounds[round].categories[c].clues[r].clue);

  const roundHasContent = (round) => {
    for (let c = 0; c < J.COLS; c++) for (let r = 0; r < J.ROWS; r++) if (cellPlayable(round, c, r)) return true;
    return false;
  };

  const roundComplete = (round) => {
    for (let c = 0; c < J.COLS; c++) {
      for (let r = 0; r < J.ROWS; r++) {
        if (cellPlayable(round, c, r) && !S.used[round][`${c}-${r}`]) return false;
      }
    }
    return true;
  };

  const finalHasContent = () => hasContent(game.final.clue) || !!game.final.category.trim();

  const nextStageInfo = () => {
    if (S.round === 'single' && game.rounds.double.enabled && roundHasContent('double')) {
      return { label: `On to ${game.rounds.double.name || 'Double Jeopardy!'}`, go: () => startRound('double') };
    }
    if (finalHasContent()) return { label: 'On to Final Jeopardy!', go: () => setPhase('finalSplash') };
    return { label: 'See the winner', go: () => setPhase('winner') };
  };

  const team = (id) => S.teams.find((t) => t.id === id);

  const placeDailyDoubles = (round) => {
    const cfg = game.dailyDoubles;
    const cells = [];
    if (cfg.mode === 'manual') {
      game.rounds[round].categories.forEach((cat, c) => cat.clues.forEach((cl, r) => {
        if (cl.dailyDouble && cellPlayable(round, c, r)) cells.push(`${c}-${r}`);
      }));
      return cells;
    }
    const want = Math.max(0, Math.min(+cfg[round] || 0, 30));
    const cols = shuffle([...Array(J.COLS).keys()]);
    for (let i = 0; i < want; i++) {
      // Like the show: avoid the top row and spread them across different categories.
      let options = [];
      for (const pass of [0, 1, 2]) {
        const colsToTry = pass === 2 ? cols : [cols[i % J.COLS]];
        for (const c of colsToTry) {
          for (let r = pass === 0 ? 1 : 0; r < J.ROWS; r++) {
            const key = `${c}-${r}`;
            if (cellPlayable(round, c, r) && !cells.includes(key)) options.push(key);
          }
        }
        if (options.length) break;
      }
      if (!options.length) break;
      cells.push(options[Math.floor(Math.random() * options.length)]);
    }
    return cells;
  };

  const roundMaxValue = () => Math.max(...game.rounds[S.round].values);

  /* ================= scoring ================= */

  const clueValue = () => (S.current.dd ? S.current.wager : S.current.value);

  const applyMark = (teamId, kind, value, sign) => {
    const t = team(teamId);
    if (t) t.score += sign * (kind === 'right' ? value : -value);
  };

  // Toggle a team's mark for the open clue. Clicking the same mark again undoes it.
  const markTeam = (teamId, kind) => {
    const cur = S.current;
    if (!cur) return;
    if (cur.dd && cur.ddTeam !== teamId) return;
    const value = clueValue();
    const prev = cur.marks[teamId];
    if (prev) applyMark(teamId, prev, value, -1);
    if (prev === kind) delete cur.marks[teamId];
    else {
      cur.marks[teamId] = kind;
      applyMark(teamId, kind, value, +1);
    }
    save();
    refreshTeamBar();
  };

  const markFinal = (teamId, kind) => {
    const wager = +S.final.wagers[teamId] || 0;
    const prev = S.final.marks[teamId];
    if (prev) applyMark(teamId, prev, wager, -1);
    if (prev === kind) delete S.final.marks[teamId];
    else {
      S.final.marks[teamId] = kind;
      applyMark(teamId, kind, wager, +1);
    }
    save();
    refreshTeamBar();
  };

  const closeClue = () => {
    const cur = S.current;
    S.history.push({ round: cur.round, key: `${cur.c}-${cur.r}`, value: clueValue(), marks: cur.marks });
    S.current = null;
    setPhase('board');
  };

  // Put a clue back on the board and take back any points it gave or cost.
  const undoClue = () => {
    let entry;
    if (S.current) {
      const cur = S.current;
      entry = { round: cur.round, key: `${cur.c}-${cur.r}`, value: clueValue() || 0, marks: cur.marks };
      S.current = null;
    } else {
      entry = S.history.pop();
    }
    if (!entry) return;
    for (const [id, kind] of Object.entries(entry.marks)) applyMark(id, kind, entry.value, -1);
    delete S.used[entry.round][entry.key];
    S.round = entry.round;
    setPhase('board');
  };

  /* ================= navigation ================= */

  let pendingZoom = null; // tile rectangle to zoom the next screen out of
  let fillBoard = false;  // play the board-fill animation on the next board render

  const setPhase = (phase) => {
    S.phase = phase;
    save();
    render();
  };

  const startRound = (round) => {
    S.round = round;
    if (!S.dd[round]) S.dd[round] = placeDailyDoubles(round);
    setPhase('roundSplash');
  };

  const openClue = (c, r, tileEl) => {
    const key = `${c}-${r}`;
    const dd = (S.dd[S.round] || []).includes(key);
    S.current = {
      round: S.round, c, r,
      value: game.rounds[S.round].values[r],
      dd, ddTeam: null, wager: null, marks: {},
    };
    S.used[S.round][key] = true;
    pendingZoom = tileEl.getBoundingClientRect();
    setPhase(dd ? 'dd' : 'clue');
  };

  // Space / Enter / → moves the game forward.
  const advance = () => {
    const screen = stage.lastElementChild;
    const btn = screen && screen.querySelector('[data-advance]:not([disabled])');
    if (btn) btn.click();
  };

  /* ================= screens ================= */

  const stopMedia = (root) => root.querySelectorAll('audio').forEach((a) => a.pause());

  // Swap in a new screen; optionally zoom its .card out of a board tile.
  const show = (screen) => {
    const old = [...stage.children];
    const zoomFrom = pendingZoom;
    pendingZoom = null;
    old.forEach(stopMedia);
    stage.append(screen);
    fitScreen(screen);
    const card = screen.querySelector('.zoom');
    if (zoomFrom && card && card.animate) {
      const to = card.getBoundingClientRect();
      const sx = zoomFrom.width / to.width;
      const sy = zoomFrom.height / to.height;
      const dx = zoomFrom.left - to.left;
      const dy = zoomFrom.top - to.top;
      screen.classList.add('zooming');
      const anim = card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: 'none' },
        ],
        { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)' });
      anim.onfinish = () => {
        screen.classList.remove('zooming');
        old.forEach((o) => o.remove());
      };
    } else {
      // Cross-fade: the new screen fades in over the old one.
      old.forEach((o) => {
        o.classList.add('leaving');
        setTimeout(() => o.remove(), 350);
      });
    }
    return screen;
  };

  const fitScreen = (root) => {
    const W = stage.clientWidth;
    root.querySelectorAll('[data-fit]').forEach((el) => J.fitText(el, W * +el.dataset.fit, 8));
  };

  const chrome = (text, cls = '') => h(`div.chrome${cls}`, { text });

  const render = () => {
    closeHostMenu();
    hostToggle.hidden = !S;
    if (!S) return renderSetup();
    switch (S.phase) {
      case 'title': return renderTitle();
      case 'roundSplash': return renderRoundSplash();
      case 'board': return renderBoard();
      case 'dd': return renderDailyDouble();
      case 'clue': return renderClue(false);
      case 'answer': return renderClue(true);
      case 'finalSplash': return renderFinalSplash();
      case 'finalCategory': return renderFinalCategory();
      case 'finalClue': return renderFinalClue(false);
      case 'finalAnswer': return renderFinalClue(true);
      case 'winner': return renderWinner();
      default: return renderSetup();
    }
  };

  /* ---------- setup ---------- */

  const renderSetup = () => {
    hostToggle.hidden = true;
    const saved = J.store.get(SESSION_KEY, null);
    const prevTeams = (saved && saved.teams && saved.teams.length)
      ? saved.teams.map((t) => t.name)
      : ['Team 1', 'Team 2', 'Team 3'];
    let names = prevTeams.slice(0, MAX_TEAMS);

    const select = h('select.input#gamePick', null,
      index.games.map((g) => h('option', { value: g.id, text: g.name || g.id })));
    if (saved && saved.gameId) select.value = saved.gameId;

    const list = h('div.teamList');
    const drawTeams = () => {
      list.replaceChildren(...names.map((n, i) => h('div.teamRow', null,
        h('input.input', {
          value: n, maxLength: 24, placeholder: `Team ${i + 1}`,
          oninput: (e) => { names[i] = e.target.value; },
        }),
        h('button.iconBtn', {
          title: 'Remove', text: '×', disabled: names.length <= 1,
          onclick: () => { names.splice(i, 1); drawTeams(); },
        }))));
      addBtn.disabled = names.length >= MAX_TEAMS;
    };
    const addBtn = h('button.btn.ghost', {
      text: '+ Add player / team',
      onclick: () => { names.push(`Team ${names.length + 1}`); drawTeams(); },
    });
    drawTeams();

    const err = h('div.err');
    const start = async () => {
      const id = select.value;
      if (!id) return;
      err.textContent = 'Loading…';
      try {
        game = await J.loadGame(id);
        if (!game) throw new Error('That game could not be found.');
      } catch (e) {
        err.textContent = e.message;
        return;
      }
      err.textContent = '';
      S = {
        gameId: id,
        phase: 'title',
        round: 'single',
        used: { single: {}, double: {} },
        dd: {},
        teams: names.map((n, i) => ({ id: J.randomId(), name: n.trim() || `Team ${i + 1}`, score: 0 })),
        current: null,
        history: [],
        final: { wagers: {}, marks: {} },
      };
      S.dd.single = placeDailyDoubles('single');
      save();
      render();
    };

    const resume = async () => {
      err.textContent = 'Loading…';
      try {
        game = await J.loadGame(saved.gameId);
        if (!game) throw new Error('That game no longer exists.');
      } catch (e) {
        err.textContent = e.message;
        return;
      }
      S = saved;
      render();
    };

    const canResume = saved && saved.gameId && saved.phase && saved.phase !== 'winner'
      && index.games.some((g) => g.id === saved.gameId);
    const savedName = canResume ? (index.games.find((g) => g.id === saved.gameId).name || '') : '';

    const panel = h('div.setup', null,
      h('img.setupLogo', { src: 'assets/logo.png', alt: 'Jeoparty!' }),
      index.games.length
        ? h('div.setupCard', null,
          h('label.lbl', { text: 'Game board' }), select,
          h('label.lbl', { text: `Players / teams (up to ${MAX_TEAMS})` }), list, addBtn,
          h('div.setupActions', null,
            canResume && h('button.btn.ghost', { onclick: resume, text: `Resume “${savedName}”` }),
            h('button.btn.gold', { onclick: start, text: 'Start new game' })),
          err)
        : h('div.setupCard', null,
          h('p', { text: 'No game boards yet. Open the admin panel to create one.' })),
      h('a.adminLink', { href: 'admin.html', text: 'Admin panel' }));

    show(h('div.screen.setupScreen', null, panel));
  };

  /* ---------- title & splashes ---------- */

  const renderTitle = () => {
    show(h('div.screen.titleScreen', { onclick: () => startRound('single') },
      game.showLogo && h('img.logo', { src: 'assets/logo.png', alt: 'Jeoparty!' }),
      game.title && h('div.chrome.titleText', { text: game.title }),
      game.subtitle && h('div.subtitle', { text: game.subtitle }),
      h('button.hint', { 'data-advance': true, text: 'Click to begin' })));
  };

  const renderRoundSplash = () => {
    const r = game.rounds[S.round];
    show(h('div.screen.splash', { onclick: () => { fillBoard = true; setPhase('board'); } },
      chrome(r.name || J.DEFAULT_ROUND_NAMES[S.round], '.big.pop'),
      h('button.hint', { 'data-advance': true, text: 'Click to reveal the board' })));
  };

  const renderFinalSplash = () => {
    show(h('div.screen.splash', { onclick: () => setPhase('finalCategory') },
      chrome('Final Jeopardy!', '.big.pop'),
      h('button.hint', { 'data-advance': true, text: 'Click to reveal the category' })));
  };

  /* ---------- the board ---------- */

  const renderBoard = () => {
    const round = game.rounds[S.round];
    const cells = [];
    round.categories.forEach((cat) => {
      cells.push(h('div.cell.cat', null, h('div.catText', { 'data-fit': '0.026', text: cat.name })));
    });
    const tiles = [];
    for (let r = 0; r < J.ROWS; r++) {
      for (let c = 0; c < J.COLS; c++) {
        const key = `${c}-${r}`;
        if (!cellPlayable(S.round, c, r) || S.used[S.round][key]) {
          cells.push(h('div.cell.tile.empty'));
        } else {
          const tile = h('button.cell.tile', {
            onclick: (e) => openClue(c, r, e.currentTarget),
            'aria-label': `${round.categories[c].name} for ${money(round.values[r])}`,
          }, h('span.val', { text: money(round.values[r]) }));
          cells.push(tile);
          tiles.push(tile);
        }
      }
    }
    const board = h('div.board', null, cells);
    const screen = h('div.screen.boardScreen', null, board, teamBar('board'));

    if (roundComplete(S.round)) {
      const next = nextStageInfo();
      screen.append(h('div.roundDone', null,
        h('button.btn.gold.large', { 'data-advance': true, onclick: next.go, text: next.label })));
    }

    if (fillBoard) {
      fillBoard = false;
      tiles.forEach((t) => t.classList.add('pre'));
      shuffle(tiles.slice()).forEach((t, i) => {
        setTimeout(() => t.classList.remove('pre'), 300 + i * (1300 / Math.max(tiles.length, 1)));
      });
    }
    show(screen);
  };

  /* ---------- team podiums ---------- */

  let teamBarMode = 'board';

  // mode: 'board' (scores only), 'judge' (✓/✗ for a regular clue),
  // 'wager' (Final Jeopardy wagers), 'final' (✓/✗ for Final Jeopardy)
  const teamBar = (mode) => {
    teamBarMode = mode;
    const bar = h('div.teamBar', { 'data-count': S.teams.length });
    fillTeamBar(bar);
    return bar;
  };

  const refreshTeamBar = () => {
    const bar = stage.querySelector('.screen:last-child .teamBar');
    if (bar) fillTeamBar(bar);
  };

  const fillTeamBar = (bar) => {
    const mode = teamBarMode;
    bar.dataset.count = S.teams.length;
    bar.replaceChildren(...S.teams.map((t, i) => {
      const scoreEl = h('div.score', { text: money(t.score) });
      if (t.score < 0) scoreEl.classList.add('neg');
      const pod = h('div.podium', null,
        h('button.name', { text: t.name, title: 'Edit teams & scores', onclick: openTeamsModal }),
        scoreEl);

      if (mode === 'judge' && S.current) {
        const mark = S.current.marks[t.id];
        const locked = S.current.dd && S.current.ddTeam !== t.id;
        if (locked) pod.classList.add('dim');
        if (mark) pod.classList.add(mark);
        pod.append(h('div.judge', null,
          h('button.right', { title: `Correct (${i + 1})`, disabled: locked, onclick: () => markTeam(t.id, 'right'), text: '✓' }),
          h('button.wrong', { title: `Wrong (Shift+${i + 1})`, disabled: locked, onclick: () => markTeam(t.id, 'wrong'), text: '✗' })));
      }

      if (mode === 'wager') {
        const max = Math.max(t.score, 0);
        const input = h('input.wager', {
          type: 'password', inputMode: 'numeric', placeholder: `$0 – ${money(max)}`,
          value: S.final.wagers[t.id] != null ? String(S.final.wagers[t.id]) : '',
          oninput: (e) => {
            const v = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = v;
            if (v === '') delete S.final.wagers[t.id];
            else S.final.wagers[t.id] = +v;
            e.target.classList.toggle('bad', v !== '' && +v > max);
            save();
            updateFinalGo();
          },
        });
        if ((S.final.wagers[t.id] || 0) > max) input.classList.add('bad');
        pod.append(input);
      }

      if (mode === 'final') {
        const mark = S.final.marks[t.id];
        if (mark) pod.classList.add(mark);
        pod.append(h('div.judge', null,
          h('button.right', { title: 'Correct', onclick: () => markFinal(t.id, 'right'), text: '✓' }),
          h('button.wrong', { title: 'Wrong', onclick: () => markFinal(t.id, 'wrong'), text: '✗' })));
        pod.append(h('div.wagerShown', { text: mark ? `Wager ${money(+S.final.wagers[t.id] || 0)}` : 'Wager ?' }));
      }
      return pod;
    }));
  };

  /* ---------- daily double ---------- */

  const renderDailyDouble = () => {
    const cur = S.current;
    const max = () => Math.max(cur.ddTeam ? team(cur.ddTeam).score : 0, roundMaxValue());
    const min = () => Math.min(5, max());

    const wagerInput = h('input.input.wagerBig', {
      inputMode: 'numeric', placeholder: 'Wager',
      value: cur.wager != null ? String(cur.wager) : '',
      oninput: (e) => {
        const v = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = v;
        cur.wager = v === '' ? null : +v;
        save();
        update();
      },
    });
    const hint = h('div.ddHint');
    const go = h('button.btn.gold', {
      'data-advance': true, text: 'Show the clue ➜',
      onclick: () => setPhase('clue'),
    });
    const trueDD = h('button.btn.ghost', {
      text: 'True Daily Double!',
      onclick: () => { cur.wager = max(); wagerInput.value = String(cur.wager); save(); update(); },
    });
    const teamBtns = h('div.ddTeams', null, S.teams.map((t) => h('button.btn.teamPick', {
      text: t.name,
      onclick: () => { cur.ddTeam = t.id; save(); update(); },
      'data-id': t.id,
    })));

    function update() {
      teamBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === cur.ddTeam));
      const ok = cur.ddTeam && cur.wager != null && cur.wager >= min() && cur.wager <= max();
      hint.textContent = cur.ddTeam
        ? `${team(cur.ddTeam).name} can wager ${money(min())} to ${money(max())}`
        : 'Who found the Daily Double?';
      hint.classList.toggle('bad', !!cur.ddTeam && cur.wager != null && !ok);
      go.disabled = !ok;
      trueDD.disabled = !cur.ddTeam;
    }
    update();

    show(h('div.screen.ddScreen', null,
      h('div.ddCard.zoom', null,
        chrome('Daily Double!', '.dd.spin'),
        h('div.ddForm', null, teamBtns, hint,
          h('div.ddRow', null, h('span.dollar', { text: '$' }), wagerInput, trueDD), go)),
      teamBar('board')));
  };

  /* ---------- clue & answer cards ---------- */

  const mediaBlock = (side) => {
    const parts = [];
    if (side.image) {
      const img = h('img.clueImg', { alt: '', onclick: (e) => { e.stopPropagation(); openLightbox(img.src); } });
      J.setMediaSrc(img, side.image);
      parts.push(h('div.imgBox', null, img));
    }
    if (side.audio) parts.push(audioPlayer(side.audio));
    return parts;
  };

  const audioPlayer = (path) => {
    const audio = h('audio', { preload: 'auto' });
    J.setMediaSrc(audio, path);
    const btn = h('button.playBtn', { text: '▶', title: 'Play / pause audio' });
    const bar = h('div.audioFill');
    const time = h('span.audioTime', { text: '0:00' });
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    btn.onclick = (e) => { e.stopPropagation(); audio.paused ? audio.play() : audio.pause(); };
    audio.onplay = () => { btn.textContent = '❚❚'; };
    audio.onpause = () => { btn.textContent = '▶'; };
    audio.onended = () => { btn.textContent = '↻'; };
    audio.ontimeupdate = () => {
      const d = audio.duration || 0;
      bar.style.width = d ? `${(audio.currentTime / d) * 100}%` : '0';
      time.textContent = fmt(audio.currentTime);
    };
    const track = h('div.audioTrack', {
      onclick: (e) => {
        e.stopPropagation();
        const rect = track.getBoundingClientRect();
        if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
      },
    }, bar);
    return h('div.audioBox', null, btn, track, time, audio);
  };

  const clueCard = ({ head, side, isAnswer, footLabel, footAction, footBack }) => {
    const hasImg = !!side.image;
    const text = side.text.trim();
    const body = h('div.cardBody', { 'data-img': hasImg ? '1' : '0' },
      text && h('div.clueText', { 'data-fit': hasImg ? '0.034' : '0.046', text }),
      mediaBlock(side));
    return h('div.card.zoom', null,
      h('div.cardHead', null, head),
      isAnswer && h('div.answerTag', { text: 'Answer' }),
      body,
      h('div.cardFoot', null,
        h('button.footBtn', { 'data-advance': true, onclick: footAction, text: footBack ? `⬅ ${footLabel}` : `${footLabel} ➜` })));
  };

  const renderClue = (isAnswer) => {
    const cur = S.current;
    if (!cur) return setPhase('board');
    const round = game.rounds[cur.round];
    const cat = round.categories[cur.c];
    const item = cat.clues[cur.r];
    const value = clueValue();
    const head = [
      h('span', { text: `${cat.name || 'Category'} · ` }),
      cur.dd && h('span', { text: 'Daily Double · ' }),
      h('span.gold', { text: money(value) }),
    ];
    const card = clueCard({
      head,
      side: isAnswer ? item.answer : item.clue,
      isAnswer,
      footLabel: isAnswer ? 'Back to board' : 'Show answer',
      footBack: isAnswer,
      footAction: isAnswer ? closeClue : () => setPhase('answer'),
    });
    show(h('div.screen.clueScreen', null, card, teamBar('judge')));
  };

  /* ---------- final jeopardy ---------- */

  let updateFinalGo = () => {};

  const renderFinalCategory = () => {
    const go = h('button.footBtn', { 'data-advance': true, text: 'Show the clue ➜', onclick: () => setPhase('finalClue') });
    updateFinalGo = () => {
      go.disabled = S.teams.some((t) => (S.final.wagers[t.id] || 0) > Math.max(t.score, 0));
    };
    const card = h('div.card.zoom', null,
      h('div.cardHead', null, h('span.gold', { text: 'Final Jeopardy!' })),
      h('div.cardBody', null,
        h('div.clueText.category', { 'data-fit': '0.06', text: game.final.category || 'Final Jeopardy' })),
      h('div.cardFoot', null, h('div.footNote', { text: 'Enter each wager below, then show the clue.' }), go));
    show(h('div.screen.clueScreen', null, card, teamBar('wager')));
    updateFinalGo();
  };

  const renderFinalClue = (isAnswer) => {
    const head = [
      h('span', { text: 'Final Jeopardy! · ' }),
      h('span.gold', { text: game.final.category || '' }),
    ];
    const card = clueCard({
      head,
      side: isAnswer ? game.final.answer : game.final.clue,
      isAnswer,
      footLabel: isAnswer ? 'See the winner' : 'Show answer',
      footAction: () => setPhase(isAnswer ? 'winner' : 'finalAnswer'),
    });
    show(h('div.screen.clueScreen', null, card, teamBar(isAnswer ? 'final' : 'board')));
  };

  /* ---------- winner ---------- */

  const renderWinner = () => {
    const ranked = S.teams.slice().sort((a, b) => b.score - a.score);
    const top = ranked.length ? ranked[0].score : 0;
    const winners = ranked.filter((t) => t.score === top);
    show(h('div.screen.winnerScreen', null,
      chrome(winners.length > 1 ? 'Winners!' : 'Winner!', '.big.pop'),
      h('div.winnerName', { text: winners.map((t) => t.name).join(' & ') }),
      h('div.winnerScore', { text: money(top) }),
      h('ol.standings', null, ranked.map((t) => h('li', null,
        h('span', { text: t.name }), h('span.gold', { text: money(t.score) })))),
      h('div.winnerActions', null,
        h('button.btn.ghost', { text: 'Main menu', onclick: () => { S = null; render(); } }))));
  };

  /* ================= host menu & modals ================= */

  const closeHostMenu = () => { hostMenu.hidden = true; };

  hostToggle.onclick = (e) => {
    e.stopPropagation();
    if (!hostMenu.hidden) return closeHostMenu();
    const items = [];
    const add = (label, fn) => items.push(h('button', { text: label, onclick: () => { closeHostMenu(); fn(); } }));
    add('Players / teams & scores', openTeamsModal);
    if (S && S.current && ['dd', 'clue', 'answer'].includes(S.phase)) add('Put this clue back on the board', undoClue);
    if (S && S.phase === 'board' && S.history.length) add('Undo last clue', undoClue);
    if (S && ['board', 'roundSplash'].includes(S.phase)) {
      const next = nextStageInfo();
      add(`Skip ahead: ${next.label.replace(/^On to /, '')}`, next.go);
    }
    if (S && ['finalSplash', 'finalCategory', 'finalClue', 'finalAnswer'].includes(S.phase)) {
      add('Back to the board', () => setPhase('board'));
    }
    add(document.fullscreenElement ? 'Exit full screen' : 'Full screen', toggleFullscreen);
    add('Main menu (game is saved)', () => { S = null; render(); });
    hostMenu.replaceChildren(...items);
    hostMenu.hidden = false;
  };
  document.addEventListener('click', (e) => { if (!hostMenu.contains(e.target)) closeHostMenu(); });

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  };

  const openModal = (title, body, onClose) => {
    const close = () => { overlay.remove(); if (onClose) onClose(); };
    const overlay = h('div.modal', { onclick: (e) => { if (e.target === overlay) close(); } },
      h('div.modalPanel', null,
        h('div.modalHead', null, h('h2', { text: title }), h('button.iconBtn', { text: '×', onclick: close })),
        body));
    overlay.close = close;
    modalRoot.append(overlay);
    return overlay;
  };

  function openTeamsModal() {
    if (!S) return;
    const body = h('div.teamsEdit');
    const draw = () => {
      body.replaceChildren(
        ...S.teams.map((t) => h('div.teamEditRow', null,
          h('input.input', {
            value: t.name, maxLength: 24, 'aria-label': 'Name',
            oninput: (e) => { t.name = e.target.value || 'Team'; save(); },
          }),
          h('button.iconBtn', { text: '−', title: 'Subtract', onclick: () => { t.score -= 100; save(); draw(); } }),
          h('input.input.scoreInput', {
            value: String(t.score), inputMode: 'numeric', 'aria-label': 'Score',
            onchange: (e) => {
              const v = parseInt(e.target.value.replace(/[^0-9-]/g, ''), 10);
              t.score = Number.isFinite(v) ? v : 0;
              save(); draw();
            },
          }),
          h('button.iconBtn', { text: '+', title: 'Add', onclick: () => { t.score += 100; save(); draw(); } }),
          h('button.iconBtn.danger', {
            text: '×', title: 'Remove', disabled: S.teams.length <= 1,
            onclick: () => {
              if (!confirm(`Remove ${t.name}?`)) return;
              S.teams = S.teams.filter((x) => x !== t);
              if (S.current) delete S.current.marks[t.id];
              if (S.current && S.current.ddTeam === t.id) S.current.ddTeam = null;
              delete S.final.wagers[t.id];
              delete S.final.marks[t.id];
              save(); draw();
            },
          }))),
        h('div.modalActions', null,
          h('button.btn.ghost', {
            text: '+ Add player / team', disabled: S.teams.length >= MAX_TEAMS,
            onclick: () => {
              S.teams.push({ id: J.randomId(), name: `Team ${S.teams.length + 1}`, score: 0 });
              save(); draw();
            },
          }),
          h('button.btn.gold', { text: 'Done', onclick: () => modal.close() })));
    };
    draw();
    const modal = openModal('Players / teams & scores', body, () => render());
  }

  const openLightbox = (src) => {
    const box = h('div.lightbox', { onclick: () => box.remove() }, h('img', { src, alt: '' }));
    modalRoot.append(box);
  };

  /* ================= keyboard ================= */

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') {
      const top = modalRoot.lastElementChild;
      if (top) { top.close ? top.close() : top.remove(); return; }
      closeHostMenu();
      return;
    }
    if (modalRoot.children.length) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      advance();
      return;
    }
    const m = e.code.match(/^Digit([1-6])$/);
    if (m && S && S.current && ['clue', 'answer'].includes(S.phase)) {
      const t = S.teams[+m[1] - 1];
      if (t) markTeam(t.id, e.shiftKey ? 'wrong' : 'right');
    }
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const screen = stage.lastElementChild;
      if (screen) fitScreen(screen);
    }, 120);
  });

  /* ================= boot ================= */

  (async () => {
    hostToggle.hidden = true;
    stage.append(h('div.screen.loading', { text: 'Loading…' }));
    try {
      index = await J.loadIndex();
    } catch (e) {
      index = { games: [] };
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    renderSetup();
  })();
})();
