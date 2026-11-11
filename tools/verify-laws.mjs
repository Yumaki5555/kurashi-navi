// 法令の条文を e-Gov 法令API（v1 articles）で取得し、根拠に使う語句が条文にそのまま含まれるかを照合する。
// 使い方：node tools/verify-laws.mjs            … 照合だけ（結果を表示）
//         node tools/verify-laws.mjs --dump     … 取得した条文を research/laws-gyosei.txt にも保存
// サイトの動作には不要（調べるための道具）。法令名・条番号・語句は下の CHECKS に書く。
import { writeFileSync, mkdirSync } from 'node:fs';

const LAWS = {
  jichi: ['322AC0000000067', '地方自治法'],
  seigan: ['322AC0000000013', '請願法'],
  kenpou: ['321CONSTITUTION', '日本国憲法'],
  fufuku: ['426AC0000000068', '行政不服審査法'],
  joho: ['411AC0000000042', '行政機関の保有する情報の公開に関する法律'],
  tetsuzuki: ['405AC0000000088', '行政手続法'],
  kisoku: ['322M40000080011', '学校教育法施行規則'],
  soshou: ['337AC0000000139', '行政事件訴訟法'],
  kenchiku: ['325AC0000000201', '建築基準法']
};

// [法令, 条（枝番は _）, 照合する語句…]
export const CHECKS = [
  ['jichi', '74', '五十分の一以上の者の連署', '条例', '制定又は改廃の請求'],
  ['jichi', '123', '会議録'],
  ['jichi', '124', '議員の紹介により請願書を提出しなければならない'],
  ['jichi', '125', '採択した請願', '処理の経過及び結果の報告を請求することができる'],
  ['jichi', '219', 'その要領を住民に公表しなければならない'],
  ['jichi', '232_2', '公益上必要がある場合においては', '寄附又は補助をすることができる'],
  ['jichi', '233', '決算を議会の認定に付するに当たつては', '主要な施策の成果を説明する書類'],
  ['jichi', '242', '違法若しくは不当な公金の支出', 'これらを証する書面を添え', '監査委員に対し', '一年を経過したときは', '正当な理由があるときは'],
  ['jichi', '242_2', '違法な行為又は怠る事実', '監査の結果又は勧告に不服がある場合', '三十日以内'],
  ['jichi', '243_3', '財政に関する事項を住民に公表しなければならない'],
  ['seigan', '5', '誠実に処理しなければならない'],
  ['seigan', '6', '差別待遇も受けない'],
  ['kenpou', '16', '平穏に請願する権利'],
  ['fufuku', '1', '国民の権利利益の救済'],
  ['fufuku', '2', '行政庁の処分に不服がある者は'],
  ['fufuku', '3', '法令に基づき行政庁に対して処分についての申請をした者は', '何らの処分をもしないこと'],
  ['fufuku', '18', '処分があったことを知った日の翌日から起算して三月', '処分', 'があった日の翌日から起算して一年を経過したときは'],
  ['fufuku', '82', '不服申立てをすることができる旨', '不服申立てをすべき行政庁', '不服申立てをすることができる期間を書面で教示しなければならない', '口頭でする場合は、この限りでない'],
  ['joho', '2', '行政機関の職員が職務上作成し、又は取得した文書'],
  ['joho', '3', '何人も', '開示を請求することができる'],
  ['joho', '5', '開示しなければならない', '個人に関する情報'],
  ['joho', '6', '部分を除いた部分につき開示しなければならない'],
  ['joho', '10', '三十日以内にしなければならない', '三十日以内に限り延長することができる'],
  ['joho', '25', '地方公共団体は', '必要な施策を策定し', '努めなければならない'],
  ['tetsuzuki', '2', '申請', '諾否の応答をすべきこととされているもの'],
  ['tetsuzuki', '3', '地方公共団体の機関がする処分'],
  ['tetsuzuki', '7', '遅滞なく当該申請の審査を開始しなければならず'],
  ['tetsuzuki', '8', '理由を示さなければならない'],
  ['tetsuzuki', '46', '地方公共団体は'],
  ['seigan', '1', '請願'],
  ['seigan', '2', '請願'],
  ['seigan', '3', '請願'],
  ['seigan', '4', '請願'],
  ['kenchiku', '87', '用途を変更して', '特殊建築物'],
  ['kisoku', '56_2', '日本語に通じない児童', '特別の教育課程']
];

const plain = xml => xml
  .replace(/<ArticleTitle>([^<]*)<\/ArticleTitle>/g, '\n$1\n')
  .replace(/<ParagraphNum>([^<]*)<\/ParagraphNum>/g, '\n[$1] ')
  .replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

async function fetchArticle(lawId, art) {
  const url = `https://laws.e-gov.go.jp/api/1/articles;lawId=${lawId};article=${art}`;
  const r = await fetch(url);
  const x = await r.text();
  if (!/<Code>0<\/Code>/.test(x)) throw new Error(`取得できません: ${lawId} 第${art}条`);
  return plain(x.split('<LawContents>')[1] || '');
}

const dump = process.argv.includes('--dump');
let ng = 0;
const out = [];
for (const [law, art, ...phrases] of CHECKS) {
  const [id, name] = LAWS[law];
  let text = '';
  try { text = await fetchArticle(id, art); } catch (e) { console.log('NG', e.message); ng++; continue; }
  const flat = text.replace(/\s/g, '');
  const miss = phrases.filter(p => !flat.includes(p.replace(/\s/g, '')));
  console.log(miss.length ? 'NG' : 'OK', `${name} 第${art.replace('_', '条の')}${art.includes('_') ? '' : '条'}`, miss.length ? '見つからない語句：' + miss.join(' / ') : '');
  if (miss.length) ng++;
  out.push(`=== ${name} ${id} 第${art}条 ===\n${text}\n`);
}
if (dump) { mkdirSync('research', { recursive: true }); writeFileSync('research/laws-gyosei.txt', out.join('\n')); }
console.log(ng ? `照合できなかったもの ${ng} 件` : 'すべて照合できました', `（確認日 ${new Date().toLocaleDateString('sv-SE')}）`);
process.exit(ng ? 1 : 0);
