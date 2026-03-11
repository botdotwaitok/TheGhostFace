"""
塔罗牌图片压缩脚本
- 将原图备份到 originals/ 子文件夹
- 缩小到最大宽度 400px（保持比例）
- JPEG 质量 75
"""

import os
import shutil
from PIL import Image

# ===== 配置 =====
MAX_WIDTH = 400        # 最大宽度（像素）
JPEG_QUALITY = 75      # JPEG 质量 (1-95)
BACKUP_DIR = "originals"
# =================

script_dir = os.path.dirname(os.path.abspath(__file__))
backup_path = os.path.join(script_dir, BACKUP_DIR)
os.makedirs(backup_path, exist_ok=True)

jpg_files = [f for f in os.listdir(script_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
jpg_files.sort()

total_before = 0
total_after = 0

print(f"找到 {len(jpg_files)} 张图片，开始压缩...\n")

for filename in jpg_files:
    src = os.path.join(script_dir, filename)
    bak = os.path.join(backup_path, filename)

    # 备份原图
    if not os.path.exists(bak):
        shutil.copy2(src, bak)

    size_before = os.path.getsize(src)
    total_before += size_before

    # 打开并压缩
    img = Image.open(src)
    w, h = img.size

    # 按比例缩小
    if w > MAX_WIDTH:
        ratio = MAX_WIDTH / w
        new_w = MAX_WIDTH
        new_h = int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    # 确保是 RGB 模式（JPEG 不支持 RGBA）
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # 保存压缩后的图片
    img.save(src, 'JPEG', quality=JPEG_QUALITY, optimize=True)

    size_after = os.path.getsize(src)
    total_after += size_after

    reduction = (1 - size_after / size_before) * 100
    print(f"  {filename}: {size_before/1024:.0f}KB -> {size_after/1024:.0f}KB  (-{reduction:.1f}%)")

print(f"\n{'='*50}")
print(f"总计: {total_before/1024/1024:.1f}MB -> {total_after/1024/1024:.1f}MB")
print(f"节省: {(total_before-total_after)/1024/1024:.1f}MB ({(1-total_after/total_before)*100:.1f}%)")
print(f"\n原图已备份到: {backup_path}")
