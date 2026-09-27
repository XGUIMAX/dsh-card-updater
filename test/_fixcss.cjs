const fs = require('fs')
const path = require('path')

const dir = path.join(process.env.USERPROFILE, '.dsh', 'profile-data', 'tavern', 'data', 'tools', 'opener-pager')
const file = path.join(dir, 'snippet.css')
const src = fs.readFileSync(file, 'utf8')

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = `${file}.bak-${stamp}`
fs.writeFileSync(backup, src, 'utf8')
console.log('备份:', path.basename(backup), `(${src.length} 字节)`)

// The button carries the host's own class; anything this sheet says about it wins
// against the host rule, because both are single-class selectors and this sheet
// is appended to the end of tavern.css.
const wanted = [
  /^\.dsh-tavern-opener-open \{[^\n]*\}\n?/m,
  /^\.dsh-tavern-opener-open:hover \{[^\n]*\}\n?/m,
]

let out = src
let removed = 0
for (const re of wanted) {
  if (!re.test(out)) {
    console.log('[失败] 没找到要删的规则:', re.source, '—— 文件未写入')
    process.exit(1)
  }
  out = out.replace(re, () => {
    removed += 1
    return ''
  })
}

const note = [
  '/* 按钮本身不设任何样式，它复用宿主的 .dsh-tavern-choice-trigger，必须完全跟随它。',
  '   这里原本有 `.dsh-tavern-opener-open { display:inline-flex; align-items:center; font:inherit }`，',
  '   而本表追加在 tavern.css 末尾、选择器优先级又与宿主那条相同，于是 font:inherit 覆盖掉了',
  '   宿主的 font-size:12px / font-weight:650，按钮比旁边的「生成候选项」大一圈。',
  '   :hover 里的硬编码 #a66b35 同理，会盖掉宿主的主题色。两条都已删除。',
  '   类名保留：自检用它数按钮节点（document.querySelectorAll(".dsh-tavern-opener-open")）。 */',
  '',
].join('\n')

out = out.replace(/^\/\* Local addition[\s\S]*?\*\/\n/, (m) => m + note)

fs.writeFileSync(file, out, 'utf8')
console.log('删除规则:', removed, '条')
console.log('字节数:', src.length, '->', out.length)
console.log('')
console.log(out.split('\n').slice(0, 12).join('\n'))
