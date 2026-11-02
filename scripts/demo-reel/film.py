#!/usr/bin/env python3
"""Narrated product film: original score, animated layouts and actual app captures.
No paid services, product changes, cloned voices or generated actor performances.
"""
import asyncio, json, math, os, subprocess, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'out/film'; OUT.mkdir(parents=True,exist_ok=True)
FPS=30; W=1920; H=1080; PAPER='#F7F5F1'; INK='#1D211E'; GOLD='#E5A038'
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SCENES=[
 {'kind':'photo','photo':'home-balcony.jpg','title':'A new city.\nThe same home.','eyebrow':'FOR EVERY FAMILY LIVING APART','vo':'A new city. A new life. And the home you still think about.'},
 {'kind':'photo','photo':'home-window.jpg','title':'It’s the little\nthings you miss.','eyebrow':'THE EVERYDAY DISTANCE','vo':'The distance is not just kilometres. It is all the little things in between.'},
 {'kind':'phone','shot':2,'title':'A window between\nyour two homes.','eyebrow':'MEET NEARER','vo':'Nearer is a window between your two homes.'},
 {'kind':'phone','shot':3,'title':'Their sky.\nTheir time.\nTheir day.','eyebrow':'A FAMILIAR WINDOW','vo':'Their sky. Their time. The rhythm of their day, from what they share in Nearer.'},
 {'kind':'lamp','photo':'lamp-lit.jpg','shot':4,'title':'One tap.\nA little light.','eyebrow':'A GESTURE THAT TRAVELS','vo':'One tap lights a lamp. I am thinking of you.'},
 {'kind':'phone','shot':5,'title':'Thinking of you.\nFelt at home.','eyebrow':'THE OTHER SIDE OF THE WINDOW','vo':'And on the other side, Maa feels it.'},
 {'kind':'phone','shot':6,'title':'Her voice.\nHer stories.\nHer way.','eyebrow':'THE VOICES THAT MAKE A HOME','vo':'Her voice. Her stories. Her way of making your favourite dal.'},
 {'kind':'family','photo':'family-group.webp','title':'Parents have\nso much to give.','eyebrow':'THE HEART OF NEARER','vo':'Because parents should do more than receive care. They should feel needed.'},
 {'kind':'phone','shot':8,'title':'A family recipe.\nA Sunday made.','eyebrow':'KNOWLEDGE, PASSED ON','vo':'A recipe gets cooked. A blessing is heard. A question gets answered.'},
 {'kind':'double','shot':9,'title':'A voice reply.\nA thoughtful gift.','eyebrow':'CARE, IN EVERYDAY ACTIONS','vo':'And when you cannot be there, send something thoughtful.'},
 {'kind':'photo','photo':'family-group.webp','title':'More of the\nlittle things.\nTogether.','eyebrow':'TWO HOMES. ONE FAMILY.','vo':'Less distance in the everyday. More room for family.'},
 {'kind':'end','title':'Far from home,\nnever far from them.','vo':'Nearer. Far from home, never far from them.'},
]

def cmd(args):subprocess.run([args[0],'-nostdin',*args[1:]],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL)
def duration(path):return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)]))
def font(n,bold=False):return ImageFont.truetype(BOLD if bold else FONT,n)
def cover(im,size):return ImageOps.fit(im,size,method=Image.Resampling.LANCZOS,centering=(.5,.5))

def setup_assets():
 import cairosvg
 for name in ['mark','wordmark']:
  cairosvg.svg2png(url=str(ROOT/f'public/brand/{name}.svg'),write_to=str(OUT/f'{name}.png'),output_width=550 if name=='wordmark' else 350)
 mask=Image.new('L',(438,944));ImageDraw.Draw(mask).rounded_rectangle((0,0,437,943),radius=54,fill=255);mask.save(OUT/'phone-mask.png')
 shadow=Image.new('RGBA',(620,1060));sd=ImageDraw.Draw(shadow);sd.rounded_rectangle((85,65,535,1005),radius=75,fill=(0,0,0,75));shadow=shadow.filter(ImageFilter.GaussianBlur(25));shadow.save(OUT/'phone-shadow.png')
 # Flat film stage. Soft shadows come only from objects placed on it.
 for dark in [False,True]:
  im=Image.new('RGB',(W,H),INK if dark else PAPER);d=ImageDraw.Draw(im)
  d.line((120,978,1800,978),fill='#383D38' if dark else '#DDDAD4',width=1)
  d.text((120,1008),'Illustrative family · real app recordings',font=font(17),fill='#A4A8A2' if dark else '#787974')
  d.text((1640,1040),'nearer.site',font=font(22),fill='#D8DBD6' if dark else '#555A53')
  im.save(OUT/('stage-dark.png' if dark else 'stage.png'))
 # Lightfall over photography, for type contrast without changing the source image.
 arr=np.zeros((H,W,4),dtype=np.uint8);arr[:,:,:3]=[7,15,12];arr[:,:,3]=(np.maximum(0,1-np.arange(W)/W)*185).astype(np.uint8)[None,:]
 Image.fromarray(arr).save(OUT/'shade.png')

async def narrate():
 import edge_tts,edge_tts.communicate
 if os.getenv('SSL_CERT_FILE'):edge_tts.communicate._SSL_CTX.load_verify_locations(cafile=os.environ['SSL_CERT_FILE'])
 sem=asyncio.Semaphore(3)
 async def one(i,s):
  async with sem:
   path=OUT/f'vo-{i:02}.mp3'
   if not path.exists() or path.stat().st_size<100:
    await edge_tts.Communicate(s['vo'],'en-IN-NeerjaNeural',rate='+5%',proxy=os.environ.get('HTTPS_PROXY')).save(str(path))
   s['voice_seconds']=duration(path);s['seconds']=max(4.7,math.ceil((s['voice_seconds']+1.1)*10)/10)
   print(f'Voice {i+1:02}: {s["voice_seconds"]:.1f}s',flush=True)
 await asyncio.gather(*(one(i,s) for i,s in enumerate(SCENES)))

def typography(i,s):
 photo=s['kind'] in ('photo','lamp','family'); dark=(i==6)
 im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im);color='#FFFFFF' if photo or dark else INK
 if s['kind']=='end':
  mark=Image.open(OUT/'mark.png').convert('RGBA');mark.thumbnail((200,200));im.alpha_composite(mark,((W-mark.width)//2,160))
  word=Image.open(OUT/'wordmark.png').convert('RGBA');word.thumbnail((460,100));im.alpha_composite(word,((W-word.width)//2,400))
  d.multiline_text((W/2,590),s['title'],font=font(48),fill=INK,align='center',anchor='ma',spacing=12)
  d.rounded_rectangle((800,775,1120,855),40,fill=INK);d.text((960,798),'nearer.site',font=font(30),fill='white',anchor='ma')
 else:
  x=120;top=195
  d.text((x,top),s.get('eyebrow',''),font=font(20,True),fill='#F5BA65' if photo or dark else '#897445',stroke_width=0)
  size=88 if s['kind']!='double' else 72
  d.multiline_text((x,top+70),s['title'],font=font(size,True),fill=color,spacing=18)
  y=top+70+len(s['title'].splitlines())*(size+18)+42
  sub={2:'Their world, a little closer.',3:'Shared moments and check-ins. Never phone-wide tracking.',5:'A light in one home. A feeling in the other.',6:'Voices and memories, kept in the family.',8:'Her words become something you can keep.',9:'Sample gift suggestions · checkout stays with the store.'}.get(i,'')
  if sub:
   # Wrap supporting copy within the editorial column.
   words=sub.split();lines=[];line=''
   for word in words:
    if d.textlength(line+' '+word,font=font(26))>770:lines.append(line);line=word
    else:line=(line+' '+word).strip()
   lines.append(line);d.multiline_text((x,y),'\n'.join(lines),font=font(26),fill='#C8CFC8' if dark else '#5A6258',spacing=10)
  word=Image.open(OUT/'wordmark.png').convert('RGBA');word.thumbnail((145,32))
  if photo or dark:
   a=word.getchannel('A');word=Image.new('RGBA',word.size,'white');word.putalpha(a)
  im.alpha_composite(word,(120,70))
 im.save(OUT/f'type-{i:02}.png')

def make_score(total,starts):
 sr=48000;n=int((total+1)*sr);sound=np.zeros((n,2),np.float64);rng=np.random.default_rng(9)
 def add(t,f,seconds,amp=.08,pan=0):
  a=int(t*sr);length=min(int(seconds*sr),n-a)
  if length<=0:return
  x=np.arange(length)/sr;env=(1-np.exp(-x*60))*np.exp(-x*2.0);tone=np.zeros(length)
  for h,g in [(1,1),(2,.25),(3,.10),(4,.035)]:tone+=g*np.sin(2*np.pi*f*h*x)*np.exp(-x*h*.45)
  v=amp*env*tone;sound[a:a+length,0]+=v*(1-pan*.35);sound[a:a+length,1]+=v*(1+pan*.35)
 # Original minimal piano/pulse bed, C-Am-F-G. No copyrighted music samples.
 beat=60/84;chords=[[48,60,64,67],[45,57,60,64],[41,53,57,60],[43,55,59,62]]
 for k in range(int(total/beat)):
  chord=chords[(k//8)%4];note=chord[1+k%3];add(.8+k*beat,440*2**((note-69)/12),3,.032,(-1 if k%2 else 1)*.6)
  if k%4==0:add(.8+k*beat,440*2**((chord[0]-69)/12),4,.038)
 # Handcrafted short air/whoosh at transitions and a small bell at the lamp.
 for at in starts[1:]:
  a=max(0,int((at-.18)*sr));l=int(.55*sr);x=np.arange(l)/sr
  noise=rng.normal(0,1,l);noise=np.convolve(noise,np.ones(18)/18,mode='same')
  v=.018*noise*np.sin(np.pi*x/.55)**2;sound[a:a+l,:]+=v[:,None]
 for t in [starts[4]+1.1,starts[5]+.45]:
  add(t,880,2,.06,-.2);add(t+.09,1318.51,2,.026,.3)
 fade=np.minimum(np.arange(n)/(sr*2),1)*np.minimum((n-np.arange(n))/(sr*3),1);sound*=fade[:,None]
 with wave.open(str(OUT/'score.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes((np.clip(sound,-1,1)*32767).astype('<i2').tobytes())

def render_scene(i,s):
 t=s['seconds'];frames=math.ceil(t*FPS);photo=s['kind'] in ('photo','lamp','family');dark=i==6
 typography(i,s);inputs=[];fs=[]
 if photo:
  im=Image.open(ROOT/'public/demo'/s['photo']).convert('RGB');im=cover(im,(2080,1170));im.save(OUT/f'photo-{i:02}.png')
  inputs+=['-loop','1','-i',str(OUT/f'photo-{i:02}.png')]
  # A continuous dolly-in, plus a lateral drift, rather than holding a slide.
  fs.append(f"[0:v]zoompan=z='1.02+0.00035*on':x='(iw-iw/zoom)/2+10*sin(on/100)':y='(ih-ih/zoom)/2':d={frames}:s=1920x1080:fps=30,format=yuv420p[base]")
  inputs+=['-loop','1','-i',str(OUT/'shade.png')];fs.append('[base][1:v]overlay=0:0[b0]');prev='b0'
 else:
  inputs+=['-loop','1','-i',str(OUT/('stage-dark.png' if dark else 'stage.png'))];fs.append('[0:v]fps=30,format=yuv420p[b0]');prev='b0'
 nextindex=len(inputs)//4 # all current entries are -loop 1 -i path (4 tokens)
 # Actual app video inside a floating phone. The screen always remains the recorded product.
 phone=s['kind'] in ('phone','double','lamp')
 if phone:
  # Index inputs explicitly to keep labels robust across photo/stage layouts.
  vidindex=2 if photo else 1
  inputs+=['-i',str(ROOT/f'out/shot-{s["shot"]:02}.webm')]
  maskindex=vidindex+1;inputs+=['-loop','1','-i',str(OUT/'phone-mask.png')]
  fs.append(f'[{vidindex}:v]crop=390:844:0:0,scale=414:896:flags=lanczos,format=rgba,pad=438:944:12:24:color=0x171C18,tpad=stop_mode=clone:stop_duration=30,trim=duration={t},setpts=PTS-STARTPTS[screen]')
  fs.append(f'[screen][{maskindex}:v]alphamerge[masked]')
  fs.append("[masked]format=rgba,pad=470:960:16:8:color=black@0[phone]")
  shadowindex=maskindex+1;inputs+=['-loop','1','-i',str(OUT/'phone-shadow.png')]
  fs.append(f'[{prev}][{shadowindex}:v]overlay=x=1185:y=35[shadow]')
  fs.append("[shadow][phone]overlay=x='1265+160*exp(-t*4)+18*sin(t*.5)':y='55+85*exp(-t*4)+10*sin(t*.65)':shortest=1[p1]");prev='p1'
  if s['kind']=='double':
   # A second real capture enters from the edge, joining the voice reply and gift flow.
   idx=shadowindex+1;inputs+=['-i',str(ROOT/'out/shot-10.webm')]
   fs.append(f'[{idx}:v]crop=390:844:0:0,scale=300:650:flags=lanczos,pad=316:678:8:14:color=0x171C18,tpad=stop_mode=clone:stop_duration=30,trim=duration={t},setpts=PTS-STARTPTS[second]')
   fs.append("[p1][second]overlay=x='1000+70*exp(-t*3)':y='330+8*sin(t*.65)'[p2]");prev='p2'
  typeindex=len([x for x in inputs if x=='-i'])
 else:typeindex=len([x for x in inputs if x=='-i'])
 inputs+=['-loop','1','-i',str(OUT/f'type-{i:02}.png')]
 fs.append(f'[{typeindex}:v]format=rgba,fade=t=in:st=0.12:d=0.65:alpha=1[copy]')
 fs.append(f"[{prev}][copy]overlay=x='-55*exp(-t*4)':y=0,fade=t=in:st=0:d=0.18,fade=t=out:st={t-.20}:d=0.20,format=yuv420p[final]")
 (OUT/f'filter-{i:02}.txt').write_text(';\n'.join(fs))
 cmd(['ffmpeg','-hide_banner','-loglevel','error','-y','-filter_complex_threads','1',*inputs,'-filter_complex_script',str(OUT/f'filter-{i:02}.txt'),'-map','[final]','-t',str(t),'-an','-c:v','libx264','-preset','veryfast','-crf','21','-r','30','-threads','2',str(OUT/f'scene-{i:02}.mp4')])
 print(f'Scene {i+1:02}: rendered {t:.1f}s',flush=True)

def assemble():
 starts=[];at=0
 for s in SCENES:starts.append(at);at+=s['seconds']
 total=round(at,3);make_score(total,starts)
 (OUT/'concat.txt').write_text(''.join(f"file '{OUT/f'scene-{i:02}.mp4'}'\n" for i in range(len(SCENES))))
 cmd(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',str(OUT/'concat.txt'),'-c','copy',str(OUT/'visuals.mp4')])
 # Separate narration takes keep unhurried sentence delivery and intentional pauses.
 args=[];filters=[]
 for i,start in enumerate(starts):
  args+=['-i',str(OUT/f'vo-{i:02}.mp3')];delay=int((start+.4)*1000)
  filters.append(f'[{i}:a]aresample=48000,adelay={delay}|{delay}[v{i}]')
 filters.append(''.join(f'[v{i}]' for i in range(len(SCENES)))+f'amix=inputs={len(SCENES)}:normalize=0,apad,atrim=duration={total},loudnorm=I=-16:TP=-1.5:LRA=8,aresample=48000[voice]')
 cmd(['ffmpeg','-v','error','-y',*args,'-filter_complex',';'.join(filters),'-map','[voice]','-c:a','pcm_s16le',str(OUT/'narration.wav')])
 # Duck the original score under the narrator. No surprise sound spikes.
 cmd(['ffmpeg','-v','error','-y','-i',str(OUT/'narration.wav'),'-i',str(OUT/'score.wav'),'-filter_complex','[0:a]aformat=channel_layouts=stereo,asplit=2[v][side];[1:a][side]sidechaincompress=threshold=0.015:ratio=5:attack=20:release=400[m];[v][m]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]','-map','[a]','-t',str(total),'-c:a','pcm_s16le',str(OUT/'mix.wav')])
 # Sentence captions are split into short readable phrases within their scene.
 head='''[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,28,&H00FFFFFF,&H00FFFFFF,&H66202020,&H66202020,0,0,0,0,100,100,0,0,3,9,0,2,100,100,26,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
 def ass(t):return f'{int(t)//3600}:{int(t)//60%60:02}:{int(t)%60:02}.{round((t%1)*100):02}'
 def srt(t):
  ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
 lines=[];srts=[];k=1
 for i,(s,start) in enumerate(zip(SCENES,starts)):
  words=s['vo'].split();parts=[' '.join(words[j:j+8]) for j in range(0,len(words),8)]
  for j,part in enumerate(parts):
   a=start+.4+s['voice_seconds']*j/len(parts);b=start+.4+s['voice_seconds']*(j+1)/len(parts)
   lines.append(f'Dialogue: 0,{ass(a)},{ass(b)},Default,,0,0,0,,{part}')
   srts.append(f'{k}\n{srt(a)} --> {srt(b)}\n{part}\n');k+=1
 (OUT/'captions.ass').write_text(head+'\n'.join(lines));(OUT/'nearer-film.srt').write_text('\n'.join(srts))
 (OUT/'nearer-film-script.txt').write_text('\n\n'.join(f'{start:.1f}s  {s["vo"]}' for start,s in zip(starts,SCENES)))
 cmd(['ffmpeg','-v','error','-y','-i',str(OUT/'visuals.mp4'),'-i',str(OUT/'mix.wav'),'-vf',f'ass={OUT}/captions.ass','-map','0:v','-map','1:a','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(total),'-movflags','+faststart',str(OUT/'nearer-film.mp4')])
 cmd(['ffmpeg','-v','error','-y','-i',str(OUT/'mix.wav'),'-c:a','libmp3lame','-b:a','192k',str(OUT/'nearer-film-audio.mp3')])
 (OUT/'film-timeline.json').write_text(json.dumps({'seconds':total,'scenes':SCENES,'starts':starts,'voice':'en-IN-NeerjaNeural','music':'original procedural piano and sound design','visuals':'animated illustrative imagery and actual recorded app interactions; no generated actor footage'},indent=2))
 meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(OUT/'nearer-film.mp4')]))
 video=next(x for x in meta['streams'] if x['codec_type']=='video');audio=next(x for x in meta['streams'] if x['codec_type']=='audio')
 assert video['width']==1920 and video['height']==1080 and video['r_frame_rate']=='30/1'
 assert audio['codec_name']=='aac' and audio['channels']==2
 assert abs(float(meta['format']['duration'])-total)<0.1
 (OUT/'verification.json').write_text(json.dumps({'seconds':total,'bytes':int(meta['format']['size']),'video':'1920x1080 H.264 at 30fps','audio':'AAC stereo, narration plus original score and effects','people':'synthetic still images, animated camera','app':'actual recorded interactions','paid_services_used':False},indent=2))
 print(f'Completed narrated film: {total:.1f}s',flush=True)

def main():
 os.chdir(ROOT);setup_assets();asyncio.run(narrate())
 for i,s in enumerate(SCENES):render_scene(i,s)
 assemble()
if __name__=='__main__':main()
