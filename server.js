const express = require('express');
const { EventEmitter } = require('events');
const path = require('path');
const http = require('http');
const https = require('https');
const { Bonjour } = require('bonjour-service');

const app = express();
const PORT = 11000;

// ── State ─────────────────────────────────────────────────────────────────────

const stateChanged = new EventEmitter();

let state = {
  volume: 30,
  mute: 0,
  playerState: 'stop', // play | pause | stop | stream | connecting
  shuffle: 0,
  repeat: 2,           // 0=repeat queue, 1=repeat track, 2=off (per spec)
  artist: '',
  album: '',
  title1: '',
  title2: '',
  title3: '',
  twoline_title1: '',
  twoline_title2: '',
  service: '',
  serviceIcon: '',
  streamUrl: '',       // present when audio is NOT from the play queue
  secs: 0,
  totlen: 0,
  image: '',
  streamFormat: '',
  pid: 0,
  prid: 0,
  song: 0,
  etag: newEtag(),
  syncStat: newEtag(),
};

const presets = [
  { id: 1, name: 'NRK P3',             url: 'https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p3',        image: '' },
  { id: 2, name: 'NRK P1',             url: 'https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p1',        image: '' },
  { id: 3, name: 'NRK P2',             url: 'https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p2',        image: '' },
  { id: 4, name: 'NRK Jazz',           url: 'https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/jazz',      image: '' },
  { id: 5, name: 'NRK Super',           url: 'https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/super',     image: '' },
  { id: 6, name: 'NRK Alltid Nyheter', url: 'https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/nyheter',   image: '' },
  { id: 7, name: 'Radio Paradise',     url: 'https://stream.radioparadise.com/mp3-192',                  image: 'https://img.radioparadise.com/source/27/channel_logo/chan_0.png' },
];

// Simulated queue (empty by default)
let queue = { id: 0, name: '', length: 0, modified: 0, tracks: [] };

// ── Helpers ───────────────────────────────────────────────────────────────────

function newEtag() {
  return Math.random().toString(36).substring(2, 10);
}

// Per spec: dB range typically -80..0dB over 0..100 volume
function volumeToDb(vol) {
  if (vol === 0) return -80;
  return Math.round((vol / 100) * 80 - 80);
}

function logEndpoint(path, params) {
  const p = Object.keys(params).length ? JSON.stringify(params) : '';
  console.log(`[API] ${path}${p ? ' ' + p : ''}`);
}

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xml(content) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${content}`;
}

function guessService(url) {
  if (!url) return '';
  if (url.startsWith('TuneIn:')) return 'TuneIn';
  if (url.startsWith('RadioParadise:')) return 'RadioParadise';
  if (url.includes('tidal')) return 'Tidal';
  if (url.includes('qobuz')) return 'Qobuz';
  if (url.includes('nrk.no')) return 'NRK';
  if (url.startsWith('http')) return 'Stream';
  return 'Stream';
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcast() {
  const data = JSON.stringify(state);
  for (const res of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
  stateChanged.emit('change');
}

function setState(updates) {
  Object.assign(state, updates, { etag: newEtag() });
  broadcast();
}

// ── Long-polling helper ───────────────────────────────────────────────────────
// Holds the response until state changes (etag mismatch) or timeout elapses.
// Per spec: timeout is in seconds, recommended 100s for /Status, 180s for /SyncStatus.

function longPoll(req, res, buildResponse, currentEtag) {
  const clientEtag = req.query.etag;
  const timeoutSecs = parseInt(req.query.timeout) || 0;

  // No long-poll requested, or etag already differs — respond immediately
  if (!timeoutSecs || !clientEtag || clientEtag !== currentEtag) {
    return res.type('xml').send(buildResponse());
  }

  // Hold until state changes or timeout
  const timer = setTimeout(() => {
    stateChanged.off('change', onChange);
    res.type('xml').send(buildResponse());
  }, timeoutSecs * 1000);

  function onChange() {
    clearTimeout(timer);
    stateChanged.off('change', onChange);
    res.type('xml').send(buildResponse());
  }

  stateChanged.on('change', onChange);
  req.on('close', () => {
    clearTimeout(timer);
    stateChanged.off('change', onChange);
  });
}

// ── Progress ticker ───────────────────────────────────────────────────────────
// Per spec: clients increment secs themselves, but we do it here for the mock.

setInterval(() => {
  if (state.playerState === 'play' && state.totlen > 0) {
    const next = state.secs + 1;
    setState(next >= state.totlen ? { secs: 0, playerState: 'stop' } : { secs: next });
  }
}, 1000);

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// Simulated network delay on BluOS API endpoints.
// Skips /ui/* (SSE + presets for the web GUI) and /proxy (audio stream)
// so the web UI itself stays responsive.
// Set API_DELAY_MS=0 to disable, or any value to override the default.
const API_DELAY_MS = process.env.API_DELAY_MS !== undefined ? parseInt(process.env.API_DELAY_MS) : 1000;

app.use((req, _res, next) => {
  const skip = req.path.startsWith('/ui/') || req.path.startsWith('/proxy');
  return skip ? next() : setTimeout(next, API_DELAY_MS);
});

// Make POST query params available the same way as GET (BluOS uses GET everywhere,
// but some integrations send POST with query string)
app.use((req, _res, next) => {
  if (req.method === 'POST') {
    const qs = req.url.split('?')[1];
    if (qs) new URLSearchParams(qs).forEach((v, k) => { req.query[k] = v; });
  }
  next();
});

// ── SSE endpoint (web UI) ─────────────────────────────────────────────────────

app.get('/ui/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(state)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Presets as JSON for the UI (avoids XML parsing on the frontend)
app.get('/ui/presets', (_req, res) => res.json(presets));

// ── 2.1  /Status ──────────────────────────────────────────────────────────────

app.get('/Status', (req, res) => {
  logEndpoint('/Status', req.query);
  longPoll(req, res, buildStatusXml, state.etag);
});

function buildStatusXml() {
  const s = state;
  const parts = [
    `<status etag="${s.etag}">`,
    `<state>${s.playerState}</state>`,
    `<volume>${s.volume}</volume>`,
    `<db>${volumeToDb(s.volume)}</db>`,
    `<mute>${s.mute}</mute>`,
    s.mute ? `<muteVolume>${s.volume}</muteVolume>` : '',
    s.mute ? `<muteDb>${volumeToDb(s.volume)}</muteDb>` : '',
    `<shuffle>${s.shuffle}</shuffle>`,
    `<repeat>${s.repeat}</repeat>`,
    `<service>${escXml(s.service)}</service>`,
    s.serviceIcon ? `<serviceIcon>${escXml(s.serviceIcon)}</serviceIcon>` : '',
    `<artist>${escXml(s.artist)}</artist>`,
    `<album>${escXml(s.album)}</album>`,
    `<name>${escXml(s.title1)}</name>`,
    `<title1>${escXml(s.title1)}</title1>`,
    `<title2>${escXml(s.title2)}</title2>`,
    `<title3>${escXml(s.title3)}</title3>`,
    s.twoline_title1 ? `<twoline_title1>${escXml(s.twoline_title1)}</twoline_title1>` : '',
    s.twoline_title2 ? `<twoline_title2>${escXml(s.twoline_title2)}</twoline_title2>` : '',
    `<image>${escXml(s.image)}</image>`,
    `<secs>${s.secs}</secs>`,
    `<totlen>${s.totlen}</totlen>`,
    `<streamFormat>${escXml(s.streamFormat)}</streamFormat>`,
    // streamUrl presence is a flag: audio is NOT from the play queue
    s.streamUrl ? `<streamUrl>${escXml(s.streamUrl)}</streamUrl>` : '',
    `<fn>${escXml(s.streamUrl)}</fn>`,
    `<pid>${s.pid}</pid>`,
    `<prid>${s.prid}</prid>`,
    `<song>${s.song}</song>`,
    `<indexing>0</indexing>`,
    `<canSeek>${s.totlen > 0 ? 1 : 0}</canSeek>`,
    `<canMovePlayback>true</canMovePlayback>`,
    `<syncStat>${s.syncStat}</syncStat>`,
    `</status>`,
  ];
  return xml(parts.filter(Boolean).join(''));
}

// ── 2.2  /SyncStatus ─────────────────────────────────────────────────────────

app.get('/SyncStatus', (req, res) => {
  logEndpoint('/SyncStatus', req.query);
  longPoll(req, res, buildSyncStatusXml, state.syncStat);
});

function buildSyncStatusXml() {
  const s = state;
  return xml(
    `<SyncStatus etag="${s.syncStat}" syncStat="${s.syncStat}" version="4.14.12" ` +
    `id="127.0.0.1:11000" db="${volumeToDb(s.volume)}" volume="${s.volume}" ` +
    `name="BluOS Mock" model="N180" modelName="POWERNODE 2" ` +
    `class="streamer-amplifier" icon="/images/players/N180_nt.png" ` +
    `brand="Bluesound" schemaVersion="34" initialized="true" mac="00:00:00:00:00:00">` +
    `<zoneOptions><option>side</option></zoneOptions><pairWithSub></pairWithSub>` +
    `</SyncStatus>`
  );
}

// ── 3.  Volume ────────────────────────────────────────────────────────────────

app.get('/Volume', handleVolume);
app.post('/Volume', handleVolume);

function handleVolume(req, res) {
  logEndpoint('/Volume', req.query);
  const q = req.query;

  if (q.level !== undefined) {
    const level = Math.max(0, Math.min(100, parseInt(q.level) || 0));
    setState({ volume: level, mute: 0, syncStat: newEtag() });
  }

  // Relative dB change: /Volume?db=2 (up 2dB) or /Volume?db=-2 (down 2dB)
  if (q.db !== undefined) {
    const delta = parseFloat(q.db) || 0;
    const currentDb = volumeToDb(state.volume);
    const newDb = Math.max(-80, Math.min(0, currentDb + delta));
    // Convert dB back to 0-100 scale: level = (db + 80) / 80 * 100
    const newLevel = Math.round(((newDb + 80) / 80) * 100);
    setState({ volume: newLevel, mute: 0, syncStat: newEtag() });
  }

  // Absolute dB: /Volume?abs_db=-20
  if (q.abs_db !== undefined) {
    const db = Math.max(-80, Math.min(0, parseFloat(q.abs_db) || 0));
    const level = Math.round(((db + 80) / 80) * 100);
    setState({ volume: level, mute: 0, syncStat: newEtag() });
  }

  // mute=1 → mute on; mute=0 → mute off (per spec section 3.4/3.5)
  if (q.mute !== undefined) {
    setState({ mute: parseInt(q.mute) === 1 ? 1 : 0, syncStat: newEtag() });
  }

  longPoll(req, res, buildVolumeXml, state.etag);
}

function buildVolumeXml() {
  const s = state;
  const attrs = [
    `db="${s.mute ? -100 : volumeToDb(s.volume)}"`,
    s.mute ? `muteDb="${volumeToDb(s.volume)}"` : '',
    s.mute ? `muteVolume="${s.volume}"` : '',
    `mute="${s.mute}"`,
    `offsetDb="0"`,
    `etag="${s.etag}"`,
    `source=""`,
  ].filter(Boolean).join(' ');
  return xml(`<volume ${attrs}>${s.mute ? 0 : s.volume}</volume>`);
}

// ── 4.1  /Play ────────────────────────────────────────────────────────────────

app.get('/Play', (req, res) => {
  logEndpoint('/Play', req.query);
  const { url, seek } = req.query;

  if (url) {
    // Play a stream URL directly
    setState({
      playerState: 'stream',
      streamUrl: url,
      service: guessService(url),
      title1: url,
      title2: '',
      title3: '',
      twoline_title1: url,
      twoline_title2: '',
      artist: '',
      album: '',
      image: '',
      secs: 0,
      totlen: 0,
    });
  } else if (seek !== undefined) {
    // Seek within current track
    const seconds = Math.max(0, parseInt(seek) || 0);
    setState({ secs: Math.min(seconds, state.totlen), playerState: 'play' });
  } else {
    // Resume playback
    setState({ playerState: 'play' });
  }

  res.type('xml').send(xml(`<state>${state.playerState}</state>`));
});

// ── 4.2  /Pause ───────────────────────────────────────────────────────────────
// Per spec: plain /Pause always pauses; /Pause?toggle=1 toggles.

app.get('/Pause', (req, res) => {
  logEndpoint('/Pause', req.query);
  const toggle = req.query.toggle === '1';
  if (toggle) {
    setState({ playerState: state.playerState === 'pause' ? 'play' : 'pause' });
  } else {
    setState({ playerState: 'pause' });
  }
  res.type('xml').send(xml(`<state>${state.playerState}</state>`));
});

// ── 4.3  /Stop ────────────────────────────────────────────────────────────────

app.get('/Stop', (req, res) => {
  logEndpoint('/Stop', req.query);
  setState({ playerState: 'stop' });
  res.type('xml').send(xml(`<state>stop</state>`));
});

// ── 4.4  /Skip ────────────────────────────────────────────────────────────────
// Per spec: response is <id>N</id> where N is the new track id.

app.get('/Skip', (req, res) => {
  logEndpoint('/Skip', req.query);
  const nextSong = (state.song + 1) % Math.max(1, queue.length);
  setState({ secs: 0, song: nextSong, playerState: 'stream' });
  res.type('xml').send(xml(`<id>${nextSong}</id>`));
});

// ── 4.5  /Back ────────────────────────────────────────────────────────────────
// Per spec: response is <id>N</id> where N is the new track id.

app.get('/Back', (req, res) => {
  logEndpoint('/Back', req.query);
  if (state.secs > 4) {
    setState({ secs: 0 });
  } else {
    const prevSong = Math.max(0, state.song - 1);
    setState({ secs: 0, song: prevSong });
  }
  res.type('xml').send(xml(`<id>${state.song}</id>`));
});

// ── 4.6  /Shuffle ─────────────────────────────────────────────────────────────

app.get('/Shuffle', (req, res) => {
  logEndpoint('/Shuffle', req.query);
  if (req.query.state !== undefined) {
    setState({ shuffle: parseInt(req.query.state) === 1 ? 1 : 0 });
  }
  res.type('xml').send(xml(
    `<playlist name="${escXml(queue.name)}" modified="${queue.modified}" ` +
    `length="${queue.length}" shuffle="${state.shuffle}" id="${queue.id}"/>`
  ));
});

// ── 4.7  /Repeat ──────────────────────────────────────────────────────────────
// Per spec: response is <playlist length="..." id="..." repeat="N"/>

app.get('/Repeat', (req, res) => {
  logEndpoint('/Repeat', req.query);
  if (req.query.state !== undefined) {
    setState({ repeat: Math.min(2, Math.max(0, parseInt(req.query.state) || 0)) });
  }
  res.type('xml').send(xml(
    `<playlist length="${queue.length}" id="${queue.id}" repeat="${state.repeat}"/>`
  ));
});

// ── 5.  Play Queue ────────────────────────────────────────────────────────────

app.get('/Playlist', (req, res) => {
  logEndpoint('/Playlist', req.query);
  res.type('xml').send(xml(
    `<playlist name="${escXml(queue.name)}" modified="${queue.modified}" ` +
    `length="${queue.length}" id="${queue.id}"/>`
  ));
});

app.get('/Clear', (req, res) => {
  logEndpoint('/Clear', req.query);
  queue = { id: queue.id + 1, name: '', length: 0, modified: 0, tracks: [] };
  res.type('xml').send(xml(
    `<playlist modified="0" length="0" id="${queue.id}"/>`
  ));
});

app.get('/Delete', (req, res) => {
  logEndpoint('/Delete', req.query);
  const id = parseInt(req.query.id) || 0;
  res.type('xml').send(xml(`<deleted>${id}</deleted>`));
});

app.get('/Move', (req, res) => {
  logEndpoint('/Move', req.query);
  res.type('xml').send(xml(`<moved>moved</moved>`));
});

app.get('/Save', (req, res) => {
  logEndpoint('/Save', req.query);
  const name = req.query.name || '';
  queue.name = name;
  res.type('xml').send(xml(`<saved><entries>${queue.length}</entries></saved>`));
});

// ── 6.  Presets ───────────────────────────────────────────────────────────────

app.get('/Presets', (req, res) => {
  logEndpoint('/Presets', req.query);
  const inner = presets.map(p =>
    `  <preset id="${p.id}" name="${escXml(p.name)}" url="${escXml(p.url)}" image="${escXml(p.image)}" volume="${state.volume}"/>`
  ).join('\n');
  res.type('xml').send(xml(`<presets prid="${state.prid}">\n${inner}\n</presets>`));
});

app.get('/Preset', handlePreset);
app.post('/Preset', handlePreset);

function handlePreset(req, res) {
  logEndpoint('/Preset', req.query);
  const rawId = req.query.id;

  // +1 / -1 cycle through presets relative to the currently active preset (prid)
  let preset;
  if (rawId === '+1') {
    const cur = presets.findIndex(p => p.id === state.prid);
    preset = presets[(cur + 1) % presets.length];
  } else if (rawId === '-1') {
    const cur = presets.findIndex(p => p.id === state.prid);
    preset = presets[(cur - 1 + presets.length) % presets.length];
  } else {
    const id = parseInt(rawId) || 1;
    preset = presets.find(p => p.id === id);
  }

  if (!preset) {
    return res.status(404).type('xml').send(xml('<error>Preset not found</error>'));
  }

  setState({
    playerState: 'stream',
    streamUrl: preset.url,
    service: guessService(preset.url),
    title1: preset.name,
    title2: '',
    title3: '',
    twoline_title1: preset.name,
    twoline_title2: '',
    artist: '',
    album: '',
    image: preset.image,
    secs: 0,
    totlen: 0,
    prid: preset.id,
  });

  res.type('xml').send(xml(`<state>stream</state>`));
}

// ── 7.  Browse (stub) ─────────────────────────────────────────────────────────

app.get('/Browse', (req, res) => {
  logEndpoint('/Browse', req.query);
  res.type('xml').send(xml(
    `<browse sid="0" type="menu">` +
    `<item text="No services configured" type="link"/>` +
    `</browse>`
  ));
});

// ── Audio proxy ───────────────────────────────────────────────────────────────
// Pipes any HTTP(S) audio stream through localhost so the browser never hits
// CORS restrictions. Handles redirects (NRK uses several hops).

function proxyAudio(req, res, url, hops = 0) {
  if (hops > 6) return res.status(502).send('Too many redirects');
  if (!url.startsWith('http')) return res.status(400).send('Invalid URL');

  const client = url.startsWith('https') ? https : http;
  const proxyReq = client.get(url, { headers: { 'User-Agent': 'BluOS/4.14.12' } }, (proxyRes) => {
    const { statusCode, headers } = proxyRes;

    if (statusCode >= 300 && statusCode < 400 && headers.location) {
      proxyRes.resume();
      return proxyAudio(req, res, headers.location, hops + 1);
    }

    res.setHeader('Content-Type', headers['content-type'] || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');
    proxyRes.pipe(res);

    req.on('close', () => { proxyRes.destroy(); proxyReq.destroy(); });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(502).send('Upstream error');
  });
}

app.get('/proxy', (req, res) => {
  logEndpoint('/proxy', req.query);
  const url = decodeURIComponent(req.query.url || '');
  proxyAudio(req, res, url);
});

// ── Sleep (stub) ──────────────────────────────────────────────────────────────

app.get('/Sleep', (req, res) => {
  logEndpoint('/Sleep', req.query);
  res.type('xml').send(xml(`<sleep></sleep>`));
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Fetch the Bluesound logo on startup so it's available to the UI without
// committing a trademarked asset to the repository.

const LOGO_PATH = path.join(__dirname, 'public', 'bluesound-logo.png');
const LOGO_URL  = 'https://www.bluesound.com/static/version1766433067/frontend/Bluesound/blsTrue/default/images/logo.png';

function fetchLogo() {
  if (require('fs').existsSync(LOGO_PATH)) return; // already on disk
  const dest = require('fs').createWriteStream(LOGO_PATH);
  https.get(LOGO_URL, (res) => {
    if (res.statusCode === 200) {
      res.pipe(dest);
    } else {
      dest.close();
      require('fs').unlink(LOGO_PATH, () => {});
    }
  }).on('error', () => dest.close());
}

app.listen(PORT, () => {
  fetchLogo();
  console.log(`BluOS mock server  →  http://localhost:${PORT}`);
  console.log(`Web UI             →  http://localhost:${PORT}/`);
  console.log(`API base           →  http://localhost:${PORT}/Status`);

  // mDNS/DNS-SD service advertisement (Bonjour)
  // Set MDNS_ENABLED=0 to disable (enabled by default)
  const mdnsEnabled = process.env.MDNS_ENABLED !== '0';

  if (mdnsEnabled) {
    const bonjour = new Bonjour();
    const mdns = bonjour.publish({
      name: 'BluOS Mock',
      type: 'bluos',
      port: PORT,
      txt: {
        model: 'N180',
        modelName: 'POWERNODE 2',
        brand: 'Bluesound',
        mac: '00:00:00:00:00:00',
        version: '4.14.12',
      },
    });

    console.log(`mDNS discovery    →  _bluos._tcp on port ${PORT} (MDNS_ENABLED=0 to disable)`);

    // Clean up on shutdown
    process.on('SIGINT', () => {
      mdns.stop(() => bonjour.destroy());
    });
  }
});
