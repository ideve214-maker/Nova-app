#!/usr/bin/env python3
"""Build 星澜 Xinglan brand icons and splash screens for user + admin apps."""
from __future__ import annotations
from pathlib import Path
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = Path("/workspace/nova-theme/brand")
FONT = TTCollection("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc").fonts[2]
GS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPEM = FONT["head"].unitsPerEm  # 1000
ASC = FONT["OS/2"].sTypoAscender  # 880
DESC = FONT["OS/2"].sTypoDescender  # -120

# ─── shared mark (星澜: nova spark + tide) ────────────────────────────────
def mark(pid: str, fill_star="#8BA3FF", fill_core="#C5D0FF", stroke_wave="#6E8BFF") -> str:
    return f'''<g id="{pid}-mark" fill-rule="evenodd">
  <defs>
    <linearGradient id="{pid}-star" x1="32" y1="2" x2="32" y2="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#F0F3FF"/>
      <stop offset=".35" stop-color="#C5D0FF"/>
      <stop offset=".75" stop-color="#8BA3FF"/>
      <stop offset="1" stop-color="#5B74F2"/>
    </linearGradient>
    <linearGradient id="{pid}-wave" x1="6" y1="48" x2="58" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4ECDC4"/>
      <stop offset=".5" stop-color="#6E8BFF"/>
      <stop offset="1" stop-color="#A8BAFF"/>
    </linearGradient>
  </defs>
  <!-- main 4-point nova -->
  <path fill="url(#{pid}-star)" d="M32 2.8
    C33.35 16.4 36.1 22.7 48.2 25.15
    C36.1 27.6 33.35 33.9 32 47.5
    C30.65 33.9 27.9 27.6 15.8 25.15
    C27.9 22.7 30.65 16.4 32 2.8Z"/>
  <!-- diagonal inner spark, forming an 8-point nova -->
  <path fill="url(#{pid}-star)" opacity=".92" transform="rotate(45 32 25.15)" d="M32 12.2
    C32.7 18.5 34.4 21.7 41.2 23.15
    C34.4 24.6 32.7 27.8 32 34.1
    C31.3 27.8 29.6 24.6 22.8 23.15
    C29.6 21.7 31.3 18.5 32 12.2Z"/>
  <!-- star dust -->
  <circle cx="11.5" cy="12.5" r="1.2" fill="#A8BAFF" opacity=".9"/>
  <circle cx="53" cy="11" r=".85" fill="#F0F3FF" opacity=".95"/>
  <circle cx="54.5" cy="21.5" r="1.05" fill="#6E8BFF" opacity=".8"/>
  <circle cx="9.5" cy="23" r=".7" fill="#4ECDC4" opacity=".75"/>
  <!-- double tide -->
  <path fill="none" stroke="url(#{pid}-wave)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        d="M7.5 48.2c6.8-5.6 13-5.6 19.6 0s13 5.6 19.6 0 10.2-5.3 11.3-5"/>
  <path fill="none" stroke="url(#{pid}-wave)" stroke-width="1.7" stroke-linecap="round" opacity=".55"
        d="M11.5 55.4c5.7-4.3 11.4-4.3 17.1 0s11.4 4.3 17.1 0 8.6-4.1 9.6-3.9"/>
</g>'''


def text_items(text: str, tracking: float = 0.0):
    """Return list of (path_d, width, bounds) in font units, plus total width."""
    items = []
    x = 0
    for ch in text:
        name = CMAP[ord(ch)]
        g = GS[name]
        pen = SVGPathPen(GS)
        g.draw(pen)
        bp = BoundsPen(GS)
        g.draw(bp)
        items.append((pen.getCommands(), g.width, bp.bounds, x))
        x += g.width + tracking
    return items, x


def text_group(text: str, size: float, fill: str, tracking_em: float = 0.0,
               y_baseline: float = 0, x_left: float = 0, opacity: float = 1) -> tuple[str, float, tuple]:
    """SVG group, advance width in svg units, tight bounds (x,y,w,h) in svg units.
    Baseline at y_baseline, left at x_left. Font y-up flipped."""
    tracking = tracking_em * UPEM
    items, total = text_items(text, tracking)
    s = size / UPEM
    # tight bounds in font units
    minx = min(b[0] + ox for _, _, b, ox in items)
    maxx = max(b[2] + ox for _, _, b, ox in items)
    miny = min(b[1] for _, _, b, _ in items)
    maxy = max(b[3] for _, _, b, _ in items)
    parts = []
    op = f' opacity="{opacity}"' if opacity != 1 else ""
    for d, w, b, ox in items:
        parts.append(f'<path fill="{fill}"{op} d="{d}" transform="translate({ox} 0)"/>')
    # translate to x_left, y_baseline and scale
    g = (f'<g transform="translate({x_left:.2f} {y_baseline:.2f}) scale({s:.6f} {-s:.6f})">'
         + "".join(parts) + "</g>")
    width = total * s
    # bounds in svg: x = x_left + minx*s, y = y_baseline - maxy*s
    bx = x_left + minx * s
    by = y_baseline - maxy * s
    bw = (maxx - minx) * s
    bh = (maxy - miny) * s
    return g, width, (bx, by, bw, bh)


def stars_bg(n=22, seed=7, w=1170, h=2532, color="#8BA3FF", max_r=1.8, ymin=80, ymax=None):
    import random
    rng = random.Random(seed)
    ymax = ymax or int(h * 0.72)
    out = []
    for i in range(n):
        x = rng.uniform(40, w - 40)
        y = rng.uniform(ymin, ymax)
        r = rng.uniform(0.5, max_r)
        o = rng.uniform(0.25, 0.85)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{color}" opacity="{o:.2f}"/>')
    return "\n".join(out)


# ─── ICON SVGs (1024, full-bleed square — OS applies the mask) ─────────────
def icon_user_svg() -> str:
    m = mark("iu")
    # mark 64 units, scale so it's ~68% of 1024 ≈ 696, scale = 696/64 = 10.875
    # visual center of mark ≈ (32, 30); place at (512, 500) slightly above middle
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="NOVA">
  <title>NOVA 用户端图标 · 星澜</title>
  <defs>
    <linearGradient id="iu-bg" x1="160" y1="0" x2="900" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1C2750"/>
      <stop offset=".42" stop-color="#0E1328"/>
      <stop offset="1" stop-color="#06070D"/>
    </linearGradient>
    <radialGradient id="iu-glow" cx="50%" cy="34%" r="58%">
      <stop offset="0" stop-color="#6E8BFF" stop-opacity=".48"/>
      <stop offset=".55" stop-color="#6E8BFF" stop-opacity=".10"/>
      <stop offset="1" stop-color="#6E8BFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#iu-bg)"/>
  <rect width="1024" height="1024" fill="url(#iu-glow)"/>
  <!-- faint top sheen -->
  <rect width="1024" height="420" fill="url(#iu-glow)" opacity=".5"/>
  <g transform="translate(512 500) scale(10.9) translate(-32 -30)">
    {m}
  </g>
</svg>
'''


def icon_admin_svg() -> str:
    m = mark("ia")
    # 管理端 — large, tight, optically centered in the banner
    # Banner: y=724 to 1024 (300px). Text cap ~ 200px. Center vertically in banner.
    # Font size: 210. CJK tight height ≈ (857+91)/1000*210 ≈ 199. Banner 300, pad 50.
    size = 215
    tracking = -0.04  # slightly tight
    # we'll compute width then center
    _, width, bounds = text_group("管理端", size, "#FFFFFF", tracking_em=tracking, y_baseline=0, x_left=0)
    # bounds: (bx, by, bw, bh) relative to baseline 0 — by is negative-of-maxy
    bw = bounds[3]  # wait (bx,by,bw,bh)
    bx, by, bw, bh = bounds
    # We want the tight box centered in banner 724–1024, and horizontally in 1024.
    # tight center x should be 512: x_left such that bx + bw/2 = 512
    # If x_left=0, tight center is bx+bw/2. So x_left = 512 - (bx+bw/2)
    x_left = 512 - (bx + bw / 2)
    # vertical: tight center at 724+300/2=874. tight center y = y_baseline + (by + bh/2)
    # by is at y_baseline=0. y_baseline + by + bh/2 = 874 → y_baseline = 874 - by - bh/2
    y_base = 874 - by - bh / 2
    tg, _, _ = text_group("管理端", size, "#FFFFFF", tracking_em=tracking,
                          y_baseline=y_base, x_left=x_left)
    # slight stroke to hold weight at small sizes — applied as a second pass in a group
    tg_stroke, _, _ = text_group("管理端", size, "#FFFFFF", tracking_em=tracking,
                                 y_baseline=y_base, x_left=x_left)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="NOVA 管理端">
  <title>NOVA 管理端图标 · 星澜</title>
  <defs>
    <linearGradient id="ia-bg" x1="160" y1="0" x2="900" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1C2750"/>
      <stop offset=".42" stop-color="#0E1328"/>
      <stop offset="1" stop-color="#06070D"/>
    </linearGradient>
    <radialGradient id="ia-glow" cx="50%" cy="28%" r="58%">
      <stop offset="0" stop-color="#6E8BFF" stop-opacity=".48"/>
      <stop offset=".55" stop-color="#6E8BFF" stop-opacity=".10"/>
      <stop offset="1" stop-color="#6E8BFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ia-ban" x1="0" y1="724" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8BA3FF"/>
      <stop offset=".35" stop-color="#6E8BFF"/>
      <stop offset="1" stop-color="#4A63E8"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#ia-bg)"/>
  <rect width="1024" height="1024" fill="url(#ia-glow)"/>
  <!-- mark shifted up, slightly smaller, to leave room for the banner -->
  <g transform="translate(512 390) scale(8.6) translate(-32 -28)">
    {m}
  </g>
  <!-- gold hairline separating the banner -->
  <rect x="0" y="716" width="1024" height="8" fill="#E2C07A"/>
  <rect x="0" y="724" width="1024" height="300" fill="url(#ia-ban)"/>
  <!-- subtle top highlight on the banner -->
  <rect x="0" y="724" width="1024" height="70" fill="#FFFFFF" opacity=".10"/>
  {tg}
</svg>
'''


def masked_preview(inner_svg: str, pid: str) -> str:
    """Wrap a 1024 full-bleed icon with an iOS-like rounded-rect clip for review."""
    # strip xml header / outer svg, keep inner
    body = inner_svg
    # extract insides
    start = body.find(">", body.find("<svg")) + 1
    end = body.rfind("</svg>")
    inner = body[start:end]
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <clipPath id="{pid}-mask"><rect width="1024" height="1024" rx="228" ry="228"/></clipPath>
  </defs>
  <g clip-path="url(#{pid}-mask)">
    {inner}
  </g>
</svg>
'''


# ─── SPLASH SVGs 1170×2532 ────────────────────────────────────────────────
def wordmark_nova(fill: str, size=96, x_center=585, y_baseline=1480, tracking_em=0.12) -> str:
    g, width, bounds = text_group("NOVA", size, fill, tracking_em=tracking_em, y_baseline=0, x_left=0)
    bx, by, bw, bh = bounds
    x_left = x_center - (bx + bw / 2)
    g, _, _ = text_group("NOVA", size, fill, tracking_em=tracking_em, y_baseline=y_baseline, x_left=x_left)
    return g, (x_left + bx, y_baseline + by, bw, bh)


def splash_svg(kind: str, theme: str) -> str:
    """kind: user|admin, theme: dark|light"""
    dark = theme == "dark"
    bg = "#0A0C14" if dark else "#F3F4F9"
    bg2 = "#06070D" if dark else "#E6E8F2"
    nova_fill = "#F4F6FC" if dark else "#13151C"
    sub_fill = "#9AA3B8" if dark else "#5C6478"
    star_c = "#8BA3FF" if dark else "#4F6EF7"
    glow_op = ".42" if dark else ".22"
    pid = f"s{kind[0]}{theme[0]}"  # e.g. sud, aul

    m = mark(pid)
    # mark large, optical center around y=1020 (slightly above geometric 1266)
    mark_scale = 9.6  # 64*9.6 ≈ 614
    mark_cx, mark_cy = 585, 1000

    nova_g, nova_box = wordmark_nova(nova_fill, size=110, x_center=585, y_baseline=1460, tracking_em=0.14)

    # subtitle 星澜 XINGLAN
    sub_text = "星澜  XINGLAN"
    # use two parts
    g1, w1, b1 = text_group("星澜", 28, sub_fill, tracking_em=0.18, y_baseline=0, x_left=0)
    g2, w2, b2 = text_group("XINGLAN", 22, sub_fill, tracking_em=0.28, y_baseline=0, x_left=0)
    # place 星澜 then a gap then XINGLAN, as a group centered, baseline 1528
    gap = 22
    total = b1[2] + gap + b2[2]
    x0 = 585 - total / 2
    # x_left so that tight bx aligns
    xl1 = x0 - b1[0]
    xl2 = x0 + b1[2] + gap - b2[0]
    sub1, _, _ = text_group("星澜", 28, sub_fill, tracking_em=0.18, y_baseline=1536, x_left=xl1)
    sub2, _, _ = text_group("XINGLAN", 22, sub_fill, tracking_em=0.28, y_baseline=1534, x_left=xl2)

    admin_block = ""
    if kind == "admin":
        # Huge 管理端 — the eye-catcher. Gold on dark, indigo pill on light? 
        # Big filled pill + white text, very large.
        label = "管理端"
        lsize = 128
        lg, lw, lb = text_group(label, lsize, "#FFFFFF", tracking_em=0.08, y_baseline=0, x_left=0)
        lbx, lby, lbw, lbh = lb
        # pill: pad 56 x 32 around tight box, centered at 585, baseline around 1760
        y_base = 1760
        x_left = 585 - (lbx + lbw / 2)
        tight_cx = 585
        tight_cy = y_base + lby + lbh / 2
        pad_x, pad_y = 72, 36
        rx = (lbh + pad_y * 2) / 2
        rect_x = tight_cx - lbw / 2 - pad_x
        rect_y = (y_base + lby) - pad_y
        rect_w = lbw + pad_x * 2
        rect_h = lbh + pad_y * 2
        lg, _, _ = text_group(label, lsize, "#FFFFFF", tracking_em=0.08, y_baseline=y_base, x_left=x_left)
        pill_fill = "url(#{pid}-pill)".format(pid=pid)
        admin_block = f'''
  <defs>
    <linearGradient id="{pid}-pill" x1="{rect_x}" y1="{rect_y}" x2="{rect_x}" y2="{rect_y+rect_h}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8BA3FF"/>
      <stop offset=".45" stop-color="#6E8BFF"/>
      <stop offset="1" stop-color="#4A63E8"/>
    </linearGradient>
  </defs>
  <rect x="{rect_x:.1f}" y="{rect_y:.1f}" width="{rect_w:.1f}" height="{rect_h:.1f}" rx="{rx:.1f}"
        fill="{pill_fill}" filter=""/>
  <rect x="{rect_x:.1f}" y="{rect_y:.1f}" width="{rect_w:.1f}" height="{rect_h*0.38:.1f}" rx="{rx:.1f}"
        fill="#FFFFFF" opacity=".10"/>
  <!-- gold hairline around the pill -->
  <rect x="{rect_x:.1f}" y="{rect_y:.1f}" width="{rect_w:.1f}" height="{rect_h:.1f}" rx="{rx:.1f}"
        fill="none" stroke="#E2C07A" stroke-width="3"/>
  {lg}
'''

    # bottom waves (decorative)
    wave_stroke = "#6E8BFF" if dark else "#4F6EF7"
    waves = f'''
  <g fill="none" stroke="{wave_stroke}" stroke-linecap="round" opacity="{.45 if dark else .3}">
    <path stroke-width="3" d="M-20 2280c180-90 320-90 500 0s320 90 500 0 280-90 320-80"/>
    <path stroke-width="2" opacity=".6" d="M-20 2340c180-80 320-80 500 0s320 80 500 0 280-80 320-72"/>
    <path stroke-width="1.5" opacity=".4" d="M-20 2396c180-70 320-70 500 0s320 70 500 0 280-70 320-64"/>
  </g>'''

    title = "NOVA 管理端" if kind == "admin" else "NOVA"
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 2532" width="1170" height="2532" role="img" aria-label="{title} 启动屏">
  <title>{title} 启动屏 · 星澜 · {theme}</title>
  <defs>
    <linearGradient id="{pid}-bg" x1="585" y1="0" x2="585" y2="2532" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{bg2}"/>
      <stop offset=".45" stop-color="{bg}"/>
      <stop offset="1" stop-color="{bg2}"/>
    </linearGradient>
    <radialGradient id="{pid}-glow" cx="50%" cy="38%" r="50%">
      <stop offset="0" stop-color="#6E8BFF" stop-opacity="{glow_op}"/>
      <stop offset="1" stop-color="#6E8BFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1170" height="2532" fill="url(#{pid}-bg)"/>
  <rect width="1170" height="2532" fill="url(#{pid}-glow)"/>
  {stars_bg(24 if dark else 12, seed=11 if dark else 19, color=star_c, max_r=2.0 if dark else 1.4)}
  <g transform="translate({mark_cx} {mark_cy}) scale({mark_scale}) translate(-32 -30)">
    {m}
  </g>
  {nova_g}
  {sub1}
  {sub2}
  {admin_block}
  {waves}
</svg>
'''


def splash_html(kind: str, theme: str, svg: str) -> str:
    bg = "#0A0C14" if theme == "dark" else "#F3F4F9"
    return f'''<!DOCTYPE html>
<html lang="zh-CN" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1170">
<title>NOVA {"管理端" if kind=="admin" else ""} 启动屏 · {theme}</title>
<style>
  html,body{{margin:0;padding:0;background:{bg};width:1170px;height:2532px;overflow:hidden}}
  svg{{display:block;width:1170px;height:2532px}}
</style>
</head>
<body>
{svg[svg.find("<svg"):] if "<?xml" in svg else svg}
</body>
</html>
'''


def main():
    # shared mark
    (ROOT / "shared" / "nova-mark.svg").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512" role="img" aria-label="NOVA 星澜标志">\n'
        '<title>NOVA Mark · 星澜</title>\n'
        + mark("sh") + "\n</svg>\n"
    )

    user_icon = icon_user_svg()
    admin_icon = icon_admin_svg()
    (ROOT / "user" / "icon" / "icon.svg").write_text(user_icon)
    (ROOT / "user" / "icon" / "icon-masked.svg").write_text(masked_preview(user_icon, "um"))
    (ROOT / "admin" / "icon" / "icon.svg").write_text(admin_icon)
    (ROOT / "admin" / "icon" / "icon-masked.svg").write_text(masked_preview(admin_icon, "am"))

    for kind in ("user", "admin"):
        for theme in ("dark", "light"):
            svg = splash_svg(kind, theme)
            (ROOT / kind / "splash" / f"splash-{theme}.svg").write_text(svg)
            (ROOT / kind / "splash" / f"splash-{theme}.html").write_text(splash_html(kind, theme, svg))

    # also copy refined mark to theme_v1/logo
    logo_dir = Path("/workspace/nova-theme/theme_v1/logo")
    logo_dir.mkdir(parents=True, exist_ok=True)
    (logo_dir / "nova-mark.svg").write_text((ROOT / "shared" / "nova-mark.svg").read_text())
    (logo_dir / "nova-app-icon.svg").write_text(masked_preview(user_icon, "lg"))
    print("SVGs written")
    for p in sorted(ROOT.rglob("*.svg")):
        print(f"  {p}  {p.stat().st_size}")

if __name__ == "__main__":
    main()
