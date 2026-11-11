// 端末内保存（localStorage）。サーバーへは送らない。
// 同じ yumaki5555.github.io の他サイトと保存場所を共有しているため、名前の頭に必ず PREFIX を付け、
// 削除も PREFIX のものだけにする（localStorage.clear() は使わない）。
export const PREFIX = 'kurashi-navi:';
const KEY = PREFIX + 'files';
const SET = PREFIX + 'settings';
let memory = { files: [] }, memSet = {};
// 保存に失敗したら、端末の中の古い内容ではなく、画面で使っている最新の内容（memory）を読むようにする
let dirty = false;
export let lastOk = true; // 直前の保存がうまくいったか（画面で知らせるため）

function ls() { try { return window.localStorage; } catch { return null; } }

export function available() {
  const s = ls();
  if (!s) return false;
  try { s.setItem(PREFIX + 'test', '1'); s.removeItem(PREFIX + 'test'); return true; } catch { return false; }
}

export function loadAll() {
  if (dirty) return memory;
  try { const v = JSON.parse(ls()?.getItem(KEY) || 'null'); if (v && Array.isArray(v.files)) return v; } catch { /* 読めないときは一時保存を使う */ }
  return memory;
}

function saveAll(db) {
  memory = db;
  const s = ls();
  try { if (!s) throw new Error('保存場所がありません'); s.setItem(KEY, JSON.stringify(db)); dirty = false; lastOk = true; }
  catch { dirty = true; lastOk = false; }
  return lastOk;
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function listFiles() { return loadAll().files.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); }
export function getFile(id) { return loadAll().files.find(f => f.id === id) || null; }

export function putFile(file) {
  const db = loadAll();
  file.updatedAt = new Date().toISOString();
  const i = db.files.findIndex(f => f.id === file.id);
  if (i >= 0) db.files[i] = file; else db.files.push(file);
  return saveAll(db);
}

export function removeFile(id) {
  const db = loadAll();
  db.files = db.files.filter(f => f.id !== id);
  return saveAll(db);
}

export function createFile(domain, state) {
  const now = new Date().toISOString();
  const f = { id: newId(), domain, title: '', createdAt: now, updatedAt: now, state, done: false, checks: {}, records: [], statusLog: [], region: null, docs: {} };
  putFile(f);
  return f;
}

export function getSettings() { try { return JSON.parse(ls()?.getItem(SET) || '{}'); } catch { return memSet; } }
export function setSettings(patch) { memSet = { ...getSettings(), ...patch }; try { ls()?.setItem(SET, JSON.stringify(memSet)); } catch { /* 保存できなくても動く */ } }

export function backupText() {
  return JSON.stringify({ app: 'kurashi-navi', version: 1, exportedAt: new Date().toISOString(), files: loadAll().files }, null, 2);
}

// 復元：同じIDは新しい方を残す。形が違うファイルは受け付けない
export function restore(text) {
  const v = JSON.parse(text);
  if (v?.app !== 'kurashi-navi' || !Array.isArray(v.files)) throw new Error('このサイトのバックアップファイルではありません');
  const db = loadAll();
  let added = 0;
  for (const f of v.files) {
    if (!f || typeof f.id !== 'string' || !f.state) continue;
    const i = db.files.findIndex(x => x.id === f.id);
    if (i < 0) { db.files.push(f); added++; }
    else if ((f.updatedAt || '') > (db.files[i].updatedAt || '')) { db.files[i] = f; added++; }
  }
  saveAll(db);
  return added;
}

export function clearAll() {
  memory = { files: [] }; memSet = {}; dirty = false; lastOk = true;
  const s = ls();
  if (!s) return;
  const keys = [];
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
  keys.forEach(k => s.removeItem(k));
}
