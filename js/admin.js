/* Admin panel: edit game boards and save them (with photos/audio) to the GitHub repo. */
(function () {
  const { h, money } = J;

  const gameListEl = document.getElementById('gameList');
  const editorEl = document.getElementById('editor');
  const statusEl = document.getElementById('status');
  const saveBtn = document.getElementById('saveBtn');
  const connBtn = document.getElementById('connBtn');
  const modalRoot = document.getElementById('modalRoot');

  const MAX_UPLOAD_MB = 50;

  let games = [];              // every game, in menu order
  let snapshots = {};          // id -> JSON as last saved/loaded
  let indexSnapshot = '';
  let savedIds = new Set();    // ids that exist in the repo
  let deletedIds = new Set();  // saved games deleted here, not yet saved
  let loadedAll = true;        // false if some game file failed to load
  let selectedId = null;
  let tab = 'title';
  const pending = {};          // media path -> { base64, size } waiting to be uploaded
  const previews = {};         // media path -> local blob URL for previews

  const selected = () => games.find((g) => g.id === selectedId) || null;
  const gameJSON = (g) => `${JSON.stringify(g, null, 2)}\n`;
  const indexJSON = () => `${JSON.stringify({ games: games.map((g) => ({ id: g.id, name: g.name })) }, null, 2)}\n`;

  const gameDirty = (g) => snapshots[g.id] !== gameJSON(g);
  const isDirty = () => deletedIds.size > 0 || indexJSON() !== indexSnapshot || games.some(gameDirty);

  /* ================= status & header ================= */

  let statusTimer;
  const status = (msg, kind = '', sticky = false) => {
    clearTimeout(statusTimer);
    statusEl.hidden = !msg;
    statusEl.className = `status ${kind}`;
    statusEl.textContent = msg || '';
    if (msg && !sticky) statusTimer = setTimeout(() => { statusEl.hidden = true; }, 6000);
  };

  const markDirty = () => {
    saveBtn.classList.toggle('dirty', isDirty());
    renderGameList();
  };

  const renderConn = () => {
    const cfg = J.gh.config();
    if (cfg.token) {
      connBtn.className = 'chip ok';
      connBtn.textContent = `GitHub: ${cfg.owner}/${cfg.repo}`;
    } else {
      connBtn.className = 'chip off';
      connBtn.textContent = 'Connect GitHub to save';
    }
  };

  /* ================= loading ================= */

  const load = async () => {
    status('Loading game boards…', '', true);
    let index;
    try {
      index = await J.loadIndex();
    } catch (e) {
      status(`Could not load the list of games: ${e.message}`, 'bad', true);
      index = { games: [] };
    }
    games = [];
    loadedAll = true;
    for (const entry of index.games) {
      try {
        const g = await J.loadGame(entry.id);
        if (g) {
          if (!g.name) g.name = entry.name || entry.id;
          games.push(g);
        } else loadedAll = false;
      } catch (e) {
        loadedAll = false;
      }
    }
    snapshots = {};
    games.forEach((g) => { snapshots[g.id] = gameJSON(g); });
    indexSnapshot = indexJSON();
    savedIds = new Set(games.map((g) => g.id));
    deletedIds = new Set();
    if (!selected()) selectedId = games.length ? games[0].id : null;
    status(loadedAll ? '' : 'Some game files could not be loaded. Unused media will not be cleaned up on save.', loadedAll ? '' : 'bad');
    markDirty();
    renderEditor();
  };

  /* ================= sidebar ================= */

  const renderGameList = () => {
    gameListEl.replaceChildren(...(games.length
      ? games.map((g) => h('button.gameItem', {
        onclick: () => { selectedId = g.id; renderGameList(); renderEditor(); },
        title: g.name,
      }, gameDirty(g) || !savedIds.has(g.id) ? h('span.dot', { text: '● ' }) : null, g.name || g.id))
      : [h('div.empty', { text: 'No games yet.' })]));
    gameListEl.querySelectorAll('.gameItem').forEach((el, i) => el.classList.toggle('on', games[i].id === selectedId));
  };

  const uniqueId = (name) => {
    let id;
    do id = `${J.slug(name)}-${J.randomId(4)}`; while (games.some((g) => g.id === id) || deletedIds.has(id));
    return id;
  };

  document.getElementById('newGameBtn').onclick = () => {
    const name = prompt('Name for the new game board:', 'New Game');
    if (name == null) return;
    const g = J.newGame(uniqueId(name || 'game'), name.trim() || 'New Game');
    games.push(g);
    selectedId = g.id;
    tab = 'title';
    markDirty();
    renderEditor();
  };

  document.getElementById('importInput').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const g = J.normalizeGame(data);
      g.id = uniqueId(g.name || 'imported');
      g.name = g.name || 'Imported game';
      games.push(g);
      selectedId = g.id;
      markDirty();
      renderEditor();
      status(`Imported “${g.name}”. Remember to save.`, 'ok');
    } catch (err) {
      status(`That file is not a valid game backup (${err.message}).`, 'bad');
    }
  };

  /* ================= editor ================= */

  const renderEditor = () => {
    renderGameList();
    const g = selected();
    if (!g) {
      editorEl.replaceChildren(
        h('h2', { text: 'Welcome!' }),
        h('p', { text: 'Create your first game board with “+ New game” on the left.' }));
      return;
    }
    const tabs = [
      ['title', 'Title screen'],
      ['single', g.rounds.single.name || 'Jeopardy!'],
      ['double', g.rounds.double.name || 'Double Jeopardy!'],
      ['final', 'Final Jeopardy!'],
      ['dd', 'Daily Doubles'],
    ];
    const body = h('div.tabBody');
    editorEl.replaceChildren(
      !J.gh.connected() && h('p.help', null,
        'You are not connected to GitHub, so you can edit but not save yet. ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); openConnModal(); }, text: 'Connect now' })),
      h('div.editorHead', null,
        h('h2', { text: g.name || g.id }),
        h('div.row', null,
          h('a.btn.small.ghost', { href: 'index.html', target: '_blank', rel: 'noopener', text: 'Play ↗' }),
          h('button.btn.small.ghost', { text: 'Duplicate', onclick: () => duplicateGame(g) }),
          h('button.btn.small.ghost', {
            text: 'Answer sheet (PDF)',
            onclick: () => J.downloadAnswerSheet(g, null).catch((e) => status(e.message, 'bad')),
          }),
          h('button.btn.small.ghost', { text: 'Download backup', onclick: () => downloadBackup(g) }),
          h('button.btn.small.danger', { text: 'Delete', onclick: () => deleteGame(g) }))),
      h('div.tabs', null, tabs.map(([key, label]) => h(`button.tab${tab === key ? '.on' : ''}`, {
        text: label, onclick: () => { tab = key; renderEditor(); },
      }))),
      body);
    if (tab === 'title') renderTitleTab(g, body);
    else if (tab === 'single' || tab === 'double') renderRoundTab(g, tab, body);
    else if (tab === 'final') renderFinalTab(g, body);
    else renderDDTab(g, body);
  };

  const field = (label, input, help) => h('label.field', null, h('span', { text: label }), input, help && h('div.help', { text: help }));

  const textInput = (obj, key, opts = {}) => h(opts.area ? 'textarea.input' : 'input.input', {
    value: obj[key] || '',
    placeholder: opts.placeholder || '',
    maxLength: opts.max || 2000,
    oninput: (e) => { obj[key] = e.target.value; markDirty(); if (opts.after) opts.after(); },
  });

  const checkbox = (label, obj, key, after) => h('label.check', null,
    h('input', {
      type: 'checkbox', checked: !!obj[key],
      onchange: (e) => { obj[key] = e.target.checked; markDirty(); if (after) after(); },
    }),
    h('span', { text: label }));

  /* ---------- title tab ---------- */

  const renderTitleTab = (g, body) => {
    const preview = h('div.preview');
    const drawPreview = () => {
      preview.replaceChildren(
        g.showLogo && h('img', { src: 'assets/logo.png', alt: '' }),
        g.title && h('div.pTitle', { text: g.title }),
        g.subtitle && h('div.pSub', { text: g.subtitle }));
    };
    drawPreview();
    body.append(
      field('Game name (shown when picking a game)', textInput(g, 'name', {
        max: 60,
        after: () => { editorEl.querySelector('.editorHead h2').textContent = g.name || g.id; },
      })),
      h('h3', { text: 'Title screen' }),
      checkbox('Show the JEOPARTY! logo', g, 'showLogo', drawPreview),
      field('Title text (optional, shown in big chrome letters)', textInput(g, 'title', { max: 60, after: drawPreview })),
      field('Subtitle (optional)', textInput(g, 'subtitle', { max: 120, after: drawPreview })),
      h('div.lbl', { text: 'Preview' }),
      preview);
  };

  /* ---------- round tab ---------- */

  const clueLabel = (side) => side.text.trim() || (side.image ? '(picture)' : side.audio ? '(audio)' : '');

  const renderRoundTab = (g, key, body) => {
    const round = g.rounds[key];
    const manualDD = g.dailyDoubles.mode === 'manual';

    if (key === 'double') {
      body.append(checkbox('Include this round in the game', round, 'enabled', () => renderEditor()));
      if (!round.enabled) {
        body.append(h('p.help', { text: 'This round is switched off. Players go straight from the first round to Final Jeopardy!. Your clues here are kept.' }));
      }
    }

    body.append(field('Round name (shown on the round splash screen)', textInput(round, 'name', {
      max: 40,
      after: () => { editorEl.querySelector('.tab.on').textContent = round.name || J.DEFAULT_ROUND_NAMES[key]; },
    })));

    body.append(h('div.lbl', { text: 'Dollar amounts for each row' }));
    body.append(h('div.values', null, round.values.map((v, i) => h('label', null, `Row ${i + 1}`,
      h('input.input', {
        type: 'number', min: 0, step: 100, value: v,
        onchange: (e) => {
          round.values[i] = Math.max(0, parseInt(e.target.value, 10) || 0);
          e.target.value = round.values[i];
          markDirty();
          drawGrid();
        },
      })))));

    body.append(h('p.help', {
      text: manualDD
        ? 'Click a square to edit its clue and answer. Click the ★ to make a square a Daily Double.'
        : 'Click a square to edit its clue and answer. Daily Doubles are placed at random (change this in the Daily Doubles tab).',
    }));

    const grid = h('div.boardEdit');
    const drawGrid = () => {
      const cells = round.categories.map((cat, c) => h('input.catInput', {
        value: cat.name, placeholder: `Category ${c + 1}`, maxLength: 60,
        oninput: (e) => { cat.name = e.target.value; markDirty(); },
      }));
      for (let r = 0; r < J.ROWS; r++) {
        for (let c = 0; c < J.COLS; c++) {
          const cl = round.categories[c].clues[r];
          const label = clueLabel(cl.clue);
          const icons = [
            (cl.clue.image || cl.answer.image) && '🖼',
            (cl.clue.audio || cl.answer.audio) && '🔊',
          ].filter(Boolean).join(' ');
          cells.push(h(`button.cellBtn${label ? '' : '.blank'}`, { onclick: () => openClueEditor(g, key, c, r) },
            h('span.val', { text: money(round.values[r]) }),
            h('span.txt', { text: label || 'Empty. Click to add.' }),
            clueLabel(cl.answer) && h('span.ans', { text: `→ ${clueLabel(cl.answer)}` }),
            icons && h('span.icons', { text: icons }),
            manualDD && h(`span.ddStar${cl.dailyDouble ? '.on' : ''}`, {
              text: '★', title: 'Daily Double', role: 'button',
              onclick: (e) => { e.stopPropagation(); cl.dailyDouble = !cl.dailyDouble; markDirty(); drawGrid(); },
            })));
        }
      }
      grid.replaceChildren(...cells);
    };
    drawGrid();
    body.append(grid);
  };

  /* ---------- clue editor (modal) ---------- */

  const openClueEditor = (g, key, c, r) => {
    const round = g.rounds[key];
    const cat = round.categories[c];
    const cl = cat.clues[r];
    const manualDD = g.dailyDoubles.mode === 'manual';
    const total = J.COLS * J.ROWS;
    const pos = c * J.ROWS + r;
    const go = (p) => { modal.close(true); openClueEditor(g, key, Math.floor(p / J.ROWS), p % J.ROWS); };

    const body = h('div', null,
      h('div.row', { style: { justifyContent: 'space-between', marginBottom: '12px' } },
        manualDD
          ? checkbox('This square is a Daily Double', cl, 'dailyDouble')
          : h('span.help', { style: { margin: 0 }, text: 'Daily Doubles are random for this game.' }),
        h('div.row', null,
          h('button.btn.small.ghost', { text: '◀ Previous', disabled: pos === 0, onclick: () => go(pos - 1) }),
          h('button.btn.small.ghost', { text: 'Next ▶', disabled: pos === total - 1, onclick: () => go(pos + 1) }))),
      h('div.grid2', null,
        sideEditor(g, cl.clue, 'Clue (shown first)', 'e.g. This planet is known as the Red Planet'),
        sideEditor(g, cl.answer, 'Answer (shown next)', 'e.g. What is Mars?')),
      h('div.modalFoot', null,
        h('button.btn.danger', {
          text: 'Clear this square',
          onclick: () => {
            if (!confirm('Clear the clue, answer and media for this square?')) return;
            Object.assign(cl, J.emptyClue());
            markDirty();
            go(pos);
          },
        }),
        h('button.btn.gold', { text: 'Done', onclick: () => modal.close() })));

    const modal = openModal(`${cat.name || `Category ${c + 1}`} · ${money(round.values[r])}`, body, (silent) => {
      if (!silent) renderEditor();
    });
    const ta = modal.querySelector('textarea');
    if (ta) ta.focus();
  };

  /* ---------- a clue/answer side: text + picture + audio ---------- */

  const sideEditor = (g, side, title, placeholder) => h('div.sideEdit', null,
    h('h3', { text: title }),
    textInput(side, 'text', { area: true, placeholder }),
    mediaRow(g, side, 'image'),
    mediaRow(g, side, 'audio'));

  const mediaRow = (g, side, kind) => {
    const wrap = h('div.mediaRow');
    const label = kind === 'image' ? 'Picture' : 'Audio';
    const draw = () => {
      const path = side[kind];
      const fileInput = h('input', {
        type: 'file', hidden: true, accept: kind === 'image' ? 'image/*' : 'audio/*',
        onchange: async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            side[kind] = await addMedia(g, file, kind);
            markDirty();
            draw();
          } catch (err) {
            alert(err.message);
          }
        },
      });
      const pick = h('label.btn.small.ghost.fileBtn', null, path ? `Replace ${label.toLowerCase()}` : `+ Add ${label.toLowerCase()}`, fileInput);
      if (!path) {
        wrap.replaceChildren(h('div.row', null, pick));
        return;
      }
      const el = kind === 'image' ? h('img', { alt: '' }) : h('audio', { controls: true, preload: 'metadata' });
      if (previews[path]) el.src = previews[path];
      else J.setMediaSrc(el, path);
      wrap.replaceChildren(
        h('span.lbl', { text: label }),
        h('div.mediaPreview', null, el),
        h('div.fileName', { text: path.split('/').pop() + (pending[path] ? ' (not saved yet)' : '') }),
        h('div.row', null, pick, h('button.btn.small.danger', {
          text: 'Remove',
          onclick: () => { side[kind] = ''; markDirty(); draw(); },
        })));
    };
    draw();
    return wrap;
  };

  const readBase64 = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });

  const addMedia = async (g, file, kind) => {
    if (!file.type.startsWith(`${kind}/`)) throw new Error(`Please choose ${kind === 'image' ? 'an image' : 'an audio'} file.`);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. Please use a file under ${MAX_UPLOAD_MB} MB.`);
    }
    const ext = ((file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || file.type.split('/')[1] || 'bin').toLowerCase();
    const base = J.slug(file.name.replace(/\.[^.]+$/, '')).slice(0, 30);
    const path = `media/${g.id}/${J.randomId(6)}-${base}.${ext}`;
    pending[path] = { base64: await readBase64(file), size: file.size };
    previews[path] = URL.createObjectURL(file);
    return path;
  };

  /* ---------- final tab ---------- */

  const renderFinalTab = (g, body) => {
    body.append(
      field('Final Jeopardy! category', textInput(g.final, 'category', { max: 80, placeholder: 'e.g. Famous Landmarks' }),
        'Players see the category first and make their wagers, then you reveal the clue.'),
      h('div.grid2', null,
        sideEditor(g, g.final.clue, 'Clue', 'The Final Jeopardy! clue'),
        sideEditor(g, g.final.answer, 'Answer', 'What is…?')));
  };

  /* ---------- daily doubles tab ---------- */

  const renderDDTab = (g, body) => {
    const dd = g.dailyDoubles;
    const radio = (mode, label) => h('label.check', null,
      h('input', {
        type: 'radio', name: 'ddmode', checked: dd.mode === mode,
        onchange: () => { dd.mode = mode; markDirty(); renderEditor(); },
      }),
      h('span', { text: label }));
    const count = (key) => field(`${g.rounds[key].name || J.DEFAULT_ROUND_NAMES[key]}: how many`, h('input.input', {
      type: 'number', min: 0, max: 10, value: dd[key],
      onchange: (e) => {
        dd[key] = Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0));
        e.target.value = dd[key];
        markDirty();
      },
    }));
    const marked = (key) => g.rounds[key].categories.reduce((n, cat) => n + cat.clues.filter((x) => x.dailyDouble).length, 0);

    body.append(
      radio('random', 'Random: place them at random each time a game starts'),
      radio('manual', 'Manual: I choose which squares are Daily Doubles'));
    if (dd.mode === 'random') {
      body.append(
        h('p.help', { text: 'Like the show: never in the top row, and spread across different categories. The real show uses 1 in the first round and 2 in Double Jeopardy!.' }),
        h('div.grid2', null, count('single'), count('double')));
    } else {
      body.append(h('p.help', {
        text: `Open the round tabs and click the ★ on any square. Currently chosen: ${marked('single')} in ${g.rounds.single.name}, ${marked('double')} in ${g.rounds.double.name}.`,
      }));
    }
  };

  /* ---------- game actions ---------- */

  const duplicateGame = (g) => {
    const copy = J.normalizeGame(JSON.parse(JSON.stringify(g)));
    copy.name = `Copy of ${g.name}`;
    copy.id = uniqueId(copy.name);
    games.push(copy);
    selectedId = copy.id;
    markDirty();
    renderEditor();
    status(`Made “${copy.name}”. Remember to save.`, 'ok');
  };

  const deleteGame = (g) => {
    if (!confirm(`Delete “${g.name}”? This happens on GitHub when you click Save.`)) return;
    games = games.filter((x) => x !== g);
    if (savedIds.has(g.id)) deletedIds.add(g.id);
    selectedId = games.length ? games[0].id : null;
    markDirty();
    renderEditor();
  };

  const downloadBackup = (g) => {
    const blob = new Blob([gameJSON(g)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${g.id}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  };

  /* ================= modals ================= */

  function openModal(title, body, onClose, narrow) {
    const overlay = h('div.modal', { onmousedown: (e) => { if (e.target === overlay) overlay.close(); } },
      h(`div.modalPanel${narrow ? '.narrow' : ''}`, null,
        h('div.modalHead', null, h('h2', { text: title }), h('button.iconBtn', { text: '×', onclick: () => overlay.close() })),
        body));
    overlay.close = (silent) => { overlay.remove(); if (onClose) onClose(silent); };
    modalRoot.append(overlay);
    return overlay;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRoot.lastElementChild) modalRoot.lastElementChild.close();
  });

  function openConnModal(intro) {
    const cfg = J.gh.config();
    const token = h('input.input', { type: 'password', value: cfg.token, placeholder: 'github_pat_…', autocomplete: 'off' });
    const owner = h('input.input', { value: cfg.owner });
    const repo = h('input.input', { value: cfg.repo });
    const branch = h('input.input', { value: cfg.branch, placeholder: 'Leave blank to use the default branch' });
    const msg = h('div.help', { style: { margin: '6px 0 0' } });

    const test = async () => {
      J.gh.save({ token: token.value.trim(), owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() });
      renderConn();
      if (!token.value.trim()) { msg.textContent = 'Please paste a token.'; return; }
      msg.textContent = 'Checking…';
      try {
        const info = await J.gh.api(J.gh.repoPath());
        const br = await J.gh.branch();
        if (info.permissions && info.permissions.push === false) {
          msg.textContent = 'Connected, but this token cannot write to the repo. Give it “Contents: Read and write”.';
          return;
        }
        msg.textContent = `Connected to ${info.full_name} (branch “${br}”).`;
        modal.close();
        status(`Connected to GitHub. Saves go to ${info.full_name} on branch “${br}”.`, 'ok');
        if (!isDirty()) load(); else renderEditor();
      } catch (e) {
        msg.textContent = `Could not connect: ${e.message}. Check the token and repo name.`;
      }
    };

    const body = h('div', null,
      intro && h('p', { text: intro }),
      h('p.help', { style: { margin: '0 0 10px' }, text: 'Saving writes your games, photos and audio into your GitHub repository, and GitHub Pages then publishes them. You only do this once per browser.' }),
      h('ol.steps', null,
        h('li', null, 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'GitHub → New fine-grained token' }), '.'),
        h('li', null, 'Name it ', h('b', { text: 'Jeoparty admin' }), ' and pick an expiration.'),
        h('li', null, 'Under ', h('b', { text: 'Repository access' }), ' choose ', h('b', { text: 'Only select repositories' }), ' → ', h('b', { text: cfg.repo }), '.'),
        h('li', null, 'Under ', h('b', { text: 'Permissions → Repository permissions' }), ' set ', h('b', { text: 'Contents' }), ' to ', h('b', { text: 'Read and write' }), '.'),
        h('li', null, 'Generate the token, copy it, and paste it below.')),
      field('Personal access token', token, 'Stored only in this browser. Never share it, and only use it on your own devices.'),
      h('div.grid2', null, field('Repo owner', owner), field('Repo name', repo)),
      field('Branch (optional)', branch),
      msg,
      h('div.modalFoot', null,
        h('button.btn.danger', {
          text: 'Disconnect',
          onclick: () => {
            J.gh.save({ owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() });
            token.value = '';
            renderConn();
            renderEditor();
            msg.textContent = 'Token removed from this browser.';
          },
        }),
        h('button.btn.gold', { text: 'Test & save', onclick: test })));
    const modal = openModal('Connect to GitHub', body, null, true);
  }

  connBtn.onclick = () => openConnModal();

  /* ================= saving ================= */

  const referencedMedia = () => {
    const set = new Set();
    const addSide = (s) => { if (s.image) set.add(s.image); if (s.audio) set.add(s.audio); };
    for (const g of games) {
      for (const key of J.ROUND_KEYS) {
        g.rounds[key].categories.forEach((cat) => cat.clues.forEach((cl) => { addSide(cl.clue); addSide(cl.answer); }));
      }
      addSide(g.final.clue);
      addSide(g.final.answer);
    }
    return set;
  };

  const commitAll = async () => {
    const gh = J.gh;
    const base = gh.repoPath();
    const branch = await gh.branch();
    const ref = await gh.api(`${base}/git/ref/heads/${encodeURIComponent(branch)}`);
    const headSha = ref.object.sha;
    const head = await gh.api(`${base}/git/commits/${headSha}`);
    const used = referencedMedia();
    const entries = [];
    const uploaded = [];

    const toUpload = Object.keys(pending).filter((p) => used.has(p));
    let n = 0;
    for (const path of toUpload) {
      n++;
      status(`Uploading media ${n} of ${toUpload.length}…`, '', true);
      const blob = await gh.api(`${base}/git/blobs`, {
        method: 'POST', body: { content: pending[path].base64, encoding: 'base64' },
      });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      uploaded.push(path);
    }
    status('Saving games…', '', true);

    const changed = games.filter(gameDirty);
    changed.forEach((g) => entries.push({ path: `data/games/${g.id}.json`, mode: '100644', type: 'blob', content: gameJSON(g) }));
    deletedIds.forEach((id) => entries.push({ path: `data/games/${id}.json`, mode: '100644', type: 'blob', sha: null }));
    if (indexJSON() !== indexSnapshot) entries.push({ path: 'data/index.json', mode: '100644', type: 'blob', content: indexJSON() });

    // Remove photos/audio that no game uses any more.
    if (loadedAll) {
      const tree = await gh.api(`${base}/git/trees/${head.tree.sha}?recursive=1`);
      for (const item of tree.tree) {
        const name = item.path.split('/').pop();
        if (item.type === 'blob' && item.path.startsWith('media/') && !name.startsWith('.') && !used.has(item.path)) {
          entries.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
        }
      }
    }

    if (!entries.length) return { changed: [], uploaded: [] };
    const tree = await gh.api(`${base}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree: entries } });
    const names = changed.map((g) => g.name).join(', ');
    const message = names ? `Update ${names} (via admin panel)` : 'Update games (via admin panel)';
    const commit = await gh.api(`${base}/git/commits`, {
      method: 'POST', body: { message, tree: tree.sha, parents: [headSha] },
    });
    await gh.api(`${base}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
    return { changed, uploaded };
  };

  const save = async () => {
    if (!J.gh.connected()) {
      openConnModal('Connect to GitHub to save your changes.');
      return;
    }
    if (!isDirty()) {
      status('Everything is already saved.', 'ok');
      return;
    }
    saveBtn.disabled = true;
    try {
      let result;
      try {
        result = await commitAll();
      } catch (e) {
        // Someone else saved at the same moment; try once more on top of their change.
        if (e.status !== 422 && e.status !== 409) throw e;
        result = await commitAll();
      }
      result.uploaded.forEach((p) => delete pending[p]);
      games.forEach((g) => { snapshots[g.id] = gameJSON(g); });
      indexSnapshot = indexJSON();
      savedIds = new Set(games.map((g) => g.id));
      deletedIds = new Set();
      markDirty();
      renderEditor();
      status('Saved! The live site updates in about a minute. This browser sees the changes right away.', 'ok', true);
    } catch (e) {
      status(`Save failed: ${e.message}`, 'bad', true);
    } finally {
      saveBtn.disabled = false;
    }
  };

  saveBtn.onclick = save;

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  renderConn();
  load();
})();
