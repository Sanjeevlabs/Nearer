#!/usr/bin/env python3
"""One local mock-only insert: the parents' trusted nearby contacts. Never dials."""
import os,re
from pathlib import Path
from playwright.sync_api import sync_playwright
from record import CLOCK
ROOT=Path(__file__).resolve().parents[2]
with sync_playwright() as p:
 opts={'headless':True}
 if os.getenv('DEMO_BROWSER_PATH'):opts.update(executable_path=os.environ['DEMO_BROWSER_PATH'],args=['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--disable-features=Vulkan'])
 b=p.chromium.launch(**opts)
 c=b.new_context(base_url='http://127.0.0.1:4700',viewport={'width':390,'height':844},device_scale_factor=2.77,record_video_dir=str(ROOT/'out/raw'),record_video_size={'width':390,'height':844})
 c.add_init_script(CLOCK);c.add_init_script("sessionStorage.setItem('aangan:entered','1');sessionStorage.setItem('aangan:door','open')")
 c.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4700') else r.abort())
 r=c.request.post('/api/session',data={'inviteCode':'NEARER-DEMO','memberId':'arjun'});assert r.ok
 page=c.new_page();page.goto('/nearby');page.get_by_role('heading',name='Trusted nearby',exact=True).wait_for()
 region=page.get_by_role('region',name=re.compile('Around Maa'))
 region.wait_for();page.wait_for_timeout(1800);region.scroll_into_view_if_needed();page.wait_for_timeout(1000)
 assert region.locator('a[href^="tel:"]').count()>1,'The synthetic parents need actual seeded trusted contacts'
 print(region.inner_text(),flush=True);page.wait_for_timeout(9000);page.screenshot(path=str(ROOT/'out/trusted-nearby.png'))
 v=page.video;page.close();c.close();v.save_as(str(ROOT/'out/shot-13.webm'));b.close()
