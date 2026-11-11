// 対応記録と「次の一手」。画面には触れない（テストからも使う）。
import { test } from './engine.js';

export const STATUS = [
  { value: 'resolved', label: '解決した' },
  { value: 'partial', label: '一部よくなった' },
  { value: 'same', label: '変化なし' },
  { value: 'worse', label: '悪くなった' },
  { value: 'ongoing', label: 'まだ対応中' }
];

export const currentStatus = file => (file.statusLog || []).at(-1)?.status || null;

// 段階（はしご）のうち、済んだもの・次にすること・その先を分ける。
// 済んだ判定：診断の答え（doneIf）か、記録に同じ相手の種類（toTypes。methods があれば方法も一致）があること。
export function ladderState(ladder, facts, records = []) {
  const steps = ladder.steps.filter(s => test(s.showIf, facts));
  const count = {};
  for (const r of records) count[r.toType] = (count[r.toType] || 0) + 1;
  const isDone = s =>
    (s.doneIf && test(s.doneIf, facts)) ||
    (s.anyRecord && records.length > 0) ||
    records.some(r => (s.toTypes || []).includes(r.toType) && (!s.methods || s.methods.includes(r.method)));
  const done = [], todo = [];
  for (const s of steps) (isDone(s) ? done : todo).push(s);
  const repeated = Object.entries(count).filter(([, n]) => n >= 2).map(([t]) => t);
  return { done, next: todo[0] || null, later: todo.slice(1), repeated };
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
    if (r.next) lines.push('  次にすること：' + esc1(r.next));
    lines.push('  状況：' + (labels.state[r.state] || '—'), '');
  });
  if ((file.statusLog || []).length) {
    lines.push('【状態の変化】');
    file.statusLog.forEach(s => lines.push(`${s.date}　${STATUS.find(x => x.value === s.status)?.label || ''}${s.note ? '　' + s.note : ''}`));
  }
  return lines.join('\n');
}
