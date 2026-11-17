(() => {
  const $ = (id) => document.getElementById(id);
  const fields = [...document.querySelectorAll('[data-k]')];
  let live = null;     // state currently on air (from server)
  let dirty = false;
  let ws = null;

  $('overlay-url').textContent = `${location.origin}/overlay`;

  // ---------- Preview scaling ----------
  const frame = $('preview-frame');
  const fit = () => { frame.style.transform = `scale(${$('preview').clientWidth / 1920})`; };
  new ResizeObserver(fit).observe($('preview'));

  // ---------- Path helpers ----------
  const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function set(obj, p, v) {
    const ks = p.split('.');
    let o = obj;
    for (const k of ks.slice(0, -1)) o = o[k] ??= {};
    o[ks.at(-1)] = v;
  }

  function readField(el) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') return Number(el.value);
    if (k === 'tickerItems') return el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    return el.value;
  }

  function writeField(el, v) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else if (k === 'tickerItems') el.value = (v || []).join('\n');
    else el.value = v ?? '';
  }

  function fillForm(s) {
    for (const el of fields) writeField(el, get(s, el.dataset.k));
    $('speed-val').textContent = s.tickerSpeed;
  }

  function collectPatch() {
    const patch = {};
    for (const el of fields) set(patch, el.dataset.k, readField(el));
    return patch;
  }

  // ---------- Dirty tracking ----------
  function setDirty(v) {
    dirty = v;
    $('applybar').classList.toggle('dirty', v);
    $('btn-apply').disabled = !v;
    $('btn-revert').disabled = !v;
    $('dirty-msg').textContent = v ? 'You have changes that are NOT on air yet.' : 'All changes are on air.';
  }

  // Checkboxes and colors go on air immediately; text waits for Apply.
  const INSTANT = (el) => el.type === 'checkbox' || el.type === 'color' || el.type === 'range';

  for (const el of fields) {
    el.addEventListener('input', () => {
      if (el.type === 'range') $('speed-val').textContent = el.value;
      if (INSTANT(el)) {
        const patch = {};
        set(patch, el.dataset.k, readField(el));
        send(patch);
      } else {
        setDirty(true);
      }
    });
  }

  function apply() {
    if (!dirty) return;
    send(collectPatch());
    setDirty(false);
  }

  $('btn-apply').onclick = apply;
  $('btn-revert').onclick = () => { if (live) fillForm(live); setDirty(false); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
  });

  $('btn-show').onclick = () => send({ visible: true });
  $('btn-hide').onclick = () => send({ visible: false });

  $('btn-reset').onclick = async () => {
    if (!confirm('Reset every setting to the defaults? The logo is kept.')) return;
    await fetch('/api/reset', { method: 'POST' });
    setDirty(false);
  };

  // ---------- Logo ----------
  $('logo-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const res = await fetch('/api/logo', { method: 'POST', headers: { 'content-type': f.type }, body: f });
    if (!res.ok) alert((await res.json()).error || 'Upload failed');
    e.target.value = '';
  };

  // ---------- Live connection ----------
  function send(patch) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'patch', patch }));
    else fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  }

  function onState(s) {
    live = s;
    $('btn-show').classList.toggle('active', s.visible);
    $('btn-hide').classList.toggle('active', !s.visible);
    if (!dirty) {
      fillForm(s);
    } else {
      // Keep the operator's unsaved text but sync instant controls.
      for (const el of fields) if (INSTANT(el)) writeField(el, get(s, el.dataset.k));
    }
  }

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { $('conn').textContent = 'connected'; $('conn').className = 'conn ok'; };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'state') onState(m.state); };
    ws.onclose = () => {
      $('conn').textContent = 'disconnected — retrying';
      $('conn').className = 'conn bad';
      setTimeout(connect, 1500);
    };
  }
  connect();

  // ---------- Facebook ----------
  let fbPosts = [];

  fetch('/api/facebook/status').then((r) => r.json()).then(({ configured }) => {
    $('fb-status').textContent = configured
      ? 'Facebook Page connected. Fetch posts, tick the ones you want, then add them to the ticker.'
      : 'Facebook is not set up yet. Add FB_PAGE_ID and FB_PAGE_TOKEN to the .env file and restart the server (see README).';
    $('fb-fetch').disabled = !configured;
  });

  // Words that end in a period but don't end a sentence (Hon., Brgy., a.m., single initials…).
  const ABBR = /^(hon|brgy|bgy|sto|sta|mr|mrs|ms|dr|engr|atty|gov|sen|rep|kgd|kgg|gng|bb|kap|konsi|sgt|capt|col|gen|prof|pres|no|nos|st|jr|sr|inc|corp|vs|etc|[a-z])$/i;
  const DOTTED = /^([a-z]\.)+[a-z]$/i; // a.m, p.m, e.g

  function splitSentences(t) {
    const out = [];
    const re = /[.!?]+["')\]]*(?=\s|$)/g;
    let start = 0;
    let m;
    while ((m = re.exec(t))) {
      const end = m.index + m[0].length;
      if (m[0][0] === '.') {
        const word = t.slice(start, m.index).split(/\s+/).pop().replace(/^[^A-Za-z]+/, '');
        if (ABBR.test(word) || DOTTED.test(word) || /\d$/.test(word)) continue;
      }
      if (/^\s*[a-z]/.test(t.slice(end))) continue; // next word lowercase → not a sentence break
      out.push(t.slice(start, end).trim());
      start = end;
    }
    const rest = t.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }

  // Always ends on a whole sentence — never cut mid-sentence or add "…".
  function summarize(msg) {
    let t = msg;
    if ($('fb-firstpara').checked) t = t.split(/\n\s*\n/)[0];
    t = t.replace(/\s+/g, ' ').trim();
    const max = Number($('fb-max').value) || 200;

    let out = '';
    for (const s of splitSentences(t)) {
      const next = out ? `${out} ${s}` : s;
      if (out && next.length > max) break;
      out = next;
      if (out.length >= max) break;
    }

    // Headlines often have no punctuation: add a period (before any trailing emoji).
    const [, body, tail] = out.match(/^(.*?)([\s\p{Extended_Pictographic}️‍]*)$/su);
    if (body && !/[.!?]["')\]]*$/.test(body)) out = body.replace(/[\s,;:|–—-]+$/, '') + '.' + tail;
    return out;
  }

  function renderFb() {
    const list = $('fb-list');
    list.innerHTML = '';
    for (const p of fbPosts) {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.id = p.id;
      const body = document.createElement('div');
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = new Date(p.created).toLocaleString() + ' · ';
      const a = document.createElement('a');
      a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'open post';
      meta.append(a);
      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.textContent = summarize(p.message);
      body.append(meta, msg);
      li.append(cb, body);
      li.onclick = (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'A') cb.checked = !cb.checked; };
      list.append(li);
    }
    $('fb-actions').hidden = fbPosts.length === 0;
  }

  $('fb-max').oninput = renderFb;
  $('fb-firstpara').onchange = renderFb;

  $('fb-fetch').onclick = async () => {
    $('fb-fetch').disabled = true;
    $('fb-fetch').textContent = 'Fetching…';
    try {
      const res = await fetch('/api/facebook/posts?limit=15');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      fbPosts = body.posts;
      if (!fbPosts.length) $('fb-status').textContent = 'No text posts found on the Page.';
      renderFb();
    } catch (err) {
      $('fb-status').textContent = 'Facebook error: ' + err.message;
    } finally {
      $('fb-fetch').disabled = false;
      $('fb-fetch').textContent = 'Fetch latest posts';
    }
  };

  function selectedTexts() {
    const ids = [...document.querySelectorAll('#fb-list input:checked')].map((c) => c.dataset.id);
    return fbPosts.filter((p) => ids.includes(p.id)).map((p) => summarize(p.message));
  }

  function putInTicker(replace) {
    const texts = selectedTexts();
    if (!texts.length) return alert('Tick at least one post first.');
    const ta = document.querySelector('[data-k="tickerItems"]');
    const current = replace ? [] : ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    ta.value = [...current, ...texts].join('\n');
    setDirty(true);
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('fb-add').onclick = () => putInTicker(false);
  $('fb-replace').onclick = () => putInTicker(true);
})();
