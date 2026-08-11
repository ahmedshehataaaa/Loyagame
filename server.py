#!/usr/bin/env python3
"""Minimal static file server for local development and the test suite.

Serves this script's own directory, avoiding os.getcwd() (sandbox-safe).
"""

import http.server
import os
import socketserver
import sys

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
