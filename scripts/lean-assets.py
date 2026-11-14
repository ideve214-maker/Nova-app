# 热更新精简包：在临时目录里压缩图片、去掉重复的皮肤 logo（原始 assets/ 不改）。
import hashlib, json, os, sys
from PIL import Image
stage = sys.argv[1]
A = os.path.join(stage, 'assets')
def h(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
brand = {}
bd = os.path.join(A, 'brand')
if os.path.isdir(bd):
    for f in os.listdir(bd): brand[h(os.path.join(bd, f))] = f
# 1) 皮肤里与品牌图完全相同的 logo：改为引用 ../../brand/<文件>
sk = os.path.join(A, 'skins')
for d in sorted(os.listdir(sk)) if os.path.isdir(sk) else []:
    js = os.path.join(sk, d, 'skin.json')
    if not os.path.isfile(js): continue
    meta = json.load(open(js, encoding='utf-8')); changed = False
    for k, v in list(meta.items()):
        if not isinstance(v, str): continue
        p = os.path.join(sk, d, v)
        if not os.path.isfile(p): continue
        hp = h(p)
        if hp in brand:
            os.remove(p); meta[k] = '../../brand/' + brand[hp]; changed = True
    if changed: json.dump(meta, open(js, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
# 2) 压缩大图（尺寸上限 + PNG 调色板量化 / JPEG 质量 82），只在变小时替换
saved = 0
for dp, _, fs in os.walk(A):
    for f in fs:
        p = os.path.join(dp, f); ext = f.lower().rsplit('.', 1)[-1]
        if ext not in ('png', 'jpg', 'jpeg') or os.path.getsize(p) < 30000: continue
        before = os.path.getsize(p); tmp = p + '.tmp'
        im = Image.open(p); im.load()
        lim = 1100 if f.startswith('pay-') else 1024
        if max(im.size) > lim:
            r = lim / max(im.size); im = im.resize((max(1, round(im.size[0]*r)), max(1, round(im.size[1]*r))), Image.LANCZOS)
        if ext == 'png':
            q = im.convert('RGBA').quantize(256, method=Image.Quantize.FASTOCTREE) if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB').quantize(256)
            q.save(tmp, 'PNG', optimize=True)
        else:
            im.convert('RGB').save(tmp, 'JPEG', quality=82, optimize=True, progressive=True)
        if os.path.getsize(tmp) < before: os.replace(tmp, p); saved += before - os.path.getsize(p)
        else: os.remove(tmp)
print('lean: images saved', saved, 'bytes')
