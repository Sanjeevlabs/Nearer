#!/usr/bin/env python3
"""Capture the real mock app. No UI replacement or response interception.
Only synthetic demo-family sessions may be used; all outbound requests are blocked.
"""
import argparse, json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out'
NOW = '2026-11-02T14:30:00Z'
CLOCK = """(() => {
 const R=Date, fixed=Date.parse('%s');
 const S=new Proxy(R, {construct(t,a,nt){return Reflect.construct(t,a.length?a:[fixed],nt===S?t:nt)},
 apply(){return new R(fixed).toString()}, get(t,p,r){return p==='now'?()=>fixed:Reflect.get(t,p,r===S?t:r)}});
 window.Date=S;
})();""" % NOW
TAPS = """document.addEventListener('pointerdown',e=>{
 const d=document.createElement('i'); Object.assign(d.style,{position:'fixed',left:(e.clientX-15)+'px',top:(e.clientY-15)+'px',width:'30px',height:'30px',borderRadius:'50%',border:'2px solid #F5A524',background:'#F5A52433',zIndex:2147483647,pointerEvents:'none'});
 document.body.appendChild(d); d.animate([{opacity:1,transform:'scale(.7)'},{opacity:0,transform:'scale(1.7)'}],{duration:650}).onfinish=()=>d.remove();
},true);"""
# Nominal shot lengths sum to 90; the assembler overlaps handles without shortening them.
SHOTS = [
 (7,'arjun','No sign-up.\nA family opens.','Meet Arjun. His parents live in another city. Nearer is the window between their two homes.'),
 (8,'arjun','Their sky. Their time.\nA little closer.','Their sky, their weather, their time. One familiar window into the home he misses.'),
 (9,'arjun','Know how they are.\nWithout tracking them.','Safe and sound shows what they share and their time in Nearer. No phone-wide tracking.'),
 (9,'arjun','One tap says:\n“I’m thinking of you.”','He lights the lamp. One small gesture that says, I am thinking of you.'),
 (6,'dadi','A little light\nin the other home.','On Maa’s side, Arjun’s light is there. A little presence, even between calls.'),
 (10,'arjun','Her voice. Her words.\nKept close.','Her voice belongs here too. Muse helps turn family voices into words across languages.'),
 (7,'arjun','Behind the door:\neverything the family keeps.','Slide the key. Memories, recipes, care and celebrations all have a place in the family home.'),
 (10,'arjun','Parents don’t just receive care.\nThey give.','Maa teaches her dal in her own words. The family cooks it. She sees her knowledge matter.'),
 (8,'arjun','Sent to you.\nEasy to answer.','For you brings what the family sends into one place. Answer with your voice.'),
 (9,'arjun','When you can’t be there,\nsend something thoughtful.','When he cannot be there, Muse suggests something to send. This demonstration uses sample products.'),
 (4,'dadi','Different homes.\nDifferent time zones.','Families can stay close across countries and time zones.'),
 (3,None,'','Nearer. Never far from them.'),
]

def tap(page, loc):
 loc.wait_for(state='visible',timeout=15000); loc.scroll_into_view_if_needed(); box=loc.bounding_box()
 page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2,steps=12)
 page.wait_for_timeout(450);loc.click();page.wait_for_timeout(500)

def ready(page,selector):
 page.locator(selector).wait_for(state='visible',timeout=20000);page.wait_for_timeout(700)

def window(page):
 page.goto('/');ready(page,'[data-ui=window-lamp]')

def shot_1(page):
 page.goto('/');ready(page,'[data-ui=home-actions]');page.wait_for_timeout(1400)
 tap(page,page.get_by_role('button',name='Try the demo family',exact=True));ready(page,'[data-ui=window-lamp]')

def shot_2(page):
 window(page)
 assert page.locator('[data-ui=window-scene]').get_attribute('data-phase') in ('night','dusk'), 'Frozen clock must show evening at parents home'

def shot_3(page):
 window(page); row=page.get_by_role('button',name='Maa:',exact=False);row.scroll_into_view_if_needed();page.wait_for_timeout(1100);tap(page,row)
 ready(page,'[data-ui=window-their-day]');page.wait_for_timeout(2400);page.keyboard.press('Escape');page.wait_for_timeout(400)

def shot_4(page):
 window(page);tap(page,page.locator('[data-ui=window-lamp-button]'))
 page.get_by_text('glowing',exact=False).first.wait_for(timeout=10000)
 page.locator('[data-ui=window-lamp]').scroll_into_view_if_needed();page.wait_for_timeout(1800)
 page.locator('[data-ui=window-scene]').scroll_into_view_if_needed()

def shot_5(page):
 window(page); page.locator('[data-ui=window-lamp]').scroll_into_view_if_needed()
 assert 'Arjun' in page.locator('[data-ui=window-lamp]').inner_text(), 'The receiving side must show the actual light from Arjun'

def shot_6(page):
 window(page);tap(page,page.locator('[data-ui=window-voice] button'))
 ready(page,'[aria-label^="Voice note from"]')

def shot_7(page):
 window(page); loc=page.get_by_role('button',name='Slide to open the house');loc.scroll_into_view_if_needed();b=loc.bounding_box()
 page.wait_for_timeout(900);page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2,steps=12);page.mouse.down();page.mouse.move(b['x']+b['width']/2+220,b['y']+b['height']/2,steps=35);page.mouse.up()
 ready(page,'[data-ui=dock]');tap(page,page.get_by_role('button',name='Open the house',exact=True))
 page.get_by_role('link',name='Kitchen',exact=False).wait_for(timeout=10000)

def shot_8(page):
 page.goto('/kitchen');page.get_by_role('link',name='Dal tadka',exact=False).wait_for(timeout=15000)
 page.wait_for_timeout(900);tap(page,page.get_by_role('link',name='Dal tadka',exact=False));page.get_by_role('heading',name='Dal tadka',exact=True).wait_for(timeout=15000)
 page.wait_for_timeout(1800);page.get_by_role('region',name='Cooked by the family').scroll_into_view_if_needed()

def shot_9(page):
 page.goto('/inbox'); loc=page.get_by_role('button',name='Reply by voice to Maa',exact=True);loc.wait_for(timeout=15000);page.wait_for_timeout(1400);tap(page,loc)
 page.get_by_role('dialog').wait_for(timeout=10000);page.wait_for_timeout(1500)
 page.keyboard.press('Escape')

def shot_10(page):
 page.goto('/send?for=dadi'); section=page.get_by_role('region',name="Muse's ideas for Maa");section.wait_for(timeout=15000)
 loc=section.get_by_role('button',name='Panchmeva',exact=False);loc.wait_for(timeout=15000);section.scroll_into_view_if_needed();page.wait_for_timeout(1400);tap(page,loc)
 page.get_by_text('Deliver to',exact=True).wait_for(timeout=15000)
 # Do not activate checkout or external store links.

def shot_11(page):
 window(page) # Maa's other side is the adult children, including Rohan in London.
 # Use an actual chosen window, via the app's existing window settings API.
 # This setup is performed before recording below; no fabricated screen.
 page.locator('[data-ui=window-header]').wait_for()
 assert 'London' in page.locator('[data-ui=window-header]').inner_text(), 'London window is required for the international shot'

def shot_12(page):
 mark=(ROOT/'public/brand/mark.svg').read_text();word=(ROOT/'public/brand/wordmark.svg').read_text()
 page.set_content('<html><head><style>svg{width:100%;height:auto;display:block}</style></head><body style="margin:0;background:#F7F5F1;height:100vh;display:flex;align-items:center;justify-content:center"><div style="text-align:center;color:#1c1b1a;font-family:Arial"><div style="width:110px;margin:0 auto 24px">'+mark+'</div><div style="width:210px;margin:auto">'+word+'</div><p style="font-size:20px;line-height:1.5;margin-top:30px">Far from home,<br>never far from them.</p><p style="font-size:17px;margin-top:30px">nearer.site</p></div></body></html>')


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--base',default='http://127.0.0.1:4700');ap.add_argument('--only',type=int);args=ap.parse_args()
 assert args.base in ('http://127.0.0.1:4700','http://localhost:4700'), 'Local mock server only'
 OUT.mkdir(exist_ok=True);(OUT/'raw').mkdir(exist_ok=True)
 report=[]
 with sync_playwright() as p:
  launch={'headless':True}
  if os.getenv('DEMO_BROWSER_PATH'):
   launch.update(executable_path=os.environ['DEMO_BROWSER_PATH'],args=['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--disable-features=Vulkan'])
  for i,(seconds,person,caption,vo) in enumerate(SHOTS,1):
   if args.only and i!=args.only:continue
   browser=p.chromium.launch(**launch)
   ctx=browser.new_context(base_url=args.base,viewport={'width':390,'height':844},device_scale_factor=2.77,timezone_id='Asia/Kolkata',record_video_dir=str(OUT/'raw'),record_video_size={'width':390,'height':844},reduced_motion='no-preference')
   ctx.route('**/*',lambda route:route.continue_() if route.request.url.startswith(args.base) or route.request.url.startswith(('data:','blob:','about:')) else route.abort())
   ctx.add_init_script(CLOCK);ctx.add_init_script(TAPS)
   if i!=1 and person:
    res=ctx.request.post('/api/session',data={'inviteCode':'NEARER-DEMO','memberId':person});assert res.ok, res.text()
   if i!=1:ctx.add_init_script("sessionStorage.setItem('aangan:entered','1'); sessionStorage.setItem('aangan:door','"+('open' if i in (8,9,10) else 'closed')+"')")
   if i==11:
    res=ctx.request.post('/api/window',data={'action':'people','people':['rohan','sneha']});assert res.ok,res.text()
   page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.set_default_timeout(15000)
   start=time.monotonic()
   try:
    globals()[f'shot_{i}'](page)
    elapsed=time.monotonic()-start
    page.wait_for_timeout(max(1000,(seconds+.3-elapsed)*1000))
    page.screenshot(path=str(OUT/f'shot-{i:02}.png'))
    if errors:raise RuntimeError('; '.join(errors))
   except Exception:
    page.screenshot(path=str(OUT/f'failed-{i:02}.png'));print(page.locator('body').inner_text(),flush=True);raise
   video=page.video;page.close();ctx.close();dest=OUT/f'shot-{i:02}.webm';video.save_as(str(dest))
   report.append({'shot':i,'seconds':seconds,'capture_seconds':round(time.monotonic()-start,2),'caption':caption,'voiceover':vo})
   browser.close()
   print(f'Shot {i:02} captured',flush=True)
 if not args.only:
  (OUT/'shots.json').write_text(json.dumps(report,indent=2))
  def stamp(t):return f'{t//3600:02}:{t//60%60:02}:{t%60:02},000'
  at=0;srt=[];voice=[]
  for i,(sec,person,cap,vo) in enumerate(SHOTS,1):
   if cap:srt.append(f'{i}\n{stamp(at)} --> {stamp(at+sec)}\n{cap}\n')
   voice.append(f'{at//60}:{at%60:02}–{(at+sec)//60}:{(at+sec)%60:02}  {vo}');at+=sec
  (OUT/'nearer-demo-captions.srt').write_text('\n'.join(srt))
  (OUT/'nearer-demo-voiceover.txt').write_text('Nearer — product demo voice-over\n90 seconds. Silent video; record these lines separately.\nAll people and content are synthetic. Product suggestions are samples.\n\n'+'\n\n'.join(voice)+'\n')

if __name__=='__main__':main()
