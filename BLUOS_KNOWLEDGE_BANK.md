# BluOS API Knowledge Bank

> Document based on real device testing (192.168.1.205 - Kjøkken, PowerNode 2)
> Firmware: BluOS 4.14.12, Model: N180

---

## 1. Base URL Format

**Real BluOS devices:**
```
http://<player-ip>:11000/<endpoint>
```

**Key insight:** Each player has its own IP and port 11000. The player is determined by which IP you call, NOT by a path parameter.

---

## 2. Working Endpoints

### Playback Control

| Endpoint | Method | Parameters | Response | Example |
|----------|--------|------------|----------|---------|
| `/Play` | GET | `?url=<stream-url>` or `?id=<preset-id>` | `<state>play\|stream\|pause</state>` | `/Play?url=https://lyd.nrk.no/...` |
| `/Pause` | GET | - | `<state>pause</state>` | `/Pause` |
| `/Stop` | GET | - | `<state>stop</state>` | `/Stop` |
| `/Skip` | GET | - | `<state>stream</state>` | `/Skip` |
| `/Back` | GET | - | `<state>stream</state>` | `/Back` |

### Volume Control

| Endpoint | Method | Parameters | Response |
|----------|--------|------------|----------|
| `/Volume` | GET | - | XML with volume value |
| `/Volume` | POST | `?level=<0-100>` | XML with new level |
| `/Volume` | POST | `?mute=0` or `?mute=1` | XML with mute status |

**Volume Response Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<volume db="-45" offsetDb="0" mute="0" etag="xxx" source="">10</volume>
```

**Note:** Mute is controlled via `/Volume?mute=1`, NOT via a separate `/Mute` endpoint.

### Shuffle & Repeat

| Endpoint | Parameters | Response |
|----------|------------|----------|
| `/Shuffle` | `?state=0` or `?state=1` | `<playlist length="30" id="10236" shuffle="1" repeat="0">` |
| `/Repeat` | `?state=0` (none), `?state=1` (all), `?state=2` (one) | `0`, `1`, or `2` |

### Player Info

| Endpoint | Response |
|----------|----------|
| `/SyncStatus` | XML with player details (firmware, model, name, MAC) |
| `/Status` | Full playback state (current track, service, position, etc.) |

**SyncStatus Response:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<SyncStatus etag="4" syncStat="4" version="4.14.12" id="192.168.1.205:11000" 
  db="-47.1" volume="9" name="Kjøkken" model="N180" modelName="POWERNODE 2" 
  class="streamer-amplifier" icon="/images/players/N180_nt.png" brand="Bluesound" 
  schemaVersion="34" initialized="true" mac="90:56:82:7F:43:39">
  <zoneOptions><option>side</option></zoneOptions>
  <pairWithSub></pairWithSub>
</SyncStatus>
```

**Status Response (key fields):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<status etag="xxx">
  <state>play|pause|stop|stream</state>
  <volume>10</volume>
  <mute>0</mute>
  <shuffle>0</shuffle>
  <repeat>0</repeat>
  <service>Qobuz|TuneIn|Tidal|Raat|https</service>
  <artist>Artist Name</artist>
  <album>Album Name</album>
  <title1>Track Title</title1>
  <secs>42</secs>
  <totlen>149</totlen>
  <streamUrl>actual-stream-url</streamUrl>
  <streamFormat>FLAC 24/44.1|MP3 192 kb/s</streamFormat>
  <pid>10236</pid>  <!-- Playlist/queue ID -->
  <song>0</song>    <!-- Current track index -->
</status>
```

### Other Endpoints

| Endpoint | Description |
|----------|-------------|
| `/Presets` | List saved presets |
| `/Preset?id=1` | Play preset by ID |
| `/Browse` | Browse services (Tidal, Qobuz, TuneIn, etc.) |
| `/Sleep` | Get sleep timer |
| `/Shuffle` | Get current shuffle state |

### Endpoints That DON'T Exist (404)

- `/Mute` - use `/Volume?mute=1` instead
- `/ZoneStatus`
- `/Players` 
- `/Sources`
- `/GroupStatus`
- `/PlayQueue`
- `/CoverArt`

---

## 3. Playing Streams

### Direct HTTP Streams (NRK example)

```
/Play?url=https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p3
```

**NRK Stream URLs (all tested and working):**
| Station | URL |
|---------|-----|
| NRK P1 | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p1` |
| NRK P1+ | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p1pluss` |
| NRK P2 | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p2` |
| NRK P3 | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p3` |
| NRK mP3 | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/mp3` |
| NRK Nyheter | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/nyheter` |
| NRK Klassisk | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/klassisk` |
| NRK Jazz | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/jazz` |
| NRK Folkemusikk | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/folkemusikk` |
| NRK Sport | `https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/sport` |

### TuneIn Radio

```
/Play?url=TuneIn:s25534
```

### Radio Paradise

```
/Play?url=RadioParadise:/0:20
```

---

## 4. Player Discovery

### Methods Tested

1. **Port scan on port 11000** - Most reliable
   ```bash
   for ip in 192.168.1.{1..254}; do
     timeout 0.5 nc -z $ip 11000 && echo "Found: $ip"
   done
   ```

2. **mDNS/Bonjour** - Should work but not tested thoroughly
   ```
   dns-sd -B _bluos._tcp local.
   ```

3. **Direct query** - Just try SyncStatus
   ```
   curl http://<ip>:11000/SyncStatus
   ```

---

## 5. Mock Server Implementation Notes

### Key Differences from Initial Assumptions

1. **No `/<player>/` prefix** - Player is determined by IP, not URL path
2. **XML responses** - Not JSON
3. **Volume response** - Just a number, or XML with attributes
4. **Mute** - Use `/Volume?mute=1`, not `/Mute`
5. **Simple commands** - Return `<state>play</state>`, not "OK"

### Mock Server Structure

The mock server should run multiple instances on sequential ports:
- Port 11000 = Player 1 (Living Room)
- Port 11001 = Player 2 (Kitchen)
- etc.

Each instance responds to the same endpoints but tracks different player state.

### Recommended Response Formats

**Volume:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<volume db="-45" offsetDb="0" mute="0" etag="xxx" source="">50</volume>
```

**Status:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<status etag="xxx">
  <state>play</state>
  <volume>50</volume>
  <mute>0</mute>
  <shuffle>0</shuffle>
  <repeat>0</repeat>
  <service>Tidal</service>
  <artist>Test Artist</artist>
  <album>Test Album</album>
  <title1>Test Track</title1>
  <secs>0</secs>
  <totlen>180</totlen>
  <streamUrl></streamUrl>
</status>
```

**SyncStatus:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<SyncStatus etag="4" syncStat="4" version="4.14.12" 
  id="192.168.1.100:11000" volume="20" name="Living Room" 
  model="N180" modelName="POWERNODE 2" class="streamer-amplifier" 
  brand="Bluesound" mac="xx:xx:xx:xx:xx:xx">
</SyncStatus>
```

---

## 6. Tested Devices

| Name | IP | Model | MAC |
|------|-----|-------|-----|
| Kjøkken | 192.168.1.205 | PowerNode 2 (N180) | 90:56:82:7F:43:39 |

---

## 7. Useful Commands Reference

```bash
# Get player status
curl http://192.168.1.205:11000/Status

# Get volume
curl http://192.168.1.205:11000/Volume

# Set volume to 50
curl http://192.168.1.205:11000/Volume?level=50

# Mute
curl http://192.168.1.205:11000/Volume?mute=1

# Unmute
curl http://192.168.1.205:11000/Volume?mute=0

# Play NRK P3
curl http://192.168.1.205:11000/Play?url=https://lyd.nrk.no/icecast/mp3/high/s0w7hwn47m/p3

# Play/Pause/Stop
curl http://192.168.1.205:11000/Play
curl http://192.168.1.205:11000/Pause
curl http://192.168.1.205:11000/Stop

# Toggle shuffle
curl http://192.168.1.205:11000/Shuffle?state=1

# Get presets
curl http://192.168.1.205:11000/Presets

# Play preset
curl -X POST http://192.168.1.205:11000/Preset?id=1
```

---

## 8. Open Questions / To Explore

- [ ] How to get actual playlist/queue contents
- [ ] How to add/remove tracks from queue
- [ ] How browsing services works in detail
- [ ] How multi-room sync works
- [ ] Authentication if required
