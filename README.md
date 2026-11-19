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
| Control panel | `http://localhost:3000/control` (or `http://<this-PC-IP>:3000/control` from another device on the LAN) |

## OBS setup

1. Sources → **+** → **Browser**.
2. URL: `http://localhost:3000/overlay`. Width **1920**, Height **1080**.
3. Untick "Shutdown source when not visible" so the ticker keeps its position.
4. Leave Custom CSS empty (the page is already transparent).

## Control panel

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

Edit `static/config.json` on GitHub (pencil icon → edit → **Commit changes**). Vercel redeploys in about 30 seconds, and the overlay picks up the change within a minute without refreshing OBS.

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
