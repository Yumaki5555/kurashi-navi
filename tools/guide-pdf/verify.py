# 元PDFと新PDFの文字を照合する（空白・改行は無視）
import sys, collections, pymupdf, json
A = pymupdf.open(sys.argv[1]); B = pymupdf.open(sys.argv[2]); rep = open(sys.argv[3], "w", encoding="utf-8")
def vis_lines(page):
    raw = page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_PRESERVE_LIGATURES | pymupdf.TEXT_CLIP)
    out = []
    for b in raw["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            t = "".join(c["c"] for s in l["spans"] for c in s["chars"])
            t = "".join(t.split())
            if t: out.append(t)
    return out
def links(page):
    return sorted(str(l.get("page", -1) + 1 if l.get("kind") in (pymupdf.LINK_GOTO, pymupdf.LINK_NAMED) else l.get("uri")) for l in page.get_links())
ok = True
rep.write(f"pages: original {len(A)} / new {len(B)}\n")
if len(A) != len(B): ok = False
bad_pages = []
for i in range(min(len(A), len(B))):
    la = vis_lines(A[i]); sa = "".join(la)
    sb = "".join("".join(vis_lines(B[i])))
    ca, cb = collections.Counter(sa), collections.Counter(sb)
    miss = ca - cb; extra = cb - ca
    notsub = [l for l in la if l not in sb]
    lk_a = collections.Counter(links(A[i])); lk_b = collections.Counter(links(B[i]))
    # リンク先のページ番号の集合が同じか（1つの文字列リンクが分割される場合もあるので種類で比較）
    lk_ok = set(lk_a) == set(lk_b)
    # はみ出し
    pr = B[i].rect
    outside = [w[4] for w in B[i].get_text("words") if w[3] > pr.y1 - 2 or w[2] > pr.x1 - 1]
    if miss or extra or notsub or not lk_ok or outside:
        ok = False; bad_pages.append(i + 1)
        rep.write(f"--- page {i+1}\n")
        if miss: rep.write(f"  MISSING chars: {dict(miss)}\n")
        if extra: rep.write(f"  EXTRA chars: {dict(extra)}\n")
        for l in notsub[:8]: rep.write(f"  line not found as-is: {l}\n")
        if not lk_ok: rep.write(f"  links orig {sorted(set(lk_a))} new {sorted(set(lk_b))}\n")
        if outside: rep.write(f"  OUTSIDE: {outside[:5]}\n")
rep.write(f"RESULT: {'ALL OK' if ok else 'PROBLEMS on pages ' + str(bad_pages)}\n")
print("RESULT:", "ALL OK" if ok else f"problems on {len(bad_pages)} pages: {bad_pages}")
