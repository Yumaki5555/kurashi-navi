# pages.json から、見やすいデザインの HTML を作る（文字は一切変えない）
import json, sys, html, re

P = json.load(open(sys.argv[1], encoding="utf-8"))
OUT = sys.argv[2]
TOTAL = len(P)

# ---------- アイコン（線画、文字なし） ----------
I = {
 "phone": '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
 "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
 "search": '<circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/>',
 "check": '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4L12 14l-3-3"/>',
 "chat": '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
 "pin": '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
 "home": '<path d="M3 9.5l9-7 9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
 "users": '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
 "volume": '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2M15.5 8.5a5 5 0 0 1 0 7"/>',
 "school": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
 "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
 "child": '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
 "help": '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
 "megaphone": '<path d="M3 11l15-6v14L3 13z"/><path d="M7 13.5V18a2 2 0 0 0 4 0v-3"/>',
 "folder": '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
 "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
 "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
 "clipboard": '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8 12h8M8 16h5"/>',
 "map": '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z"/><path d="M8 2v16M16 6v16"/>',
 "tool": '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
 "sprout": '<path d="M12 22V12"/><path d="M12 12C12 7 8.5 4 3 4c0 5 3.5 8 9 8z"/><path d="M12 14c0-4 3-7 9-7 0 4-3 7-9 7z"/><path d="M4 22h16"/>',
 "tree": '<path d="M12 2l7 9h-4l5 7H4l5-7H5z"/><path d="M12 18v4"/>',
 "mountain": '<path d="M2 20l7-12 4 6 3-4 6 10z"/>',
 "road": '<path d="M5 22L10 2M19 22L14 2M12 5v2M12 10.5v2.5M12 17v3"/>',
 "droplet": '<path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.3 0z"/>',
 "hammer": '<path d="M15 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="M17.6 15L22 10.6M20.9 11.7l-1.3-1.3c-.6-.6-.9-1.4-.9-2.2v-.9L16 4.6A5.6 5.6 0 0 0 12.1 3H9l.9.8A6.2 6.2 0 0 1 12 8.4V10l2 2h2.5l2.3 1.9"/>',
 "waves": '<path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
 "ruler": '<path d="M21.3 8.7L8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="M7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>',
 "compare": '<path d="M12 3v18M6 21h12M3 7h18"/><path d="M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
 "book": '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
 "alert": '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
 "bookmark": '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
 "table": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
 "bed": '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
 "utensils": '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
 "flower": '<circle cx="12" cy="10" r="2.5"/><path d="M12 7.5a3 3 0 1 1 0-5 3 3 0 1 1 0 5M14.5 10a3 3 0 1 1 5 0 3 3 0 1 1-5 0M12 12.5a3 3 0 1 1 0 5 3 3 0 1 1 0-5M9.5 10a3 3 0 1 1-5 0 3 3 0 1 1 5 0M12 17.5V22"/>',
 "flame": '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3 0 2.5 2.5 2.5 2.5 2.5z"/>',
 "paw": '<circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M12 11c-3 0-6 4.5-6 7a3 3 0 0 0 3 3c1.2 0 2-.5 3-.5s1.8.5 3 .5a3 3 0 0 0 3-3c0-2.5-3-7-6-7z"/>',
 "grave": '<path d="M6 21V9a6 6 0 0 1 12 0v12"/><path d="M3 21h18M12 8v7M9.5 10.5h5"/>',
 "building": '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6M9 10h.01M15 10h.01"/>',
 "trash": '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
 "heart": '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.7z"/>',
 "arrow": '<circle cx="12" cy="12" r="10"/><path d="M12 16l4-4-4-4M8 12h8"/>',
 "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
 "bulb": '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
 "x": '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
 "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
 "bell": '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
 "list": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
 "progress": '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
 "yen": '<path d="M6 3l6 8 6-8M12 11v10M7 13h10M7 17h10"/>',
 "pencil": '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
 "person": '<circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>',
 "start": '<circle cx="12" cy="12" r="10"/><path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
}
def ic(name, cls="i"):
    return f'<svg class="{cls}" viewBox="0 0 24 24"><use href="#i-{name}"/></svg>'
SYMBOLS = "".join(f'<symbol id="i-{k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{v}</symbol>' for k, v in I.items())

TITLE_ICON = [("電話の会話", "chat"), ("電話", "phone"), ("メール", "mail"), ("目次", "list"), ("選ぶ", "check"), ("初めて相談", "start"),
    ("場所をそろえる", "map"), ("この場所", "pin"), ("住宅", "home"), ("人が集まる", "users"), ("音", "volume"), ("学校", "school"),
    ("子ども", "child"), ("活動", "calendar"), ("説明", "help"), ("近所", "users"), ("声をまとめ", "megaphone"), ("回答", "chat"),
    ("資料が届", "folder"), ("行政の資料", "folder"), ("記録用紙", "clipboard"), ("記録", "edit"), ("時間と費用", "clock"),
    ("進み具合", "progress"), ("追加確認の入口", "tool"), ("田畑", "sprout"), ("山林", "tree"), ("土を盛る", "mountain"),
    ("道路", "road"), ("雨水", "droplet"), ("解体", "hammer"), ("川・崖", "waves"), ("広さ", "ruler"), ("現物", "compare"),
    ("用紙", "clipboard"), ("言葉", "book"), ("注意", "alert"), ("参考資料", "bookmark"), ("早見表", "table"), ("宿泊", "bed"),
    ("食品", "utensils"), ("遺体", "flower"), ("心配事から探す", "search"), ("食べ物", "utensils"), ("火", "flame"),
    ("ヤギ", "paw"), ("土葬", "grave"), ("行事", "users"), ("税金", "building"), ("不安", "heart")]
HEAD_ICON = [("電話", "phone"), ("つながったら", "phone"), ("メール", "mail"), ("フォーム", "mail"), ("注意", "alert"),
    ("記録", "edit"), ("書", "edit"), ("窓口", "building"), ("担当", "building"), ("回答", "chat"), ("聞", "chat"), ("質問", "help"),
    ("確認", "check"), ("前に", "check"), ("費用", "yen"), ("時間", "clock"), ("資料", "folder"), ("言葉", "book"),
    ("次", "arrow"), ("後", "arrow"), ("改善", "tool"), ("場合", "help"), ("例", "chat")]
def pick(table, text, default):
    for k, v in table:
        if k in text: return v
    return default

GROUPS = [  # (開始, 終了, 名前, 色, 薄い色, アイコン)
    (1, 5, "start", "#0e7468", "#e3f3f0", "start"), (6, 21, "worry", "#2a62a8", "#e7effa", "help"),
    (22, 30, "step", "#6c47b3", "#efe9fa", "edit"), (31, 50, "land", "#a9550c", "#fbefe1", "tool"),
    (51, 60, "ref", "#4f5f6e", "#edf0f3", "bookmark"), (61, 68, "quick", "#167a3d", "#e5f4ea", "table"),
    (69, 81, "life", "#b3324f", "#fbe9ed", "users"), (82, 84, "ref", "#4f5f6e", "#edf0f3", "bookmark"),
    (85, 85, "start", "#0e7468", "#e3f3f0", "chat")]
TAB_ORDER = ["start", "worry", "step", "land", "ref", "quick", "life"]
def group(n):
    for a, b, *g in GROUPS:
        if a <= n <= b: return g

def esc(s): return html.escape(s, quote=False)
def ptxt(runs): return "".join(r.get("s", "") for r in runs)

def runs_html(runs, k_sp=True):
    out = []
    for r in runs:
        if "sp" in r:
            out.append(f'<span class="sp" style="width:calc({r["sp"]}pt * var(--k))"></span>'); continue
        t = esc(r["s"])
        t = t.replace("□", '<span class="cb">□</span>')
        t = re.sub(r"(\d+(?:[〜～]\d+)?)?ページ", lambda m: f'<span class="nw">{m.group(0)}</span>', t)
        if r.get("b"): t = f"<b>{t}</b>"
        if r.get("a"): t = f'<span class="ac">{t}</span>'
        if "l" in r:
            href = f"#p{r['l']}" if isinstance(r["l"], int) else esc(r["l"])
            t = f'<a href="{href}">{t}</a>'
        out.append(t)
    return "".join(out)

def split_number(runs):
    """先頭の番号（例: 1　場所と…）を丸い番号にする。文字はそのまま残す"""
    if not runs or "s" not in runs[0]: return None, runs
    m = re.match(r"^(\d+)[\s　]+", runs[0]["s"])
    if not m: return None, runs
    rest = dict(runs[0], s=runs[0]["s"][m.end():])
    return m.group(1), [rest] + runs[1:]

def paras_html(paras):
    out = []
    for q in paras:
        cls = "note" if q.get("note") else ""
        out.append(f'<div class="{cls}">{runs_html(q["runs"])}</div>')
    return "".join(out)

def table_html(b, hdr_rows):
    colw = b["colw"]; cells = b["cells"]
    ncol = len(colw)
    # 中身のない細い列は落とす
    drop = set()
    for c in range(ncol):
        if colw[c] < 14 and all(not x["paras"] for x in cells if x["c"] <= c < x["c"] + x["cs"]):
            drop.add(c)
    keep = [c for c in range(ncol) if c not in drop]
    newc = {c: i for i, c in enumerate(keep)}
    tw = sum(colw[c] for c in keep)
    rows = {}
    for x in cells:
        span = [c for c in range(x["c"], x["c"] + x["cs"]) if c not in drop]
        if not span:
            assert not x["paras"], "dropped cell has text"
            continue
        x2 = dict(x, c=newc[span[0]], cs=len(span))
        rows.setdefault(x["r"], []).append(x2)
    def is_hdr(x):
        bb = x["bb"]; cy = (bb[1] + bb[3]) / 2
        return any(h[1] - 1 <= cy <= h[3] + 1 and h[0] - 1 <= (bb[0] + bb[2]) / 2 <= h[2] + 1 for h in hdr_rows)
    out = ['<table class="tb"><colgroup>' + "".join(f'<col style="width:{colw[c] / tw * 100:.2f}%">' for c in keep) + "</colgroup>"]
    for r in sorted(rows):
        rc = sorted(rows[r], key=lambda x: x["c"])
        if all(not x["paras"] for x in rc) and max(x["h"] for x in rc) < 6: continue
        anyempty = any(not x["paras"] for x in rc)
        hdr = all(is_hdr(x) for x in rc)
        tr = []
        for x in rc:
            tag = "th" if hdr else "td"
            attrs = ""
            if x["cs"] > 1: attrs += f' colspan="{x["cs"]}"'
            if x["rs"] > 1: attrs += f' rowspan="{x["rs"]}"'
            if anyempty and not hdr: attrs += f' style="height:{x["h"]}pt"'
            tr.append(f"<{tag}{attrs}>{paras_html(x['paras'])}</{tag}>")
        out.append(f'<tr class="{"hr" if hdr else ""}">' + "".join(tr) + "</tr>")
    out.append("</table>")
    if len(keep) == 1: out[0] = out[0].replace('class="tb"', 'class="tb one"')
    return "".join(out)

def is_say(text):
    # 吹き出し（相手に言う・送る文）か：「」で始まる文と、〔　〕の書き込み欄がある文例。それ以外の枠は説明なので電球のヒントにする
    return text.startswith("「") or "〔" in text

def close_at(t):
    # 最初の「が閉じる位置（まだ閉じていなければ -1）
    d = 0
    for j, ch in enumerate(t):
        if ch == "「": d += 1
        elif ch == "」":
            d -= 1
            if d == 0: return j
    return -1

def whole_quote(t):
    # 文全体が「」で囲まれた話す言葉か（まだ閉じていない＝次の行へ続く場合も含む）。
    # 「と畜」は…／「不要」なら… のように、言葉を引用して始まる説明文は吹き出しにしない
    t = t.strip()
    return t.startswith("「") and close_at(t) in (len(t) - 1, -1)

def split_quote_table(b):
    # 「」の文と「言葉：」だけを囲んだ枠（1列の表として読まれたもの）を、□見出し・吹き出し（＋言葉の説明）に戻す
    if b["t"] != "table": return None
    rows = {}
    for x in b["cells"]:
        if x["paras"]: rows.setdefault(x["r"], []).append(x)
    if not rows or any(len(v) != 1 for v in rows.values()): return None
    paras = [q for r in sorted(rows) for q in rows[r][0]["paras"]]
    texts = [ptxt(q["runs"]).strip() for q in paras]
    if not any(t.startswith("「") for t in texts) or not texts[-1].startswith("言葉："): return None
    heads, say, gloss = [], [], []
    for q, t in zip(paras, texts):
        if t.startswith("言葉："): gloss.append(q)
        elif t.startswith("□") and not say: heads.append(q)
        else: say.append(q)
    assert say and say[0] is not None and texts[len(heads)].startswith("「"), f"枠の形が想定外: {texts}"
    out = [dict(t="para", cls="h", runs=q["runs"], y=b["y"], y1=b["y"], x=0) for q in heads]
    # 表の行で折り返されていた「」の文は1つの段落につなぐ（例：「…許」＋「可の…」）
    out.append(dict(t="quote", y=b["y"], paras=[dict(runs=[r for q in say for r in q["runs"]], note=False)], gloss=gloss))
    return out

def page_html(pg):
    n = pg["n"]; gname, col, tint, gicon = group(n)
    blocks = []
    for b in pg["blocks"]:
        sp = split_quote_table(b)
        if sp: blocks.extend(sp); continue
        # 文の途中から枠で囲まれていた説明（例：76ページ「…一時安置や、焼」＋枠「骨を納める…」）は、前の段落につなぐ
        if b["t"] == "quote" and blocks and blocks[-1]["t"] == "para" and blocks[-1]["cls"] in ("p", "note"):
            first = ptxt(b["paras"][0]["runs"]).strip(); prev = ptxt(blocks[-1]["runs"]).strip()
            if not is_say(first) and not re.search(r"[。」）：]$", prev):
                blocks[-1] = dict(blocks[-1], runs=blocks[-1]["runs"] + [r for q in b["paras"] for r in q["runs"]])
                print(f"  p{pg['n']}: 途中で切れた文をつなぐ: …{prev[-8:]}＋{first[:8]}…")
                continue
        # 「」の文のすぐ後ろに太字の見出しがくっついた段落（例：13ページ「…教えてください。」＋「回答後にすること」）は分ける
        if b["t"] == "para" and b["cls"] == "p" and ptxt(b["runs"]).strip().startswith("「"):
            k = next((j for j, r in enumerate(b["runs"]) if r.get("s", "").rstrip().endswith("」")), None)
            rest = b["runs"][k + 1:] if k is not None else []
            if rest and all(r.get("b") for r in rest if r.get("s", "").strip()):
                blocks.append(dict(b, runs=b["runs"][:k + 1]))
                blocks.append(dict(b, cls="h", runs=rest))
                print(f"  p{pg['n']}: 「」の文と見出しを分ける: {ptxt(rest)}")
                continue
        blocks.append(b)
    title_txt = next((ptxt(b["runs"]) for b in blocks if b["t"] == "para" and b["cls"] == "title"), "")
    ticon = pick(TITLE_ICON, title_txt, gicon)
    out = []
    hdr = next((b for b in blocks if b["t"] == "header"), None)
    ftr = next((b for b in blocks if b["t"] == "footer"), None)
    body = [b for b in blocks if b["t"] not in ("header", "footer")]
    # ---- 頭 ----
    if hdr:
        left = [q for q in hdr["paras"] if q["x"] < 300]; right = [q for q in hdr["paras"] if q["x"] >= 300]
        out.append('<div class="hdr"><div class="nav">' + ic("list") + "".join(runs_html(q["runs"]) for q in left) +
                   '</div><div class="gname">' + "".join(runs_html(q["runs"]) for q in right) + "</div></div>")
    out.append('<div class="main">')
    seen_title = False; lead_done = False; mode = None; checks_open = False
    i = 0
    while i < len(body):
        b = body[i]; t = b["t"]
        if t != "check" and checks_open: out.append("</div>"); checks_open = False
        if t != "para": lead_done = True
        if t == "para":
            cls = b["cls"]; txt = ptxt(b["runs"]).strip()
            if cls == "title":
                rh = runs_html(b["runs"])
                rh = rh.replace("｜", '<span class="bar">｜</span><span class="sub">', 1) + ("</span>" if "｜" in rh else "")
                if n == 1:
                    out.append(f'<div class="cover"><div class="cv-txt"><h1>{rh}</h1>')
                    # 次の「はじめに…」もカバー内に
                    if i + 1 < len(body) and body[i + 1]["t"] == "para" and body[i + 1]["cls"] == "label":
                        out.append(f'<div class="cv-sub">{runs_html(body[i + 1]["runs"])}</div>'); i += 1
                    out.append(f'</div>{COVER_ART}</div>')
                else:
                    out.append(f'<div class="title"><div class="ticon">{ic(ticon)}</div><h1>{rh}</h1></div>')
                seen_title = True; i += 1; continue
            if seen_title and not lead_done and cls in ("p", "note") and not whole_quote(txt):
                # 直後に続く段落もまとめて「はじめの説明」カードに
                grp = [b]
                while i + 1 < len(body) and body[i + 1]["t"] == "para" and body[i + 1]["cls"] in ("p", "note") \
                        and body[i + 1]["y"] - grp[-1]["y1"] < 6 and not ptxt(body[i + 1]["runs"]).strip().endswith("："):
                    i += 1; grp.append(body[i])
                out.append('<div class="lead">' + ic("bulb", "i lic") + "<div>" +
                           "".join(f'<p class="{"sm" if g["cls"] == "note" else ""}">{runs_html(g["runs"])}</p>' for g in grp) + "</div></div>")
                lead_done = True; i += 1; continue
            lead_done = True
            if cls in ("h", "h2"):
                num, rr = split_number(b["runs"])
                hic = f'<span class="num">{esc(num)}</span>' if num else (
                    '' if txt.startswith("□") else f'<span class="hic">{ic(pick(HEAD_ICON, txt, ticon))}</span>')
                extra = ""
                if cls == "h2":
                    k = {"できること": "shield", "安心": "shield", "始め方": "start", "コツ": "bulb", "急ぐ": "bell"}
                    hic = f'<span class="hic">{ic(pick(list(k.items()), txt, "info"))}</span>'
                    extra = " h2" + (" urgent" if "急ぐ" in txt else "")
                out.append(f'<h2 class="h{extra}">{hic}<span class="ht">{runs_html(rr)}</span></h2>')
                mode = None; i += 1; continue
            if cls == "label":
                if txt == "できること": mode = "can"; out.append(f'<div class="lab can">{ic("check")}{runs_html(b["runs"])}</div>')
                elif txt == "できないこと": mode = "cannot"; out.append(f'<div class="lab cannot">{ic("x")}{runs_html(b["runs"])}</div>')
                else: out.append(f'<div class="lab">{runs_html(b["runs"])}</div>')
                i += 1; continue
            if cls == "bullet":
                grp = [b]
                while i + 1 < len(body) and body[i + 1]["t"] == "para" and body[i + 1]["cls"] == "bullet":
                    i += 1; grp.append(body[i])
                out.append(f'<div class="bl-card {mode or ""}">' + "".join(f'<div class="bl">{runs_html(g["runs"])}</div>' for g in grp) + "</div>")
                i += 1; continue
            if whole_quote(txt):
                # 自由配置の「話す言葉」も吹き出しに。「」が閉じていなければ続く行もまとめる
                grp = [b]
                while close_at("".join(ptxt(g["runs"]) for g in grp).strip()) < 0 and i + 1 < len(body) and body[i + 1]["t"] == "para" \
                        and body[i + 1]["cls"] in ("p", "note"):
                    i += 1; grp.append(body[i])
                assert whole_quote("".join(ptxt(g["runs"]) for g in grp)), f"p{n} 吹き出しの「」が文の途中で閉じる: {txt[:30]}"
                out.append('<div class="quote">' + ic("chat", "i qic") + '<div class="qb">' +
                           "".join(f"<div>{runs_html(g['runs'])}</div>" for g in grp) + "</div></div>")
                i += 1; continue
            rh = runs_html(b["runs"])
            if "救急は" in txt:
                rh = re.sub(r"(119|110|#9110)", r'<span class="tel">\1</span>', rh)
                out.append(f'<div class="emerg">{ic("phone", "i eic")}<div>{rh}</div></div>'); i += 1; continue
            m = re.match(r"^(あなた|代表|警察|担当)[\s　]*「", txt)
            if m:
                who = m.group(1); me = who == "あなた"
                av = ic({"あなた": "person", "代表": "building", "警察": "shield", "担当": "building"}[who])
                out.append(f'<div class="talk {"me" if me else "them"}"><div class="av">{av}</div><div class="bub">{rh}</div></div>'); i += 1; continue
            c = "note" if cls == "note" else "p"
            if txt.endswith("：") and i + 1 < len(body) and body[i + 1]["t"] == "field": c += " flabel"
            ind = f' style="margin-left:{min(b["x"], 40)}pt"' if b.get("x", 0) > 6 else ""
            out.append(f'<p class="{c}"{ind}>{rh}</p>'); i += 1; continue
        if t == "quote":
            if not is_say(ptxt(b["paras"][0]["runs"]).strip()):
                out.append('<div class="lead">' + ic("bulb", "i lic") + "<div>" +
                           "".join(f'<p>{runs_html(q["runs"])}</p>' for q in b["paras"]) + "</div></div>")
            else:
                gl = "".join('<div class="gl">' + runs_html(q["runs"]).replace("言葉：", '<b class="glk">言葉：</b>', 1) + "</div>"
                             for q in b.get("gloss", []))
                out.append('<div class="quote">' + ic("chat", "i qic") + '<div class="qcol"><div class="qb">' + paras_html(b["paras"]) +
                           "</div>" + gl + "</div></div>")
        elif t == "check":
            if not checks_open: out.append('<div class="checks">'); checks_open = True
            out.append(f'<div class="ck">{paras_html(b["paras"])}</div>')
        elif t == "hl":
            out.append(f'<div class="hl">{ic("info", "i hlic")}<div>{paras_html(b["paras"])}</div></div>')
        elif t == "field":
            out.append(f'<div class="field" style="height:{max(b["h"], 14)}pt">{paras_html(b["paras"])}{ic("pencil", "i fic")}</div>')
        elif t == "box":
            out.append(f'<div class="bigbox" style="height:{b["h"]}pt">{ic("map", "i bbic")}{paras_html(b["paras"])}</div>')
        elif t == "table":
            out.append(table_html(b, pg["hdr_rows"]))
        elif t == "tablefree":
            out.append(f"<p>{paras_html(b['paras'])}</p>")
        elif t == "footnote":
            pass  # 下でまとめて出す
        else:
            raise SystemExit(f"unknown block {t} on page {n}")
        i += 1
    if checks_open: out.append("</div>")
    out.append("</div>")  # main
    fn = [b for b in body if b["t"] == "footnote"]
    for b in fn:
        out.append(f'<div class="next">{ic("arrow", "i nic")}<div>{paras_html(b["paras"])}</div></div>')
    if ftr:
        left = [q for q in ftr["paras"] if q["x"] < 300]; right = [q for q in ftr["paras"] if q["x"] >= 300]
        out.append('<div class="ftr"><div>' + "".join(runs_html(q["runs"]) for q in left) +
                   '</div><div class="pno">' + "".join(runs_html(q["runs"]) for q in right) + "</div></div>")
    # つめ（章の見出しタブ、アイコンのみ）
    ti = TAB_ORDER.index(gname)
    tab = f'<div class="tab" style="top:{28 + ti * 31}mm">{ic(gicon)}</div>'
    return f'<section class="page g-{gname}" id="p{n}" style="--c:{col};--t:{tint}">{tab}' + "".join(out) + "</section>"

COVER_ART = '''<svg class="cv-art" viewBox="0 0 220 120" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 110h212" />
<path d="M14 110V72l22-18 22 18v38" /><path d="M28 110V90h14v20" /><path d="M20 76h8M44 76h8" />
<path d="M70 110V64h56v46" /><path d="M78 64a20 20 0 0 1 40 0" /><path d="M98 44v-8" /><path d="M90 110V92a8 8 0 0 1 16 0v18" /><path d="M78 76h8M110 76h8" />
<path d="M136 110V80l18-14 18 14v30" /><path d="M148 110V96h12v14" />
<path d="M188 110V92" /><path d="M188 94c-9 0-12-8-12-14 0-8 6-14 12-14s12 6 12 14c0 6-3 14-12 14z" />
<circle cx="204" cy="86" r="4"/><path d="M204 90v12M199 110l5-8 5 8M198 96h12"/>
<circle cx="62" cy="88" r="4"/><path d="M62 92v12M57 110l5-6 5 6M56 98h12"/>
</svg>'''

CSS = r"""
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0 }
body { font-kerning: none; text-rendering: optimizeSpeed; font-variant-ligatures: none; font-feature-settings: "liga" 0, "clig" 0; font-family: "BIZ UDPGothic", "Noto Sans JP", sans-serif; color: #1f2529; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { --k: 1; width: 210mm; height: 297mm; position: relative; overflow: hidden; break-after: page; padding: 11mm 15.5mm 8mm 14mm;
        display: flex; flex-direction: column; background: #fff }
.page:last-child { break-after: auto }
.i { width: 1em; height: 1em; flex: none; vertical-align: -0.14em }
a { color: inherit; text-decoration: none; border-bottom: 1.2px solid color-mix(in srgb, var(--c) 70%, #fff); color: color-mix(in srgb, var(--c) 85%, #000); font-weight: 700 }
.sp { display: inline-block }
.nw { white-space: nowrap }
.cb { color: var(--c); font-weight: 700 }
.ac { color: color-mix(in srgb, var(--c) 80%, #000) }
.tab { position: absolute; right: 0; width: 10mm; height: 26mm; background: var(--c); border-radius: 3mm 0 0 3mm; color: #fff;
       display: flex; align-items: center; justify-content: center }
.tab .i { width: 5.5mm; height: 5.5mm }
.hdr { display: flex; justify-content: space-between; align-items: center; font-size: 8pt; color: #5d6670; padding: 2mm 3mm;
       background: var(--t); border-radius: 2mm; margin-bottom: 4mm }
.hdr .nav { display: flex; align-items: center; gap: 1.5mm; color: #39424a }
.hdr .nav .i { color: var(--c); width: 1.2em; height: 1.2em }
.hdr .gname { color: var(--c); font-weight: 700 }
.main { overflow-wrap: anywhere; flex: 1; font-size: calc(10.4pt * var(--k)); line-height: 1.62; display: flex; flex-direction: column; gap: calc(2.4mm * var(--k)); min-height: 0 }
.main p { margin: 0 }
.title { display: flex; align-items: center; gap: 3.5mm; padding-bottom: 2.2mm; border-bottom: 2.5px solid var(--c); margin-bottom: 0.5mm }
.ticon { width: calc(13mm * var(--k)); height: calc(13mm * var(--k)); border-radius: 3.2mm; background: var(--c); color: #fff; display: flex; align-items: center; justify-content: center; flex: none }
.ticon .i { width: 62%; height: 62% }
.title h1 { margin: 0; font-size: calc(18.5pt * var(--k)); line-height: 1.3; font-weight: 700; color: #16202a }
.title .bar { color: color-mix(in srgb, var(--c) 45%, #fff); margin: 0 0.15em }
.title .sub { color: var(--c) }
.lead { display: flex; gap: 2.5mm; background: var(--t); border-radius: 2.5mm; padding: 2.4mm 3.2mm; align-items: flex-start }
.lead .lic { color: var(--c); width: 1.5em; height: 1.5em; margin-top: 0.05em }
.lead p.sm { font-size: 0.9em }
h2.h { margin: 1.2mm 0 0; display: flex; align-items: center; gap: 2mm; font-size: 1.12em; line-height: 1.4; font-weight: 700; color: #16202a;
       padding: 1mm 0 1.1mm; border-bottom: 1.6px solid color-mix(in srgb, var(--c) 35%, #fff) }
h2.h .hic { width: 1.75em; height: 1.75em; border-radius: 50%; background: var(--t); color: var(--c); display: flex; align-items: center; justify-content: center; flex: none }
h2.h .hic .i { width: 62%; height: 62% }
h2.h .num { width: 1.6em; height: 1.6em; border-radius: 50%; background: var(--c); color: #fff; display: flex; align-items: center; justify-content: center; flex: none; font-size: 0.95em }
h2.h .ht b { font-weight: 700 }
h2.h2 { background: var(--c); color: #fff; border: 0; border-radius: 2mm; padding: 1.2mm 2.5mm; margin-top: 1.5mm }
h2.h2 .hic { background: rgba(255,255,255,.22); color: #fff }
h2.h2 b, h2.h2 .cb { color: #fff }
h2.urgent { background: #c62828 }
.lab { font-weight: 700; display: inline-flex; align-items: center; gap: 1.5mm; color: var(--c) }
.lab.can { color: #1d7a3a } .lab.cannot { color: #b3261e }
.lab .i { width: 1.3em; height: 1.3em }
.bl-card { display: flex; flex-direction: column; gap: 0.6mm }
.bl-card.can { background: #eaf6ed; border-radius: 2mm; padding: 1.6mm 3mm; margin-top: -1.2mm }
.bl-card.cannot { background: #fdeceb; border-radius: 2mm; padding: 1.6mm 3mm; margin-top: -1.2mm }
.bl { padding-left: 1em; text-indent: -1em }
.note { font-size: 0.9em; color: #47515a }
p.note { padding-left: 2.5mm; border-left: 2px solid #d5dade }
p.flabel { font-weight: 700; color: #2c353d; border: 0; padding: 0; margin-bottom: -2mm }
.quote { display: flex; gap: 2.4mm; align-items: flex-start }
.quote .qic { width: calc(8mm * var(--k)); height: calc(8mm * var(--k)); padding: 1.6mm; border-radius: 50%; background: var(--c); color: #fff; margin-top: 0.6mm }
.quote .qb { position: relative; flex: 1; background: #fffaf0; border: 1.4px solid #e3cf9e; border-radius: 3mm; padding: 2mm 3.2mm }
.quote .qb::before { content: ""; position: absolute; left: -2.1mm; top: 3mm; width: 3.2mm; height: 3.2mm; background: #fffaf0;
       border-left: 1.4px solid #e3cf9e; border-bottom: 1.4px solid #e3cf9e; transform: rotate(45deg) }
.quote .qcol { flex: 1; min-width: 0 }
.quote .gl { margin-top: 1mm; padding: 1mm 3.2mm; font-size: 0.9em; color: #47515a; background: var(--t); border-radius: 2mm }
.quote .glk { color: var(--c); font-weight: 700 }
.checks { display: flex; flex-direction: column; gap: 1.4mm }
.ck { background: #fff; border: 1.4px solid color-mix(in srgb, var(--c) 30%, #fff); border-radius: 2mm; padding: 1.4mm 3mm }
.ck b { color: var(--c) }
.hl { display: flex; gap: 2mm; align-items: center; background: var(--t); border-radius: 2mm; padding: 1.6mm 3mm; font-weight: 700 }
.hl .hlic { color: var(--c); width: 1.3em; height: 1.3em }
.field { position: relative; border-bottom: 1.6px dashed color-mix(in srgb, var(--c) 55%, #fff); background: linear-gradient(to top, var(--t), rgba(255,255,255,0) 60%); flex: none }
.field .fic { position: absolute; right: 1mm; bottom: 1mm; color: color-mix(in srgb, var(--c) 60%, #fff); width: 1.1em; height: 1.1em }
.bigbox { position: relative; border: 1.6px dashed color-mix(in srgb, var(--c) 55%, #fff); border-radius: 3mm; padding: 2.5mm 3.5mm; color: #47515a; flex: none }
.bigbox .bbic { position: absolute; right: 4mm; bottom: 4mm; width: 16mm; height: 16mm; color: color-mix(in srgb, var(--c) 18%, #fff) }
table.tb { width: 100%; border-collapse: separate; border-spacing: 0; border: 1.3px solid color-mix(in srgb, var(--c) 30%, #fff); border-radius: 2.2mm; overflow: hidden; font-size: 0.95em; line-height: 1.5 }
.tb td, .tb th { padding: 1.3mm 2.2mm; vertical-align: top; text-align: left; border-top: 1px solid color-mix(in srgb, var(--c) 18%, #fff) }
.tb td + td, .tb th + th, .tb td + th, .tb th + td { border-left: 1px solid color-mix(in srgb, var(--c) 18%, #fff) }
.tb tr:first-child > * { border-top: 0 }
.tb th { background: var(--c); color: #fff; font-weight: 700 }
.tb th a, .tb th .cb, .tb th .ac, .tb th .note { color: #fff }
.tb tr:nth-child(even) td { background: color-mix(in srgb, var(--t) 55%, #fff) }
.tb td:first-child { font-weight: 700; color: #26303a }
.tb.one td:first-child { font-weight: 400 }
.tb .note { font-weight: 400 }
.emerg { display: flex; align-items: center; gap: 3mm; background: #fdecea; border: 1.6px solid #e57373; border-radius: 2.5mm; padding: 2mm 3.5mm; font-weight: 700 }
.emerg .eic { color: #c62828; width: 1.8em; height: 1.8em }
.tel { display: inline-block; background: #c62828; color: #fff; border-radius: 1.6mm; padding: 0 1.6mm; font-size: 1.25em; margin: 0 0.6mm; line-height: 1.35 }
.next { overflow-wrap: anywhere; display: flex; align-items: center; gap: 2mm; margin-top: 2.5mm; background: var(--t); border-left: 4px solid var(--c); border-radius: 1.5mm;
        padding: 1.8mm 3mm; font-size: 9pt; line-height: 1.5; color: #26303a }
.next .nic { color: var(--c); width: 1.4em; height: 1.4em }
.ftr { display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; color: #7a838b; margin-top: 2mm }
.ftr .pno { background: var(--c); color: #fff; border-radius: 3mm; padding: 0.4mm 2.6mm; font-weight: 700 }
.cover { display: flex; align-items: flex-end; justify-content: space-between; gap: 4mm; background: linear-gradient(135deg, var(--c), #2a8f80);
         color: #fff; border-radius: 4mm; padding: 5mm 6mm 4mm; margin-bottom: 1mm }
.cover h1 { margin: 0; font-size: calc(20pt * var(--k)); line-height: 1.35 }
.cv-sub { margin-top: 2mm; display: inline-block; background: rgba(255,255,255,.2); border-radius: 2mm; padding: 0.6mm 2.5mm; font-weight: 700; font-size: 1.02em }
.cv-sub .ac, .cv-sub b, .cover .ac, .cover b { color: #fff }
.talk { display: flex; gap: 2mm; align-items: flex-start }
.talk.me { flex-direction: row-reverse }
.talk .av { width: 7mm; height: 7mm; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; background: #e9edf0; color: #4f5f6e }
.talk.me .av { background: var(--c); color: #fff }
.talk .av .i { width: 60%; height: 60% }
.talk .bub { max-width: 84%; border-radius: 3mm; padding: 1.3mm 3mm; background: #fff; border: 1.3px solid #d5dce1 }
.talk.me .bub { background: var(--t); border-color: color-mix(in srgb, var(--c) 30%, #fff) }
/* 文字の多いページ：余白と行間を先に詰める */
.tight .main { line-height: 1.47; gap: calc(1.3mm * var(--k)) }
.tight .hdr { margin-bottom: 2.5mm; padding: 1.4mm 3mm }
.tight .title { padding-bottom: 1.5mm }
.tight .ticon { width: calc(10.5mm * var(--k)); height: calc(10.5mm * var(--k)) }
.tight h2.h { margin-top: 0.6mm; padding: 0.4mm 0 0.6mm }
.tight h2.h .hic { width: 1.5em; height: 1.5em }
.tight .quote .qic { width: calc(6.5mm * var(--k)); height: calc(6.5mm * var(--k)); padding: 1.2mm }
.tight .quote .qb { padding: 1.2mm 2.6mm }
.tight .lead { padding: 1.6mm 3mm }
.tight .tb td, .tight .tb th { padding: 0.8mm 1.8mm }
.tight .next { margin-top: 1.5mm; padding: 1.2mm 3mm }
.tight .cover { padding: 3.5mm 5mm 3mm }
.tight .cv-art { width: 44mm }
.tight .bl-card.can, .tight .bl-card.cannot { padding: 1mm 2.6mm }
.cv-art { width: 58mm; flex: none; color: rgba(255,255,255,.85) }
"""

FIT = r"""
<script>
document.querySelectorAll('.page').forEach(pg => {
  const m = pg.querySelector('.main');
  let k = 1.12;
  pg.style.setProperty('--k', k);
  const over = () => pg.scrollHeight > pg.clientHeight + 0.5 || m.scrollHeight > m.clientHeight + 0.5;
  while (over() && k > 0.96) { k = Math.round((k - 0.01) * 100) / 100; pg.style.setProperty('--k', k); }
  if (over()) { pg.classList.add('tight'); k = 1.04; pg.style.setProperty('--k', k);
    while (over() && k > 0.6) { k = Math.round((k - 0.01) * 100) / 100; pg.style.setProperty('--k', k); } }
  pg.dataset.k = k; if (over()) pg.dataset.overflow = '1';
});
</script>
"""

doc = ['<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>モスクなどの施設　確認と相談のガイド</title><style>', CSS,
       '</style></head><body><svg width="0" height="0" style="position:absolute">', SYMBOLS, "</svg>"]
for pg in P: doc.append(page_html(pg))
doc.append(FIT + "</body></html>")
open(OUT, "w", encoding="utf-8").write("".join(doc))
print("written", OUT)
