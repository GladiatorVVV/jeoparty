/* Host answer sheet: a PDF of every clue and answer to keep on another device. */
(function () {
  const JSPDF_URL = 'js/vendor/jspdf.umd.min.js?v=2.5.1'; // jsPDF 2.5.1, MIT license
  let loading = null;

  const loadJsPDF = () => {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSPDF_URL;
        s.onload = () => resolve(window.jspdf);
        s.onerror = () => {
          loading = null;
          s.remove();
          reject(new Error('Could not load the PDF maker. Please try again.'));
        };
        document.head.append(s);
      });
    }
    return loading;
  };

  // The built-in PDF fonts only cover Latin-1, so swap common "smart" punctuation.
  const clean = (t) => String(t || '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '?');

  const hasContent = (side) => !!(side && (side.text.trim() || side.image || side.audio));

  const mediaNote = (side) => [side.image && '[picture]', side.audio && '[audio]'].filter(Boolean).join(' ');

  /**
   * Build and download the answer sheet.
   * dd: optional { single: ['c-r', ...], double: [...] } with the Daily Double squares
   * chosen for a game in progress (random Daily Doubles are only known once a game starts).
   */
  J.downloadAnswerSheet = async (game, dd) => {
    const { jsPDF } = await loadJsPDF();
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 44;
    const valueW = 64;
    const textX = M + valueW;
    const textW = W - M - textX;
    const NAVY = [8, 6, 135];
    const GREEN = [0, 110, 60];
    const RED = [190, 20, 60];
    const GREY = [110, 110, 130];
    let y = M;

    const font = (style, size, color = [0, 0, 0]) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...color);
    };
    const lines = (text, width, style, size) => {
      font(style, size);
      return doc.splitTextToSize(clean(text), width);
    };
    const ensure = (h) => {
      if (y + h > H - M) {
        doc.addPage();
        y = M;
      }
    };

    // Title block
    font('bold', 20, NAVY);
    doc.text(clean(game.name || 'Jeoparty!'), M, y + 14);
    y += 24;
    font('normal', 10, GREY);
    let ddNote;
    if (game.dailyDoubles.mode === 'manual') ddNote = 'Daily Doubles are marked below.';
    else if (dd) ddNote = 'Daily Doubles chosen for this game are marked below.';
    else ddNote = 'Daily Doubles are placed at random when the game starts. Download this sheet from the in-game menu to see where they are.';
    const dbl = game.rounds.double;
    const offNote = !dbl.enabled && dbl.categories.some((cat) => cat.clues.some((cl) => hasContent(cl.clue)))
      ? ` ${dbl.name || 'Double Jeopardy!'} is switched off for this game, so it is not included (turn it on in the admin panel).`
      : '';
    const intro = doc.splitTextToSize(clean(`Host answer sheet - keep this to yourself! ${ddNote}${offNote}`), W - 2 * M);
    doc.text(intro, M, y + 8);
    y += intro.length * 12 + 20;

    const roundBar = (title) => {
      ensure(80);
      doc.setFillColor(...NAVY);
      doc.rect(M, y, W - 2 * M, 24, 'F');
      font('bold', 13, [255, 195, 25]);
      doc.text(clean(title).toUpperCase(), M + 10, y + 16.5);
      y += 34;
    };

    const isDD = (key, c, r) => {
      const cl = game.rounds[key].categories[c].clues[r];
      if (game.dailyDoubles.mode === 'manual') return cl.dailyDouble;
      return !!(dd && dd[key] && dd[key].includes(`${c}-${r}`));
    };

    const entry = (valueLabel, side, answer, tag) => {
      const clueText = [side.text.trim(), mediaNote(side)].filter(Boolean).join('  ') || '(no text)';
      const ansText = [answer.text.trim(), mediaNote(answer)].filter(Boolean).join('  ') || '(no answer entered)';
      const cl = lines(clueText, textW, 'normal', 10.5);
      const al = lines(`Answer: ${ansText}`, textW, 'bold', 10.5);
      const lh = 13.5;
      const h = (cl.length + al.length) * lh + 10;
      ensure(h);
      font('bold', 11.5, NAVY);
      doc.text(valueLabel, M, y + 10);
      if (tag) {
        font('bold', 7.5, RED);
        doc.text(tag, M, y + 21);
      }
      font('normal', 10.5);
      doc.text(cl, textX, y + 10, { lineHeightFactor: 1.28 });
      font('bold', 10.5, GREEN);
      doc.text(al, textX, y + 10 + cl.length * lh, { lineHeightFactor: 1.28 });
      y += h;
      doc.setDrawColor(220, 222, 235);
      doc.line(textX, y - 5, W - M, y - 5);
    };

    for (const key of J.ROUND_KEYS) {
      const round = game.rounds[key];
      if (key === 'double' && !round.enabled) continue;
      const cats = round.categories
        .map((cat, c) => ({ cat, c }))
        .filter(({ cat }) => cat.clues.some((cl) => hasContent(cl.clue)));
      if (!cats.length) continue;
      roundBar(round.name || J.DEFAULT_ROUND_NAMES[key]);
      for (const { cat, c } of cats) {
        ensure(60);
        font('bold', 13, [0, 0, 0]);
        doc.text(clean(cat.name || `Category ${c + 1}`).toUpperCase(), M, y + 10);
        y += 20;
        cat.clues.forEach((cl, r) => {
          if (!hasContent(cl.clue)) return;
          entry(J.money(round.values[r]), cl.clue, cl.answer, isDD(key, c, r) ? 'DAILY DOUBLE' : '');
        });
        y += 8;
      }
    }

    const fin = game.final;
    if (hasContent(fin.clue) || fin.category.trim()) {
      roundBar('Final Jeopardy!');
      font('bold', 13, [0, 0, 0]);
      doc.text(clean(fin.category || 'Final Jeopardy!').toUpperCase(), M, y + 10);
      y += 20;
      entry('Final', fin.clue, fin.answer, '');
    }

    // Page numbers
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      font('normal', 8.5, GREY);
      doc.text(`${clean(game.name || 'Jeoparty!')} - page ${i} of ${pages}`, W / 2, H - 20, { align: 'center' });
    }

    doc.save(`${J.slug(game.name)}-answer-sheet.pdf`);
  };
})();
