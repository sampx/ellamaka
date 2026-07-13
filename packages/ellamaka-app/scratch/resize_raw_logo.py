import os
from PIL import Image

source_path = "/Users/sam/.gemini/antigravity-ide/brain/e009b180-5a37-4597-aba3-70416cbce33f/ellamaka_logo_raw_1783919152302.png"
public_dir = "/Volumes/U500G/coding/wopal-workspace/projects/ellamaka/packages/ellamaka-app/public"

# 1. 跑色彩抠图，清除背景棋盘格
img = Image.open(source_path).convert("RGBA")
width, height = img.size
data = img.getdata()
new_data = []

for item in data:
    r, g, b, a = item
    diff = max(r, g, b) - min(r, g, b)
    brightness = (r + g + b) // 3
    
    if diff < 16 and (70 < brightness < 185 or brightness > 240):
        new_data.append((0, 0, 0, 0))
    else:
        if diff < 32:
            alpha = int((diff / 32) * 255)
            new_data.append((r, g, b, alpha))
        else:
            new_data.append((r, g, b, 255))

clean_large_img = Image.new("RGBA", img.size)
clean_large_img.putdata(new_data)

# 2. 核心优化：利用 getbbox() 自动剪裁掉大图四周的大量透明留白 (Autocrop)
# 这使得圆形 Logo 本体能 100% 铺满正方形尺寸，彻底解决浏览器 Tab 上“显得像个小圆点”的留白过大问题
bbox = clean_large_img.getbbox()
cropped_img = clean_large_img.crop(bbox)

# 重新调整为正方形画布，防止非正方形裁剪导致缩放变形
crop_w, crop_h = cropped_img.size
max_side = max(crop_w, crop_h)
square_img = Image.new("RGBA", (max_side, max_side), (0, 0, 0, 0))
offset_x = (max_side - crop_w) // 2
offset_y = (max_side - crop_h) // 2
square_img.paste(cropped_img, (offset_x, offset_y))

# 3. 导出 100% 满画幅无损缩放 PNG
sizes = {
    "favicon-96x96-v3.png": (96, 96),
    "favicon-96x96.png": (96, 96),
    "apple-touch-icon-v3.png": (180, 180),
    "apple-touch-icon.png": (180, 180),
    "web-app-manifest-192x192.png": (192, 192),
    "web-app-manifest-512x512.png": (512, 512),
}

for name, size in sizes.items():
    out_path = os.path.join(public_dir, name)
    resized = square_img.resize(size, Image.Resampling.LANCZOS)
    resized.save(out_path, "PNG")
    print(f"Cropped & Resized saved {name}")

# 4. 导出 ICO
ico_sizes = [(16, 16), (32, 32), (48, 48)]
ico_imgs = [square_img.resize(s, Image.Resampling.LANCZOS) for s in ico_sizes]
for name in ["favicon-v3.ico", "favicon.ico"]:
    out_path = os.path.join(public_dir, name)
    square_img.save(out_path, format="ICO", sizes=ico_sizes, append_images=ico_imgs)
    print(f"Cropped & Resized saved {name}")

# 5. 导出 1200x630 社交大图 (等比例 1:1 标志贴在纯黑背景正中央)
for name in ["social-share.png", "social-share-zen.png"]:
    out_path = os.path.join(public_dir, name)
    social_bg = Image.new("RGBA", (1200, 630), (0, 0, 0, 255))
    logo_size = 400
    logo_resized = square_img.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    x = (1200 - logo_size) // 2
    y = (630 - logo_size) // 2
    social_bg.paste(logo_resized, (x, y), logo_resized)
    social_bg.convert("RGB").save(out_path, "PNG")
    print(f"Generated {name}")
