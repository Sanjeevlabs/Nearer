#!/usr/bin/env python3
"""One-command local, synthetic product-demo pipeline."""
import argparse, os, secrets, subprocess, time, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--skip-build',action='store_true');ap.add_argument('--only',type=int);ap.add_argument('--care',action='store_true');args=ap.parse_args()
 env=dict(os.environ,MOCK='true',NEXT_PUBLIC_MOCK='true',NEXT_PUBLIC_DEMO_REEL='true',SESSION_SECRET=secrets.token_hex(32),AANGAN_FIXED_NOW='2026-11-02T14:30:00Z')
 os.chdir(ROOT);(ROOT/'out').mkdir(exist_ok=True)
 if not args.skip_build:subprocess.run(['npm','run','build'],env=env,check=True)
 log=open(ROOT/'out/server.log','w')
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','4700'],env=env,stdout=log,stderr=subprocess.STDOUT)
 try:
  for _ in range(120):
   if server.poll() is not None:raise RuntimeError('Mock server exited; see out/server.log')
   try:urllib.request.urlopen('http://127.0.0.1:4700/home',timeout=1);break
   except Exception:time.sleep(.5)
  else:raise RuntimeError('Mock server did not become ready')
  cmd=['python3','scripts/demo-reel/record-care.py' if args.care else 'scripts/demo-reel/record.py']
  if args.only:cmd+=['--only',str(args.only)]
  subprocess.run(cmd,env=env,check=True)
  if not args.only and not args.care:subprocess.run(['bash','scripts/demo-reel/assemble.sh'],env=env,check=True)
 finally:
  server.terminate()
  try:server.wait(timeout=8)
  except subprocess.TimeoutExpired:server.kill();server.wait()
  log.close()
if __name__=='__main__':main()
