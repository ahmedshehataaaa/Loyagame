#!/usr/bin/env python3
"""Minimal static file server for Slicy-P.
Serves this script's own directory, avoiding os.getcwd() (sandbox-safe)."""
import http.server
import socketserver
import os

PORT = int(os.environ.get("PORT", "8765"))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Disable caching so local edits always show on reload.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # quieter logs
        print("%s - %s" % (self.address_string(), fmt % args))


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    # The app fires a burst of ~15-20 concurrent requests on load (ES module
    # imports + item sprites); the plain single-threaded TCPServer's small
    # accept backlog can't keep up and refuses the overflow. Threading fixes
    # that without needing a real production server for local dev.
    daemon_threads = True
    allow_reuse_address = True


with ThreadingServer(("", PORT), Handler) as httpd:
    print(f"Serving {DIRECTORY} at http://localhost:{PORT}")
    httpd.serve_forever()
