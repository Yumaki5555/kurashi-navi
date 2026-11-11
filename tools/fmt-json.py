# JSONを読みやすく整形する（短い {…} や […] は1行にまとめる）。使い方：python tools/fmt-json.py ファイル…
import json, sys

def one(v):
    s = json.dumps(v, ensure_ascii=False, separators=(', ', ': '))
    if isinstance(v, dict) and v: s = '{ ' + s[1:-1] + ' }'
    return s

def fmt(v, ind=0, width=150):
    pad = '  ' * ind
    s = one(v)
    if not isinstance(v, (dict, list)) or len(s) + len(pad) <= width or not v:
        return s
    inner = '  ' * (ind + 1)
    if isinstance(v, list):
        return '[\n' + ',\n'.join(inner + fmt(x, ind + 1, width) for x in v) + '\n' + pad + ']'
    return '{\n' + ',\n'.join(inner + json.dumps(k, ensure_ascii=False) + ': ' + fmt(x, ind + 1, width) for k, x in v.items()) + '\n' + pad + '}'

for p in sys.argv[1:]:
    d = json.load(open(p, encoding='utf-8'))
    open(p, 'w', encoding='utf-8', newline='\n').write(fmt(d) + '\n')
