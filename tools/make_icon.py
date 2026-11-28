"""Build web/pitchlens.ico (16-256 px): the Pitchlens mark in warm white on a near-black rounded tile.

The tile keeps the icon visible on light (Explorer, desktop wallpapers) and dark (taskbar) backgrounds.
Renders with headless Microsoft Edge (canvas -> PNG), so it needs no Python packages.
Usage: py tools/make_icon.py
"""
import base64
import json
import os
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web' / 'pitchlens.ico'
SIZES = [16, 24, 32, 48, 64, 128, 256]
EDGE = next(p for p in (
    Path(os.environ.get('ProgramFiles(x86)', '')) / 'Microsoft/Edge/Application/msedge.exe',
    Path(os.environ.get('ProgramFiles', '')) / 'Microsoft/Edge/Application/msedge.exe') if p.is_file())

MARK = ('<path fill-rule="evenodd" d="M38 2 A18 18 0 1 1 37.99 2 Z M38 9.5 A10.5 10.5 0 1 0 38.01 9.5 Z"/>'
        '<circle cx="38" cy="20" r="3.6"/><path d="M19 33 L29.5 38.5 L16 55 L4 55 Z"/>')


def svg(size: int) -> str:
    # small sizes: slightly bigger mark and tighter corners so the P stays readable
    small = size <= 32
    scale, tx, ty, rx = (3.0, 32, 44, 44) if small else (2.75, 40, 50, 56)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="{size}" height="{size}">'
            f'<rect width="256" height="256" rx="{rx}" fill="#161616"/>'
            f'<g transform="translate({tx} {ty}) scale({scale})" fill="#f0ede6">{MARK}</g></svg>')


PAGE = """<!doctype html><meta charset="utf-8"><body><pre id="out"></pre><script>
const svgs = %s, out = {};
Promise.all(Object.entries(svgs).map(([size, s]) => new Promise(done => {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = +size;
    c.getContext('2d').drawImage(img, 0, 0, +size, +size); out[size] = c.toDataURL('image/png'); done(); };
  img.src = 'data:image/svg+xml;base64,' + btoa(s);
}))).then(() => { document.getElementById('out').textContent = JSON.stringify(out); });
</script>"""


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp, 'icon.html')
        page.write_text(PAGE % json.dumps({s: svg(s) for s in SIZES}), encoding='utf-8')
        dom = subprocess.run([str(EDGE), '--headless=new', '--disable-gpu', f'--user-data-dir={Path(tmp, "profile")}',
                              '--virtual-time-budget=5000', '--dump-dom', page.as_uri()],
                             capture_output=True, text=True, encoding='utf-8').stdout
    raw = dom.split('<pre id="out">', 1)[1].split('</pre>', 1)[0].replace('&quot;', '"')
    pngs = {int(k): base64.b64decode(v.split(',', 1)[1]) for k, v in json.loads(raw).items()}
    # ICO with PNG-compressed images (supported since Windows Vista)
    header = struct.pack('<HHH', 0, 1, len(SIZES))
    entries, blobs, offset = b'', b'', 6 + 16 * len(SIZES)
    for s in SIZES:
        data = pngs[s]
        entries += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    OUT.write_bytes(header + entries + blobs)
    print(f'{OUT} ({len(SIZES)} sizes, {OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
