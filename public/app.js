// ── State ─────────────────────────────────────────────────────────────────────

let currentState = {};
let isSeeking = false;
let volumeDragging = false;
let volumeTimeout = null;

// ── Audio playback ────────────────────────────────────────────────────────────

const audio = document.getElementById('player');
let audioUrl = null; // last URL loaded into audio element

function updateAudio(s) {
  // Only stream URLs that are real HTTP can be played
  const playable = (s.playerState === 'play' || s.playerState === 'stream')
    && s.streamUrl && s.streamUrl.startsWith('http');

  // Sync volume: mute → 0, otherwise 0..100 → 0.0..1.0
  audio.volume = s.mute ? 0 : s.volume / 100;

  if (playable) {
    const proxyUrl = `/proxy?url=${encodeURIComponent(s.streamUrl)}`;
    if (proxyUrl !== audioUrl) {
      audio.src = proxyUrl;
      audioUrl = proxyUrl;
    }
    if (audio.paused) audio.play().catch(() => {});
  } else if (s.playerState === 'pause') {
    audio.pause();
  } else if (s.playerState === 'stop') {
    audio.pause();
    audio.src = '';
    audioUrl = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(secs) {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function api(path) {
  return fetch(path).catch(console.error);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Controls (called from HTML) ───────────────────────────────────────────────

function togglePlay() {
  const s = currentState.playerState;
  if (s === 'play' || s === 'stream') {
    api('/Pause');          // plain /Pause always pauses (spec §4.2)
  } else {
    api('/Play');           // resume from pause, or start from stop
  }
}

function toggleMute() {
  // spec §3.4/3.5: mute=1 → mute on, mute=0 → mute off
  const next = currentState.mute === 1 ? 0 : 1;
  api(`/Volume?mute=${next}`);
}

function toggleShuffle() {
  const next = currentState.shuffle === 1 ? 0 : 1;
  api(`/Shuffle?state=${next}`);
}

function cycleRepeat() {
  // spec §4.7: 0=repeat queue, 1=repeat track, 2=off
  // UI cycle: off(2) → queue(0) → track(1) → off(2)
  const cur = currentState.repeat ?? 2;
  const next = cur === 2 ? 0 : cur === 0 ? 1 : 2;
  api(`/Repeat?state=${next}`);
}

function playPreset(id) {
  api(`/Preset?id=${id}`);
}

// ── Volume slider ─────────────────────────────────────────────────────────────

const volumeSlider = document.getElementById('volumeSlider');
const volumeValue  = document.getElementById('volumeValue');

volumeSlider.addEventListener('mousedown', () => { volumeDragging = true; });
volumeSlider.addEventListener('touchstart', () => { volumeDragging = true; });

volumeSlider.addEventListener('input', () => {
  const val = parseInt(volumeSlider.value);
  volumeValue.textContent = val;
  clearTimeout(volumeTimeout);
  volumeTimeout = setTimeout(() => api(`/Volume?level=${val}`), 80);
});

volumeSlider.addEventListener('change', () => {
  volumeDragging = false;
  clearTimeout(volumeTimeout);
  api(`/Volume?level=${volumeSlider.value}`);
});

// ── Seek slider ───────────────────────────────────────────────────────────────

const seekSlider = document.getElementById('seekSlider');

seekSlider.addEventListener('mousedown', () => { isSeeking = true; });
seekSlider.addEventListener('touchstart', () => { isSeeking = true; });

seekSlider.addEventListener('change', () => {
  isSeeking = false;
  if (currentState.totlen > 0) {
    const secs = Math.round((parseInt(seekSlider.value) / 100) * currentState.totlen);
    api(`/Play?seek=${secs}`);
  }
});

// ── SSE — receive state updates ───────────────────────────────────────────────

const conn = document.getElementById('connection');

function connect() {
  const es = new EventSource('/ui/events');

  es.onopen = () => {
    conn.textContent = 'connected';
    conn.className = 'connection connected';
  };

  es.onmessage = (e) => {
    const s = JSON.parse(e.data);
    currentState = s;
    render(s);
    updateAudio(s);
  };

  es.onerror = () => {
    conn.textContent = 'reconnecting…';
    conn.className = 'connection disconnected';
    es.close();
    setTimeout(connect, 3000);
  };
}

connect();

// ── Render ────────────────────────────────────────────────────────────────────

function render(s) {
  // Track info — spec says title1/title2/title3 MUST be used for 3-line UI display
  document.getElementById('title1').textContent  = s.title1  || '—';
  document.getElementById('artist').textContent  = s.title2  || '';
  document.getElementById('album').textContent   = s.title3  || '';
  document.getElementById('service').textContent = s.service || '';
  document.getElementById('format').textContent  = s.streamFormat || '';

  // Artwork
  const artImg         = document.getElementById('artwork');
  const artPlaceholder = document.getElementById('artworkPlaceholder');
  if (s.image) {
    artImg.src = s.image;
    artImg.classList.add('visible');
    artPlaceholder.style.display = 'none';
  } else {
    artImg.classList.remove('visible');
    artPlaceholder.style.display = '';
  }

  // Progress — only shown when there is a known duration
  const hasDuration = s.totlen > 0;
  document.getElementById('timeCurrent').textContent = hasDuration ? fmt(s.secs)   : '—';
  document.getElementById('timeTotal').textContent   = hasDuration ? fmt(s.totlen) : '—';
  const pct = hasDuration ? (s.secs / s.totlen) * 100 : 0;
  document.getElementById('progressFill').style.width = `${pct}%`;
  if (!isSeeking) seekSlider.value = pct;

  // Hide seek slider for stream sources (spec: streamUrl presence means seek not applicable)
  seekSlider.style.display = s.streamUrl && !s.totlen ? 'none' : '';

  // Play button
  const btnPlay   = document.getElementById('btnPlay');
  const iconPlay  = document.getElementById('iconPlay');
  const iconPause = document.getElementById('iconPause');
  const iconStop  = document.getElementById('iconStop');

  iconPlay.style.display  = 'none';
  iconPause.style.display = 'none';
  iconStop.style.display  = 'none';
  btnPlay.classList.remove('playing');

  if (s.playerState === 'play' || s.playerState === 'stream') {
    iconPause.style.display = '';
    btnPlay.classList.add('playing');
  } else if (s.playerState === 'pause') {
    iconPlay.style.display = '';
  } else {
    iconStop.style.display = '';
  }

  // Volume — don't override while user is dragging
  if (!volumeDragging) {
    volumeSlider.value = s.volume;
    volumeValue.textContent = s.volume;
  }

  // Mute
  document.getElementById('iconVolume').style.display = s.mute ? 'none' : '';
  document.getElementById('iconMuted').style.display  = s.mute ? '' : 'none';
  document.getElementById('btnMute').classList.toggle('active', !!s.mute);

  // Shuffle — hide when streaming (spec: shuffle not relevant when streamUrl present)
  const btnShuffle = document.getElementById('btnShuffle');
  btnShuffle.classList.toggle('active', !!s.shuffle);
  btnShuffle.style.opacity = s.streamUrl ? '0.3' : '';

  // Repeat — spec: 0=repeat queue, 1=repeat track, 2=off
  const btnRepeat   = document.getElementById('btnRepeat');
  const repeatBadge = document.getElementById('repeatBadge');
  const isRepeatOn  = s.repeat === 0 || s.repeat === 1;
  btnRepeat.classList.toggle('active', isRepeatOn);
  repeatBadge.textContent = s.repeat === 1 ? '1' : '';  // "1" badge = repeat track
  btnRepeat.style.opacity = s.streamUrl ? '0.3' : '';

  // Presets active state
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', s.prid > 0 && parseInt(btn.dataset.presetId) === s.prid);
  });
}

// ── Load presets ──────────────────────────────────────────────────────────────

fetch('/ui/presets')
  .then(r => r.json())
  .then(presets => {
    const container = document.getElementById('presets');
    container.innerHTML = presets.map(p => {
      const thumb = p.image
        ? `<img class="preset-thumb" src="${p.image}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="" /><div class="preset-thumb-placeholder" style="display:none">${p.id}</div>`
        : `<div class="preset-thumb-placeholder">${p.id}</div>`;
      return `
        <button class="preset-btn" data-preset-id="${p.id}" onclick="playPreset(${p.id})">
          ${thumb}
          <div class="preset-info">
            <div class="preset-name">${escHtml(p.name)}</div>
            <div class="preset-id">Preset ${p.id}</div>
          </div>
        </button>`;
    }).join('');
  })
  .catch(console.error);
