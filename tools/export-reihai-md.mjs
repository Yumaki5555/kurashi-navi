// 礼拝施設の確認チェックリストの全文（構成・質問分岐・項目・質問文・回答別の次の一手）を、データから読みやすい文書に書き出す。
// 使い方：node tools/export-reihai-md.mjs  → research/reihai_checklist_全文.md（サイトには不要。見直し用）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const D = JSON.parse(readFileSync('data/reihai/checklist.json', 'utf8'));
const SRC = Object.fromEntries(JSON.parse(readFileSync('data/sources.json', 'utf8')).sources.map(s => [s.id, s]));
const WHO = { all: 'だれでも', pub: '公開情報', owner: '所有者など限定', foi: '情報公開請求', local: '自治体ごと', self: '自分で作成' };
const qLabel = (qid, v) => D.questions.find(q => q.id === qid)?.options?.find(o => o.v === v)?.label || v;
function cond(w) {
  if (!w) return '常に表示（基本の項目）';
  if (w.not) return `（${cond(w.not)}）ではない`;
  if (w.any) return w.any.map(cond).join(' または ');
  if (w.all) return w.all.map(cond).join(' かつ ');
  if (w.pick) return `項目${w.pick}で「${w.in.map(v => D.items.find(i => i.id === w.pick).pick.options.find(o => o.v === v).label).join('・')}」`;
  const q = D.questions.find(x => x.id === w.q);
  return `「${q.text.replace(/（いくつでも）/, '')}」で「${(w.in || w.has).map(v => qLabel(w.q, v)).join('・')}」`;
}
const o = [];
o.push(`# ${D.title}（${D.kicker}）`, '', `データ：data/reihai/checklist.json／確認日 ${D.checked}／このファイルは tools/export-reihai-md.mjs で自動生成`, '', D.lead, '');
o.push('## 考え方', ...D.principles.map(x => `- ${x}`), '', '## 記録するときの注意', ...D.safety.map(x => `- ${x}`), '', '## 扱わないこと', ...D.outOfScope.map(x => `- ${x}`), '');
o.push(`行政に出す相談票の「お願い」欄の基本文：${D.askClose}`, '');
o.push('## 画面の流れ', '1. 入口（考え方・誤解しやすい点）→ 2. 最初の質問（1画面1問・最大10問）→ 3. 項目の一覧（「まずここから」5件＋分類ごと。関係しない項目は「ほかの項目」に折りたたみ）→ 4. 項目の詳細（1画面1項目・状態・メモ）', '5. 比較表（登記・建築・開発・課税・消防）／記録表／回答別の次の一手／書き出す（6種類）', '');
o.push(`状態：${D.statuses.map(s => s.label).join('／')}（未確認は違反の数として数えない。危険度は計算しない）`, '', `根拠の区分：${Object.values(D.levels).join('／')}`, '');
o.push('## 最初の質問と分岐', '');
D.questions.forEach((q, i) => {
  o.push(`### Q${i + 1}. ${q.text}${q.when ? `（表示条件：${cond(q.when)}）` : ''}`);
  if (q.help) o.push(`補足：${q.help}`);
  if (q.options) o.push(...q.options.map(x => `- ${x.label}${x.ex ? '（ほかと同時に選べない）' : ''}${x.when ? `（表示条件：${cond(x.when)}）` : ''}`));
  if (q.fields) o.push(...q.fields.map(f => `- 入力欄：${f.label}`));
  o.push('');
});
o.push('## チェック項目', '');
for (const g of D.groups) {
  o.push(`### ${g.id}. ${g.title}`, g.lead, '');
  for (const it of D.items.filter(x => x.g === g.id)) {
    o.push(`#### ${it.id} ${it.t}`, `- 表示：${cond(it.when)}`, `- なぜ確認するのか：${it.why}`);
    if (it.self?.length) o.push('- 利用者が確認する事実：', ...it.self.map(x => `  - ${x}`));
    if (it.gov?.length) o.push('- 行政に確認してもらう事項：', ...it.gov.map(x => `  - ${x}`));
    if (it.docs?.length) o.push('- 入手できる資料と取得先：', ...it.docs.map(d => `  - ${d.n}：${d.w}（${WHO[d.who]}）`));
    if (it.dept?.length) o.push(`- 担当部署の候補：${it.dept.map(d => D.depts[d]).join('／')}`);
    if (it.ask) o.push(`- そのまま使える質問文：${it.ask}`);
    for (const [d, t] of Object.entries(it.askBy || {})) o.push(t ? `- そのまま使える質問文（${D.depts[d]}あて）：${t}` : `- ${D.depts[d]}あての相談票・質問一覧には、この項目の質問文を入れない`);
    for (const v of it.vary || []) o.push(`- 言いかえ（${cond(v.when)}のとき）：`, ...['t', 'ask', 'req'].filter(k => v[k]).map(k => `  - ${{ t: '項目名', ask: '質問文', req: '求める対応' }[k]}：${v[k]}`));
    if (it.req) o.push(`- 求める対応：${it.req}`);
    o.push('- 回答後の次の行動：', ...it.next.map(x => `  - ${x}`));
    if (it.pick) o.push(`- 記録する値：${it.pick.options.map(x => x.label).join('／')}`);
    if (it.warn) o.push(`- 誤解しやすい点：${it.warn}`);
    o.push('- 根拠（確認日 ' + D.checked + '）：', ...it.basis.map(b => `  - 【${D.levels[b.k]}】${b.s}${b.src ? `（${SRC[b.src]?.title || b.src}）` : ''}`), '');
  }
}
o.push('## 比較表（現況と各制度の記録）', `列：現況／各制度の記録／一致・不一致・不明（${D.cross.match.map(m => m.label).join('・')}）／確認先／回答／次の対応`, '');
o.push('| 制度 | 確認する事項 | 第三者が取れるか |', '|---|---|---|', ...D.cross.rows.map(r => `| ${r.label} | ${r.what} | ${r.access} |`), '', '見落としやすい点：', ...D.cross.pitfalls.map(p => `- ${p}`), '');
o.push('## 行政の回答別「次の一手」', '');
for (const r of D.responses) o.push(`### ${r.said}`, r.mean, '', `質問文：${r.ask}`, ...r.then.map(t => `- ${t}`), '');
o.push('## 回答がない・改善しないときの進め方', ...D.routes.map(r => `- **${r.t}**【${D.levels[r.k]}】${r.d}`), '');
o.push('## 誤解しやすい点', '| よくある誤解 | 正しくは |', '|---|---|', ...D.myths.map(m => `| ${m.wrong} | ${m.right} |`), '');
o.push('## 出力（書き出す画面）', '1. 優先して確認する項目　2. 担当部署別の質問一覧　3. 相談票（部署を選ぶ・質問は優先度順に5つまで・回答の希望日は任意）　4. 比較表　5. 記録表　6. 回答がない・改善しないときの次の行動', '');
o.push('## 根拠資料', ...[...new Set(D.items.flatMap(i => i.basis.map(b => b.src)).concat(D.routes.map(r => r.src)).filter(Boolean))].map(id => SRC[id]).filter(Boolean).map(s => `- ${s.title}（${s.publisher}、確認日 ${s.checked}）${s.url}`));
mkdirSync('research', { recursive: true });
writeFileSync('research/reihai_checklist_全文.md', o.join('\n') + '\n');
console.log('書き出し：research/reihai_checklist_全文.md', o.length, '行');
