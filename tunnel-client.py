#!/usr/bin/env python3
"""
Fluso Astrology Tunnel Client
Polls the relay server and forwards HTTP requests to the local Flask backend.

Usage: python3 tunnel-client.py <relay_url> <tunnel_id>
Example: python3 tunnel-client.py https://astrology-relay.onrender.com myastro
"""
import json
import sys
import time
import threading
import urllib.request
import urllib.error

LOCAL_BACKEND = "http://localhost:8001"
POLL_INTERVAL = 0.3
MAX_RESPONSE_SIZE = 10 * 1024 * 1024

def log(msg):
    print(f"  {msg}")

def run(relay_base, tunnel_id):
    relay_base = relay_base.rstrip('/')
    public_url = f"{relay_base}/t/{tunnel_id}/"
    print(f"")
    print(f"🔮 Astrology Tunnel Client")
    print(f"{'='*50}")
    print(f"   Relay:      {relay_base}")
    print(f"   Tunnel ID:  {tunnel_id}")
    print(f"   Local:      {LOCAL_BACKEND}")
    print(f"")
    print(f"🌐 Public URL: {public_url}")
    print(f"")
    print(f"   Share this URL to access your astrology website!")
    print(f"{'='*50}")
    print(f"")
    
    # Register the tunnel
    try:
        reg_data = json.dumps({"name": "fluso-astrology", "tunnel_id": tunnel_id}).encode()
        reg_req = urllib.request.Request(
            f"{relay_base}/api/register",
            data=reg_data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp = urllib.request.urlopen(reg_req, timeout=15)
        result = json.loads(resp.read())
        actual_url = result.get("public_url", public_url)
        print(f"✅ Tunnel registered! Public URL: {actual_url}")
    except Exception as e:
        print(f"⚠️  Registration failed (tunnel may already exist): {e}")
    
    print(f"")
    print(f"⏳ Polling for requests...")
    
    while True:
        try:
            url = f"{relay_base}/api/poll/{tunnel_id}"
            req = urllib.request.Request(url, method="GET")
            resp = urllib.request.urlopen(req, timeout=30)
            data = json.loads(resp.read())
            if data and "request_id" in data:
                threading.Thread(target=forward, args=(relay_base, tunnel_id, data), daemon=True).start()
        except urllib.error.HTTPError as e:
            if e.code != 404:
                log(f"Poll HTTP error: {e.code}")
        except Exception as e:
            log(f"Poll error: {e}")
        time.sleep(POLL_INTERVAL)

def forward(relay_base, tunnel_id, req_data):
    rid = req_data["request_id"]
    method = req_data.get("method", "GET")
    path = req_data.get("path", "/")
    body = req_data.get("body", "")
    headers = req_data.get("headers", {})
    
    log(f"→ {method} {path}")
    
    try:
        local_url = f"{LOCAL_BACKEND}{path}"
        req_headers = {}
        ct = headers.get("content-type") or headers.get("Content-Type") or ""
        if ct:
            req_headers["Content-Type"] = ct
        accept = headers.get("accept") or headers.get("Accept")
        if accept:
            req_headers["Accept"] = accept
        body_data = body.encode("utf-8") if body and method not in ("GET", "HEAD") else None
        req = urllib.request.Request(local_url, data=body_data, headers=req_headers, method=method)
        resp = urllib.request.urlopen(req, timeout=60)
        status = resp.status
        resp_body = resp.read(MAX_RESPONSE_SIZE)
        try:
            resp_text = resp_body.decode("utf-8")
            is_binary = False
        except UnicodeDecodeError:
            import base64
            resp_text = base64.b64encode(resp_body).decode("ascii")
            is_binary = True
        resp_headers = {}
        for key in resp.headers:
            val = resp.headers[key]
            if key.lower() not in ('transfer-encoding', 'connection', 'keep-alive', 'content-length', 'date', 'server'):
                resp_headers[key] = val
        if is_binary:
            resp_headers["x-tunnel-binary"] = "base64"
        log(f"← {status} ({len(resp_body)} bytes)")
    except urllib.error.HTTPError as e:
        status = e.code
        resp_headers = {}
        try:
            resp_text = e.read().decode("utf-8", errors="replace")
        except:
            resp_text = str(e)
        log(f"← {status} (error)")
    except Exception as e:
        status = 502
        resp_headers = {}
        resp_text = f"Tunnel error: {e}"
        log(f"← 502 ({e})")
    try:
        resp_data = json.dumps({
            "request_id": rid,
            "status": status,
            "headers": resp_headers,
            "body": resp_text
        }).encode()
        post_req = urllib.request.Request(
            f"{relay_base}/api/respond/{tunnel_id}",
            data=resp_data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        urllib.request.urlopen(post_req, timeout=15)
    except Exception as e:
        log(f"✗ Failed to post response: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 tunnel-client.py <relay_url> <tunnel_id>")
        print("Example: python3 tunnel-client.py https://astrology-relay.onrender.com myastro")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])