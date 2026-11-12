// 端末内保存（localStorage）。サーバーへは送らない。
// 同じ yumaki5555.github.io の他サイトと保存場所を共有しているため、名前の頭に必ず PREFIX を付け、
// 削除も PREFIX のものだけにする（localStorage.clear() は使わない）。
//
// 保存データを守るための決まり：
// - 読めない保存データ（壊れた・新しすぎる版）は、空のデータで上書きしない（別の名前に写してから使う。写せなければ保存を止める）
// - 相談ごとに版番号（rev）を持ち、別のタブで新しくなった相談を、古い内容で黙って上書きしない
// - 削除した相談は「削除した相談」に30日残し、元に戻せる。古いタブの操作で勝手に復活させない
// - 形を変えるとき（版を上げるとき）は、変える前の内容を別の名前に1回だけ写しておく
export const PREFIX = 'kurashi-navi:';
const KEY = PREFIX + 'files';
const SET = PREFIX + 'settings';
const UI = PREFIX + 'ui';
const RESCUE = PREFIX + 'files.unreadable';
const OLD = PREFIX + 'files.before-v2';
export const SCHEMA = 2;
const TRASH_DAYS = 30;

let memory = { schema: SCHEMA, files: [], trash: [] }, memSet = {}, memUi = {};
// 保存に失敗したら、端末の中の古い内容ではなく、画面で使っている最新の内容（memory）を読むようにする
let dirty = false;
// 読めない保存データがあり、写しも作れなかったとき：上書きしないよう保存を止める
let blocked = '';
export let lastOk = true;     // 直前の保存がうまくいったか（画面で知らせるため）
export let lastSavedAt = 0;   // 最後に保存できた時刻
export let conflict = null;   // 直前の保存を止めた理由 { type: 'newer' | 'deleted', id }

function ls() { try { return window.localStorage; } catch { return null; } }

export function available() {
  const s = ls();
  if (!s) return false;
  try { s.setItem(PREFIX + 'test', '1'); s.removeItem(PREFIX + 'test'); return true; } catch { return false; }
}

// 読めない保存データの状態（画面の「保存した相談」で知らせる）
export function problem() {
  const s = ls();
  let rescued = null;
  try { rescued = s?.getItem(RESCUE) ?? null; } catch { /* 読めなくてもよい */ }
  return { blocked, rescued: rescued ? rescued.length : 0 };
}
export function rescuedText() { try { return ls()?.getItem(RESCUE) || ''; } catch { return ''; } }
export function dropRescued() { try { ls()?.removeItem(RESCUE); } catch { /* なし */ } }

// 読めない内容は、空のデータで上書きする前に別の名前へ写す（同じ内容なら写し直さない）
function rescue(raw, why) {
  const s = ls();
  try {
    if (s.getItem(RESCUE) !== raw) s.setItem(RESCUE, raw);
    blocked = '';
    return true;
  } catch {
    blocked = why;
    return false;
  }
}

const isFile = f => !!f && typeof f === 'object' && typeof f.id === 'string' && typeof f.domain === 'string' &&
  !!f.state && typeof f.state === 'object' && typeof f.state.node === 'string' && !!f.state.facts && Array.isArray(f.state.history);

// 古い形（版1）を今の形にする。答え・記録・下書きは変えず、版番号と「削除した相談」を足すだけ
function upgrade(v, raw) {
  if (!v.schema || v.schema < SCHEMA) {
    const s = ls();
    try { if (s && raw && s.getItem(OLD) == null) s.setItem(OLD, raw); } catch { /* 写せなくても、足すだけの変更なので進める */ }
  }
  const files = v.files.filter(f => f && typeof f.id === 'string');
  for (const f of files) if (!(f.rev >= 1)) f.rev = 1;
  const limit = Date.now() - TRASH_DAYS * 864e5;
  const trash = (Array.isArray(v.trash) ? v.trash : []).filter(t => t?.file?.id && Date.parse(t.deletedAt) > limit);
  return { ...v, schema: SCHEMA, files, trash };
}

export function loadAll() {
  if (dirty) return memory;
  const s = ls();
  if (!s) return memory;
  let raw = null;
  try { raw = s.getItem(KEY); } catch { return memory; }
  if (raw == null) return { schema: SCHEMA, files: [], trash: [] };
  let v = null;
  try { v = JSON.parse(raw); } catch { v = null; }
  if (v && Array.isArray(v.files)) {
    if (v.schema > SCHEMA) { blocked = 'newer'; return { ...v, trash: v.trash || [] }; }
    return upgrade(v, raw);
  }
  // 読めない：写してから空で始める（写せなければ保存を止める）
  rescue(raw, 'unreadable');
  return blocked ? memory : { schema: SCHEMA, files: [], trash: [] };
}

function saveAll(db) {
  memory = db;
  const s = ls();
  try {
    if (!s) throw new Error('保存場所がありません');
    if (blocked) throw new Error('読めない保存データを守るため、保存を止めています');
    s.setItem(KEY, JSON.stringify({ ...db, schema: SCHEMA }));
    dirty = false; lastOk = true; lastSavedAt = Date.now();
  } catch { dirty = true; lastOk = false; }
  return lastOk;
}

// 食い違いの知らせを消す（最新の内容を読み直したとき）
export function clearConflict() { conflict = null; lastOk = !dirty; }

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function listFiles() { return loadAll().files.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); }
export function getFile(id) { return loadAll().files.find(f => f.id === id) || null; }
export function revOf(id) { return getFile(id)?.rev || 0; }

// 保存。別のタブで新しくなっていたら（版番号が違う）・削除されていたら、上書きせずに止める（conflict に理由）。
// force：利用者が「この画面の内容で上書きする」を選んだとき。touch=false：中身の形を直すだけ（更新日時を変えない）
export function putFile(file, touch = true, force = false) {
  conflict = null;
  const db = loadAll();
  const i = db.files.findIndex(f => f.id === file.id);
  const stored = i >= 0 ? db.files[i] : null;
  const gone = db.trash.findIndex(t => t.file.id === file.id);
  if (!force) {
    // 保存先に無い相談：ごみ箱にある（削除済み）か、一度は保存した相談（rev 1以上）なら、完全に削除・すべて削除のあとなので、古い画面から復活させない
    if (!stored && (gone >= 0 || (file.rev || 0) > 0)) { conflict = { type: 'deleted', id: file.id }; lastOk = false; return false; }
    if (stored && stored !== file && (stored.rev || 1) !== (file.rev || 1)) { conflict = { type: 'newer', id: file.id }; lastOk = false; return false; }
  }
  if (gone >= 0) db.trash.splice(gone, 1);
  file.rev = Math.max(stored?.rev || 0, file.rev || 0) + 1;
  if (touch) file.updatedAt = new Date().toISOString();
  if (i >= 0) db.files[i] = file; else db.files.push(file);
  // 保存できなかったときも、画面の内容は memory に残る（次の保存で同じ内容を書く）
  return saveAll(db);
}

// 相談1件の削除：「削除した相談」へ移す（30日間は元に戻せる）
export function removeFile(id) {
  const db = loadAll();
  const f = db.files.find(x => x.id === id);
  if (!f) return false;
  db.files = db.files.filter(x => x.id !== id);
  db.trash = [...db.trash.filter(t => t.file.id !== id), { file: f, deletedAt: new Date().toISOString() }];
  return saveAll(db);
}
export function listTrash() { return loadAll().trash.slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)); }
export function undelete(id) {
  const db = loadAll();
  const t = db.trash.find(x => x.file.id === id);
  if (!t) return false;
  db.trash = db.trash.filter(x => x.file.id !== id);
  const f = { ...t.file, rev: (t.file.rev || 1) + 1 };
  db.files = [...db.files.filter(x => x.id !== id), f];
  return saveAll(db);
}
// 削除した相談を、完全に消す（元に戻せない）
export function purge(id) {
  const db = loadAll();
  db.trash = db.trash.filter(x => x.file.id !== id);
  return saveAll(db);
}

// 相談を作る（画面からは、1問目に答えたときだけ呼ぶ。開始ボタンを押しただけでは作らない）
export function createFile(domain, state, extra = {}) {
  const now = new Date().toISOString();
  const f = { id: newId(), rev: 0, domain, title: '', createdAt: now, updatedAt: now, state, done: false, checks: {}, records: [], statusLog: [], region: null, docs: {}, info: {}, ...extra };
  putFile(f);
  return f;
}

// 古い形の保存データを今の形に直す。fix(file) が true を返したものがあれば保存し直す（消さずに書き換えるだけ）
export function migrateAll(fix) {
  const db = loadAll();
  let changed = false;
  for (const f of db.files) if (fix(f)) changed = true;
  if (changed) saveAll(db);
  return changed;
}

export function getSettings() { try { return JSON.parse(ls()?.getItem(SET) || '{}'); } catch { return memSet; } }
export function setSettings(patch) { memSet = { ...getSettings(), ...patch }; try { ls()?.setItem(SET, JSON.stringify(memSet)); } catch { /* 保存できなくても動く */ } }

// 画面の覚え書き（相談ごとの最後に見た画面・記録の書きかけ）。相談の中身とは別に置き、版番号を動かさない
export function getUi() { try { return JSON.parse(ls()?.getItem(UI) || '{}'); } catch { return memUi; } }
export function setUi(fn) { const u = getUi(); fn(u); memUi = u; try { ls()?.setItem(UI, JSON.stringify(u)); } catch { /* 保存できなくても動く */ } }

// ---- バックアップ（復元用のファイル）----
export function backupText() {
  const files = loadAll().files;
  return JSON.stringify({ app: 'kurashi-navi', version: SCHEMA, exportedAt: new Date().toISOString(), count: files.length, files }, null, 2);
}

// 復元の前に、何が起きるかを調べる（端末の相談は消さない。同じ相談は新しい方を残す）
export function planRestore(text) {
  let v;
  try { v = JSON.parse(text); } catch { throw new Error('ファイルを読めませんでした。このサイトの「バックアップを保存」で作ったファイル（.json）を選んでください。'); }
  if (v?.app !== 'kurashi-navi' || !Array.isArray(v.files)) throw new Error('このサイトのバックアップファイルではありません。');
  if (v.version > SCHEMA) throw new Error('このサイトの新しい版で作られたバックアップのため、読み込めません。端末の相談はそのままです。');
  const db = loadAll();
  const plan = { add: [], replace: [], keep: [], invalid: 0, exportedAt: v.exportedAt || '' };
  for (const f of v.files) {
    if (!isFile(f)) { plan.invalid++; continue; }
    const cur = db.files.find(x => x.id === f.id);
    if (!cur) plan.add.push(f);
    else if ((f.updatedAt || '') > (cur.updatedAt || '')) plan.replace.push(f);
    else plan.keep.push(f);
  }
  return plan;
}
export function applyRestore(plan) {
  if (blocked) { lastOk = false; return false; }
  const db = loadAll();
  for (const f of [...plan.add, ...plan.replace]) {
    const i = db.files.findIndex(x => x.id === f.id);
    const g = { ...f, rev: Math.max(f.rev || 1, i >= 0 ? db.files[i].rev || 1 : 0) + 1 };
    if (i >= 0) db.files[i] = g; else db.files.push(g);
    db.trash = db.trash.filter(t => t.file.id !== f.id);
  }
  return saveAll(db);
}

// このサイトのデータをすべて消す（PREFIX の付いたものだけ。ほかのサイトのデータには触れない）
export function clearAll() {
  memory = { schema: SCHEMA, files: [], trash: [] }; memSet = {}; memUi = {}; dirty = false; blocked = ''; lastOk = true;
  const s = ls();
  if (!s) return;
  const keys = [];
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
  keys.forEach(k => s.removeItem(k));
}
export const FILES_KEY = KEY;
