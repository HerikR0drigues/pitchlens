"""Pitchlens launcher - double-click to open (runs without a console window).

Opens Pitchlens in its own window; closing the window stops it. On the first run it also creates
"Pitchlens" shortcuts (with icon) on the Desktop and in the Start Menu.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scout  # noqa: E402

scout.run_app()
