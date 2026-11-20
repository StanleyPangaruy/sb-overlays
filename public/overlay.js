(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  if (params.has('preview')) document.body.classList.add('preview-bg');
  // ?only=lowerthird | corner | speaker: one part per OBS source (see README).
  if (params.has('only')) document.body.dataset.only = params.get('only');

  // Static mode: published without the Node server (see static/index.html).
  const STATIC = document.body.dataset.mode === 'static';

  const root = document.documentElement;
  const lt = $('lt');
  let state = null;

  // ---------- Clock ----------
  let clockFmt = null;
  function buildClockFmt(tz) {
    try {
      clockFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz || undefined });
    } catch {
      clockFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  }
  function tickClock() {
    if (!clockFmt) return;
    $('clock-text').textContent = clockFmt.format(new Date()).replace(/\s?(AM|PM)$/i, (m) => ' ' + m.trim().toUpperCase());
  }
  setInterval(tickClock, 1000);

  // ---------- Ticker ----------
  const track = $('ticker-track');
  let x = 1920;          // start off-screen right
  let copyWidth = 0;
  let speed = 110;       // px per second
  let lastTs = 0;
  let tickerKey = '';

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function buildTicker(items, sep) {
    const clean = items.map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const key = JSON.stringify([clean, sep]);
    if (key === tickerKey) return;
    tickerKey = key;

    if (!clean.length) { track.innerHTML = ''; copyWidth = 0; return; }
    const sepHtml = sep ? `<span class="sep">${escapeHtml(sep)}</span>` : '';
    const one = clean.map((t) => `<span class="item">${escapeHtml(t)}</span>`).join(sepHtml) + sepHtml;

    track.innerHTML = `<span class="copy">${one}</span>`;
    copyWidth = track.firstElementChild.getBoundingClientRect().width;
    // Repeat until the track covers the screen twice so the loop is seamless.
    const reps = Math.max(2, Math.ceil((1920 * 2) / Math.max(copyWidth, 1)));
    track.innerHTML = Array.from({ length: reps }, () => `<span class="copy">${one}</span>`).join('');
    if (x < -copyWidth) x = x % copyWidth;
  }

  function frame(ts) {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
    lastTs = ts;
    if (copyWidth > 0) {
      x -= speed * dt;
      if (x <= -copyWidth) x += copyWidth;
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Corner logos (top right) ----------
  // Shows one logo at a time and spins (turns around its vertical axis) to the next
  // every few seconds. Settings: cornerLogos { visible, images: [...], seconds }.
  // Every logo is an <img> in the card, loaded and decoded before the first spin;
  // a spin only changes which one is visible, so the new logo is there at once.
  // (Changing an <img>'s src mid-spin made OBS show the old logo until the new
  // file had loaded again.)
  const corner = $('corner');
  const cornerCard = $('corner-card');
  let cornerKey = '';
  let cornerTimer = null;
  let cornerIndex = 0;
  let cornerImgs = [];

  function spin(from, to, duration, easing) {
    return cornerCard.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
      { duration, easing, fill: 'forwards' },
    ).finished;
  }

  function showLogo(i) {
    cornerImgs.forEach((im, n) => im.classList.toggle('on', n === i));
  }

  // One spin at a time: if the page stops drawing (OBS throttles a source that is not
  // on screen), skipped spins must not pile up and then all play at once.
  let spinning = false;
  async function spinTo(i) {
    if (spinning) return;
    spinning = true;
    try {
      await spin(0, 90, 420, 'cubic-bezier(.5,0,.75,0)');   // turn edge-on
      showLogo(i);                                          // swap while it is invisible
      await spin(-90, 0, 560, 'cubic-bezier(.2,.8,.2,1)');  // turn back to face the camera
    } finally {
      spinning = false;
    }
  }

  async function setupCorner(c) {
    const images = (c?.images || []).filter(Boolean);
    const show = Boolean(c?.visible) && images.length > 0;
    const seconds = Math.max(3, Number(c?.seconds) || 8);
    const key = JSON.stringify([show, images, seconds]);
    if (key === cornerKey) return;
    cornerKey = key;

    clearInterval(cornerTimer);
    if (!show) { corner.classList.add('off'); return; }

    const imgs = images.map((src) => {
      const im = new Image();
      im.alt = '';
      im.src = src;
      return im;
    });
    await Promise.all(imgs.map((im) => im.decode().catch(() => {}))); // a broken file is just skipped
    if (key !== cornerKey) return; // settings changed while loading

    cornerImgs = imgs;
    cornerCard.replaceChildren(...imgs);
    cornerIndex = 0;
    showLogo(0);
    corner.classList.remove('off');
    spin(-90, 0, 700, 'cubic-bezier(.2,.8,.2,1)');      // spin in
    if (imgs.length > 1) {
      cornerTimer = setInterval(() => {
        if (spinning) return;
        cornerIndex = (cornerIndex + 1) % imgs.length;
        spinTo(cornerIndex);
      }, seconds * 1000);
    }
  }

  // ---------- Versions ----------
  // ?theme=sb picks the Sangguniang Bayan session version: its settings from "themes.sb"
  // (in config.json / the server state) go over the normal ones. Without it: the normal look.
  const THEME = params.get('theme') || '';
  function withTheme(s) {
    const t = THEME && s.themes?.[THEME];
    if (!t) return s;
    return { ...s, ...t, colors: { ...s.colors, ...t.colors } };
  }

  // ---------- Render ----------
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  function render(s) {
    s = withTheme(s);
    const prevTz = state?.timeZone;
    // A ticker built while hidden measures 0px wide: rebuild it once it's shown.
    if (s.tickerVisible && state && !state.tickerVisible) tickerKey = '';
    state = s;

    root.style.setProperty('--bar', s.colors?.bar || '#d7141a');
    root.style.setProperty('--ticker', s.colors?.ticker || '#0c2d6b');
    root.style.setProperty('--clock', s.colors?.clock || '#1d5fc4');
    root.style.setProperty('--ticker-h', s.tickerVisible ? '34px' : '0px');

    setText($('live'), s.liveLabel || '');
    $('pipe').classList.toggle('off', !s.liveLabel || !s.title);
    setText($('title'), s.title || '');

    $('clock').classList.toggle('off', !s.showClock);
    root.style.setProperty('--clock-w', s.showClock ? '232px' : '0px');
    if (!clockFmt || prevTz !== s.timeZone) buildClockFmt(s.timeZone);
    tickClock();

    const social = s.social || {};
    let anySocial = false;
    for (const k of ['website', 'youtube', 'facebook', 'instagram']) {
      const el = $('s-' + k);
      const v = (social[k] || '').trim();
      el.classList.toggle('off', !v);
      setText(el.querySelector('.t'), v);
      anySocial ||= Boolean(v);
    }
    $('social').classList.toggle('off', !s.showSocial || !anySocial);

    $('ticker').classList.toggle('off', !s.tickerVisible);
    speed = Number(s.tickerSpeed) || 110;
    buildTicker(s.tickerItems || [], s.tickerSeparator ?? '•');

    const img = $('logo-img');
    const src = STATIC ? (s.logo || 'assets/logo.png') : `/logo?v=${s.logoVersion || 0}`;
    if (img.getAttribute('src') !== src) img.src = src;

    lt.classList.toggle('hidden', !s.visible);
    setupCorner(s.cornerLogos);
    renderSpeaker(s.speakerLive || {});
  }

  // ---------- Speaker plate ----------
  const sp = $('speaker');
  const spName = $('sp-name');
  const spTitle = $('sp-title');
  let spShown = { visible: false, name: '', title: '' };
  let spSwapTimer;

  // Shrink a line's font until it fits the available width.
  function fitLine(el, base, min, maxW) {
    el.style.fontSize = base + 'px';
    let size = base;
    while (el.getBoundingClientRect().width > maxW && size > min) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }

  function setSpeakerText(name, title) {
    spName.textContent = name;
    spTitle.textContent = title;
    // Keep clear of the social strip on the right when it's showing.
    const social = $('social');
    const r = social.getBoundingClientRect();
    const socialLeft = r.width > 0 ? r.left : 1920;
    const maxW = Math.min(socialLeft, 1920) - 182 - 28;
    fitLine(spName, 40, 26, maxW);
    fitLine(spTitle, 24, 16, maxW);
  }

  function renderSpeaker(live) {
    if (!sp) return; // static page has no speaker plate
    const next = { visible: Boolean(live.visible && live.name), name: live.name || '', title: live.title || '' };
    const changed = next.name !== spShown.name || next.title !== spShown.title;
    clearTimeout(spSwapTimer);

    if (!next.visible) {
      sp.classList.remove('show');
    } else if (!spShown.visible) {
      setSpeakerText(next.name, next.title);
      void sp.offsetWidth; // restart transition
      sp.classList.add('show');
    } else if (changed) {
      // Swap: wipe out, change text, wipe in.
      sp.classList.remove('show');
      spSwapTimer = setTimeout(() => {
        setSpeakerText(next.name, next.title);
        sp.classList.add('show');
      }, 450);
    }
    spShown = next;
  }

  // ---------- Live connection ----------
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') render(msg.state);
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }

  // ---------- Static mode: settings come from config.json (+ URL overrides) ----------
  // URL overrides for a single OBS source: ?title=...&live=...&ticker=line1&ticker=line2
  function urlOverrides() {
    const o = {};
    if (params.has('title')) o.title = params.get('title');
    if (params.has('live')) o.liveLabel = params.get('live');
    if (params.has('ticker')) o.tickerItems = params.getAll('ticker');
    return o;
  }

  let configText = '';
  async function loadConfig() {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (text === configText) return; // unchanged since last check
      configText = text;
      render({ visible: true, ...JSON.parse(text), ...urlOverrides() });
    } catch (err) {
      console.error('Could not load config.json:', err);
    }
  }

  // Wait for fonts so ticker width measurement is accurate.
  (document.fonts?.ready || Promise.resolve()).then(() => {
    if (!STATIC) return connect();
    loadConfig();
    setInterval(loadConfig, 60_000); // pick up a redeploy without refreshing OBS
  });
})();
