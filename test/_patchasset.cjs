const fs = require('fs')
const path = require('path')

const file = path.join(
  process.env.USERPROFILE,
  '.dsh',
  'profile-data',
  'tavern',
  'data',
  'tools',
  'opener-pager',
  'snippet.client.js',
)
const src = fs.readFileSync(file, 'utf8')

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = `${file}.bak-${stamp}`
fs.writeFileSync(backup, src, 'utf8')
console.log('备份:', path.basename(backup), `(${src.length} 字节)`)

const report = []
const apply = (text, label, re, build) => {
  let count = 0
  const out = text.replace(re, (...args) => {
    count += 1
    return build(...args)
  })
  if (count !== 1) {
    console.log(`\n[失败] ${label} 期望命中 1 处，实际 ${count} —— 文件未写入`)
    process.exit(1)
  }
  report.push(`${label}：命中 ${count} 处`)
  return out
}

const helpers = (indent) =>
  [
    `${indent}// 与宿主同源地取玩家名：宿主两处调用 getCardOpenings 都从 localStorage 读这个键，`,
    `${indent}// 缺了它开场预览里的 <user> 换不出来。`,
    `${indent}function openerPlayerName() {`,
    `${indent}\ttry { return String(window.localStorage.getItem("dsh-tavern-player-name") || "你").trim() || "你"; }`,
    `${indent}\tcatch (error) { return "你"; }`,
    `${indent}}`,
    `${indent}// 预览通道没有上限的话，卡住就永远停在「读取中」—— 状态从 loading 出发，`,
    `${indent}// Promise 不落地就没人改它。给一个上限，超了就走回退。`,
    `${indent}const OPENER_PREVIEW_TIMEOUT_MS = 20000;`,
    `${indent}function openerTimeout(promise, ms, message) {`,
    `${indent}\tlet timer = null;`,
    `${indent}\tconst guard = new Promise(function (_resolve, reject) {`,
    `${indent}\t\ttimer = setTimeout(function () { reject(new Error(message)); }, ms);`,
    `${indent}\t});`,
    `${indent}\treturn Promise.race([promise, guard]).finally(function () { if (timer) clearTimeout(timer); });`,
    `${indent}}`,
    `${indent}// 预览失败或超时后的轻路径：只读卡上的 first_mes 与 alternate_greetings。`,
    `${indent}function openerFallbackPlain(cardPath, sessionId) {`,
    `${indent}\treturn rpc("getCard", { path: cardPath }, sessionId).then(function (plain) {`,
    `${indent}\t\tconst loaded = plain && plain.card ? plain.card : {};`,
    `${indent}\t\tconst items = openerChoices(loaded);`,
    `${indent}\t\topenerPagerStore.items = items;`,
    `${indent}\t\tif (openerStr(loaded.name)) openerPagerStore.cardName = openerStr(loaded.name);`,
    `${indent}\t\topenerPublish("ready");`,
    `${indent}\t\tconsole.log("[opener-pager] 已回退纯文本：" + String(items.length) + " 条");`,
    `${indent}\t\treturn null;`,
    `${indent}\t});`,
    `${indent}}`,
    '',
  ].join('\n')

let out = apply(
  src,
  '1) 在 openerLoad 之前插入辅助函数',
  /(\n)([ \t]*)function openerLoad\(sessionId\) \{/,
  (whole, nl, indent) => `${nl}${helpers(indent)}${indent}function openerLoad(sessionId) {`,
)

out = apply(
  out,
  '2) getCardOpenings 按宿主的方式调用并加超时',
  /rpc\("getCardOpenings", \{ path: path, requestMode: "dsh" \}, sessionId\)\.then\(/,
  () =>
    'openerTimeout(rpc("getCardOpenings", { path: path, userName: openerPlayerName(), requestMode: "dsh", previewTransport: "deferred-v1" }, sessionId), OPENER_PREVIEW_TIMEOUT_MS, "预览读取超时").then(',
)

out = apply(
  out,
  '3) 预览通道失败时回退，而不是停在读取中',
  /(\n[ \t]*return null;\n[ \t]*\}\);\n)([ \t]*)(\}\);)/,
  (whole, head, indent) =>
    head +
    [
      `${indent}}).catch(function (failure) {`,
      `${indent}\tconsole.warn("[opener-pager] 预览接口不可用，回退纯文本:", failure);`,
      `${indent}\treturn openerFallbackPlain(path, sessionId);`,
      `${indent}});`,
    ].join('\n'),
)

fs.writeFileSync(file, out, 'utf8')
console.log(report.join('\n'))
console.log('字节数:', src.length, '->', out.length)
