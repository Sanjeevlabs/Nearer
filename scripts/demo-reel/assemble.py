#!/usr/bin/env python3
"""Exact 90-second portrait edit with crossfades, captions and end card."""
import json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'out'

def run(args):subprocess.run(args,check=True)

def main():
 shots=json.loads((OUT/'shots.json').read_text()); inputs=[]; filters=[];offset=0
 # Each clip includes a 300ms outgoing handle. Overlap removes handles, not story time.
 for i,shot in enumerate(shots):
  inputs+=['-i',str(OUT/f'shot-{i+1:02}.webm')]
  sec=shot['seconds']+(.3 if i<len(shots)-1 else 0)
  filters.append(f'[{i}:v]fps=30,crop=390:844:0:0,scale=820:1774:flags=lanczos,pad=1080:1920:130:26:color=0xF7F5F1,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=20,trim=duration={sec},settb=AVTB,setpts=PTS-STARTPTS[v{i}]')
 prev='v0'
 for i in range(1,len(shots)):
  offset+=shots[i-1]['seconds'];label=f'x{i}'
  filters.append(f'[{prev}][v{i}]xfade=transition=fade:duration=0.3:offset={offset}[{label}]');prev=label
 header="""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,44,&H00FFFFFF,&H00FFFFFF,&H6621201C,&H6621201C,0,0,0,0,100,100,0,0,3,13,0,2,70,70,32,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
 at=0;events=[]
 def ts(t):return f'{t//3600}:{t//60%60:02}:{t%60:02}.00'
 for shot in shots:
  if shot['caption']:
   caption=shot['caption'].replace(chr(10),r'\N')
   events.append(f"Dialogue: 0,{ts(at)},{ts(at+shot['seconds'])},Default,,0,0,0,,{caption}")
  at+=shot['seconds']
 (OUT/'captions.ass').write_text(header+'\n'.join(events)+'\n')
 filters.append(f"[{prev}]ass=out/captions.ass,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Synthetic family · recorded in mock mode':fontsize=18:fontcolor=0x66625C:x=(w-tw)/2:y=4[final]")
 (OUT/'edit-filter.txt').write_text(';\n'.join(filters))
 run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-filter_complex_threads','1',*inputs,'-filter_complex_script',str(OUT/'edit-filter.txt'),'-map','[final]','-an','-c:v','libx264','-preset','fast','-crf','23','-maxrate','1550k','-bufsize','3100k','-pix_fmt','yuv420p','-r','30','-t','90','-movflags','+faststart',str(OUT/'nearer-demo.mp4')])
 meta=json.loads(subprocess.check_output(['ffprobe','-v','quiet','-show_streams','-show_format','-of','json',str(OUT/'nearer-demo.mp4')]))
 v=next(x for x in meta['streams'] if x['codec_type']=='video')
 assert (v['width'],v['height'],v['codec_name'],v['r_frame_rate'])==(1080,1920,'h264','30/1'),v
 assert 88<=float(meta['format']['duration'])<=92
 assert (OUT/'nearer-demo.mp4').stat().st_size<=20_000_000
 assert not any(x['codec_type']=='audio' for x in meta['streams'])
 (OUT/'verification.json').write_text(json.dumps({'duration':meta['format']['duration'],'bytes':int(meta['format']['size']),'width':v['width'],'height':v['height'],'codec':v['codec_name'],'fps':v['r_frame_rate'],'audio':False,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'family':'synthetic demo only','store_requests':'blocked; preview only'},indent=2))
 # Five frames from the actual finished video, including rendered captions.
 canvas=Image.new('RGB',(1180,540),'#F7F5F1');draw=ImageDraw.Draw(canvas);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
 for i,t in enumerate([10,29,44,61,79]):
  frame=OUT/f'contact-{i}.png';run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(OUT/'nearer-demo.mp4'),'-frames:v','1',str(frame)])
  im=Image.open(frame).convert('RGB');im.thumbnail((216,440));x=16+i*234;canvas.paste(im,(x,42));draw.text((x+10,503),f'{t//60}:{t%60:02}',font=font,fill='#262421')
 canvas.save(OUT/'contact.png');print('Verified: 90s, 1080x1920, H.264, 30fps, under 20MB, silent.',flush=True)
if __name__=='__main__':main()
