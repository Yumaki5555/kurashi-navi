# 元PDFを「部品（見出し・段落・枠・表・記入欄など）」に分解して JSON に保存する
import sys, json, re, collections
import pymupdf

SRC, OUT = sys.argv[1], sys.argv[2]
doc = pymupdf.open(SRC)

def hexcol(c):
    if c is None: return None
    if isinstance(c, int): return "%06x" % c
    return "%02x%02x%02x" % tuple(int(v * 255) for v in c)

def center(b): return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
def inside(pt, r, pad=0.5): return r[0] - pad <= pt[0] <= r[2] + pad and r[1] - pad <= pt[1] <= r[3] + pad

MARK = ("・", "□", "■", "※", "例：", "→")

def visible_drawings(page):
    """切り抜き（クリップ）で隠れている古い図形を除き、見えている図形だけ返す"""
    out = []; stack = []
    for it in page.get_drawings(extended=True):
        lv = it.get("level", 0)
        while stack and stack[-1][0] >= lv: stack.pop()
        sc = stack[-1][1] if stack else page.rect
        if it["type"] == "clip":
            stack.append((lv, pymupdf.Rect(it["scissor"]) & sc)); continue
        if it["type"] == "group":
            stack.append((lv, sc)); continue
        r = pymupdf.Rect(it["rect"])
        vis = pymupdf.Rect(max(r.x0, sc.x0), max(r.y0, sc.y0), min(r.x1, sc.x1), min(r.y1, sc.y1))
        if vis.x1 < vis.x0 - 0.01 or vis.y1 < vis.y0 - 0.01: continue
        if vis.width < 0.3 and vis.height < 0.3: continue
        d = {k: v for k, v in it.items() if k not in ("level",)}
        d["vis"] = tuple(vis)
        out.append(d)
    return out

def page_parse(pno, page):
    # ---- 文字（1文字ずつ） ----
    raw = page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_PRESERVE_LIGATURES | pymupdf.TEXT_CLIP)
    chars = []  # dict(c, bbox, size, bold, color, line)
    lid = 0
    for b in raw["blocks"]:
        if b["type"] != 0: continue
        for ln in b["lines"]:
            lid += 1
            for sp in ln["spans"]:
                for ch in sp["chars"]:
                    chars.append(dict(c=ch["c"], bb=ch["bbox"], size=sp["size"], bold="Bold" in sp["font"],
                                      color=hexcol(sp["color"]), line=lid))
    # ---- リンク ----
    links = []
    for l in page.get_links():
        tgt = None
        if l.get("kind") == pymupdf.LINK_GOTO: tgt = l["page"] + 1
        elif l.get("uri"): tgt = l["uri"]
        if tgt is not None: links.append((tuple(l["from"]), tgt))
    for c in chars:
        cc = center(c["bb"])
        c["link"] = next((t for r, t in links if inside(cc, r, 0.3)), None)
    # ---- 図形 ----
    bars, quotes, checks, hls, fields, boxes = [], [], [], [], [], []
    footbox = None
    vis = visible_drawings(page)
    for dr in vis:
        f = hexcol(dr.get("fill")); s = hexcol(dr.get("color")); r = tuple(dr["rect"])
        h = r[3] - r[1]; w = r[2] - r[0]
        v = dr["vis"]
        if f == "937228" and 70 < v[1] < 780 and 8 < v[3] - v[1] < 40 and v[2] - v[0] < 6: bars.append(v)
        elif f == "f9f8ef": quotes.append(r)
        elif f == "dfe2db": checks.append(r)
        elif f == "edf4f2": hls.append(r)
        elif f == "b8bcb5" and h > 5: fields.append(r)
        elif f == "ffffff" and r[1] > 760: footbox = r
        elif (f is None and s == "b5b8af" or f == "b5b8af") and h > 100 and w > 300: boxes.append(r)
    # ---- 表 ----
    tables = []
    for t in page.find_tables(paths=vis).tables:
        cells = [c for row in t.rows for c in row.cells if c]
        xs = sorted(set(round(c[0], 0) for c in cells) | set(round(c[2], 0) for c in cells))
        ys = sorted(set(round(c[1], 0) for c in cells) | set(round(c[3], 0) for c in cells))
        tables.append(dict(bbox=tuple(t.bbox), cells=[tuple(c) for c in cells], xs=xs, ys=ys))
    has_hdr = any(hexcol(dr.get("fill")) == "937228" and dr["vis"][1] < 70 for dr in vis)
    # ---- 文字を入れ物に割り当て ----
    cont = []  # (kind, rect, extra)
    for i, t in enumerate(tables):
        for j, cbb in enumerate(t["cells"]): cont.append(("cell", cbb, (i, j)))
    for r in quotes: cont.append(("quote", r, None))
    for r in checks: cont.append(("check", r, None))
    for r in hls: cont.append(("hl", r, None))
    for r in fields: cont.append(("field", r, None))
    for r in boxes: cont.append(("box", r, None))
    if footbox: cont.append(("footnote", footbox, None))
    for c in chars:
        cc = center(c["bb"])
        if cc[1] < 72 and has_hdr: c["cont"] = ("header",); continue
        if cc[1] > 810: c["cont"] = ("footer",); continue
        hit = None
        for k, r, ex in cont:
            if inside(cc, r):
                hit = (k, tuple(round(v, 1) for v in r), ex); break
        if hit is None:
            # 表の枠内だがセル外
            for i, t in enumerate(tables):
                if inside(cc, t["bbox"]): hit = ("tablefree", t["bbox"], i); break
        c["cont"] = hit or ("free",)
    # 枠から少しはみ出した文字は、同じ行の仲間がいる枠へ戻す
    byline = collections.defaultdict(list)
    for c in chars: byline[c["line"]].append(c)
    for cs in byline.values():
        conts = collections.Counter(c["cont"] for c in cs if c["cont"][0] not in ("free", "cell", "tablefree"))
        if conts and any(c["cont"][0] == "free" for c in cs):
            best = conts.most_common(1)[0][0]
            for c in cs:
                if c["cont"][0] == "free": c["cont"] = best
    return chars, bars, tables, fields, boxes

def make_lines(chars):
    """同じ元行の文字をまとめて行にする（入れ物ごと）"""
    by = collections.OrderedDict()
    for c in chars: by.setdefault(c["line"], []).append(c)
    lines = []
    for lid, cs in by.items():
        # 行内に空白しかなければ捨てる（空白はそのまま比較対象外）
        if not "".join(c["c"] for c in cs).strip(): continue
        x0 = min(c["bb"][0] for c in cs if c["c"].strip()); x1 = max(c["bb"][2] for c in cs if c["c"].strip())
        y0 = min(c["bb"][1] for c in cs); y1 = max(c["bb"][3] for c in cs)
        sz = collections.Counter(round(c["size"], 1) for c in cs if c["c"].strip()).most_common(1)[0][0]
        lines.append(dict(cs=cs, x0=x0, x1=x1, y0=y0, y1=y1, size=sz))
    # 同じ高さに並ぶ別の元行（右側に置かれた文字など）は左から順に
    # 高さが重なる行を「同じ段」にまとめ、段の中は左から順に
    lines.sort(key=lambda l: (l["y0"] + l["y1"]) / 2)
    rows = []
    for l in lines:
        cy = (l["y0"] + l["y1"]) / 2
        if rows and abs(cy - rows[-1][0]) < 0.45 * min(l["size"], rows[-1][1][0]["size"]):
            rows[-1][1].append(l)
        else:
            rows.append([cy, [l]])
    out = []
    for cy, ls in rows: out.extend(sorted(ls, key=lambda l: l["x0"]))
    return out

def runs_of(cs, size):
    """文字列を書式ごとのかたまりに。大きな横の空きは空白枠にする"""
    runs = []
    prev = None
    for c in cs:
        if prev is not None and c["c"].strip() and prev["c"].strip():
            gap = c["bb"][0] - prev["bb"][2]
            if gap > 1.3 * size: runs.append(dict(sp=round(gap, 1)))
        key = (c["bold"], c["link"], c["color"] in ("675223", "5f501d", "0e4f52", "937228"))
        if runs and "s" in runs[-1] and runs[-1]["k"] == key:
            runs[-1]["s"] += c["c"]
        else:
            runs.append(dict(s=c["c"], k=key))
        prev = c
    out = []
    for r in runs:
        if "sp" in r: out.append(r); continue
        d = dict(s=r["s"])
        if r["k"][0]: d["b"] = 1
        if r["k"][1] is not None: d["l"] = r["k"][1]
        if r["k"][2]: d["a"] = 1
        out.append(d)
    return out

def join_runs(a, b):
    if a and b and "s" in a[-1] and "s" in b[0]:
        if re.match(r"[A-Za-z0-9]$", a[-1]["s"]) and re.match(r"^[A-Za-z0-9]", b[0]["s"]):
            b = [dict(b[0], s=" " + b[0]["s"])] + b[1:]
        if {k: v for k, v in a[-1].items() if k != "s"} == {k: v for k, v in b[0].items() if k != "s"}:
            return a[:-1] + [dict(a[-1], s=a[-1]["s"] + b[0]["s"])] + b[1:]
    return a + b

MERGES = []
def paragraphs(lines, right_ref=None):
    """行を段落にまとめる（行が右端まで届いていれば次の行に続く）"""
    paras = []
    if not lines: return paras
    natural = max(l["x1"] for l in lines)
    rr = min(right_ref, natural) if right_ref else natural
    for l in lines:
        txt = "".join(c["c"] for c in l["cs"]).strip()
        cont = False
        if paras:
            p = paras[-1]; pl = p["last"]
            full = pl["x1"] >= rr - 1.6 * pl["size"]
            gap = l["y0"] - pl["y1"]
            same_col = (l["x0"] <= p["x0"] + 2.2 * l["size"])
            prev_t = "".join(r.get("s", "") for r in p["runs"]).rstrip()
            mid = not prev_t.endswith(("。", "」", "）", ")", "："))
            cont = full and same_col and -2 < gap < (1.2 if mid else 0.9) * l["size"] \
                and (abs(l["size"] - pl["size"]) < 1.2 or mid) \
                and not txt.startswith(MARK) and not p.get("bar")
        r = runs_of(l["cs"], l["size"])
        if paras:
            # 同じ高さで右に続く行は、同じ行の続き
            same_row = abs((l["y0"] + l["y1"]) / 2 - (pl["y0"] + pl["y1"]) / 2) < 0.45 * min(l["size"], pl["size"])                 and l["x0"] > pl["x1"] - 1 and not p.get("bar")
            # リンクが行をまたいで続いている（例: 68ペー / ジ）
            link_cont = bool(p["runs"]) and "l" in p["runs"][-1] and bool(r) and r[0].get("l") == p["runs"][-1]["l"]                 and -2 < gap < 1.5 * l["size"]
            if same_row:
                if txt.startswith(MARK) and l["x0"] - pl["x1"] > 1.3 * l["size"]:
                    r = [dict(sp=round(l["x0"] - pl["x1"], 1))] + r
                MERGES.append(("row", prev_t[-15:], txt[:15]))
                cont = True
                l = dict(l, x0=pl["x0"], y0=min(l["y0"], pl["y0"]), y1=max(l["y1"], pl["y1"]))
            elif link_cont and not cont:
                MERGES.append(("link", prev_t[-15:], txt[:15]))
                cont = True
        if cont:
            p["runs"] = join_runs(p["runs"], r); p["last"] = l; p["y1"] = l["y1"]
            p["bold_n"] += sum(1 for c in l["cs"] if c["bold"] and c["c"].strip()); p["n"] += sum(1 for c in l["cs"] if c["c"].strip())
        else:
            paras.append(dict(runs=r, x0=l["x0"], y0=l["y0"], y1=l["y1"], last=l, size=l["size"],
                              bold_n=sum(1 for c in l["cs"] if c["bold"] and c["c"].strip()),
                              n=sum(1 for c in l["cs"] if c["c"].strip())))
    for p in paras: p.pop("last")
    return paras

def ptext(p): return "".join(r.get("s", "") for r in p["runs"])

pages = []
for pno, page in enumerate(doc):
    chars, bars, tables, fields, boxes = page_parse(pno, page)
    groups = collections.OrderedDict()
    for c in chars:
        k = c["cont"]
        key = k[0] if k[0] in ("header", "footer", "free") else (k[0], k[1])
        groups.setdefault(key if k[0] != "cell" else ("cell", k[2]), []).append(c)
    blocks = []
    # 本文の基準サイズ
    free = [c for c in chars if c["cont"][0] == "free" and c["c"].strip()]
    body = collections.Counter(round(c["size"]) for c in free).most_common(1)[0][0] if free else 10
    # --- 自由配置の行 ---
    flines = make_lines(groups.get("free", []))
    fparas = paragraphs(flines, right_ref=547)
    for p in fparas:
        t = ptext(p).strip()
        cy = (p["y0"] + p["y1"]) / 2
        inbar = any(b[1] - 2 <= cy <= b[3] + 2 for b in bars)
        if p["size"] >= 15: cls = "title"
        elif inbar: cls = "h"
        elif t.startswith("■") and p["bold_n"] >= 0.6 * p["n"]: cls = "h2"
        elif p["bold_n"] >= 0.8 * p["n"] and p["n"] <= 16 and p["size"] >= body - 0.6: cls = "label"
        elif t.startswith("・"): cls = "bullet"
        elif p["size"] < body - 0.6: cls = "note"
        else: cls = "p"
        blocks.append(dict(t="para", cls=cls, runs=p["runs"], y=p["y0"], y1=p["y1"], x=round(p["x0"] - 48, 1)))
    # --- 入れ物 ---
    for key, cs in groups.items():
        if key in ("free",) or key[0] == "cell": continue
        if key in ("header", "footer"):
            ls = make_lines(cs)
            blocks.append(dict(t=key, paras=[dict(runs=runs_of(l["cs"], l["size"]), x=l["x0"]) for l in ls], y=-1 if key == "header" else 9999))
            continue
        kind, rect = key
        ls = make_lines(cs)
        ps = paragraphs(ls, right_ref=rect[2] - 6)
        blocks.append(dict(t=kind, rect=rect, y=rect[1], h=round(rect[3] - rect[1], 1),
                           paras=[dict(runs=p["runs"], x=round(p["x0"] - rect[0], 1), note=p["size"] < body - 0.6) for p in ps]))
    # 文字のない記入欄・枠
    used = {tuple(round(v, 1) for v in b["rect"]) for b in blocks if "rect" in b}
    for r in fields:
        rr = tuple(round(v, 1) for v in r)
        if rr not in used: blocks.append(dict(t="field", rect=rr, y=r[1], h=round(r[3] - r[1], 1), paras=[])); used.add(rr)
    for r in boxes:
        rr = tuple(round(v, 1) for v in r)
        if rr not in used: blocks.append(dict(t="box", rect=rr, y=r[1], h=round(r[3] - r[1], 1), paras=[]))
    # --- 表 ---
    for ti, t in enumerate(tables):
        xs, ys = t["xs"], t["ys"]
        cellmap = []
        for j, cbb in enumerate(t["cells"]):
            cs = groups.get(("cell", (ti, j)), [])
            ls = make_lines(cs)
            ps = paragraphs(ls, right_ref=cbb[2] - 5) if ls else []
            c0 = min(range(len(xs)), key=lambda i: abs(xs[i] - cbb[0])); c1 = min(range(len(xs)), key=lambda i: abs(xs[i] - cbb[2]))
            r0 = min(range(len(ys)), key=lambda i: abs(ys[i] - cbb[1])); r1 = min(range(len(ys)), key=lambda i: abs(ys[i] - cbb[3]))
            cellmap.append(dict(r=r0, c=c0, rs=max(1, r1 - r0), cs=max(1, c1 - c0), h=round(cbb[3] - cbb[1], 1),
                                bb=[round(v, 1) for v in cbb], paras=[dict(runs=p["runs"], note=p["size"] < body - 0.6) for p in ps]))
        colw = [round(xs[i + 1] - xs[i], 1) for i in range(len(xs) - 1)]
        blocks.append(dict(t="table", y=t["bbox"][1], rect=t["bbox"], colw=colw, nrows=len(ys) - 1, cells=cellmap))
    # 表の中だがセル外の文字（念のため）
    for key, cs in groups.items():
        if isinstance(key, tuple) and key[0] == "tablefree":
            ls = make_lines(cs)
            for p in paragraphs(ls):
                blocks.append(dict(t="para", cls="p", runs=p["runs"], y=p["y0"], y1=p["y1"], x=0))
    # 見出しの帯（元の位置）も記録
    blocks.sort(key=lambda b: (b["y"], b.get("x", 0) if isinstance(b.get("x", 0), (int, float)) else 0))
    pages.append(dict(n=pno + 1, body=body, blocks=blocks,
                      hdr_rows=[tuple(round(v, 1) for v in dr["rect"]) for dr in visible_drawings(page) if hexcol(dr.get("fill")) == "ede9dd"]))

json.dump(pages, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
open(OUT.replace("pages.json", "merges.txt"), "w", encoding="utf-8").write(chr(10).join(" | ".join(m) for m in MERGES))
print("pages", len(pages))
