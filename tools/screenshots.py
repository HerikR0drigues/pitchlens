"""Regenerate the README screenshots with headless Microsoft Edge.

1. Start the scout with FM27 open and a save loaded:  py scout.py --no-browser --port 8771
2. Run:  py tools/screenshots.py [port] [player_uid]
Images are written to docs/img/. Photos are turned off (?photos=0): face packs are third-party images.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'img'
PORT = sys.argv[1] if len(sys.argv) > 1 else '8771'
UID = sys.argv[2] if len(sys.argv) > 2 else ''
XI_CLUB = sys.argv[3] if len(sys.argv) > 3 else 'Ava%C3%AD'   # club for the best-XI shot (URL-encoded)
EDGE = next(p for p in (
    Path(os.environ.get('ProgramFiles(x86)', '')) / 'Microsoft/Edge/Application/msedge.exe',
    Path(os.environ.get('ProgramFiles', '')) / 'Microsoft/Edge/Application/msedge.exe') if p.is_file())

SHOTS = [
    ('overview-dark.png', 'lang=en&theme=dark&sit=all&photos=0'),
    ('overview-light.png', 'lang=pt&theme=light&sit=pre&photos=0'),
    ('player-dark.png', f'lang=en&theme=dark&photos=0&p={UID}'),
    ('compare.png', 'lang=en&theme=dark&photos=0&cmp=29179241,85139014,28049320'),
    ('roles-light.png', 'lang=en&theme=light&sit=all&photos=0&role=w'),
    ('best-xi.png', f'lang=pt&theme=dark&photos=0&xi={XI_CLUB}&form=4-3-3'),
]

OUT.mkdir(parents=True, exist_ok=True)
for name, query in SHOTS:
    if 'p=' in query and not UID:
        continue
    target = OUT / name
    subprocess.run([str(EDGE), '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900',
                    '--force-device-scale-factor=1', f'--user-data-dir={OUT / ".edge-profile"}',
                    '--virtual-time-budget=60000', f'--screenshot={target.resolve()}',
                    f'http://127.0.0.1:{PORT}/?{query}'], check=False, capture_output=True)
    print(name, 'ok' if target.exists() else 'FAILED')
