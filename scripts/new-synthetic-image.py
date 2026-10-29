from PIL import Image, ImageDraw, ImageFont
image=Image.new('RGB',(1400,100),'white')
ImageDraw.Draw(image).text((12,15),'오늘 식사는 세 번 했고 약을 빠뜨리지 않았습니다.',font=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',36),fill='black')
image.save('scripts/new-synthetic.png')
