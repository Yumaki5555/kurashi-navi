// 文書の下書き：ひな形の各行は requires の欄がすべて入力されたときだけ出す。
// 入力していない被害や法令違反を、勝手に書き足さないための仕組み。
export const filled = v => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');
const str = v => (Array.isArray(v) ? v.join('、') : String(v ?? '').trim());

export function docLines(doc, values) {
  return doc.body
    .filter(l => (l.requires || []).every(k => filled(values[k])))
    .map(l => l.text.replace(/\{([a-z_]+)\}/g, (_, k) => str(values[k])));
}

export function renderDoc(doc, values) {
  return docLines(doc, values).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
