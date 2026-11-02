#!/usr/bin/env python3
"""58-second cinematic family story with explicit, verified full-length audio."""
import asyncio, hashlib, json, math, os, subprocess, wave
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps,ImageFilter
import edge_tts,edge_tts.communicate
import film
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'out/movie58';OUT.mkdir(parents=True,exist_ok=True)
FPS=30;TOTAL=58.0
SCENES=[
 (6.0,'photo','home-balcony.jpg',None,'A new life.\nA part of you stays home.','You move away to build a life. But part of you stays home.'),
 (6.0,'photo','home-window.jpg',None,'The moments\na call can’t hold.','With your parents. In the little moments a weekly call cannot hold.'),
 (5.5,'phone','home-window.jpg',2,'A window between\nyour two homes.','Nearer is a window between your two homes.'),
 (5.5,'phone','lamp-lit.jpg',4,'I’m thinking of you.','See their day. Light a lamp. I am thinking of you.'),
 (6.0,'phone','family-group.webp',6,'Her voice.\nHer place in your life.','Hear her voice. Keep her stories. Let her know she is needed.'),
 (6.0,'phone','home-courtyard.jpg',13,'Trusted nearby.\nPeople you can call.','Care keeps trusted nearby people and local contacts within reach.'),
 (6.0,'phone','home-window.jpg',10,'Groceries. Sweets.\nA little piece of home.','Send something brings groceries and sweets to their home.'),
 (6.0,'photo','family-group.webp',None,'Small things.\nCloser together.','Small gestures can make the distance feel smaller.'),
 (5.5,'photo','family-dadi.webp',None,'Do something\nthat matters.','You cannot always be there. You can still make a difference.'),
 (5.5,'end','family-group.webp',None,'Far from home,\nnever far from them.','Nearer. Far from home, never far from them.'),
]
def run(a):subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y']+a,check=True,stdin=subprocess.DEVNULL)
def probe(p):return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)]))
def dur(p):return float(probe(p)['format']['duration'])
def font(n,b=False):return ImageFont.truetype(film.BOLD if b else film.FONT,n)
def cover(im,size):return ImageOps.fit(im,size,method=Image.Resampling.LANCZOS)
async def voices():
 if os.getenv('SSL_CERT_FILE'):edge_tts.communicate._SSL_CTX.load_verify_locations(cafile=os.environ['SSL_CERT_FILE'])
 sem=asyncio.Semaphore(3)
 async def one(i,s):
  async with sem:
   h=hashlib.sha256(s[5].encode()).hexdigest()[:10];path=OUT/f'voice-{h}.mp3'
   if not path.exists() or path.stat().st_size<100:await edge_tts.Communicate(s[5],'en-IN-NeerjaNeural',rate='+12%',proxy=os.environ.get('HTTPS_PROXY')).save(str(path))
   run(['-i',str(path),'-ar','48000','-ac','1','-c:a','pcm_s16le',str(OUT/f'voice-{i:02}.wav')])
   d=dur(OUT/f'voice-{i:02}.wav');limit=s[0]-.55
   if d>limit:
    ratio=d/limit;assert ratio<1.2,(i,d,limit)
    run(['-i',str(OUT/f'voice-{i:02}.wav'),'-af',f'atempo={ratio}',str(OUT/f'adjusted-{i:02}.wav')]);os.replace(OUT/f'adjusted-{i:02}.wav',OUT/f'voice-{i:02}.wav')
   print(f'Voice {i+1}: {dur(OUT/f"voice-{i:02}.wav"):.2f}s / {s[0]:.1f}s',flush=True)
 await asyncio.gather(*(one(i,s) for i,s in enumerate(SCENES)))
def assets():
 film.OUT=OUT;film.setup_assets()
 mask=Image.new('L',(340,733));ImageDraw.Draw(mask).rounded_rectangle((0,0,339,732),42,fill=255);mask.save(OUT/'mask.png')
 shade=Image.new('RGBA',(1920,1080));a=np.zeros((1080,1920,4),np.uint8);a[:,:,:3]=[3,9,9];a[:,:,3]=(205*(1-np.arange(1920)/2400)).astype(np.uint8)[None,:];Image.fromarray(a).save(OUT/'shade.png')
 bars=Image.new('RGBA',(1920,1080));d=ImageDraw.Draw(bars);d.rectangle((0,0,1920,138),fill='black');d.rectangle((0,942,1920,1080),fill='black');d.text((80,1034),'Illustrative family · real app demo',font=font(17),fill='#7F8783');bars.save(OUT/'bars.png')
 for i,s in enumerate(SCENES):
  im=cover(Image.open(ROOT/'public/demo'/s[2]).convert('RGB'),(2304,1296))
  if s[1] in ('phone','end'):im=im.filter(ImageFilter.GaussianBlur(12 if s[1]=='phone' else 22))
  im.save(OUT/f'bg-{i:02}.jpg',quality=96)
  layer=Image.new('RGBA',(1920,1080));d=ImageDraw.Draw(layer)
  if s[1]=='end':
   mark=Image.open(OUT/'mark.png').convert('RGBA');mark.thumbnail((140,140));layer.alpha_composite(mark,((1920-mark.width)//2,230))
   word=Image.open(OUT/'wordmark.png').convert('RGBA');word.thumbnail((390,90));alpha=word.getchannel('A');word=Image.new('RGBA',word.size,'white');word.putalpha(alpha);layer.alpha_composite(word,((1920-word.width)//2,420))
   d.multiline_text((960,580),s[4],font=font(45),fill='white',align='center',anchor='ma',spacing=12);d.text((960,795),'nearer.site',font=font(29),fill='#F1C77C',anchor='ma')
  else:
   if i in (5,6):d.text((150,270),'CARE' if i==5 else 'SEND SOMETHING',font=font(22,True),fill='#F1C77C')
   size=68 if i==0 else 74
   d.multiline_text((150,350),s[4],font=font(size,True),fill='white',spacing=20)
   if i==5:d.text((150,600),'Your trusted circle. Local contacts.',font=font(26),fill='#CED3CA')
   if i==6:d.text((150,600),'Groceries and sweets · sample suggestions',font=font(26),fill='#CED3CA')
   word=Image.open(OUT/'wordmark.png').convert('RGBA');word.thumbnail((135,30));alpha=word.getchannel('A');word=Image.new('RGBA',word.size,'white');word.putalpha(alpha);layer.alpha_composite(word,(150,190))
  layer.save(OUT/f'type-{i:02}.png')
def render(i,s):
 sec=s[0];frames=round(sec*30);inputs=['-loop','1','-i',str(OUT/f'bg-{i:02}.jpg'),'-loop','1','-i',str(OUT/'shade.png')]
 fs=[f"[0:v]zoompan=z='1.01+0.00045*on':x='(iw-iw/zoom)/2+12*sin(on/80)':y='(ih-ih/zoom)/2':d={frames}:s=1920x1080:fps=30,eq=contrast=1.045:saturation=0.88:brightness=-0.02,colorbalance=bs=0.025:rs=0.025[bg]",'[bg][1:v]overlay=0:0[dark]'];prev='dark'
 if s[1]=='phone':
  start={2:.7,4:.6,6:2.2,13:1.5,10:2.2}[s[3]]
  inputs+=['-ss',str(start),'-i',str(ROOT/f'out/shot-{s[3]:02}.webm'),'-loop','1','-i',str(OUT/'mask.png')]
  fs+=['[2:v]crop=390:844:0:0,scale=320:693:flags=lanczos,format=rgba,pad=340:733:10:20:color=0x111714,tpad=stop_mode=clone:stop_duration=20,setpts=PTS-STARTPTS[screen]','[screen][3:v]alphamerge[phone]',"[dark][phone]overlay=x='1370+180*exp(-t*4)':y='178+8*sin(t*.6)':shortest=1[device]"];prev='device'
 idx=inputs.count('-i');inputs+=['-loop','1','-i',str(OUT/f'type-{i:02}.png')]
 fs+=[f'[{idx}:v]format=rgba,fade=t=in:st=0.18:d=0.7:alpha=1[words]',f"[{prev}][words]overlay=x='-45*exp(-t*3)':y=0[typed]"]
 idx=inputs.count('-i');inputs+=['-loop','1','-i',str(OUT/'bars.png')]
 fs+=[f'[typed][{idx}:v]overlay=0:0,noise=alls=2:allf=t,fade=t=in:st=0:d=0.18,fade=t=out:st={sec-.18}:d=0.18,format=yuv420p[final]']
 (OUT/f'filter-{i:02}.txt').write_text(';'.join(fs))
 run(['-filter_complex_threads','1',*inputs,'-filter_complex_script',str(OUT/f'filter-{i:02}.txt'),'-map','[final]','-t',str(sec),'-an','-c:v','libx264','-crf','20','-preset','veryfast','-r','30','-threads','2',str(OUT/f'scene-{i:02}.mp4')]);print(f'Scene {i+1} rendered',flush=True)
def writewave(path,a,sr=48000):
 with wave.open(str(path),'wb') as f:f.setnchannels(1 if a.ndim==1 else a.shape[1]);f.setsampwidth(2);f.setframerate(sr);f.writeframes((np.clip(a,-.98,.98)*32767).astype('<i2').tobytes())
 assert abs(dur(path)-TOTAL)<.05,(str(path),dur(path))
def mix_audio():
 sr=48000;voice=np.zeros(round(TOTAL*sr));starts=[];at=0
 for i,s in enumerate(SCENES):
  starts.append(at)
  with wave.open(str(OUT/f'voice-{i:02}.wav')) as f:a=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float64)/32768
  # Preserve the whole sentence, and establish audible speech independently in every scene.
  rms=np.sqrt(np.mean(a*a));assert rms>.005,(i,rms)
  a*=min(2.0,.15/max(.01,rms));a=np.tanh(a*1.1)/1.1
  begin=round((at+.25)*sr);voice[begin:begin+len(a)]+=a[:len(voice)-begin];at+=s[0]
 writewave(OUT/'nearer-voice-full.wav',voice)
 film.OUT=OUT;film.make_score(TOTAL,starts)
 with wave.open(str(OUT/'score.wav')) as f:music=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').reshape(-1,2).astype(np.float64)/32768
 music=music[:len(voice)]*.65
 activity=(np.abs(voice)>.01).astype(float);cs=np.cumsum(np.r_[np.zeros(12000),activity]);envelope=(cs[12000:]-cs[:-12000])/12000;music*=np.maximum(.25,1-envelope*.7)[:,None]
 mixed=voice[:,None]+music;peak=np.max(np.abs(mixed));mixed*=min(1.3,.89/max(peak,.001));writewave(OUT/'nearer-mix-full.wav',mixed)
 run(['-i',str(OUT/'nearer-voice-full.wav'),'-ar','44100','-ac','1','-c:a','libmp3lame','-b:a','192k',str(OUT/'nearer-voice-only.mp3')])
 run(['-i',str(OUT/'nearer-mix-full.wav'),'-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','192k',str(OUT/'nearer-movie-audio.mp3')])
 return starts
def assemble(starts):
 (OUT/'concat.txt').write_text(''.join(f"file '{OUT/f'scene-{i:02}.mp4'}'\n" for i in range(len(SCENES))))
 run(['-f','concat','-safe','0','-i',str(OUT/'concat.txt'),'-c','copy',str(OUT/'visuals.mp4')])
 head='''[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,29,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,140,140,62,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
 def ts(t):
  c=round(t*100);return f'{c//360000}:{c//6000%60:02}:{c//100%60:02}.{c%100:02}'
 lines=[];narr=[]
 for i,(s,start) in enumerate(zip(SCENES,starts)):
  words=s[5].split();parts=[' '.join(words[k:k+8]) for k in range(0,len(words),8)];length=dur(OUT/f'voice-{i:02}.wav')
  for j,text in enumerate(parts):
   a=start+.25+j*length/len(parts);b=start+.25+(j+1)*length/len(parts);lines.append(f'Dialogue: 0,{ts(a)},{ts(b)},Default,,0,0,0,,{text}')
  narr.append(f'{start:.1f}–{start+s[0]:.1f}s  {s[5]}')
 (OUT/'captions.ass').write_text(head+'\n'.join(lines));(OUT/'nearer-movie-script.txt').write_text('\n\n'.join(narr))
 run(['-i',str(OUT/'visuals.mp4'),'-i',str(OUT/'nearer-mix-full.wav'),'-vf',f'ass={OUT}/captions.ass','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-profile:a','aac_low','-ar','48000','-ac','2','-b:a','192k','-disposition:a:0','default','-t',str(TOTAL),'-movflags','+faststart',str(OUT/'nearer-movie-58s.mp4')])
 run(['-i',str(OUT/'nearer-mix-full.wav'),'-c:a','aac','-profile:a','aac_low','-ar','48000','-ac','2','-b:a','192k','-movflags','+faststart',str(OUT/'nearer-movie-audio.m4a')])
 meta=probe(OUT/'nearer-movie-58s.mp4');a=next(x for x in meta['streams'] if x['codec_type']=='audio');v=next(x for x in meta['streams'] if x['codec_type']=='video')
 assert abs(float(meta['format']['duration'])-58)<.05
 assert a['sample_rate']=='48000' and a['channels']==2 and a['codec_name']=='aac'
 assert v['width']==1920 and v['height']==1080
 # Decode exported speech and check every narrated scene, including the final line.
 raw=subprocess.check_output(['ffmpeg','-nostdin','-v','error','-i',str(OUT/'nearer-voice-only.mp3'),'-f','f32le','-ar','48000','-ac','1','pipe:1'],stdin=subprocess.DEVNULL);audio=np.frombuffer(raw,dtype='<f4');checks=[]
 for i,(s,start) in enumerate(zip(SCENES,starts)):
  clip=audio[round((start+.3)*48000):round((start+s[0]-.2)*48000)];rms=float(np.sqrt(np.mean(clip**2)));assert rms>.025,(i,rms);checks.append({'scene':i+1,'voice_rms':round(rms,4)})
 report={'seconds':58,'video':'1920x1080 H.264, 30fps, cinematic 2.39:1 framing','audio':'AAC-LC, 48 kHz, stereo, default enabled','bytes':int(meta['format']['size']),'narration_complete_in_every_scene':checks,'send_something':'groceries and sweets','care':'trusted nearby people and local contacts','paid_services_used':False,'people':'synthetic still photographs; camera and graphics are animated'}
 (OUT/'verification.json').write_text(json.dumps(report,indent=2));print('Verified: 58 seconds, narration in all ten scenes, AAC-LC stereo at 48kHz.',flush=True)
def main():
 os.chdir(ROOT);assert sum(x[0] for x in SCENES)==58
 assets();asyncio.run(voices());starts=mix_audio()
 for i,s in enumerate(SCENES):render(i,s)
 assemble(starts)
if __name__=='__main__':main()
