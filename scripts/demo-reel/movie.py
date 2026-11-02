#!/usr/bin/env python3
"""Capture real product inserts if needed, then make the 58-second film."""
import os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];os.chdir(ROOT)
if not all((ROOT/f'out/shot-{i:02}.webm').exists() for i in [2,4,6,10]):
 subprocess.run(['python3','scripts/demo-reel/run.py'],check=True)
if not (ROOT/'out/shot-13.webm').exists():
 subprocess.run(['python3','scripts/demo-reel/run.py','--skip-build','--care'],check=True)
subprocess.run(['python3','scripts/demo-reel/cinematic.py'],check=True)
