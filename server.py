#!/usr/bin/env python3
"""
Mock BluOS Server for testing hardware controllers.
Simulates multiple BluOS players (PowerNodes, Flex, etc.)
Based on official BluOS Custom Integration API v1.7

Each player runs on its own port - just like real BluOS devices.
"""

from flask import Flask, Response, request
import uuid
from dataclasses import dataclass, field
from typing import Optional

app = Flask(__name__)


def make_response(content: str, status: int = 200) -> Response:
    return Response(content, status=status)


def xml_response(content: str, status: int = 200) -> Response:
    response = Response(content, status=status)
    response.headers['Content-Type'] = 'text/xml; charset=utf-8'
    return response


def ok_response() -> Response:
    return make_response("OK")


def error_response(message: str) -> Response:
    return make_response(f"ERROR: {message}")


def status_to_xml(p) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<Status>
<state>{p.state}</state>
<mode>normal</mode>
<volume>{p.volume}</volume>
<mute>{"1" if p.mute else "0"}</mute>
<shuffle>{"1" if p.shuffle else "0"}</shuffle>
<repeat>{p.repeat}</repeat>
<repeatOne>{"1" if p.repeatOne else "0"}</repeatOne>
<artist>{p.track.artist}</artist>
<album>{p.track.album}</album>
<title>{p.track.title}</title>
<genre>{p.track.genre}</genre>
<trackNo>1</trackNo>
<duration>{p.track.duration}</duration>
<remaining>{p.track.duration - p.track.currentPosition}</remaining>
<seek>{p.track.currentPosition}</seek>
<service>{p.service}</service>
<uri></uri>
<url>{p.streamUrl}</url>
<image>{p.track.image}</image>
</Status>"""


def sync_status_to_xml(p) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<SyncStatus>
<host>{p.host}</host>
<port>{p.port}</port>
<name>{p.name}</name>
<type>{p.model}</type>
<brand>{p.brand}</brand>
<mac>{p.mac}</mac>
<ip>{p.ip}</ip>
<firmwareVersion>{p.firmwareVersion}</firmwareVersion>
<version>{p.version}</version>
</SyncStatus>"""


def zone_status_to_xml(p) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<ZoneStatus>
<host>{p.host}</host>
<port>{p.port}</port>
<name>{p.name}</name>
<type>{p.model}</type>
<brand>{p.brand}</brand>
<zone>Main</zone>
</ZoneStatus>"""


def volume_to_xml(p) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<Volume>
<val>{p.volume}</val>
<mute>{"1" if p.mute else "0"}</mute>
</Volume>"""


def presets_to_xml() -> str:
    return """<?xml version="1.0" encoding="utf-8"?>
<Presets>
<Preset>
<id>1</id>
<text>Preset 1</text>
<type>0</type>
<genre></genre>
<album></album>
<artist></artist>
<duration>0</duration>
<service>Tidal</service>
</Preset>
<Preset>
<id>2</id>
<text>Preset 2</text>
<type>0</type>
<genre></genre>
<album></album>
<artist></artist>
<duration>0</duration>
<service>Tidal</service>
</Preset>
<Preset>
<id>3</id>
<text>Preset 3</text>
<type>0</type>
<genre></genre>
<album></album>
<artist></artist>
<duration>0</duration>
<service>Radio</service>
</Preset>
</Presets>"""


def sources_to_xml() -> str:
    return """<?xml version="1.0" encoding="utf-8"?>
<Sources>
<Source>
<name>Tidal</name>
<icon>tidal</icon>
<type>service</type>
</Source>
<Source>
<name>Qobuz</name>
<icon>qobuz</icon>
<type>service</type>
</Source>
<Source>
<name>Radio</name>
<icon>radio</icon>
<type>service</type>
</Source>
<Source>
<name>Bluetooth</name>
<icon>bluetooth</icon>
<type>service</type>
</Source>
<Source>
<name>USB</name>
<icon>usb</icon>
<type>local</type>
</Source>
</Sources>"""


def players_to_xml(player_list: list) -> str:
    players_xml = ""
    for p in player_list:
        players_xml += f"""<Player>
<host>{p.host}</host>
<port>{p.port}</port>
<name>{p.name}</name>
<type>{p.model}</type>
<brand>{p.brand}</brand>
<mac>{p.mac}</mac>
<ip>{p.ip}</ip>
</Player>
"""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<players>
{players_xml}
</players>"""


@dataclass
class Track:
    artist: str = "Test Artist"
    album: str = "Test Album"
    title: str = "Test Track"
    genre: str = "Rock"
    duration: int = 180
    currentPosition: int = 0
    path: str = "test/track.mp3"
    image: str = "/images/test.jpg"


@dataclass
class Player:
    host: str
    port: int
    name: str
    model: str
    brand: str = "Bluesound"
    mac: str = ""
    ip: str = ""
    firmwareVersion: str = "3.20.0"
    version: str = "BluOS 3.20.0"
    
    state: str = "stopped"
    volume: int = 20
    mute: bool = False
    shuffle: bool = False
    repeat: str = "0"
    repeatOne: bool = False
    
    service: str = "TestService"
    streamUrl: str = ""
    
    track: Track = field(default_factory=Track)
    
    def __post_init__(self):
        if not self.mac:
            self.mac = ':'.join(['{:02x}'.format((uuid.getnode() >> i) & 0xff) for i in range(0, 48, 8)][:6])
        if not self.ip:
            self.ip = self.host


PLAYERS = [
    Player(host="192.168.1.100", port=11000, name="Living Room", model="PowerNode 2i"),
    Player(host="192.168.1.101", port=11000, name="Kitchen", model="PowerNode 2i"),
    Player(host="192.168.1.102", port=11000, name="Office", model="PowerNode 2i"),
    Player(host="192.168.1.103", port=11000, name="Bedroom", model="PowerNode 2i"),
    Player(host="192.168.1.104", port=11000, name="Bathroom", model="Flex Mini"),
    Player(host="192.168.1.105", port=11000, name="Patio", model="Flex Mini"),
]


class PlayerRegistry:
    """Registry that maps ports to players for multi-port mock server"""
    
    def __init__(self, players: list[Player], base_port: int = 11000):
        self.players = {p.port + i: p for i, p in enumerate(players)}
        self.base_port = base_port
        self.port_offset = 0
    
    def set_port_offset(self, offset: int):
        """Set which player this server instance represents"""
        self.port_offset = offset
    
    @property
    def player(self) -> Player:
        return self.players.get(self.base_port + self.port_offset)


registry = PlayerRegistry(PLAYERS)


@app.route("/Status", methods=["GET"])
def get_status():
    """Get player status - returns current track, volume, state, etc."""
    return xml_response(status_to_xml(registry.player))


@app.route("/Volume", methods=["GET", "POST"])
def volume():
    """Get or set volume. Use ?level=X to set (0-100)"""
    player = registry.player
    
    if request.method == "POST" or request.args.get("level"):
        level = request.args.get("level")
        if level is not None:
            player.volume = max(0, min(100, int(level)))
    
    return xml_response(volume_to_xml(player))


@app.route("/Mute", methods=["GET", "POST"])
def mute():
    """Get or set mute. Use ?mute=0 or ?mute=1"""
    player = registry.player
    
    mute_val = request.args.get("mute")
    if mute_val is not None:
        player.mute = (mute_val == "1")
    
    return xml_response(volume_to_xml(player))


@app.route("/Play", methods=["GET", "POST"])
def play():
    """Start playback"""
    registry.player.state = "playing"
    return ok_response()


@app.route("/Pause", methods=["GET", "POST"])
def pause():
    """Pause playback"""
    registry.player.state = "paused"
    return ok_response()


@app.route("/Stop", methods=["GET", "POST"])
def stop():
    """Stop playback"""
    player = registry.player
    player.state = "stopped"
    player.track.currentPosition = 0
    return ok_response()


@app.route("/Skip", methods=["GET", "POST"])
def skip():
    """Skip to next track"""
    player = registry.player
    player.track.title = f"Test Track {uuid.uuid4().hex[:4]}"
    player.track.currentPosition = 0
    return ok_response()


@app.route("/Back", methods=["GET", "POST"])
def back():
    """Go to previous track"""
    registry.player.track.currentPosition = 0
    return ok_response()


@app.route("/Shuffle", methods=["GET", "POST"])
def shuffle():
    """Get or set shuffle. Use ?state=0 or ?state=1"""
    player = registry.player
    
    state = request.args.get("state")
    if state is not None:
        player.shuffle = (state == "1")
    
    return make_response("1" if player.shuffle else "0")


@app.route("/Repeat", methods=["GET", "POST"])
def repeat():
    """Get or set repeat. Use ?state=0 (none), 1 (all), or 2 (one)"""
    player = registry.player
    
    state = request.args.get("state")
    if state is not None:
        state_map = {"0": "0", "1": "1", "2": "2"}
        player.repeat = state_map.get(state, "0")
    
    return make_response(player.repeat)


@app.route("/SyncStatus", methods=["GET"])
def sync_status():
    """Get player sync status - firmware, model, etc."""
    return xml_response(sync_status_to_xml(registry.player))


@app.route("/ZoneStatus", methods=["GET"])
def zone_status():
    """Get zone status"""
    return xml_response(zone_status_to_xml(registry.player))


@app.route("/Presets", methods=["GET"])
def presets():
    """Get presets"""
    return xml_response(presets_to_xml())


@app.route("/Preset", methods=["POST"])
def preset_play():
    """Play a preset"""
    player = registry.player
    
    preset_id = request.args.get("id")
    player.state = "playing"
    player.track = Track(
        artist="Preset Artist",
        album="Preset Album",
        title=f"Preset {preset_id}"
    )
    return ok_response()


@app.route("/Sources", methods=["GET"])
def sources():
    """Get available sources"""
    return xml_response(sources_to_xml())


@app.route("/PlayUrl", methods=["POST"])
def play_url():
    """Play a URL"""
    player = registry.player
    
    url = request.form.get("url", "")
    player.state = "playing"
    player.streamUrl = url
    return ok_response()


@app.route("/CoverArt", methods=["GET"])
def cover_art():
    """Get cover art URL"""
    return make_response(registry.player.track.image)


@app.route("/GroupStatus", methods=["GET"])
def group_status():
    """Get group status"""
    player = registry.player
    return xml_response(f"""<?xml version="1.0" encoding="utf-8"?>
<GroupStatus>
<host>{player.name}</host>
<name>{player.name}</name>
</GroupStatus>""")


@app.route("/", methods=["GET"])
def player_info():
    """Get basic player info"""
    return xml_response(sync_status_to_xml(registry.player))


@app.route("/health", methods=["GET"])
def health():
    """Health check"""
    p = registry.player
    return make_response(f"OK {p.name} ({p.model})")


@app.route("/PlayQueue", methods=["GET"])
def play_queue():
    """Get play queue"""
    return xml_response("""<?xml version="1.0" encoding="utf-8"?>
<PlayQueue>
<count>0</count>
</PlayQueue>""")


@app.route("/PlayQueue", methods=["DELETE"])
def clear_queue():
    """Clear play queue"""
    return ok_response()


def create_app(port_offset: int = 0) -> Flask:
    """Create Flask app with specific player"""
    registry.set_port_offset(port_offset)
    return app


if __name__ == "__main__":
    import sys
    
    port_offset = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    registry.set_port_offset(port_offset)
    player = registry.player
    
    print("=" * 60)
    print(f"Mock BluOS Server - {player.name} ({player.model})")
    print("=" * 60)
    print(f"  IP: {player.ip}:{player.port}")
    print(f"  URL: http://localhost:{11000 + port_offset}")
    print("\nEndpoints:")
    print("  GET  /Status       - Get player status (XML)")
    print("  GET  /Volume      - Get volume (XML)")
    print("  POST /Volume?level=50 - Set volume (0-100)")
    print("  POST /Mute?mute=0  - Set mute (0 or 1)")
    print("  GET  /Play       - Play (returns OK)")
    print("  GET  /Pause      - Pause (returns OK)")
    print("  GET  /Stop       - Stop (returns OK)")
    print("  GET  /Skip       - Skip (returns OK)")
    print("  GET  /Back       - Previous (returns OK)")
    print("  GET  /Shuffle?state=0 - Set shuffle")
    print("  GET  /Repeat?state=0  - Set repeat (0/1/2)")
    print("  GET  /SyncStatus - Player info (XML)")
    print("  GET  /ZoneStatus - Zone info (XML)")
    print("  GET  /Presets    - List presets (XML)")
    print("=" * 60)
    
    app.run(host="0.0.0.0", port=11000 + port_offset, debug=False)
