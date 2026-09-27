import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const css = typeof internals.CSS === 'string' ? internals.CSS : (internals.CSS || []).join('\n')
console.log('注入的样式表长度:', css.length)

const selectors = new Set()
for (const m of css.matchAll(/(?:^|\n|\})\s*([^{}\n@/][^{}]*?)\s*\{/g)) {
  selectors.add(m[1].trim())
}

const ours = [...selectors].filter((s) => s.includes('.dcu-'))
const notOurs = [...selectors].filter((s) => !s.includes('.dcu-'))
console.log('规则总数:', selectors.size, '· 带 .dcu- 前缀:', ours.length, '· 不带:', notOurs.length)
for (const s of notOurs) console.log('   非命名空间选择器 →', s)

// Anything that could reach a host element from inside our namespace, or that
// lifts specificity with !important.
const important = [...css.matchAll(/[^;{}]*!important[^;{}]*/g)].map((m) => m[0].trim())
console.log('\n!important 次数:', important.length)
for (const s of important.slice(0, 20)) console.log('   ', s.slice(0, 120))

// Global-ish selectors that would apply outside a .dcu- subtree.
const risky = [...selectors].filter((s) => /^(?:\*|button|input|select|textarea|div|span|a|\.dsw-|\[)/.test(s.trim()))
console.log('\n看起来会影响全局的选择器:', risky.length ? risky.join(' | ') : '(无)')
