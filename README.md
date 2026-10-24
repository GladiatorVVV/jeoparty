# Jeoparty!

An online version of Jeopardy! styled after the Jeoparty slide deck. It runs entirely on GitHub Pages.

- **`index.html`** is the game: board → clue → answer → back to the board, with the square cleared.
- **`admin.html`** is the admin panel for editing game boards, clues, answers, photos, audio, dollar amounts, Daily Doubles and Final Jeopardy!.

## Turn on GitHub Pages (one time)

1. In the repo on GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick the repo's default branch and the **/ (root)** folder, then click **Save**.
4. After a minute the game is live at `https://<your-username>.github.io/jeoparty/`.
   The admin panel is at `https://<your-username>.github.io/jeoparty/admin.html`.

## Connect the admin panel (one time per browser)

The admin panel saves straight into this repo, so it needs a GitHub token:

1. Open [GitHub → New fine-grained token](https://github.com/settings/personal-access-tokens/new).
2. **Repository access** → **Only select repositories** → `jeoparty`.
3. **Permissions → Repository permissions → Contents** → **Read and write**.
4. Generate it, then in the admin panel click **Connect GitHub to save** and paste it.

The token is stored only in that browser. Every **Save** makes one commit containing your game files and any photos or audio you added. GitHub Pages republishes in about a minute. A browser that has the token sees changes immediately.

## Hosting a game

- On the start screen, pick a game board and add 1–6 players or teams. You can rename, add or remove them and adjust scores any time from the ☰ menu in the top-right corner, or by clicking a team's name.
- Click a dollar amount to open the clue. Mark each team ✓ or ✗ as they answer. A wrong answer subtracts the value, and the clue stays open for the next team. Click a mark again to undo it.
- **Keyboard:** `Space`/`Enter`/`→` moves forward. `1`–`6` marks that team correct, and `Shift`+`1`–`6` marks them wrong. `F` toggles full screen.
- **Daily Double:** choose who found it, enter their wager (the most they can bet is their score or the round's top value, whichever is higher), then show the clue.
- **Final Jeopardy!:** enter each wager (hidden as dots), show the clue, reveal the answer, then mark each team.
- **Host answer sheet (PDF):** every clue and its answer, by round and category, to check on your phone before you reveal the answer. Download it from the start screen, the ☰ menu or the admin panel. Download it from the ☰ menu **after** starting the game to see where the random Daily Doubles are.
- The ☰ menu can also put a clue back on the board (this undoes its scoring) and skip to the next round.
- The game in progress is saved in the browser, so a refresh or the **Resume** button picks up where you left off.

## Files

```
index.html, admin.html   the two pages
css/, js/                styles and code (no build step; js/vendor has jsPDF, MIT license)
assets/                  logo and background taken from the slide deck
data/index.json          list of game boards
data/games/<id>.json     one file per game board
media/<id>/              photos and audio uploaded from the admin panel
```
