# 印刷用PDF（print/shisetsu-guide.pdf）から、サイトで読むためのガイド本文（data/reihai/guide.json）を作る。
# 使い方: python -I tools/import-guide.py   （PyMuPDF が必要: pip install pymupdf）
# ・ページごとに、見出し・質問・言う言葉（「」）・表・参考資料のリンクに分ける
# ・記録用の空欄（年 月 日、〇〇：など）はサイトには出さない（印刷用PDFで使う）
# ・サイト上の文では、特定の宗教の名前を言い換える（PDFそのものは変えない）
# ・取りこぼしは tools/import-guide-report.txt に書き出す（0件であること）
import json, re, sys
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / 'print' / 'shisetsu-guide.pdf'
OUT = ROOT / 'data' / 'reihai' / 'guide.json'
REPORT = ROOT / 'tools' / 'import-guide-report.txt'
HEAD_Y, FOOT_Y = 50, 800  # 上の目次リンクと、下の日付・ページ番号は除く

# 目次（3ページ）に合わせた章。すべてのページがちょうど1回ずつ入ること
CHAPTERS = [
    ('start', 'はじめに｜まず知っておくこと', 1, 1, 'first'),
    ('choose', '気になることを選ぶ・目次', 2, 3, 'first'),
    ('call', '初めて相談する・電話とメールの文例', 4, 5, 'first'),
    ('A', 'A 土地の使い方・この場所で認められる用途', 6, 7, 'topic'),
    ('B', 'B 住宅・倉庫の使い方の変更、増改築', 8, 9, 'topic'),
    ('C', 'C 火事・避難・人が多いときの安全', 10, 11, 'topic'),
    ('D', 'D 音・車・ごみ・臭い・排水・照明', 12, 13, 'topic'),
    ('E', 'E 学校・保育園・通学路', 14, 15, 'topic'),
    ('F', 'F 施設や屋外での活動・子ども向け教室・墓地', 16, 17, 'topic'),
    ('G', 'G 運営者の窓口・説明会・改善の約束', 18, 19, 'topic'),
    ('area', '近所・自治会と協力する／声をまとめる', 20, 21, 'step'),
    ('reask', '回答に合わせて聞き直す', 22, 23, 'step'),
    ('foi', '行政の資料を見る・相談が進まないとき', 24, 25, 'step'),
    ('record', '記録のしかた・時間と費用・進み具合', 26, 28, 'step'),
    ('sheet', '記録用紙・地図（印刷して使う）', 29, 30, 'step'),
    ('land', '土地・工事｜追加確認の入口', 31, 31, 'land'),
    ('H', 'H 田畑を建物や駐車場に変えたとき', 32, 33, 'land'),
    ('I', 'I 山林を切り開く・木を切るとき', 34, 35, 'land'),
    ('J', 'J 土を盛る・削る、斜面が心配なとき', 36, 37, 'land'),
    ('K', 'K 道路・出入口・進入路', 38, 39, 'land'),
    ('L', 'L 雨水・汚水・排水先', 40, 41, 'land'),
    ('M', 'M 解体・改修・工事', 42, 43, 'land'),
    ('N', 'N 川・崖・保護区域などの近く', 44, 45, 'land'),
    ('detail', '建物を詳しく聞く・土地と工事の進み具合', 46, 47, 'land'),
    ('compare', '現物と行政の情報が違うとき', 48, 50, 'step'),
    ('words', '行政の言葉をやさしく読む・判断前の注意', 51, 54, 'step'),
    ('ref1', '参考資料1〜34（土地・建物など）', 55, 60, 'ref'),
    ('law1', '早見表｜法令と窓口（活動・暮らし／土地・建物・工事）', 61, 62, 'ref'),
    ('stay', '宿泊', 63, 64, 'life'),
    ('food', '食品店・食堂・食事の提供', 65, 65, 'life'),
    ('funeral', '遺体洗浄・安置・葬儀', 66, 66, 'life'),
    ('ref2', '参考資料35〜44（宿泊・食品・葬祭など）', 67, 68, 'ref'),
    ('worry', '心配事から探す（一覧）', 69, 70, 'first'),
    ('park', '公園・広場で食べ物を配っている', 71, 71, 'life'),
    ('fire', '公園・広場で火を使っている', 72, 72, 'life'),
    ('kids', '子どもの行事・声かけ・勧誘', 73, 73, 'life'),
    ('animal', 'ヤギ・羊を飼っている', 74, 74, 'life'),
    ('slaughter', 'ヤギ・羊のと畜・食肉の提供', 75, 75, 'life'),
    ('burial', '土葬墓地の計画', 76, 76, 'life'),
    ('event', '大きな行事・路上での礼拝', 77, 77, 'life'),
    ('night', '音・臭い・ごみ・看板・地域との連絡／調停', 78, 78, 'life'),
    ('org', '土地の取得・宗教法人・税金', 79, 79, 'life'),
    ('anxiety', '漠然とした不安を、相談できる内容にする', 80, 80, 'life'),
    ('law2', '早見表｜公園・動物・行事・法人', 81, 81, 'ref'),
    ('ref3', '参考資料45〜68（公園・動物・墓地・法人・調停など）', 82, 84, 'ref'),
    ('talk', '電話の会話の見本', 85, 85, 'first'),
]

# サイト上の文だけ言い換える（PDFはそのまま）。どれも1回以上当たること
REPLACE = [
    ('モスクなどの施設　確認と相談のガイド', '近所の施設　確認と相談のガイド'),
    ('神社・お寺・教会・モスクなどの宗教の建物は、', '宗教の建物は、宗教の種類を問わず、'),
    ('「モスクだから」', '「宗教施設だから」'),
    ('モスク等の宗教施設でも', '宗教施設でも'),
    ('や「ハラール」という表示だけでは', 'や、宗教上の決まりに合わせた食品という表示だけでは'),
    ('（犠牲祭等）', '（宗教行事等）'),
    ('ハラール食品店・食堂', '食品店・食堂'),
    ('大きな行事（イード等）', '大きな行事'),
    ('（礼拝・ラマダン期間等）', '（礼拝・行事の期間等）'),
    ('犠牲祭などの行事名だけでは', '宗教行事の名前だけでは'),
    ('イードなどで人が多く集まる', '大きな行事で人が多く集まる'),
    ('早朝礼拝・ラマダン期間等も', '早朝の礼拝・行事の期間等も'),
]
BANNED = re.compile(r'モスク|イスラム|ムスリム|イード|ラマダン|ハラール|犠牲祭|キリスト教|カトリック|プロテスタント|仏教|神道|ヒンドゥー|ユダヤ')

Q_RE = re.compile(r'^□\s*((?:[A-Z](?:追|子|墓)?|[一-鿿])\d+)[\s　]+(.+)$')
PAGE_ONLY = re.compile(r'^[\d〜・]+(ページ)?$')
MARK = re.compile(r'^(・|□|■|「|[①-⑳]|言葉：|知っておくこと|次へ：|参考：|根拠：|→|※|対応ページ：|資料\d|STEP|\d+[.．]\s)')
FORM = re.compile(r'(年[\s　]+月[\s　]+日|：[\s　]*$|：[\s　]{2,}|□\s?相手から)')
REC_HEAD = re.compile(r'^(回答を記録する|回答と次の行動を記録する)')
WS = re.compile(r'[\s　]+')


def squash(s):
    return re.sub(r'[・■□]', '', WS.sub('', s))


def page_lines(page):
    d = page.get_text('dict')
    out = []
    for b in d['blocks']:
        if b['type'] != 0:
            continue
        for ln in b['lines']:
            t = ''.join(s['text'] for s in ln['spans'])
            if not t.strip():
                continue
            x0, y0, x1, y1 = ln['bbox']
            s0 = next(s for s in ln['spans'] if s['text'].strip())
            s9 = next(s for s in reversed(ln['spans']) if s['text'].strip())
            if (y0 < HEAD_Y and s0['size'] < 9) or (y0 > FOOT_Y and s0['size'] < 8):
                continue
            out.append(dict(x0=x0, y0=y0, x1=x1, y1=y1, t=t.strip(), size=round(s0['size'], 1),
                            bold=bool(s0['flags'] & 16), color=s0['color'], used=False, uri=None,
                            end=(bool(s9['flags'] & 16), s9['color'])))  # 行の終わりの文字の太さ・色（折り返しの判定用）
    out.sort(key=lambda r: (round(r['y0'] / 3), r['x0']))
    return out


def inside(ln, bb, tol=1.5):
    cx, cy = (ln['x0'] + ln['x1']) / 2, (ln['y0'] + ln['y1']) / 2
    return bb[0] - tol <= cx <= bb[2] + tol and bb[1] - tol <= cy <= bb[3] + tol


def join_lines(ls, right):
    """折り返された行をつなぐ。right は右端（これに届いている行は次の行に続く）"""
    parts = []
    for ln in ls:
        if parts:
            prev = parts[-1]
            full = prev['x1'] >= right - prev['size'] * 1.6
            if full and not MARK.match(ln['t']) and not PAGE_ONLY.match(ln['t']):
                prev['t'] += ln['t']
                prev['x1'] = ln['x1']
                continue
        parts.append(dict(ln))
    return '\n'.join(p['t'] for p in parts)


def tables_of(page, lines, rep, pno):
    blocks = []
    for t in page.find_tables(strategy='lines').tables:
        cells_text = ' '.join(c or '' for r in t.extract() for c in r)
        if re.search(r'□\s*[A-Z]\d', cells_text):
            continue  # 質問を並べるための枠。表ではなく本文として読む
        ncol = max(len(r.cells) for r in t.rows)
        cols = []  # 列ごとの左右の位置（結合セルのない行から）
        for ci in range(ncol):
            xs = [r.cells[ci] for r in t.rows if ci < len(r.cells) and r.cells[ci]]
            cols.append((min(b[0] for b in xs), max(b[2] for b in xs)) if xs else (0, 0))
        grid = [[[] for _ in range(ncol)] for _ in t.rows]
        for ri, row in enumerate(t.rows):
            for ci, bb in enumerate(row.cells):
                if bb is None:
                    continue
                for ln in lines:
                    if not ln['used'] and inside(ln, bb):
                        ln['used'] = True
                        grid[ri][ci].append(ln)
        # 枠線が途中で切れていて拾えなかった行は、高さ（行）と左右の位置（列）で入れる
        for ln in lines:
            if ln['used'] or not inside(ln, t.bbox, 0):
                continue
            cy, cx = (ln['y0'] + ln['y1']) / 2, (ln['x0'] + ln['x1']) / 2
            ri = next((i for i, r in enumerate(t.rows) if r.bbox[1] - 1 <= cy <= r.bbox[3] + 1), len(t.rows) - 1)
            ci = next((i for i, c in enumerate(cols) if c[0] - 2 <= cx <= c[1] + 2), 0)
            ln['used'] = True
            grid[ri][ci].append(ln)
            rep['fixed'].append(f'p{pno} 表の{ri + 1}行{ci + 1}列に入れた: {ln["t"]}')
        # 表のすぐ下に、枠線のない最後の行があれば表に入れる（2列以上が同じ高さで始まり、列の幅に収まる行だけ）
        rh = max(r.bbox[3] - r.bbox[1] for r in t.rows)
        def col_of(ln):
            return next((i for i, c in enumerate(cols) if ln['x0'] >= c[0] - 3 and ln['x1'] <= c[1] + 3), None)
        cand = [ln for ln in lines if not ln['used'] and t.bbox[3] - 2 <= ln['y0'] <= t.bbox[3] + rh * 1.2 and col_of(ln) is not None]
        if cand:
            y0 = min(ln['y0'] for ln in cand)
            if len({col_of(ln) for ln in cand if abs(ln['y0'] - y0) <= 3}) >= 2:
                row = [[] for _ in range(ncol)]
                for ln in sorted(cand, key=lambda l: l['y0']):
                    c = row[col_of(ln)]
                    # 1行目と、そのすぐ下に続く行だけ（離れた見出しなどは入れない）
                    if (not c and abs(ln['y0'] - y0) <= 3) or (c and ln['y0'] - c[-1]['y1'] <= c[-1]['size'] * 0.8):
                        ln['used'] = True
                        c.append(ln)
                        rep['fixed'].append(f'p{pno} 表の下の行を表に入れた: {ln["t"]}')
                grid.append(row)
        head = bool(grid and grid[0] and all(ln['color'] == 0xffffff for c in grid[0] for ln in c) and any(grid[0]))
        # 折り返しの判定に使う右端：その列でいちばん右まで届いた文字の位置
        colmax = [max([ln['x1'] for r in grid for ln in r[ci]] or [cols[ci][1]]) for ci in range(ncol)]
        rows = []
        for r in grid:
            rows.append([join_lines(sorted(c, key=lambda l: (l['y0'], l['x0'])), colmax[ci]) if c else '' for ci, c in enumerate(r)])
        rows = [[re.sub(r'([〜・、])\n', r'\1', c) for c in r] for r in rows if any(r)]
        blocks.append(dict(y=t.bbox[1], b=dict(k='tbl', head=head, rows=rows), stray=[]))
    return blocks


def mark_uris(page, lines):
    for lk in page.get_links():
        if lk['kind'] != pymupdf.LINK_URI:
            continue
        r = lk['from']
        for ln in lines:
            ov = min(ln['y1'], r.y1) - max(ln['y0'], r.y0)
            if ov > (ln['y1'] - ln['y0']) * 0.5 and ln['x0'] < r.x1 and ln['x1'] > r.x0:
                ln['uri'] = lk['uri']


def classify(text, ln, first_title):
    t = text
    if ln['size'] >= 14:
        return dict(k='title', t=t)
    if ln['uri']:
        return dict(k='url', u=ln['uri'], t=t)
    m = Q_RE.match(t)
    if m:
        return dict(k='q', id=m.group(1), t=m.group(2).strip())
    if t.startswith('□'):
        return dict(k='chk', t=t[1:].strip())
    if t.startswith('「') and t.endswith('」'):
        # 太字の短い「」は、役所の答えなどの見出し（例：「問題ありません」）。言う言葉ではない
        if ln['bold'] and len(t) <= 20:
            return dict(k='h', t=t)
        return dict(k='say', t=t)
    if t.startswith('言葉：') or t.startswith('知っておくこと'):
        return dict(k='note', t=t)
    if t.startswith('次へ：'):
        return dict(k='nav', t=t)
    if t.startswith('・'):
        return dict(k='li', t=t[1:].strip())
    if t.startswith('■'):
        return dict(k='h', t=t[1:].strip())
    if ln['bold'] and len(t) <= 40 and not t.endswith('。') and ln['color'] != 0xffffff:
        return dict(k='h', t=t)
    return dict(k='p', t=t)


def build_page(page, pno, rep):
    lines = page_lines(page)
    mark_uris(page, lines)
    raw = [ln['t'] for ln in lines]
    tbls = tables_of(page, lines, rep, pno)
    for tb in tbls:
        for ln in tb['stray']:
            rep['stray'].append(f'p{pno} 表の中で拾えなかった行: {ln["t"]}')
    flow = [ln for ln in lines if not ln['used']]
    # 右端：同じ左端を持つ行のうち、いちばん右まで届いている位置
    def right_of(ln):
        return max(o['x1'] for o in flow if abs(o['x0'] - ln['x0']) <= 3)
    paras = []
    for ln in flow:
        if paras:
            pv = paras[-1]
            # 同じ書式：段落の始まりと同じか、前の行の終わりと同じ（リンクや「言葉：」など色の違う文字の途中で折り返した行もつなぐ）
            same = abs(pv['size'] - ln['size']) <= 0.4 and ((pv['bold'], pv['color']) == (ln['bold'], ln['color']) or pv['end'] == (ln['bold'], ln['color']))
            gap = ln['y0'] - pv['y1']
            near = -1 <= gap <= pv['size'] * 1.1 and abs(ln['x0'] - pv['x0']) <= pv['size'] * 1.3
            full = pv['x1'] >= pv['right'] - pv['size'] * 1.6
            cont = not MARK.match(ln['t']) or (ln['t'].startswith('「') and not re.search(r'[。」）：]$', pv['t']))
            if same and near and full and cont and (pv['uri'] == ln['uri']) and ln['size'] < 14 or \
               (same and near and pv['size'] >= 14 and ln['size'] >= 14):
                pv['t'] += ln['t']
                pv['x1'], pv['y1'], pv['end'] = ln['x1'], ln['y1'], ln['end']
                pv['right'] = max(pv['right'], right_of(ln))
                continue
        p = dict(ln)
        p['right'] = right_of(ln)
        paras.append(p)
    items = [dict(y=p['y0'], p=p) for p in paras] + [dict(y=tb['y'], b=tb['b']) for tb in tbls]
    items.sort(key=lambda it: it['y'])
    title, blocks, in_rec = '', [], False
    for it in items:
        if 'b' in it:
            blocks.append(it['b'])
            continue
        p = it['p']
        b = classify(p['t'], p, title)
        if b['k'] == 'title':
            title = (title + b['t']) if title else b['t']
            continue
        if b['k'] in ('h', 'p') and REC_HEAD.match(b['t']):
            blocks.append(dict(k='rec'))
            in_rec = True
            rep['form'].append(f'p{pno} 記録欄の見出し: {b["t"]}')
            continue
        if b['k'] in ('h', 'q', 'nav', 'url'):
            in_rec = False
        if FORM.search(p['t']) and '。' not in p['t'] and b['k'] not in ('q', 'say', 'url'):
            rep['form'].append(f'p{pno} 記録欄: {p["t"]}')
            continue
        if b['k'] == 'url' and blocks and blocks[-1]['k'] == 'url' and blocks[-1]['u'] == b['u']:
            blocks[-1]['t'] += b['t']
            continue
        blocks.append(b)
    return title, tidy(blocks), raw


def unbalanced(t):
    return t.count('「') > t.count('」') or t.count('（') > t.count('）')


def tidy(blocks):
    """段落の後始末：かっこの途中で切れた段落をつなぐ・手順の番号を見出しにつける"""
    out = []
    for b in blocks:
        if out and b['k'] in ('p', 'h') and out[-1]['k'] == 'p' and re.search(r'[→、の・／]$', out[-1]['t']) and len(b['t']) <= 20:
            out[-1]['t'] += b['t']
            continue
        # 言葉の途中で切れた行（例：「土地を削」＋「る・盛る…」、「確認で」＋「きますか。」）をつなぐ
        if out and b['k'] == 'p' and re.match(r'[ぁ-ん]', b['t']) and out[-1]['k'] in ('p', 'chk', 'li', 'note') \
                and not re.search(r'[。？?」）：]$', out[-1]['t']):
            out[-1]['t'] += b['t']
            if out[-1]['k'] == 'p' and out[-1]['t'].startswith('「') and out[-1]['t'].endswith('」'):
                out[-1]['k'] = 'say'
            continue
        if out and b['k'] in ('p', 'say') and out[-1]['k'] in ('p', 'li', 'note') and unbalanced(out[-1]['t']):
            out[-1]['t'] += b['t']
            if out[-1]['k'] == 'p' and out[-1]['t'].startswith('「') and out[-1]['t'].endswith('」'):
                out[-1]['k'] = 'say'
            continue
        out.append(b)
    res = []
    for i, b in enumerate(out):
        if b['k'] == 'p' and re.fullmatch(r'\d{1,2}', b['t']):
            nx = out[i + 1] if i + 1 < len(out) else None
            pv = res[-1] if res else None
            if nx and nx['k'] == 'h' and not re.match(r'\d', nx['t']):
                nx['t'] = b['t'] + '　' + nx['t']
                continue
            if pv and pv['k'] == 'h' and not re.match(r'\d', pv['t']):
                pv['t'] = b['t'] + '　' + pv['t']
                continue
        res.append(b)
    return res


def texts(blocks):
    for b in blocks:
        if b['k'] == 'tbl':
            for r in b['rows']:
                for c in r:
                    yield c
        elif b['k'] == 'q':
            yield b['id'] + b['t']
        elif 't' in b:
            yield b['t']


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    doc = pymupdf.open(PDF)
    n = doc.page_count
    covered = sorted(p for c in CHAPTERS for p in range(c[2], c[3] + 1))
    assert covered == list(range(1, n + 1)), f'章のページが1〜{n}をちょうど覆っていない'
    rep = dict(stray=[], form=[], lost=[], banned=[], fixed=[])
    pages = {}
    for i in range(n):
        title, blocks, raw = build_page(doc[i], i + 1, rep)
        # 取りこぼし：元の行（空白を除く）が、出力のどこかにそのまま残っているか
        allout = squash(''.join(texts(blocks)) + title)
        dropped = squash(''.join(x.split(': ', 1)[1] for x in rep['form'] if x.startswith(f'p{i + 1} ')))
        for t in raw:
            st = squash(t)
            if st and st not in allout and st not in dropped:
                rep['lost'].append(f'p{i + 1}: {t}')
        pages[str(i + 1)] = dict(t=title, b=blocks)
    # 言い換え
    hits = [0] * len(REPLACE)

    def rp(s):
        for k, (a, b) in enumerate(REPLACE):
            if a in s:
                hits[k] += s.count(a)
                s = s.replace(a, b)
        return s
    for pg in pages.values():
        pg['t'] = rp(pg['t'])
        for b in pg['b']:
            if b['k'] == 'tbl':
                b['rows'] = [[rp(c) for c in r] for r in b['rows']]
            elif 't' in b:
                b['t'] = rp(b['t'])
    for k, h in enumerate(hits):
        if h == 0:
            rep['banned'].append(f'言い換えが1回も当たらない: {REPLACE[k][0]}')
    for no, pg in pages.items():
        for s in [pg['t'], *texts(pg['b'])]:
            for m in BANNED.finditer(s):
                rep['banned'].append(f'p{no} 宗教の名前が残っている「{m.group(0)}」: {s[:60]}')
    meta = doc.metadata or {}
    data = dict(
        version=1,
        title='近所の施設　確認と相談のガイド',
        pdf='print/shisetsu-guide.pdf',
        pdfBytes=PDF.stat().st_size,
        pageCount=n,
        edition='2026-11-18',
        lawChecked='2026-11-18',
        chapters=[dict(id=c[0], t=c[1], from_=c[2], to=c[3], g=c[4]) for c in CHAPTERS],
        pages=pages,
    )
    txt = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('"from_"', '"from"')
    OUT.write_text(txt, encoding='utf-8')
    nq = sum(1 for pg in pages.values() for b in pg['b'] if b['k'] == 'q')
    nsay = sum(1 for pg in pages.values() for b in pg['b'] if b['k'] == 'say')
    ntbl = sum(1 for pg in pages.values() for b in pg['b'] if b['k'] == 'tbl')
    nurl = sum(1 for pg in pages.values() for b in pg['b'] if b['k'] == 'url')
    notitle = [no for no, pg in pages.items() if not pg['t']]
    lines = [f'PDF {PDF.name}（{n}ページ） → {OUT.relative_to(ROOT)}（{len(txt.encode("utf-8")):,} バイト）',
             f'質問 {nq}・言う言葉 {nsay}・表 {ntbl}・資料リンク {nurl}・言い換え {sum(hits)}回 {hits}',
             f'題名のないページ: {notitle or "なし"}',
             f'取りこぼし {len(rep["lost"])}件・表の外れ {len(rep["stray"])}件・宗教の名前 {len(rep["banned"])}件・記録欄として除いた行 {len(rep["form"])}件', '']
    for k in ('lost', 'stray', 'banned', 'fixed', 'form'):
        lines.append(f'## {k}')
        lines += rep[k]
        lines.append('')
    REPORT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines[:4]))
    return 1 if rep['lost'] or rep['stray'] or rep['banned'] else 0


if __name__ == '__main__':
    sys.exit(main())
