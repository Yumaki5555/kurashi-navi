// 対応記録と「次の一手」。画面には触れない（テストからも使う）。
import { test } from './engine.js';

export const STATUS = [
  { value: 'resolved', label: '解決した' },
  { value: 'partial', label: '一部よくなった' },
  { value: 'same', label: '変化なし' },
  { value: 'worse', label: '悪くなった' },
  { value: 'ongoing', label: 'まだ対応中' },
  { value: 'waiting', label: '回答を待っている' },
  { value: 'paused', label: '今は休む・中断する' }
];
// 回答の期限の種類（法律などで決まった期限・相手が示した予定・自分で決めた目安は、意味が違うので分けて記録する）
export const DUE_TYPES = { law: '法律・条例などで決まった期限', them: '相手が示した予定', mine: '自分で決めた目安' };

export const currentStatus = file => (file.statusLog || []).at(-1)?.status || null;

// 記録の画面の「今の状態」を、診断の「その後どうなったか」（outcome）に読み替える。「まだ対応中」は読み替えない
export const STATUS_OUTCOME = { resolved: 'improved', partial: 'partial', same: 'same', worse: 'worse' };

const localToday = () => new Date().toLocaleDateString('sv-SE');
// 実際にしたこと：状況が「これからする（予定）」ではなく、日付が今日以前のもの。予定は済んだ判定に使わない
export const isPlanned = (r, today = localToday()) => r.state === 'todo' || (!!r.date && r.date > today);

// 段階（はしご）のうち、済んだもの・次にすること・その先を分ける。
// 済んだ判定：診断の答え（doneIf）か、実際にした記録に同じ相手の種類（toTypes。methods があれば方法も一致）があること。
export function ladderState(ladder, facts, records = [], today = localToday()) {
  const steps = ladder.steps.filter(s => test(s.showIf, facts));
  const did = records.filter(r => !isPlanned(r, today));
  // 同じ相手への繰り返し：相手の種類と部署・名前が同じ「実際にした」記録で数える
  const count = {};
  for (const r of did) { const k = r.toType + '\u0000' + String(r.toName || '').replace(/\s/g, ''); count[k] = (count[k] || 0) + 1; }
  const isDone = s =>
    (s.doneIf && test(s.doneIf, facts)) ||
    (s.anyRecord && did.length > 0) ||
    did.some(r => (s.toTypes || []).includes(r.toType) && (!s.methods || s.methods.includes(r.method)));
  const done = [], todo = [];
  for (const s of steps) (isDone(s) ? done : todo).push(s);
  const repeated = Object.entries(count).filter(([, n]) => n >= 2).map(([k]) => { const [toType, toName] = k.split('\u0000'); return { toType, toName }; });
  const planned = records.filter(r => isPlanned(r, today));
  return { done, next: todo[0] || null, later: todo.slice(1), repeated, planned };
}

const esc1 = v => String(v ?? '').replace(/\r?\n/g, '\n    ');

export function recordsText(file, labels) {
  const lines = [`【対応の記録】${file.title || ''}`, `出力日：${new Date().toLocaleDateString('ja-JP')}`, ''];
  const st = currentStatus(file);
  if (st) lines.push(`今の状態：${STATUS.find(s => s.value === st)?.label}`, '');
  const rs = (file.records || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!rs.length) lines.push('（記録はまだありません）');
  rs.forEach((r, i) => {
    lines.push(`■ ${i + 1}. ${r.date || '日付なし'}　${labels.toType[r.toType] || ''}${r.toName ? '（' + r.toName + '）' : ''}　${labels.method[r.method] || ''}`);
    if (r.content) lines.push('  内容：' + esc1(r.content));
    if (r.response) lines.push('  回答：' + esc1(r.response));
    if (r.resultType && labels.result?.[r.resultType]) lines.push('  回答の種類：' + labels.result[r.resultType]);
    if (r.next) lines.push('  次にすること：' + esc1(r.next));
    lines.push('  状況：' + (labels.state[r.state] || '—'), '');
  });
  if ((file.statusLog || []).length) {
    lines.push('【状態の変化】');
    file.statusLog.forEach(s => lines.push(`${s.date}　${STATUS.find(x => x.value === s.status)?.label || ''}${s.note ? '　' + s.note : ''}`));
  }
  return lines.join('\n');
}
