(() => {
  const $ = (id) => document.getElementById(id);
  const fields = [...document.querySelectorAll('[data-k]')];
  let live = null;     // state currently on air (from server)
  let dirty = false;
  let ws = null;

  $('overlay-url').textContent = `${location.origin}/overlay`;
  $('control-url').textContent = `${location.origin}/control`;

  // ---------- Collapsible sections (remembered per browser / OBS dock) ----------
  const OPEN_KEY = 'sbo-open-sections';
  const DEFAULT_OPEN = ['speakers'];
  let openSet;
  try { openSet = new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || DEFAULT_OPEN); } catch { openSet = new Set(DEFAULT_OPEN); }
  for (const d of document.querySelectorAll('details[data-key]')) {
    d.open = openSet.has(d.dataset.key);
    d.addEventListener('toggle', () => {
      if (d.open) openSet.add(d.dataset.key); else openSet.delete(d.dataset.key);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openSet])); } catch { /* storage unavailable */ }
      if (d.dataset.key === 'preview') syncPreview();
    });
  }

  // ---------- Preview (only loaded while its section is open, to save CPU in OBS) ----------
  const frame = $('preview-frame');
  const previewBox = document.querySelector('details[data-key="preview"]');
  const fit = () => { frame.style.transform = `scale(${$('preview').clientWidth / 1920})`; };
  new ResizeObserver(fit).observe($('preview'));
  function syncPreview() {
    if (previewBox.open && !frame.getAttribute('src')) frame.src = '/overlay?preview=1';
    if (!previewBox.open && frame.getAttribute('src')) frame.removeAttribute('src');
  }
  syncPreview();

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
    $('applybar').hidden = !v;
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
    renderSpeakerPanel(s);
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
  // ---------- Speakers ----------
  let roster = [];
  const rosterBody = $('sp-roster');
  const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function speakerOnAir(name, title) {
    send({ speakerLive: { visible: true, name: name.trim(), title: title.trim() } });
  }
  function speakerOff() { send({ speakerLive: { visible: false } }); }
  function saveRoster() { send({ speakerRoster: roster }); }

  function isLive(p) {
    const l = live?.speakerLive;
    return Boolean(l?.visible && l.name === p.name.trim() && l.title === p.title.trim());
  }

  let editing = false;

  function renderRoster() {
    rosterBody.innerHTML = '';
    $('sp-table').classList.toggle('editing', editing);
    roster.forEach((p, i) => (editing ? renderEditRow : renderPickRow)(p, i));
  }

  const chairTitle = (c) => `Chairman, Committee on ${c}`;
  const viceTitle = (c) => `Vice-Chairman, Committee on ${c}`;
  const liveIs = (name, title) => {
    const l = live?.speakerLive;
    return Boolean(l?.visible && l.name === (name || '').trim() && l.title === (title || '').trim());
  };
  const rowLive = (p) => isLive(p)
    || (p.committees || []).some((c) => liveIs(p.name, chairTitle(c)))
    || (p.viceCommittees || []).some((c) => liveIs(p.name, viceTitle(c)));
  function toggleAir(name, title) {
    if (liveIs(name, title)) speakerOff();
    else if (name) speakerOnAir(name, title);
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Live mode: click the name for their position, or a committee under it for "Chairman, Committee on …".
  function renderPickRow(p, i) {
    const tr = el('tr');
    tr.dataset.id = p.id;
    tr.classList.toggle('on-air', rowLive(p));
    const td = el('td');
    td.colSpan = 4;
    const card = el('div', 'sp-card');

    const main = el('button', 'pick');
    main.title = isLive(p) ? 'Take off air' : 'Put on air';
    const who = el('span', 'pick-who');
    who.append(el('span', 'pick-name', p.name || '(no name)'), el('span', 'pick-title', p.title));
    main.append(el('span', 'pick-num', i < 9 ? String(i + 1) : ''), who, el('span', 'pick-chip', isLive(p) ? 'ON AIR' : ''));
    main.onclick = () => toggleAir(p.name, p.title);
    card.append(main);

    const chipRow = (label, list, titleFn, cls) => {
      list = (list || []).filter(Boolean);
      if (!list.length) return;
      const chips = el('div', 'cm-chips ' + cls);
      chips.append(el('span', 'cm-label', label));
      for (const c of list) {
        const t = titleFn(c);
        const on = liveIs(p.name, t);
        const b = el('button', 'cm-chip' + (on ? ' on' : ''), c);
        b.title = on ? 'Take off air' : `Show as "${t}"`;
        b.onclick = () => toggleAir(p.name, t);
        chips.append(b);
      }
      card.append(chips);
    };
    chipRow('Chairman:', p.committees, chairTitle, 'chair');
    chipRow('Vice-Chairman:', p.viceCommittees, viceTitle, 'vice');

    td.append(card);
    tr.append(td);
    rosterBody.append(tr);
  }

  // Edit mode: name, position, chairmanships (one per line), reorder / remove.
  function renderEditRow(p, i) {
    const tr = el('tr');
    tr.dataset.id = p.id;
    tr.append(el('td', 'num', i < 9 ? String(i + 1) : ''));

    const input = (key, ph) => {
      const inp = el('input');
      inp.value = p[key] || '';
      inp.placeholder = ph;
      inp.onchange = () => { p[key] = inp.value.trim(); saveRoster(); };
      return inp;
    };
    const tdName = el('td');
    tdName.append(input('name', 'Hon. Juan Dela Cruz'));
    const tdTitle = el('td');
    tdTitle.append(input('title', 'Municipal Councilor'));
    const listBox = (key, label) => {
      const lab = el('label', 'cm-edit-label');
      lab.append(el('small', null, label + ' (one committee per line)'));
      const ta = el('textarea', 'cm-edit');
      ta.rows = Math.max(2, (p[key] || []).length);
      ta.value = (p[key] || []).join('\n');
      ta.onchange = () => {
        p[key] = ta.value.split('\n').map((x) => x.trim().replace(/^committee on\s+/i, '')).filter(Boolean);
        saveRoster();
      };
      lab.append(ta);
      tdTitle.append(lab);
    };
    listBox('committees', 'Chairman of');
    listBox('viceCommittees', 'Vice-Chairman of');

    const acts = el('td', 'acts');
    const btn = (label, title, fn) => { const b = el('button', 'btn icon', label); b.title = title; b.onclick = fn; acts.append(b); return b; };
    btn('↑', 'Move up', () => { [roster[i - 1], roster[i]] = [roster[i], roster[i - 1]]; saveRoster(); renderRoster(); }).disabled = i === 0;
    btn('↓', 'Move down', () => { [roster[i + 1], roster[i]] = [roster[i], roster[i + 1]]; saveRoster(); renderRoster(); }).disabled = i === roster.length - 1;
    btn('✕', 'Remove from list', () => {
      if (!confirm(`Remove ${p.name || 'this speaker'} from the list?`)) return;
      roster.splice(i, 1); saveRoster(); renderRoster();
    });

    tr.append(tdName, tdTitle, acts);
    rosterBody.append(tr);
  }

  $('sp-edit').onclick = () => {
    editing = !editing;
    $('sp-edit').textContent = editing ? 'Done editing' : 'Edit list';
    $('sp-edit').classList.toggle('primary', editing);
    $('sp-add').hidden = !editing;
    renderRoster();
  };

  function renderSpeakerPanel(s) {
    const l = s.speakerLive || {};
    const on = Boolean(l.visible && l.name);
    $('sp-status').classList.toggle('live', on);
    $('sp-status-text').textContent = on ? `ON AIR: ${l.name}${l.title ? ' — ' + l.title : ''}` : 'No speaker on air';
    $('sp-off').disabled = !on;
    $('sp-badge').hidden = !on;
    if (document.activeElement !== $('sp-autohide')) $('sp-autohide').value = s.speakerAutoHide ?? 0;

    // Don't rebuild the table while someone is typing in it.
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) && rosterBody.contains(document.activeElement)) {
      for (const tr of rosterBody.children) {
        const p = roster.find((x) => x.id === tr.dataset.id);
        if (p) tr.classList.toggle('on-air', rowLive(p));
      }
      return;
    }
    roster = structuredClone(s.speakerRoster || []);
    renderRoster();
  }

  $('sp-off').onclick = speakerOff;
  $('sp-autohide').onchange = (e) => send({ speakerAutoHide: Math.max(0, Number(e.target.value) || 0) });
  $('sp-add').onclick = () => {
    roster.push({ id: newId(), name: '', title: '', committees: [], viceCommittees: [] });
    saveRoster();
    renderRoster();
    rosterBody.lastElementChild?.querySelector('input')?.focus();
  };

  function quickValues() {
    const name = $('sp-q-name').value.trim();
    const title = $('sp-q-title').value.trim();
    $('sp-q-err').hidden = Boolean(name);
    $('sp-q-err').textContent = name ? '' : 'Enter a name first.';
    return name ? { name, title } : null;
  }
  $('sp-q-name').oninput = () => { $('sp-q-err').hidden = true; };
  $('sp-q-go').onclick = () => { const q = quickValues(); if (q) speakerOnAir(q.name, q.title); };
  $('sp-q-save').onclick = () => {
    const q = quickValues();
    if (!q) return;
    roster.push({ id: newId(), ...q, committees: [], viceCommittees: [] });
    saveRoster();
    renderRoster();
    $('sp-q-name').value = '';
    $('sp-q-title').value = '';
  };
  for (const id of ['sp-q-name', 'sp-q-title']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); $('sp-q-go').click(); } });
  }

  document.addEventListener('keydown', (e) => {
    if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); speakerOff(); return; }
    if (/^[1-9]$/.test(e.key)) {
      const p = roster[Number(e.key) - 1];
      if (p?.name) { e.preventDefault(); speakerOnAir(p.name, p.title); }
    }
  });
})();
