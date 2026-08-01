/* Rubbelwelt – geräteübergreifender Sync über Supabase.
   Modell: EINE gemeinsame Karte, adressiert über einen geheimen "Sync-Code".
   Beide Geräte, die denselben Code eingeben, teilen sich dieselbe Karte. */
(function () {
  'use strict';
  const CODE_KEY = 'rubbelwelt_code';
  const URL = window.SUPABASE_URL || '';
  const KEY = window.SUPABASE_ANON_KEY || '';
  const configured = /^https:\/\/.+\.supabase\.co/.test(URL) && KEY.length > 20;

  let client = null, code = localStorage.getItem(CODE_KEY) || '', channel = null;
  let lastStamp = '';            // updated_at des letzten eigenen Push (Echo-Filter)
  let saveTimer = null, statusEl = null;

  function makeClient() {
    if (!configured || !window.supabase) return null;
    if (!client) client = window.supabase.createClient(URL, KEY, { auth: { persistSession: false } });
    return client;
  }

  async function pull() {
    const c = makeClient(); if (!c || !code) return;
    setStatus('Verbinde…');
    const { data, error } = await c.from('boards').select('data,updated_at').eq('id', code).maybeSingle();
    if (error) { setStatus('Fehler: ' + error.message, true); return; }
    if (data && data.data) {
      lastStamp = data.updated_at || '';
      window.Rubbel && window.Rubbel.applyState(data.data);
      setStatus('Synchron ✓');
    } else {
      setStatus('Neuer Code – diese Karte wird geteilt ✓');
      push(window.Rubbel ? window.Rubbel.getState() : null, true); // Zeile anlegen
    }
    subscribe();
  }

  function subscribe() {
    const c = makeClient(); if (!c || !code) return;
    if (channel) { c.removeChannel(channel); channel = null; }
    channel = c.channel('board-' + code)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'boards', filter: 'id=eq.' + code },
        (payload) => {
          const row = payload.new; if (!row) return;
          if (row.updated_at && row.updated_at === lastStamp) return; // eigenes Echo
          lastStamp = row.updated_at || '';
          if (row.data) { window.Rubbel && window.Rubbel.applyState(row.data); flashStatus('Aktualisiert von anderem Gerät ↻'); }
        })
      .subscribe();
  }

  function push(state, immediate) {
    const c = makeClient(); if (!c || !code || !state) return;
    clearTimeout(saveTimer);
    const doPush = async () => {
      const stamp = new Date().toISOString();
      lastStamp = stamp;
      const { error } = await c.from('boards').upsert({ id: code, data: state, updated_at: stamp });
      if (error) setStatus('Sync-Fehler: ' + error.message, true);
      else setStatus('Synchron ✓');
    };
    if (immediate) doPush(); else saveTimer = setTimeout(doPush, 700);
  }

  /* ---------- Panel ---------- */
  function buildPanel() {
    const wrap = document.createElement('div');
    wrap.id = 'sync-panel'; wrap.className = 'modal hidden';
    wrap.innerHTML =
      '<div class="modal-card">' +
      '<button class="icon-btn modal-close" aria-label="Schließen">✕</button>' +
      '<h2>☁️ Geräte-Sync</h2>' +
      '<p class="sync-intro"></p>' +
      '<label class="sync-label">Gemeinsamer Sync-Code</label>' +
      '<input id="sync-code" type="text" placeholder="z. B. basti-anna-2026" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<p class="sync-hint">Gib auf <b>allen Geräten denselben Code</b> ein – dann seht ihr überall dieselbe Karte. Merk ihn dir wie ein Passwort.</p>' +
      '<div class="sync-status" id="sync-status">—</div>' +
      '<button class="btn btn-primary" id="sync-save">Verbinden</button>' +
      '</div>';
    document.body.appendChild(wrap);
    statusEl = wrap.querySelector('#sync-status');
    const codeInput = wrap.querySelector('#sync-code');
    codeInput.value = code;
    wrap.querySelector('.sync-intro').textContent = configured
      ? 'Deine Reisekarte auf Handy und Laptop gleichzeitig – automatisch abgeglichen.'
      : '⚠️ Sync ist noch nicht eingerichtet (Supabase-Zugang fehlt in config.js).';
    codeInput.disabled = !configured;
    wrap.querySelector('#sync-save').disabled = !configured;

    wrap.querySelector('.modal-close').addEventListener('click', () => wrap.classList.add('hidden'));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.classList.add('hidden'); });
    wrap.querySelector('#sync-save').addEventListener('click', () => {
      const v = codeInput.value.trim().toLowerCase().replace(/\s+/g, '-');
      if (v.length < 4) { setStatus('Bitte einen längeren Code wählen (min. 4 Zeichen).', true); return; }
      code = v; localStorage.setItem(CODE_KEY, code); codeInput.value = code;
      pull();
    });
    return wrap;
  }
  let panel = null;
  function openPanel() { panel = panel || buildPanel(); panel.classList.remove('hidden'); }
  function setStatus(msg, err) { if (statusEl) { statusEl.textContent = msg; statusEl.classList.toggle('err', !!err); } }
  function flashStatus(msg) { setStatus(msg); }

  /* ---------- Öffentliche API ---------- */
  window.RubbelSync = {
    init() { if (configured && code) pull(); },
    push(state) { push(state); },
    openPanel,
    configured,
    hasCode: () => !!code
  };
})();
