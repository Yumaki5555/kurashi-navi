// トップページの確認（2026-11-13 改修分）。
// 使い方：先にテスト用サーバー（python -m http.server 8791 --bind 127.0.0.1）を起動してから
//   node tools/home-check.mjs [画面写真の保存先]
// ・Edge（なければ Chrome）を「使い捨ての保存領域」で起動するので、ふだん使っているブラウザの相談データには触れません。
// ・確かめること：横スクロールなし／押せる所の大きさ（44px以上）／文字の大きさ（16px以上）／最初の画面に見えるもの／
//   トップで読み込む量／分野・緊急・ヒントの行き先／保存した相談の再開と、保存データが変わらないこと／画面のエラー
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8791/';
const OUT = process.argv[2] || 'research/home';
const PORT = 9334;
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = BROWSERS.find(existsSync);
if (!exe) throw new Error('Edge / Chrome が見つかりません');
mkdirSync(OUT, { recursive: true });
// 前回のブラウザが残っていると、そちらにつながって結果が狂うので止める
if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)) throw new Error(`ポート${PORT}で前回の確認用ブラウザが動いています。閉じてから実行してください`);
const prof = mkdtempSync(join(tmpdir(), 'kn-home-'));
const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const W = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK ' : 'NG '} ${name}${detail ? ' … ' + detail : ''}`); };
const errors = [];

let ws, seq = 0, width = 375;
const waiting = new Map();
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiting.set(id, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))));
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function size(w, h = 812) { width = w; await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 760 }); await W(300); }
async function load(hash) { await cdp('Page.navigate', { url: BASE + hash }); await W(1500); }
async function go(hash) { await js(`location.hash = ${JSON.stringify(hash)};`); await W(900); }
async function shot(name) {
  await js('window.scrollTo(0, 0);'); await W(200);
  const h = await js('return Math.min(document.documentElement.scrollHeight, 5000);');
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
  const p = join(OUT, `${name}_${width}px.png`);
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('   写真:', p);
}
const h1 = () => js(`return document.querySelector('main h1')?.textContent.trim() || '';`);
const store = () => js(`return JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('kurashi-navi')).sort().map(k => [k, localStorage.getItem(k)]));`);
// 画面の大きさの確認（トップ）
const layout = () => js(`
  const vw = innerWidth, vh = innerHeight;
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const tiny = [...document.querySelectorAll('header a, main a, main button, main summary')].filter(vis)
    .filter(el => !el.closest('p.note'))
    .map(el => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(x => x.h < 44 || x.w < 44);
  const texts = [...document.querySelectorAll('header *, main *')].filter(el => vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const low = texts.filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.textContent.trim().slice(0, 12) + ' ' + getComputedStyle(el).fontSize);
  const out = [...document.querySelectorAll('main *')].filter(vis).filter(el => el.getBoundingClientRect().right > vw + 1).map(el => el.tagName + '.' + el.className);
  const top = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().bottom + scrollY) : -1; };
  const fs = s => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
  const bg = getComputedStyle(document.querySelector('.hero')).backgroundImage;
  return { vw, vh, over: document.documentElement.scrollWidth - vw, tiny, low: low.slice(0, 6), out: out.slice(0, 4),
    h1: fs('main h1'), h2: fs('main h2'), cat: fs('.cat b'), emgBottom: top('.emg-bar'), firstAct: top('.fc .fbtn') > 0 ? top('.fc .fbtn') : top('.cat'),
    cols: getComputedStyle(document.querySelector('.cats')).gridTemplateColumns.split(' ').length, illust: /hero\\.svg/.test(bg) };`);
async function checkLayout(label, w) {
  await size(w); await go('#/'); await W(300);
  const L = await layout();
  ok(`${label} ${w}px 横スクロールなし`, L.over <= 0 && !L.out.length, L.over > 0 || L.out.length ? `はみ出し ${L.over}px ${L.out.join(' ')}` : '');
  ok(`${label} ${w}px 押せる所が44px以上`, !L.tiny.length, L.tiny.map(x => `${x.t}(${x.w}x${x.h})`).join(' '));
  ok(`${label} ${w}px 文字が16px以上`, !L.low.length, L.low.join(' / '));
  ok(`${label} ${w}px 最初の画面に緊急の帯と最初のボタン`, L.emgBottom > 0 && L.emgBottom <= L.vh && L.firstAct > 0 && L.firstAct <= L.vh, `緊急の帯の下端 ${L.emgBottom}px・最初のボタンの下端 ${L.firstAct}px（画面の高さ ${L.vh}px）`);
  console.log(`   文字：タイトル${L.h1}px・見出し${L.h2}px・分野名${L.cat}px／分野カード${L.cols}列／イラスト${L.illust ? 'あり' : 'なし'}`);
  return L;
}
// 診断を「各質問の最初の選択肢」で進める（複数選ぶ質問は最初の1つ）。stopAt 問目で止める
const answer = (stopAt = 99) => js(`
  const W = ms => new Promise(r => setTimeout(r, ms));
  let n = 0;
  while (!/\\/result/.test(location.hash) && n < ${stopAt}) {
    const cb = document.querySelector('input[type=checkbox]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); await W(150); document.querySelector('[data-act=multi]').click(); }
    else { const b = document.querySelector('[data-act=ans]'); if (!b) break; b.click(); }
    const h = location.hash;
    for (let i = 0; i < 60 && location.hash === h; i++) await W(100);
    await W(400); n++;
  }
  return location.hash;`);
// 部品が画面に出るまで待つ（最大8秒）。読み込みの速さで結果が変わらないように
const waitFor = sel => js(`for (let i = 0; i < 80 && !document.querySelector(${JSON.stringify(sel)}); i++) await new Promise(r => setTimeout(r, 100)); return !!document.querySelector(${JSON.stringify(sel)});`);
const startAndAnswer = async (d, stopAt) => { await go('#/start/' + d); await waitFor('[data-act=startans]'); await js(`document.querySelector('[data-act=startans]').click();`); await waitFor('[data-act=ans], input[type=checkbox]'); return answer(stopAt); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await W(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch { /* 起動待ち */ }
  }
  if (!target) throw new Error('ブラウザに接続できませんでした');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(res => ws.addEventListener('open', res));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await size(375);

  console.log('■ 1. トップで読み込む量（保存した相談なし）');
  await load('#/');
  const res = await js(`return performance.getEntriesByType('resource').map(e => [e.name.replace(location.origin, ''), e.decodedBodySize]);`);
  const total = res.reduce((s, [, b]) => s + b, 0) + (await js(`return performance.getEntriesByType('navigation')[0]?.decodedBodySize || 0;`));
  console.log(`   読み込んだファイル ${res.length + 1}個・合計 ${(total / 1024).toFixed(0)}KB（圧縮前）`);
  console.log('   ' + res.map(([n, b]) => `${n.split('/').pop()} ${(b / 1024).toFixed(1)}KB`).join('・'));
  ok('トップでは出典・地域のデータを読まない', !res.some(([n]) => /sources|regions|actions/.test(n)), res.filter(([n]) => /data\//.test(n)).map(([n]) => n).join(' '));
  ok('スマホではイラストを読まない', !res.some(([n]) => /hero\.svg/.test(n)));
  ok('トップの題名', (await h1()) === '困りごと、次どうする？');

  console.log('■ 2. 画面の幅ごと（保存した相談なし）');
  for (const w of [320, 375, 390, 430, 1280]) await checkLayout('相談なし', w);
  await size(375); await go('#/'); await shot('1_トップ_相談なし');
  await size(1280); await go('#/'); await W(500); await shot('1_トップ_相談なし');
  await size(375);

  console.log('■ 3. 行き先（分野・緊急・ヒント）');
  await go('#/');
  const cats = await js(`return [...document.querySelectorAll('.cat')].map(a => [a.getAttribute('href'), a.querySelector('b').textContent]);`);
  ok('分野カードは6枚（5分野＋手段から選ぶ）', cats.length === 6, cats.map(c => c[1]).join('・'));
  for (const [href, name] of cats) {
    await go('#/'); await js(`document.querySelector('.cat[href="${href}"]').click();`); await W(900);
    const t = await h1(), hash = await js('return location.hash;');
    ok(`分野「${name}」→ ${hash}`, hash === href && t && !/表示できません/.test(t), `見出し「${t}」`);
  }
  ok('「手段から選ぶ」に手段が9つ', (await js(`await new Promise(r => setTimeout(r, 300)); location.hash = '#/act'; await new Promise(r => setTimeout(r, 900)); return document.querySelectorAll('main details.card').length;`)) === 9);
  await go('#/'); await js(`document.querySelector('.emg-bar').click();`); await W(900);
  ok('緊急の帯 → 緊急の画面（110・119の電話リンク）', (await js('return location.hash;')) === '#/emergency' && (await js(`return ['tel:110','tel:119'].every(h => document.querySelector('main a[href="' + h + '"]'));`)), await h1());
  await go('#/');
  const hints = await js(`return [...document.querySelectorAll('.hints a')].map(a => [a.getAttribute('href'), a.querySelector('b').textContent, a.target]);`);
  for (const [href, name, tgt] of hints) {
    if (tgt === '_blank') { ok(`ヒント「${name}」（別タブ）`, href === 'https://yumaki5555.github.io/todokeru/#/contacts', href); continue; }
    await go('#/'); await js(`document.querySelector('.hints a[href="${href}"]').click();`); await W(900);
    const t = await h1();
    ok(`ヒント「${name}」→ ${href}`, (await js('return location.hash;')) === href && t && !/表示できません/.test(t), `見出し「${t}」`);
  }

  console.log('■ 4. トップ以外から開いたとき（あとから読むデータが届くか）');
  await load('#/act');
  ok('いきなり「手段の一覧」を開いても9つ出る', (await js(`return document.querySelectorAll('main details.card').length;`)) === 9);
  await load('#/about');
  ok('いきなり「このサイトについて」を開いても根拠資料が出る', (await js(`return document.querySelectorAll('main a[href^="http"]').length;`)) > 20);
  await load('#/cases/minpaku');
  ok('いきなり「事例集」を開いても事例が出る', !/表示できません/.test(await h1()) && (await js(`return document.querySelectorAll('main a[href^="#/case/"]').length;`)) > 0, await h1());

  console.log('■ 5. 保存した相談がある場合（使い捨ての保存領域の中だけで作る）');
  await load('#/');
  await js(`localStorage.setItem('kurashi-navi:settings', JSON.stringify({ region: { pref: '13', prefName: '東京都', code: '131113', cityName: '大田区' } }));`);
  ok('民泊の相談を結果まで進める', /\/result/.test(await startAndAnswer('minpaku')));
  ok('結果の画面に地域の情報が出る（あとから読むデータ）', await js(`return /大田区/.test(document.querySelector('main').textContent);`));
  await js(`document.querySelector('[data-act=choose]')?.click();`); await W(700);
  await startAndAnswer('gakko', 1);
  await go('#/');
  const before = await store();
  const cards = await js(`return [...document.querySelectorAll('.fc')].map(li => ({ t: li.querySelector('.ttl').textContent, tag: li.querySelector('.tag').textContent, meta: li.querySelector('.meta').textContent, btn: li.querySelector('.fbtn').textContent, href: li.querySelector('.fbtn').getAttribute('href'), primary: li.querySelector('.fbtn').classList.contains('primary'), icon: !!li.querySelector('svg.ico') }));`);
  cards.forEach(c => console.log(`   カード：${c.t}｜${c.tag}｜${c.meta}｜ボタン「${c.btn}」${c.primary ? '（目立つ色）' : ''}`));
  ok('「続きから」のカードが2枚・アイコン・更新日つき', cards.length === 2 && cards.every(c => c.icon && /更新/.test(c.meta)));
  ok('1枚目のボタンだけ目立つ色', cards[0]?.primary && !cards[1]?.primary);
  ok('状態のラベル（途中／結果）', cards.some(c => c.tag === '診断の途中') && cards.some(c => c.tag !== '診断の途中'), cards.map(c => c.tag).join('・'));
  ok('記録がある相談は件数が出る', cards.some(c => /記録\d+件/.test(c.meta)));
  for (const w of [320, 375, 390, 430, 1280]) await checkLayout('相談あり', w);
  await size(375); await go('#/'); await shot('2_トップ_相談あり');
  await size(320); await go('#/'); await shot('2_トップ_相談あり');
  await size(1280); await go('#/'); await W(500); await shot('2_トップ_相談あり');
  await size(375); await go('#/');
  ok('トップを何度開いても保存データは変わらない', before === (await store()));
  await js(`document.querySelector('.fc .fbtn').click();`); await W(900);
  ok('1枚目の「再開」で質問の続きへ', (await js('return location.hash;')) === cards[0].href && /\/q\//.test(cards[0].href), `${cards[0].href} 見出し「${await h1()}」`);
  await go('#/'); await js(`document.querySelectorAll('.fc .fbtn')[1].click();`); await W(900);
  ok('2枚目のボタンで結果へ', (await js('return location.hash;')) === cards[1].href && !/表示できません/.test(await h1()), `${cards[1].href} 見出し「${await h1()}」`);
  await startAndAnswer('yosan', 1);
  await go('#/');
  ok('3件目からは「すべて見る」', (await js(`return document.querySelectorAll('.fc').length;`)) === 2 && /すべて見る（3件）/.test(await js(`return document.querySelector('.more-link')?.textContent || '';`)));
  await js(`document.querySelector('.more-link').click();`); await W(900);
  ok('「すべて見る」→ 保存した相談の一覧に3件', (await js(`return document.querySelectorAll('main .files li').length;`)) >= 3, await h1());

  ok('画面のエラーなし', !errors.length, errors.slice(0, 5).join(' / '));
} finally {
  console.log(`\n結果：OK ${pass}・NG ${fail}`);
  try { await Promise.race([cdp('Browser.close'), W(3000)]); } catch { /* 無視 */ }
  try { ws?.close(); } catch { /* 無視 */ }
  br.kill();
  await W(1500);
  try { rmSync(prof, { recursive: true, force: true }); } catch { /* 使い捨ての保存領域：消せなくても害はない */ }
}
