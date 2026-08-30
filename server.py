#!/usr/bin/env python3
"""Local dev server for the BSL Bend Open app."""
import http.server, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8642, bind="127.0.0.1")
