#!/usr/bin/env python3
"""
Test script for Mock BluOS Server
Tests all major endpoints
"""

import requests
import sys
import time
import json

BASE_URL = "http://localhost:11000"


def test_health():
    print("Testing /health...")
    r = requests.get(f"{BASE_URL}/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    data = r.json()
    assert data["status"] == "healthy"
    print(f"  ✓ Server healthy, {data['players']} players configured")


def test_get_devices():
    print("\nTesting /api/devices...")
    r = requests.get(f"{BASE_URL}/api/devices")
    assert r.status_code == 200
    data = r.json()
    assert "devices" in data
    print(f"  ✓ Found {len(data['devices'])} devices:")
    for d in data["devices"]:
        print(f"    - {d['name']} ({d['type']}) at {d['ip']}")


def test_get_status():
    print("\nTesting /Living Room/Status...")
    r = requests.get(f"{BASE_URL}/Living Room/Status")
    assert r.status_code == 200
    data = r.json()
    print(f"  ✓ State: {data['state']}, Volume: {data['volume']}")
    print(f"  ✓ Now playing: {data['artist']} - {data['title']}")


def test_playback_control():
    player = "Living Room"
    
    print(f"\nTesting playback control for {player}...")
    
    r = requests.post(f"{BASE_URL}/{player}/Player_Control?action=Play")
    assert r.status_code == 200
    print(f"  ✓ Play: {r.json()['state']}")
    
    r = requests.get(f"{BASE_URL}/{player}/Status")
    assert r.json()['state'] == 'playing'
    
    r = requests.post(f"{BASE_URL}/{player}/Player_Control?action=Pause")
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/{player}/Status")
    assert r.json()['state'] == 'paused'
    print(f"  ✓ Pause works")
    
    r = requests.post(f"{BASE_URL}/{player}/Player_Control?action=Stop")
    r = requests.get(f"{BASE_URL}/{player}/Status")
    assert r.json()['state'] == 'stopped'
    print(f"  ✓ Stop works")


def test_volume():
    player = "Kitchen"
    
    print(f"\nTesting volume control for {player}...")
    
    r = requests.get(f"{BASE_URL}/{player}/Volume")
    assert r.status_code == 200
    data = r.json()
    original_volume = data['volume']
    print(f"  ✓ Original volume: {original_volume}")
    
    r = requests.post(f"{BASE_URL}/{player}/Volume?action=set&volume=50")
    assert r.status_code == 200
    data = r.json()
    assert data['volume'] == 50
    print(f"  ✓ Set volume to 50")
    
    r = requests.post(f"{BASE_URL}/{player}/Volume?action=increase")
    r = requests.get(f"{BASE_URL}/{player}/Volume")
    print(f"  ✓ Volume after increase: {r.json()['volume']}")
    
    r = requests.post(f"{BASE_URL}/{player}/Volume?action=decrease")
    r = requests.get(f"{BASE_URL}/{player}/Volume")
    print(f"  ✓ Volume after decrease: {r.json()['volume']}")


def test_presets():
    player = "Bedroom"
    
    print(f"\nTesting presets for {player}...")
    
    r = requests.get(f"{BASE_URL}/{player}/Presets")
    assert r.status_code == 200
    data = r.json()
    print(f"  ✓ Found {len(data['presets'])} presets")
    
    r = requests.post(f"{BASE_URL}/{player}/Preset?id=1")
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/{player}/Status")
    assert r.json()['state'] == 'playing'
    print(f"  ✓ Preset playback started")


def test_sync_status():
    player = "Office"
    
    print(f"\nTesting SyncStatus for {player}...")
    
    r = requests.get(f"{BASE_URL}/{player}/SyncStatus")
    assert r.status_code == 200
    data = r.json()
    print(f"  ✓ {data['name']} - {data['model']}")
    print(f"    Firmware: {data['firmwareVersion']}")


def test_sources():
    player = "Bathroom"
    
    print(f"\nTesting sources for {player}...")
    
    r = requests.get(f"{BASE_URL}/{player}/Sources")
    assert r.status_code == 200
    data = r.json()
    print(f"  ✓ Available sources: {[s['name'] for s in data['sources']]}")


def test_play_url():
    player = "Patio"
    
    print(f"\nTesting PlayUrl for {player}...")
    
    r = requests.post(
        f"{BASE_URL}/{player}/PlayUrl",
        json={"url": "http://stream.example.com/test.mp3"}
    )
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/{player}/Status")
    print(f"  ✓ Stream URL: {r.json()['streamUrl']}")


def test_all_players():
    print("\nTesting all players...")
    
    r = requests.get(f"{BASE_URL}/api/players")
    data = r.json()
    
    for player in data['players']:
        name = player['name']
        r = requests.get(f"{BASE_URL}/{name}/Status")
        status = r.json()
        print(f"  ✓ {name}: {status['state']} (vol: {status['volume']})")


def main():
    print("=" * 50)
    print("Mock BluOS Server Test Suite")
    print("=" * 50)
    
    try:
        test_health()
        test_get_devices()
        test_get_status()
        test_playback_control()
        test_volume()
        test_presets()
        test_sync_status()
        test_sources()
        test_play_url()
        test_all_players()
        
        print("\n" + "=" * 50)
        print("ALL TESTS PASSED!")
        print("=" * 50)
        
    except requests.exceptions.ConnectionError:
        print("\n✗ ERROR: Could not connect to server.")
        print("  Make sure the server is running:")
        print("    python server.py")
        sys.exit(1)
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
