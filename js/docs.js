// 文書の下書き：ひな形の各行は requires の欄がすべて入力されたときだけ出す。
// 入力していない被害や法令違反を、勝手に書き足さないための仕組み。unless の欄が入力されていれば、その行は出さない（書き分け用）。
import { test } from './engine.js';

export const filled = v => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');
const str = v => (Array.isArray(v) ? v.join('、') : String(v ?? '').trim());

// 見出しの行（■ で始まる行・【要旨】のような1行だけの見出し）は、その下に出す行が1つもなければ出さない（空欄の項目は、見出しごと文章に出さない）
const HEAD = /^(■|【[^】]*】\s*$)/;
export function docLines(doc, values) {
  const ls = doc.body
    .filter(l => (l.requires || []).every(k => filled(values[k])) && !(l.unless || []).some(k => filled(values[k])))
    .map(l => l.text.replace(/\{([a-z_]+)\}/g, (_, k) => str(values[k])));
  return ls.filter((t, i) => {
    if (!HEAD.test(t)) return true;
    const nx = ls.slice(i + 1).find(x => x.trim() !== '');
    return nx !== undefined && !HEAD.test(nx);
  });
}

export function renderDoc(doc, values) {
  return docLines(doc, values).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 部品を外したあとに残る区切り（「 → 」「／」）を整える
const tidy = s => s.replace(/(\s*→\s*){2,}/g, ' → ').replace(/^(\s*→\s*)+|(\s*→\s*)+$/g, '').replace(/／{2,}/g, '／').replace(/^／+|／+$/g, '').replace(/：／/g, '：');

// 結果の案内の文：文字列か、部品の並び（[文字列 | {t, when}]）。答えに当てはまる部品だけをつなげる（答えていない事実を書かないため）。
// {key|既定の文} は、相談の共通情報（場所・困りごとなど）が入っていればそれに、なければ既定の文にする
export function fillText(v, facts = {}, vars = {}) {
  const s = Array.isArray(v) ? tidy(v.filter(p => typeof p === 'string' || test(p.when, facts)).map(p => (typeof p === 'string' ? p : p.t)).join('')) : String(v ?? '');
  return s.replace(/\{([a-z_]+)\|([^}]*)\}/g, (_, k, d) => (filled(vars[k]) ? str(vars[k]) : d));
}
