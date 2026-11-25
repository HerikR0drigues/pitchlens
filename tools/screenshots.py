"""Regenerate the README screenshots with headless Microsoft Edge.

1. Start the scout with FM27 open and a save loaded:  py scout.py --no-browser --port 8771
2. Run:  py tools/screenshots.py [port] [player_uid]
Images are written to docs/img/.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'img'
PORT = sys.argv[1] if len(sys.argv) > 1 else '8771'
UID = sys.argv[2] if len(sys.argv) > 2 else ''
EDGE = next(p for p in (
    Path(os.environ.get('ProgramFiles(x86)', '')) / 'Microsoft/Edge/Application/msedge.exe',
    Path(os.environ.get('ProgramFiles', '')) / 'Microsoft/Edge/Application/msedge.exe') if p.is_file())

SHOTS = [
    ('overview-dark.png', 'lang=en&theme=dark&sit=all'),
    ('overview-light.png', 'lang=pt&theme=light&sit=pre'),
    ('player-dark.png', f'lang=en&theme=dark&p={UID}'),
]

OUT.mkdir(parents=True, exist_ok=True)
for name, query in SHOTS:
    if 'p=' in query and not UID:
        continue
    target = OUT / name
    subprocess.run([str(EDGE), '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900',
                    '--force-device-scale-factor=1', f'--user-data-dir={OUT / ".edge-profile"}',
                    '--virtual-time-budget=20000', f'--screenshot={target}',
                    f'http://127.0.0.1:{PORT}/?{query}'], check=False, capture_output=True)
    print(name, 'ok' if target.exists() else 'FAILED')
