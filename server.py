#!/usr/bin/env python3
"""Static file server + local reward backend, for development and the test suite.

Serves this script's own directory, avoiding os.getcwd() (sandbox-safe), and
answers `/api/*` from `dev_api.py`.

The API half exists because the shipped backend is Vercel Functions plus
Supabase, neither of which is reachable from a laptop — so every reward call
used to 404 and the player was told "Rewards are not available in this build"
on every win. `dev_api.py` mirrors the same wire contract locally. It is a DEV
server: nothing here ships, and `dist/` contains no Python at all.
"""

import http.server
import json
import os
import socketserver
import sys

import dev_api

PORT = int(os.environ.get("PORT", "8765"))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        """Serve files, except `/api/*` which the admin dashboard reads over GET.

        The admin endpoints (api/admin-*.mjs) are GETs, so without this the
        dashboard under dashboard/ could only ever be developed against a
        deployed Supabase project.
        """
        path, _, query = self.path.partition("?")
        if path.startswith("/api/"):
            result = dev_api.handle_get(path, query, self.headers)
            if result is None:
                self.send_error(404, "No such endpoint")
                return
            self._send_json(*result)
            return
        super().do_GET()

    def do_POST(self):
        """Route `/api/*` to the dev backend; everything else is not a POST target."""
        path = self.path.split("?", 1)[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length else b"{}"

        result = dev_api.handle(path, raw)
        if result is None:
            self.send_error(404, "No such endpoint")
            return

        self._send_json(*result)

    def end_headers(self):
        # Disable caching so local edits always show on reload.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def handle_one_request(self):
        """Treat a client hang-up as normal, not as a crash.

        Playwright closes sockets abruptly between navigations, and the stock
        handler lets the resulting ConnectionAbortedError/ConnectionResetError
        propagate — which printed a traceback per navigation and, under the full
        6-viewport run, showed up as intermittent test failures where a page
        simply never finished loading. A disconnected client is an ordinary
        event for a dev server, so it is swallowed here.
        """
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def log_message(self, fmt, *args):
        # Quiet by default: the test runner starts this server and its access
        # log is noise in a failure report. PORT_VERBOSE=1 brings it back.
        if os.environ.get("SERVER_VERBOSE") == "1":
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    # The app fires a burst of ~15-20 concurrent requests on load (ES module
    # imports + item sprites); the plain single-threaded TCPServer's small
    # accept backlog can't keep up and refuses the overflow. Threading fixes
    # that without needing a real production server for local dev.
    daemon_threads = True
    allow_reuse_address = True
    # The default backlog of 5 is far too small once Playwright runs six
    # viewport projects in parallel: overflowing connections are refused, which
    # surfaces as a page that mysteriously fails to load rather than as an
    # error anyone can act on.
    request_queue_size = 128


with ThreadingServer(("", PORT), Handler) as httpd:
    print(f"Serving {DIRECTORY} at http://localhost:{PORT}")
    httpd.serve_forever()
