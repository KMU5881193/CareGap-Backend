from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
Path('.runtime').mkdir(exist_ok=True)
texts=['오늘 식사는 세 번 했고 약을 빠뜨리지 않았습니다.','오늘 식사는 두 번 했고 외출은 주 한 번 했습니다.']
for i,text in enumerate(texts):
    im=Image.new('RGB',(1400,100),'white')
    ImageDraw.Draw(im).text((12,15),text,font=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',36),fill='black')
    im.save(f'.runtime/person-{i}-synthetic.png')
im=Image.new('RGB',(600,420),'#f5f1e8');d=ImageDraw.Draw(im)
d.text((20,15),'SYNTHETIC DEMO - NO REAL PERSON',fill='black')
d.rectangle((70,130,530,350),fill='#bd9065');d.ellipse((210,170,390,320),fill='white',outline='black',width=4)
d.ellipse((240,205,275,250),fill='#559449');d.ellipse((290,210,345,270),fill='#df7442')
d.rectangle((100,180,140,260),fill='#75b6d5',outline='black',width=3)
im.save('.runtime/vision-synthetic.png');im.save('.runtime/vision-synthetic.jpg')
