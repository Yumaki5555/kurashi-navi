# ファビコン（サイトのアイコン）を、原本の SVG から PNG に書き出す
# 使い方：python tools/make-icons.py            … icons/ に 16・32・180・192・512px の PNG を作る
#         python tools/make-icons.py --preview 保存先.png 原本1.svg [原本2.svg …]
#                                                … 小さいサイズの見え方を拡大して並べた確認用の画像を作る
# ・SVG の描画には Edge（なければ Chrome）を画面なしで使う。使い捨ての保存領域で起動し、最後に消す。
# ・180px（iPhone のホーム画面用）は、iPhone が自動で角を丸めるため、角を丸めない正方形で作る
#   （透明な角は iPhone では黒く表示されるため）。
import sys, os, re, subprocess, tempfile, shutil, pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'icons' / 'favicon.svg'
SIZES = [512, 192, 180, 32, 16]
# Chrome を先に使う（この PC の Edge は、画面なしの写真撮影（--screenshot）でファイルを書き出さないため）
BROWSERS = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']


def square(svg):
    """角を丸めない版（背景の rect の rx を 0 に）"""
    out, n = re.subn(r'(<rect\b[^>]*?)\s+rx="[^"]*"', r'\1', svg, count=1)
    if n != 1:
        sys.exit('NG：背景の角丸（rect の rx）が見つかりません')
    return out


def render(svgs):
    """SVG の文字列のリストを、それぞれ SIZES の各サイズで描いて PIL 画像の辞書にして返す"""
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        sys.exit('NG：Edge / Chrome が見つかりません')
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='kn-icons-'))
    try:
        cells, x, y, rowh, W = [], 0, 0, 0, 1100
        parts = []
        for i, svg in enumerate(svgs):
            (tmp / f'i{i}.svg').write_text(svg, encoding='utf-8')
            for s in SIZES:
                if x + s > W:
                    x, y, rowh = 0, y + rowh + 8, 0
                cells.append((i, s, x, y))
                parts.append(f'<img src="i{i}.svg" width="{s}" height="{s}" style="position:absolute;left:{x}px;top:{y}px">')
                x, rowh = x + s + 8, max(rowh, s)
        H = y + rowh
        (tmp / 'p.html').write_text('<!doctype html><html><body style="margin:0;background:transparent">' + ''.join(parts) + '</body></html>', encoding='utf-8')
        shot = tmp / 'shot.png'
        subprocess.run([exe, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                        '--default-background-color=00000000', f'--user-data-dir={tmp / "prof"}', '--no-first-run',
                        f'--window-size={W},{H}', f'--screenshot={shot}', (tmp / 'p.html').as_uri()],
                       check=True, timeout=60, capture_output=True)
        if not shot.exists():
            sys.exit(f'NG：{exe} が画面写真を書き出しませんでした')
        img = Image.open(shot).convert('RGBA')
        if img.size != (W, H):
            sys.exit(f'NG：画面写真の大きさが想定と違います {img.size} ≠ {(W, H)}')
        return {(i, s): img.crop((x, y, x + s, y + s)) for i, s, x, y in cells}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check(im, s):
    """四隅と中心を確かめる：中心付近はアンバーか白、背景色がにじまず画像の端まで描けていること"""
    px = im.load()
    amber = (0xD6, 0x9E, 0x2E)
    edge = px[s // 2, 0]          # 上の辺の中央：背景の角丸の外ではないので、アンバーのはず
    if max(abs(a - b) for a, b in zip(edge[:3], amber)) > 6 or edge[3] < 250:
        sys.exit(f'NG：{s}px の上端の中央がアンバーではありません {edge}（余白ができている可能性）')
    colors = {px[a, b][:3] for a in range(s) for b in range(s) if px[a, b][3] == 255}
    if (255, 255, 255) not in colors and s >= 32:
        sys.exit(f'NG：{s}px に白い線がありません')


def main():
    args = sys.argv[1:]
    if args[:1] == ['--preview']:
        out, files = args[1], args[2:]
        ims = render([pathlib.Path(f).read_text(encoding='utf-8') for f in files])
        # 1行目：実寸（白地・濃い地）、2行目：16px を8倍、32px を4倍に拡大（点の並びがわかるよう、ぼかさずに拡大）
        cw = 16 * 8 + 32 * 4 + 180 + 60
        sheet = Image.new('RGBA', (cw * len(files) + 20, 330), (255, 255, 255, 255))
        for i in range(len(files)):
            ox = 10 + cw * i
            dark = Image.new('RGBA', (80, 40), (40, 44, 48, 255))
            sheet.paste(dark, (ox, 4))
            for j, (s, bx) in enumerate([(16, 8), (32, 40)]):
                sheet.alpha_composite(ims[(i, s)], (ox + bx, 8 if s == 16 else 4))
                sheet.alpha_composite(ims[(i, s)], (ox + 90 + bx, 8 if s == 16 else 4))
            sheet.alpha_composite(ims[(i, 16)].resize((128, 128), Image.NEAREST), (ox, 60))
            sheet.alpha_composite(ims[(i, 32)].resize((128, 128), Image.NEAREST), (ox + 136, 60))
            sheet.alpha_composite(ims[(i, 180)], (ox + 272, 40))
        sheet.convert('RGB').save(out)
        print('確認用の画像：', out)
        return
    svg = SRC.read_text(encoding='utf-8')
    ims = render([svg, square(svg)])
    for s in SIZES:
        im = ims[(1 if s == 180 else 0, s)]
        check(im, s)
        name = 'apple-touch-icon.png' if s == 180 else f'icon-{s}.png'
        im.save(ROOT / 'icons' / name, optimize=True)
        print(f'{name}：{im.size[0]}×{im.size[1]}px')


main()
