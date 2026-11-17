(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  if (params.has('preview')) document.body.classList.add('preview-bg');

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

  // ---------- Render ----------
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  function render(s) {
    const prevTz = state?.timeZone;
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
    const src = `/logo?v=${s.logoVersion || 0}`;
    if (img.getAttribute('src') !== src) img.src = src;

    lt.classList.toggle('hidden', !s.visible);
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

  // Wait for fonts so ticker width measurement is accurate.
  (document.fonts?.ready || Promise.resolve()).then(connect);
})();
