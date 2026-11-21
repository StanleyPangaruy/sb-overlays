# SB Overlays: Lower Third for OBS

A live lower third (logo, red title bar, social strip, clock and scrolling ticker) that runs as an OBS **Browser Source**. You control it from a web panel.

## Run

**Windows:** double-click **`start.bat`**. On the first run it installs dependencies, then starts the server and opens the control panel. Keep the window open while streaming; close it to stop.

Or from a terminal:

```bash
npm install
npm start
```

| Page | URL |
|---|---|
| Overlay (for OBS) | `http://localhost:3000/overlay` |
| Overlay, SB session version | `http://localhost:3000/overlay?theme=sb` |
| Control panel | `http://localhost:3000/control` (or `http://<this-PC-IP>:3000/control` from another device on the LAN) |

## OBS setup

1. Sources → **+** → **Browser**.
2. URL: `http://localhost:3000/overlay`. Width **1920**, Height **1080**.
3. Untick "Shutdown source when not visible" so the ticker keeps its position.
4. Leave Custom CSS empty (the page is already transparent).

## Two versions: livestreams and SB sessions

The lower third has two versions, picked by the browser source's URL. Each has **its own settings** (title, ticker, colours, clock, social strip, show/hide, which speaker is on air):

| Version | Look | URL ends with | Settings file (local) | Settings file (online) |
|---|---|---|---|---|
| Usual livestreams | red title bar, blue ticker | `/overlay` (or `/` online) | `data/state.json` | `static/config.json` |
| Sangguniang Bayan sessions | blue title bar, red ticker | `/overlay?theme=sb` (or `/?theme=sb` online) | `data/state-sb.json` | `static/config-sb.json` |

Make one browser source per version (for example in an "SB Session" scene).

**Control panel:** the **Usual | SB** switch at the top picks which version you're editing; SHOW/HIDE, Apply and the speaker buttons act on that version. A green dot on a switch button means that version is showing. Open `/control?style=sb` to start on SB, handy as a second OBS dock.

**Shared by both:** the speaker list (with committee roles), the logo and the corner badge.

**Online:** `config-sb.json` only needs what differs from `config.json`; anything it leaves out (for example the ticker) comes from `config.json`. Add `"tickerItems": [...]` to it to give SB its own ticker.

## Separate links for each part

Add `?only=` to the URL to show just one part, so each part can be its own OBS browser source (show, hide or move them separately). All are 1920 x 1080.

| Part | Online (Vercel) | Local |
|---|---|---|
| Everything (as before) | `/` | `/overlay` |
| Lower third only (title bar, ticker, clock, socials, seal) | `/?only=lowerthird` | `/overlay?only=lowerthird` |
| Top-right logo badge only | `/?only=corner` | `/overlay?only=corner` |
| Speaker name plate only | — | `/overlay?only=speaker` |

Combine with the SB version using `&`, e.g. `/?only=lowerthird&theme=sb`. Use either the separate links or the everything link in a scene, not both, or the part shows twice.

## Corner logo badge (top right)

A small white badge in the top-right corner shows the **LIVE Lopez** logo and the **PICTU** logo in turn: every 8 seconds it spins (turns around its vertical axis) to the other one. It is on in both versions (usual and SB session).

Settings, in `static/config.json` (online) or the `server.js` defaults (local):

```json
"cornerLogos": {
  "visible": true,
  "images": ["assets/corner-live-lopez.png", "assets/corner-pictu.png"],
  "seconds": 8
}
```

- `visible: false` hides it; `seconds` is the time between spins (3 or more).
- Add or reorder logos in `images`. Use small square PNGs (about 320 x 320 px, transparent or white background); the badge is 132 px on screen. The 6000 px originals (`live_lopez.png`, `pictu_small.png`) are too heavy for OBS and are kept out of Git.


- **SHOW / HIDE** animates the lower third in or out immediately.
- Text edits (title, ticker, social) are staged. Press **Apply changes** (or Ctrl+Enter) to put them on air.
- Checkboxes, colours and ticker speed apply instantly.
- Upload the municipal seal under **Look → Logo**. A transparent PNG works best.
- Settings are saved in `data/state.json` and survive restarts.

## Facebook posts → ticker

The panel can pull recent posts from the municipality's Facebook Page through the official Graph API. You tick the posts you want, they're trimmed into ticker lines, and you review them and press Apply. Nothing goes on air automatically.

Requirements (Meta only allows this for Pages you manage):

1. Someone with a role on the Page creates an app at <https://developers.facebook.com> (type: Business).
2. Use **Graph API Explorer** to get a *User* token with `pages_show_list` and `pages_read_engagement`. Call `GET /me/accounts` to get the Page's `id` and `access_token`.
3. Exchange it for a **long-lived** Page token: first get a long-lived user token via `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=USER_TOKEN`, then call `/me/accounts` again with it. The Page token you get then doesn't expire.
4. Copy `.env.example` to `.env`, fill in `FB_PAGE_ID` and `FB_PAGE_TOKEN`, then restart.

Keep `.env` private. It's git-ignored.

## Online version (static, no control panel)

The `static/` folder is a hosted copy of the lower third that runs without the Node server, so OBS can load it from anywhere. It has no control panel, no speaker plates, no logo upload and no Facebook import. Its content comes from **`static/config.json`**.

### Deploy to Vercel (one time)

1. Push this repo to GitHub.
2. At <https://vercel.com>, **Add New → Project**, import the repo, and deploy. `vercel.json` already sets everything up, so leave the settings as they are.
3. You get a URL like `https://sb-overlays.vercel.app`.

### Use it in OBS

Browser source → URL `https://<your-project>.vercel.app/`, Width **1920**, Height **1080**.

To animate it in and out, show or hide the source in OBS. Tick "Refresh browser when scene becomes active" if you want the slide-in each time.

### Change the text, colours or ticker

Edit `static/config.json` (usual) or `static/config-sb.json` (SB session) on GitHub (pencil icon → edit → **Commit changes**). Vercel redeploys in about 30 seconds, and the overlay picks up the change within a minute without refreshing OBS.

To change the logo, replace `static/assets/logo.png`.

One OBS source can override the config with URL parameters. Repeat `ticker` for each ticker line:

```
https://<your-project>.vercel.app/?title=SPECIAL%20SESSION&live=LIVE&ticker=First%20line&ticker=Second%20line
```

### Preview locally before pushing

```bash
npm run preview:static
```

Then open <http://localhost:3001/?preview> (the `?preview` adds a checkerboard background so you can see the overlay).
