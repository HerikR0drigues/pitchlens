"""Pitchlens - local web server (127.0.0.1 only) that reads the running FM27 and serves the UI.

Normal use: double-click Pitchlens.pyw (no console, opens in its own window).
Developer use:
        py scout.py               -> opens http://127.0.0.1:8770 in your browser
        py scout.py --no-browser  -> just start the server
        py scout.py --port 9000   -> use another port
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import faces  # noqa: E402
import fmreader  # noqa: E402

__version__ = '1.1.1'
REPO = 'HerikR0drigues/pitchlens'
HOST, PORT = '127.0.0.1', 8770
WEB = ROOT / 'web'
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
         '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}
_lock = threading.Lock()
_state: dict = {'players': [], 'by_uid': {}, 'meta': None, 'error': None, 'error_code': None}

LIST_FIELDS = ('uid', 'name', 'ca', 'pa', 'nation', 'nation_code', 'birth_year', 'club', 'club_uid',
               'contract_year', 'free', 'transfer_listed', 'loan_listed', 'female', 'pos', 'foot',
               'pre_club', 'pre_year', 'wage', 'release', 'squad')


def refresh() -> None:
    with _lock:
        _read()


def ensure_loaded() -> None:
    """First read of the save; concurrent callers wait for it instead of reading twice."""
    with _lock:
        if not _state['meta'] and not _state['error']:
            _read()


def _read() -> None:
    try:
        players, meta = fmreader.snapshot()
        _state.update(players=players, by_uid={p['uid']: p for p in players}, meta=meta,
                      error=None, error_code=None)
    except fmreader.FMNotRunning as e:
        _state.update(error=str(e), error_code=e.code)
    except Exception as e:  # noqa: BLE001
        _state.update(error=f'Error reading FM: {e}', error_code='read_error')


def list_payload() -> dict:
    faces.wait(10)
    # attributes go as one compact string per player (chr(48 + value)) for role ratings and similar players
    data = [[p[k] for k in LIST_FIELDS] + [faces.has(p['uid']), ''.join(chr(48 + v) for v in p['attrs'])]
            for p in _state['players']]
    return {'fields': LIST_FIELDS + ('photo', 'a'), 'groups': fmreader.GROUP_INDEX, 'rows': data, 'meta': _state['meta'], 'error': _state['error'],
            'error_code': _state['error_code'], 'version': __version__}


def player_payload(uid: int) -> dict:
    p = _state['by_uid'].get(uid)
    if not p:
        return {'error': 'Player not found (refresh the data).', 'error_code': 'player_not_found'}
    return {**{k: p[k] for k in LIST_FIELDS}, 'contract_day': p['contract_day'], 'pre_day': p['pre_day'], 'birth_day': p['birth_day'],
            'photo': faces.has(uid), 'attrs': p['attrs'], 'groups': fmreader.GROUP_INDEX}


_update: dict = {}


def _ver(s: str) -> tuple:
    return tuple(int(x) for x in s.lstrip('vV').split('.')[:3] if x.isdigit())


def update_info() -> dict:
    """Ask GitHub once per run whether a newer release exists (only the public releases API; nothing is sent)."""
    if not _update:
        info = {'current': __version__, 'latest': None, 'newer': False, 'url': None}
        try:
            req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/releases/latest',
                                         headers={'User-Agent': 'Pitchlens', 'Accept': 'application/vnd.github+json'})
            with urllib.request.urlopen(req, timeout=4) as r:
                rel = json.load(r)
            info.update(latest=rel.get('tag_name'), url=rel.get('html_url'),
                        newer=_ver(rel.get('tag_name') or '0') > _ver(__version__))
        except Exception:  # noqa: BLE001 - offline or rate limited: just say nothing
            pass
        _update.update(info)
    return _update


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj) -> None:
        self._send(200, json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8'),
                   'application/json; charset=utf-8')

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        if url.path == '/api/quit':
            self._json({'ok': True})
            return _quit_soon()
        if url.path == '/api/ping':
            if 'alive' in url.query:
                _app['last_ping'] = time.monotonic()
            return self._json({'app': 'pitchlens', 'version': __version__})
        if url.path == '/api/players':
            ensure_loaded()
            return self._json(list_payload())
        if url.path == '/api/refresh':
            refresh()
            return self._json(list_payload())
        if url.path == '/api/player':
            try:
                uid = int(parse_qs(url.query).get('uid', ['0'])[0])
            except ValueError:
                uid = 0
            return self._json(player_payload(uid))
        if url.path == '/api/update':
            return self._json(update_info())
        if url.path == '/api/face':
            try:
                f = faces.path(int(parse_qs(url.query).get('uid', ['0'])[0]))
            except ValueError:
                f = None
            if f and os.path.isfile(f):
                body = Path(f).read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', TYPES.get(Path(f).suffix.lower(), 'image/jpeg'))
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'max-age=86400')
                self.end_headers()
                self.wfile.write(body)
                return None
            return self._send(404, b'no face', 'text/plain')
        name = 'index.html' if url.path in ('/', '') else url.path.lstrip('/')
        target = (WEB / name).resolve()
        if WEB.resolve() in target.parents and target.is_file():   # no path traversal
            return self._send(200, target.read_bytes(), TYPES.get(target.suffix, 'application/octet-stream'))
        return self._send(404, b'not found', 'text/plain')


# ---------------------------------------------------------------- desktop app mode
# Pitchlens.exe starts "pythonw Pitchlens.pyw --server --port N" (no console) and shows the UI in its own
# WebView2 window; when that window closes it calls /api/quit. If the page stops pinging /api/ping?alive=1
# for 3 minutes (e.g. the window crashed) the server also stops by itself.
APP_DIR = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Pitchlens'
_app: dict = {'last_ping': None, 'server': None}


def _quit_soon() -> None:
    srv = _app['server']
    if srv is not None:
        threading.Thread(target=srv.shutdown, daemon=True).start()


def _watchdog() -> None:
    started = time.monotonic()
    while True:
        time.sleep(5)
        last = _app['last_ping']
        if (last is None and time.monotonic() - started > 300) or (last is not None and time.monotonic() - last > 180):
            return _quit_soon()


def run_app() -> None:
    """Entry point for Pitchlens.pyw (always started without a console)."""
    APP_DIR.mkdir(parents=True, exist_ok=True)
    log = open(APP_DIR / 'pitchlens.log', 'a', encoding='utf-8', buffering=1)  # noqa: SIM115
    sys.stdout = sys.stderr = log
    print(f'--- {time.strftime("%Y-%m-%d %H:%M:%S")} Pitchlens {__version__} {sys.argv[1:]}')
    port = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else PORT
    if _already_running(port):
        if '--server' not in sys.argv:
            webbrowser.open(f'http://{HOST}:{port}')
        return
    while not _free(port):
        port += 1
    faces.start()
    threading.Thread(target=ensure_loaded, daemon=True).start()   # start reading the save right away
    srv = ThreadingHTTPServer((HOST, port), Handler)
    _app['server'] = srv
    if '--server' not in sys.argv:            # started by hand (not by Pitchlens.exe): use the default browser
        webbrowser.open(f'http://{HOST}:{port}')
    threading.Thread(target=_watchdog, daemon=True).start()
    srv.serve_forever()
    print('stopped')


def _already_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f'http://{HOST}:{port}/api/ping', timeout=1) as r:
            return json.load(r).get('app') == 'pitchlens'
    except Exception:  # noqa: BLE001
        return False


def _free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex((HOST, port)) != 0


def main() -> None:
    port = PORT
    if '--port' in sys.argv:
        port = int(sys.argv[sys.argv.index('--port') + 1])
    browser = '--no-browser' not in sys.argv
    if _already_running(port):
        print(f'Pitchlens is already running at http://{HOST}:{port}')
        if browser:
            webbrowser.open(f'http://{HOST}:{port}')
        return
    while not _free(port):
        port += 1
    faces.start()
    srv = ThreadingHTTPServer((HOST, port), Handler)
    url = f'http://{HOST}:{port}'
    print(f'Pitchlens {__version__} running at {url}  (close this window to stop)')
    if browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
