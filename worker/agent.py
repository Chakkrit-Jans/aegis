#!/usr/bin/env python3
"""
Aegis worker exec-agent.

A minimal HTTP service that runs a *whitelisted* security tool and returns its
output. It is the only entry point into the Kali worker and enforces:
  - bearer-token auth (shared secret with the backend),
  - a binary allow-list (defense-in-depth; the backend also allow-lists),
  - execution timeouts and output caps.

It is NOT exposed to the host — only the backend on the compose network reaches
it. Uses the Python standard library only (Kali ships python3), no pip deps.
"""
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("WORKER_TOKEN", "")
PORT = int(os.environ.get("PORT", "7000"))
MAX_OUTPUT = 200_000
MAX_TIMEOUT = 600

# Defense-in-depth: block a few catastrophic patterns even though the backend
# already gates shell commands behind operator approval + audit. This is not a
# sandbox — the worker container itself is the isolation boundary.
DANGEROUS = [
    r"\brm\s+-rf\s+/(?:\s|$)",
    r":\(\)\s*\{",          # fork bomb
    r"\bmkfs\b",
    r"\bdd\s+if=.*of=/dev/",
    r">\s*/dev/sd",
    r"\bshutdown\b",
    r"\breboot\b",
]

# Binaries the worker will run. Anything else is refused.
ALLOWED = {
    "nmap",
    "nuclei",
    "nikto",
    "whatweb",
    "ffuf",
    "gobuster",
    "hydra",
    "searchsploit",
    "dig",
    "sqlmap",
    "commix",
    "dalfox",
    "msfconsole",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "tools": sorted(ALLOWED)})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/exec", "/shell"):
            return self._send(404, {"error": "not found"})
        if not TOKEN or self.headers.get("Authorization", "") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:  # noqa: BLE001
            return self._send(400, {"error": f"bad json: {e}"})

        if self.path == "/exec":
            return self._exec(data)
        return self._shell(data)

    def _exec(self, data):
        binary = data.get("bin", "")
        args = data.get("args", [])
        timeout = min(int(data.get("timeout", 120) or 120), MAX_TIMEOUT)

        if binary not in ALLOWED:
            return self._send(400, {"error": f"tool '{binary}' not permitted"})
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            return self._send(400, {"error": "args must be a list of strings"})

        try:
            proc = subprocess.run(
                [binary, *args], capture_output=True, text=True, timeout=timeout
            )
            out = (proc.stdout or "") + (proc.stderr or "")
            self._send(200, {"code": proc.returncode, "output": out[:MAX_OUTPUT]})
        except FileNotFoundError:
            self._send(200, {"code": 127, "output": f"'{binary}' is not installed on the worker"})
        except subprocess.TimeoutExpired:
            self._send(200, {"code": 124, "output": f"timeout after {timeout}s"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def _shell(self, data):
        command = data.get("command", "")
        cwd = data.get("cwd") or "/root"
        timeout = min(int(data.get("timeout", 120) or 120), MAX_TIMEOUT)
        if not isinstance(command, str) or not command.strip():
            return self._send(400, {"error": "command required"})
        for pattern in DANGEROUS:
            if re.search(pattern, command):
                return self._send(400, {"error": "command blocked by worker safety filter"})
        try:
            proc = subprocess.run(
                ["bash", "-lc", command],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd if os.path.isdir(cwd) else "/root",
            )
            out = (proc.stdout or "") + (proc.stderr or "")
            self._send(200, {"code": proc.returncode, "output": out[:MAX_OUTPUT]})
        except subprocess.TimeoutExpired:
            self._send(200, {"code": 124, "output": f"timeout after {timeout}s"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def log_message(self, *_args):
        pass  # keep the container logs quiet


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
