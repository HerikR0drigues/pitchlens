"""Player photos from the user's own FM graphics folder (face packs / cut-out packs).

Face packs name each image after the player's unique ID (e.g. ``graphics/facepack/12345.png``), the same ID that
Pitchlens reads from memory. We index those files once (about 1 s for 500k images) and serve them locally.
Nothing is downloaded; if there is no face pack, the UI keeps the initials avatar.
"""
from __future__ import annotations

import ctypes
import os
import threading
from pathlib import Path

GAME_DIR = ('Sports Interactive', 'Football Manager 27')
# Only folders that hold faces: graphics/logos and kits also use numeric names (club IDs).
FACE_WORDS = ('face', 'player', 'portrait', 'people', 'person', 'cut')
SKIP_WORDS = ('backup', 'logo', 'kit', 'badge')
EXTS = ('.png', '.jpg', '.jpeg', '.webp')

_index: dict[int, str] = {}
_ready = threading.Event()
_started = threading.Lock()


def _documents() -> list[Path]:
    """The user's Documents folder (may be redirected to OneDrive), plus common fallbacks."""
    out: list[Path] = []
    try:
        # FOLDERID_Documents {FDD39AD0-238F-46AF-ADB4-6C85480369C7}
        guid = (ctypes.c_byte * 16).from_buffer_copy(bytes.fromhex('d09ad3fd8f23af46adb46c85480369c7'))
        ptr = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(ptr)) == 0:
            out.append(Path(ptr.value))
            ctypes.windll.ole32.CoTaskMemFree(ptr)
    except Exception:  # noqa: BLE001
        pass
    home = Path.home()
    out += [home / 'Documents', home / 'OneDrive' / 'Documents', home / 'OneDrive' / 'Documentos']
    return out


def graphics_dirs() -> list[Path]:
    seen, out = set(), []
    for d in _documents():
        g = d.joinpath(*GAME_DIR, 'graphics')
        key = str(g).lower()
        if key not in seen and g.is_dir():
            seen.add(key)
            out.append(g)
    return out


def _scan() -> None:
    try:
        for g in graphics_dirs():
            stack = [(str(g), False)]
            while stack:
                folder, in_faces = stack.pop()
                try:
                    with os.scandir(folder) as it:
                        for e in it:
                            low = e.name.lower()
                            if e.is_dir(follow_symlinks=False):
                                if any(w in low for w in SKIP_WORDS):
                                    continue
                                stack.append((e.path, in_faces or any(w in low for w in FACE_WORDS)))
                            elif in_faces:
                                stem, ext = os.path.splitext(low)
                                if ext in EXTS and stem.isdigit():
                                    _index.setdefault(int(stem), e.path)
                except OSError:
                    continue
    finally:
        _ready.set()


def start() -> None:
    """Index in the background (called when the server starts)."""
    if _started.acquire(blocking=False):
        threading.Thread(target=_scan, daemon=True).start()


def has(uid: int) -> bool:
    return uid in _index


def path(uid: int) -> str | None:
    return _index.get(uid)


def wait(timeout: float) -> None:
    _ready.wait(timeout)


def count() -> int:
    return len(_index)
