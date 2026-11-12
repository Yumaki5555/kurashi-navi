// スマホ幅の画面写真を自動で撮る（報告・見た目の確認用）
// 使い方：先にテスト用サーバー（python -m http.server 8791 --bind 127.0.0.1）を起動してから
//   node tools/screens.mjs [保存先フォルダ] [画面の幅]
// ・Edge（なければ Chrome）を「使い捨ての保存領域」で起動するので、ふだん使っているブラウザの相談データには触れません。
// ・テスト用の相談は、使い捨ての保存領域の中だけで作り、最後に保存領域ごと消します。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8791/';
const OUT = process.argv[2] || 'research/screens';
const WIDTH = +(process.argv[3] || 375);
const PORT = 9333;
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = BROWSERS.find(existsSync);
if (!exe) throw new Error('Edge / Chrome が見つかりません');
mkdirSync(OUT, { recursive: true });
const prof = mkdtempSync(join(tmpdir(), 'kn-screens-'));
const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const W = ms => new Promise(r => setTimeout(r, ms));

let ws, seq = 0;
const waiting = new Map();
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, ng) => waiting.set(id, m => (m.error ? ng(new Error(method + ': ' + m.error.message)) : ok(m.result))));
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function go(hash) { await js(`location.hash = ${JSON.stringify(hash)};`); await W(900); }
async function shot(name, full = false) {
  await js('window.scrollTo(0, 0);'); await W(200);
  let clip;
  if (full) {
    const h = await js('return Math.min(document.documentElement.scrollHeight, 6000);');
    clip = { x: 0, y: 0, width: WIDTH, height: h, scale: 1 };
  }
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
  const p = join(OUT, `${name}_${WIDTH}px.png`);
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('保存:', p);
}
// 診断を「各質問の最初の選択肢」で進める（複数選ぶ質問は最初の1つ）。stopAt 問目で止める
const answer = (stopAt = 99) => js(`
  const W = ms => new Promise(r => setTimeout(r, ms));
  let n = 0;
  while (!/\\/result/.test(location.hash) && n < ${stopAt}) {
    const cb = document.querySelector('input[type=checkbox]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); await W(150); document.querySelector('[data-act=multi]').click(); }
    else { const b = document.querySelector('[data-act=ans]'); if (!b) break; b.click(); }
    await W(700); n++;
  }
  return location.hash;`);

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await W(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch { /* 起動待ち */ }
  }
  if (!target) throw new Error('ブラウザに接続できませんでした');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(ok => ws.addEventListener('open', ok));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 812, deviceScaleFactor: 2, mobile: WIDTH < 760 });
  await cdp('Page.navigate', { url: BASE + '#/' }); await W(1500);

  // 1) 民泊の相談：大田区を選んで最後まで答える → 結果
  await js(`localStorage.setItem('kurashi-navi:settings', JSON.stringify({ region: { pref: '13', prefName: '東京都', code: '131113', cityName: '大田区' } }));`);
  await go('#/start/minpaku');
  await js(`document.querySelector('[data-act=startans]').click();`); await W(900);
  await answer();
  await shot('2_結果', true);
  // 2) 結果から「やることに追加」→ 対応の記録
  await js(`document.querySelector('[data-act=choose]')?.click();`); await W(700);
  const fid = await js(`return location.hash.split('/')[2];`);
  await go(`#/f/${fid}/records`);
  await shot('3_対応の記録', true);
  // 3) 文書の下書き（今の行動に合う文書の先頭）
  await go(`#/f/${fid}/doc`);
  const doc = await js(`return document.querySelector('main a[href*="/doc/"]')?.getAttribute('href');`);
  if (doc) { await go(doc); await shot('4_文書の下書き', true); }
  // 4) 学校の相談を途中（質問2）で止める → トップの「続きから」
  await go('#/start/gakko');
  await js(`document.querySelector('[data-act=startans]').click();`); await W(900);
  await answer(1);
  await go('#/');
  await shot('1_トップ（続きから）', true);
  // 5) 「再開」から質問の画面へ
  await js(`[...document.querySelectorAll('main a')].find(a => /再開/.test(a.textContent))?.click();`); await W(900);
  await shot('5_続きから再開した質問');
} finally {
  try { ws?.close(); } catch { /* 無視 */ }
  br.kill();
  await W(800);
  try { rmSync(prof, { recursive: true, force: true }); } catch { /* 使い捨ての保存領域：消せなくても害はない */ }
}
