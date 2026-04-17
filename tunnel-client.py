#!/usr/bin/env python3
"""
Fluso Astrology Tunnel Client
Polls the relay server and forwards HTTP requests to the local Flask backend.

Usage: python3 tunnel-client.py <relay_url> <tunnel_id>
Example: python3 tunnel-client.py https://astrology-relay.onrender.com abc123
"""
import json
import sys
import time
import threading
import urllib.request
import urllib.error

LOCAL_BACKEND = "http://localhost:8001"

def run(relay_base, tunnel_id):
    relay_base = relay_base.rstrip('/')
    print(f"🔮 Astrology Tunnel Client")
    print(f"   Relay: {relay_base}")
    print(f"   Tunnel ID: {tunnel_id}")
    print(f"   Local backend: {LOCAL_BACKEND}")
    print(f"")
    print(f"   Public URL: {relay_base}/t/{tunnel_id}")
    print(f"")
    print(f"Polling for requests...")
    
    while True:
        try:
            url = f"{relay_base}/api/poll/{tunnel_id}"
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=30)
            data = json.loads(resp.read())
            if data and "request_id" in data:
                threading.Thread(target=forward, args=(relay_base, tunnel_id, data), daemon=True).start()
        except urllib.error.HTTPError:
            pass
        except Exception as e:
            print(f"Poll error: {e}")
        time.sleep(0.3)

def forward(relay_base, tunnel_id, req_data):
    rid = req_data["request_id"]
    method = req_data.get("method", "GET")
    path = req_data.get("path", "/")
    body = req_data.get("body", "")
    headers = req_data.get("headers", {})
    
    print(f"  → {method} {path}")
    
    try:
        content_type = headers.get("content-type", "application/json")
        req = urllib.request.Request(
            f"{LOCAL_BACKEND}{path}",
            data=body.encode() if body and method != "GET" else None,
            headers={"Content-Type": content_type},
            method=method
        )
        resp = urllib.request.urlopen(req, timeout=60)
        status = resp.status
        resp_headers = dict(resp.headers)
        resp_body = resp.read().decode("utf-8", errors="replace")
        print(f"  ← {status} ({len(resp_body)} bytes)")
    except urllib.error.HTTPError as e:
        status = e.code
        resp_headers = {}
        resp_body = e.read().decode("utf-8", errors="replace")
        print(f"  ← {status} (error)")
    except Exception as e:
        status = 502
        resp_headers = {}
        resp_body = str(e)
        print(f"  ← 502 ({e})")
    
    try:
        resp_data = json.dumps({
            "request_id": rid,
            "status": status,
            "headers": resp_headers,
            "body": resp_body
        }).encode()
        post_req = urllib.request.Request(
            f"{relay_base}/api/respond/{tunnel_id}",
            data=resp_data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        urllib.request.urlopen(post_req, timeout=10)
    except Exception as e:
        print(f"  ✗ Failed to post response: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 tunnel-client.py <relay_url> <tunnel_id>")
        print("Example: python3 tunnel-client.py https://astrology-relay.onrender.com abc123")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])