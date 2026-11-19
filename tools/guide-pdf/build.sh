#!/bin/bash
# 使い方: bash tools/guide-pdf/build.sh  （元のPDF src/guide.pdf を 解析→HTML→PDF→照合。できたPDFは work/new.pdf）
S="$(cygpath -m "$(cd "$(dirname "$0")" && pwd)")"
W="$S/work"; mkdir -p "$W"
python -I -X utf8 "$S/parse.py" "$S/src/guide.pdf" "$W/pages.json" 2>&1 | grep -v pymupdf_layout; [ ${PIPESTATUS[0]} -eq 0 ] || exit 1
python -I -X utf8 "$S/render.py" "$W/pages.json" "$W/guide.html" || exit 1
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf-no-header \
  --virtual-time-budget=30000 --print-to-pdf="$(cygpath -w "$W/new.pdf")" "file:///$(cygpath -m "$W/guide.html")" 2>/dev/null
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --virtual-time-budget=30000 --dump-dom "file:///$(cygpath -m "$W/guide.html")" 2>/dev/null > "$W/dom.html"
python -I -X utf8 -c "
import re,sys
d=open(sys.argv[1],encoding='utf-8').read()
r=[(int(a),float(b),'overflow' in c) for a,b,c in re.findall(r'id=\"p(\d+)\"[^>]*?data-k=\"([\d.]+)\"([^>]*)',d)]
open(sys.argv[2],'w').write(' '.join(f'{a}:{b}' for a,b,c in r))
print('fit: smallest', sorted(r,key=lambda x:x[1])[:10], 'overflow', [a for a,b,c in r if c])
" "$W/dom.html" "$W/fit.txt"
python -I -X utf8 "$S/verify.py" "$S/src/guide.pdf" "$W/new.pdf" "$W/verify.txt" 2>&1 | grep -v pymupdf_layout
