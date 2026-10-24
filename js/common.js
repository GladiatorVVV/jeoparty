/* Shared helpers for the game (index.html) and the admin panel (admin.html). */
(function () {
  const J = (window.J = {});

  J.COLS = 6;
  J.ROWS = 5;
  J.ROUND_KEYS = ['single', 'double'];
  J.DEFAULT_VALUES = {
    single: [200, 400, 600, 800, 1000],
    double: [400, 800, 1200, 1600, 2000],
  };
  J.DEFAULT_ROUND_NAMES = { single: 'Jeopardy!', double: 'Double Jeopardy!' };

  /* ---------- data model ---------- */

  J.emptySide = () => ({ text: '', image: '', audio: '' });
  J.emptyClue = () => ({ clue: J.emptySide(), answer: J.emptySide(), dailyDouble: false });

  J.newRound = (key) => ({
    name: J.DEFAULT_ROUND_NAMES[key],
    enabled: true,
    values: J.DEFAULT_VALUES[key].slice(),
    categories: Array.from({ length: J.COLS }, () => ({
      name: '',
      clues: Array.from({ length: J.ROWS }, J.emptyClue),
    })),
  });

  J.newGame = (id, name) => ({
    id,
    name: name || 'New Game',
    showLogo: true,
    title: '',
    subtitle: '',
    rounds: { single: J.newRound('single'), double: J.newRound('double') },
    dailyDoubles: { mode: 'random', single: 1, double: 2 },
    final: { category: '', clue: J.emptySide(), answer: J.emptySide() },
  });

  // Fill in anything missing so older or hand-edited files never crash the app.
  J.normalizeGame = (g) => {
    const base = J.newGame(g.id, g.name);
    const side = (s) => Object.assign(J.emptySide(), s || {});
    const out = Object.assign(base, g);
    out.rounds = {};
    for (const key of J.ROUND_KEYS) {
      const src = (g.rounds && g.rounds[key]) || {};
      const r = Object.assign(J.newRound(key), src);
      r.values = Array.from({ length: J.ROWS }, (_, i) =>
        Number.isFinite(+(src.values || [])[i]) ? +src.values[i] : J.DEFAULT_VALUES[key][i]);
      r.categories = Array.from({ length: J.COLS }, (_, c) => {
        const cat = (src.categories || [])[c] || {};
        return {
          name: cat.name || '',
          clues: Array.from({ length: J.ROWS }, (_, row) => {
            const cl = (cat.clues || [])[row] || {};
            return { clue: side(cl.clue), answer: side(cl.answer), dailyDouble: !!cl.dailyDouble };
          }),
        };
      });
      if (key === 'single') r.enabled = true;
      out.rounds[key] = r;
    }
    out.dailyDoubles = Object.assign({ mode: 'random', single: 1, double: 2 }, g.dailyDoubles || {});
    out.final = {
      category: (g.final && g.final.category) || '',
      clue: side(g.final && g.final.clue),
      answer: side(g.final && g.final.answer),
    };
    return out;
  };

  J.slug = (s) =>
    (s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';

  J.randomId = (n = 6) => Math.random().toString(36).slice(2, 2 + n);

  J.money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

  /* ---------- GitHub connection (stored only in this browser) ---------- */

  const GH_KEY = 'jeoparty.github';

  J.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) { /* storage unavailable */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  // Work out owner/repo from the GitHub Pages URL, e.g. gladiatorvvv.github.io/jeoparty/
  J.guessRepo = () => {
    const host = location.hostname;
    if (host.endsWith('.github.io')) {
      const owner = host.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      const repo = first && !first.includes('.') ? first : `${owner}.github.io`;
      return { owner, repo };
    }
    return { owner: 'GladiatorVVV', repo: 'jeoparty' };
  };

  J.gh = {
    _branch: null,
    config() {
      const saved = J.store.get(GH_KEY, {});
      const guess = J.guessRepo();
      return {
        token: saved.token || '',
        owner: saved.owner || guess.owner,
        repo: saved.repo || guess.repo,
        branch: saved.branch || '',
      };
    },
    save(cfg) {
      J.store.set(GH_KEY, cfg);
      this._branch = null;
    },
    connected() {
      return !!this.config().token;
    },
    async api(path, opts = {}) {
      const cfg = this.config();
      const headers = Object.assign(
        { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        opts.headers || {});
      if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
      const init = { method: opts.method || 'GET', headers, cache: 'no-store' };
      if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(`https://api.github.com${path}`, init);
      if (opts.raw) return res;
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const body = await res.json();
          if (body.message) msg = `${body.message} (${res.status})`;
        } catch (e) { /* ignore */ }
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    },
    repoPath() {
      const cfg = this.config();
      return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
    },
    async branch() {
      const cfg = this.config();
      if (cfg.branch) return cfg.branch;
      if (!this._branch) {
        const repo = await this.api(this.repoPath());
        this._branch = repo.default_branch;
      }
      return this._branch;
    },
    // Fetch a file's raw contents straight from the repo (fresh, no Pages delay).
    async raw(path) {
      const branch = await this.branch();
      const enc = path.split('/').map(encodeURIComponent).join('/');
      return this.api(`${this.repoPath()}/contents/${enc}?ref=${encodeURIComponent(branch)}`, {
        raw: true,
        headers: { Accept: 'application/vnd.github.raw+json' },
      });
    },
  };

  /* ---------- loading data ---------- */

  // When this browser has a GitHub token, read straight from the repo so freshly
  // saved edits show up immediately; otherwise read the published Pages copy.
  J.loadJSON = async (path) => {
    if (J.gh.connected()) {
      try {
        const res = await J.gh.raw(path);
        if (res.ok) return await res.json();
        if (res.status === 404) return null;
      } catch (e) { /* fall back to the published copy */ }
    }
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return res.json();
  };

  J.loadIndex = async () => {
    const idx = await J.loadJSON('data/index.json');
    return (idx && Array.isArray(idx.games)) ? idx : { games: [] };
  };

  J.loadGame = async (id) => {
    const g = await J.loadJSON(`data/games/${id}.json`);
    return g ? J.normalizeGame(g) : null;
  };

  // Point an <img>/<audio> at a media file. A file saved moments ago may not be
  // on the published site yet; if it fails and we have a token, pull it from the repo.
  const blobCache = new Map();
  J.setMediaSrc = (el, path) => {
    if (!path) return;
    if (/^(blob:|data:|https?:)/.test(path)) {
      el.src = path;
      return;
    }
    if (blobCache.has(path)) {
      el.src = blobCache.get(path);
      return;
    }
    let retried = false;
    el.addEventListener('error', async function onErr() {
      if (retried || !J.gh.connected()) return;
      retried = true;
      el.removeEventListener('error', onErr);
      try {
        const res = await J.gh.raw(path);
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        blobCache.set(path, url);
        el.src = url;
      } catch (e) { /* leave broken */ }
    });
    el.src = path;
  };

  /* ---------- small DOM helper ---------- */

  // h('div.card#x', {onclick, ...attrs}, children...)
  J.h = (sel, attrs, ...kids) => {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) {
      for (const part of m[2].match(/[.#][\w-]+/g)) {
        if (part[0] === '.') el.classList.add(part.slice(1));
        else el.id = part.slice(1);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    return el;
  };

  // Shrink an element's font until its content fits its box.
  J.fitText = (el, maxPx, minPx = 10) => {
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    while (size > minPx && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
      size -= Math.max(1, size * 0.06);
      el.style.fontSize = `${size}px`;
    }
  };
})();
