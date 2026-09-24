/**
 * Regression pass on the real cards, in a sandbox copy.
 *
 * The synthetic cards above prove the merge does what it is told. These prove it
 * does not do damage: the shipped MVU copies carry a status bar, a variable
 * system and a script set, and a merge that takes the author's text for a field
 * holding one of those breaks the card in a way that only shows up when it is
 * played. The pair used is the smallest on this machine; the folder is read, the
 * files are copied, and nothing in the real card directory is written.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHost, createReport, rmrf } from './harness.mjs'

const ROOT = path.join(os.tmpdir(), 'dcu-real')
const REAL_CARDS = path.join(
  os.homedir(),
  '.dsh',
  'profile-data',
  'tavern',
  'data',
  'resources',
  'cards',
)

const report = createReport('dsh-card-updater real cards')

if (!fs.existsSync(REAL_CARDS)) {
  console.log('\ndsh-card-updater real cards: no card directory on this machine, nothing to check\n')
  process.exit(0)
}

/** Every card pair available, smallest first, so this stays quick. */
function pairs() {
  const names = fs.readdirSync(REAL_CARDS).filter((n) => /\.json$/i.test(n) && !/MVU/i.test(n))
  const out = []
  for (const name of names) {
    const mvu = `${name.replace(/\.json$/i, '')} MVU版本.json`
    if (!fs.existsSync(path.join(REAL_CARDS, mvu))) continue
    const bytes = fs.statSync(path.join(REAL_CARDS, name)).size + fs.statSync(path.join(REAL_CARDS, mvu)).size
    out.push({ name, mvu, bytes })
  }
  return out.sort((a, b) => a.bytes - b.bytes)
}

const available = pairs()
if (!available.length) {
  console.log('\ndsh-card-updater real cards: no original/copy pair found, nothing to check\n')
  process.exit(0)
}

function sandbox(name) {
  const base = path.join(ROOT, name)
  rmrf(base)
  const home = path.join(base, '.dsh')
  const res = path.join(home, 'profile-data', 'tavern', 'data', 'resources')
  const dirs = {
    home,
    cards: path.join(res, 'cards'),
    tool: path.join(home, 'profile-data', 'tavern', 'data', 'tools', 'card-updater'),
    originals: path.join(home, 'profile-data', 'tavern', 'data', 'originals', 'cards'),
    tavern: path.join(home, 'profile-data', 'tavern', 'data'),
  }
  for (const d of [dirs.cards, dirs.tool, dirs.originals, path.join(dirs.tavern, 'chats')]) {
    fs.mkdirSync(d, { recursive: true })
  }
  return dirs
}

const keysOf = (o) => Object.keys(o && typeof o === 'object' ? o : {}).sort()
const diff = (before, after) => before.filter((k) => !after.includes(k))

/* -------------------------------------------------------- structure survives */

{
  report.group('structure survives a merge')
  const pair = available[0]
  const sb = sandbox('one')
  fs.copyFileSync(path.join(REAL_CARDS, pair.name), path.join(sb.cards, pair.name))
  fs.copyFileSync(path.join(REAL_CARDS, pair.mvu), path.join(sb.cards, pair.mvu))

  const host = loadHost(sb.home)
  const plainPath = path.join(sb.cards, pair.name)
  const mvuPath = path.join(sb.cards, pair.mvu)

  const before = host.loadCard(mvuPath)
  const beforeExt = keysOf(before.data.extensions)
  const beforeScripts = JSON.stringify(before.data.extensions || {}).length
  const statusBefore = String(before.data.first_mes || '').match(/StatusPlaceHolder|mvu-|<mvu/i)

  host.db.cfg = host.normalizeCfg({
    mergeStrategy: 'full',
    syncPlain: false,
    bookPreferOriginal: true,
    autoBumpVersion: false,
    cards: [
      {
        id: 'real',
        label: pair.name.replace(/\.json$/i, ''),
        plain: { path: plainPath },
        mvu: { path: mvuPath },
      },
    ],
  })
  host.db.loaded = true

  const originalText = fs.readFileSync(plainPath, 'utf8')
  const result = await host.handleAction({ action: 'merge', cardId: 'real' })
  report.eq(`merge of ${pair.name} reports success`, result.ok, true)

  const after = host.loadCard(mvuPath)
  report.eq('no extension was dropped', diff(beforeExt, keysOf(after.data.extensions)), [])
  report.ok(
    'the extension payload is still there',
    JSON.stringify(after.data.extensions || {}).length >= beforeScripts,
    `${JSON.stringify(after.data.extensions || {}).length} vs ${beforeScripts} before`,
  )
  report.ok('the world book is still there', Array.isArray(after.data.character_book?.entries))
  report.eq(
    'the status bar placeholder in the opening is untouched',
    String(after.data.first_mes || '').includes(String(statusBefore && statusBefore[0])),
    true,
  )
  report.eq(
    'the original card was not written, since syncPlain is off',
    fs.readFileSync(plainPath, 'utf8') === originalText,
    true,
  )

  // The outer workspace shell has to come back intact: the payload is written
  // back through `buildCardText`, and losing `kind` or `meta` here would turn a
  // workspace card into a bare one.
  const outer = JSON.parse(fs.readFileSync(mvuPath, 'utf8'))
  report.eq('the workspace shell survived', outer.kind, before.outer.kind)
  report.eq('the workspace metadata survived', outer.meta, before.outer.meta)
  report.ok('the payload is still under raw', !!outer.raw && !!outer.raw.data)

  // Running it again must settle: a merge that keeps finding changes would
  // rewrite the card on every check.
  const firstPass = fs.readFileSync(mvuPath, 'utf8')
  const second = await host.handleAction({ action: 'merge', cardId: 'real' })
  report.eq('merging a second time still succeeds', second.ok, true)
  report.eq(
    'and writes nothing new',
    fs.readFileSync(mvuPath, 'utf8') === firstPass,
    true,
  )
  report.eq(
    'the second pass does not rewrite the card at all',
    second.result.wrote,
    false,
  )
  report.ok(
    'and leaves no snapshot behind',
    (second.result.backups || []).length === 0,
    `backups: ${JSON.stringify(second.result.backups || [])}`,
  )
}

/* ------------------------------------------------------- every shipped pair */

{
  report.group('every pair on this machine')
  for (const pair of available) {
    const sb = sandbox(`pair-${available.indexOf(pair)}`)
    fs.copyFileSync(path.join(REAL_CARDS, pair.name), path.join(sb.cards, pair.name))
    fs.copyFileSync(path.join(REAL_CARDS, pair.mvu), path.join(sb.cards, pair.mvu))
    const host = loadHost(sb.home)

    const plainPath = path.join(sb.cards, pair.name)
    const mvuPath = path.join(sb.cards, pair.mvu)
    const before = host.loadCard(mvuPath)
    const beforeExt = keysOf(before.data.extensions)

    host.db.cfg = host.normalizeCfg({
      mergeStrategy: 'full',
      cards: [{ id: 'p', label: pair.name, plain: { path: plainPath }, mvu: { path: mvuPath } }],
    })
    host.db.loaded = true

    const label = `${pair.name.replace(/\.json$/i, '')} (${(pair.bytes / 1048576).toFixed(1)} MB)`
    let failure = null
    const t0 = process.hrtime.bigint()
    try {
      const res = await host.handleAction({ action: 'merge', cardId: 'p' })
      if (!res.ok) failure = res.error || 'merge refused'
    } catch (e) {
      failure = e && e.message ? e.message : String(e)
    }
    const took = Number(process.hrtime.bigint() - t0) / 1e6
    report.ok(`${label} merges without error`, !failure, failure || '')
    if (failure) continue

    const after = host.loadCard(mvuPath)
    report.eq(`${label}: no extension lost`, diff(beforeExt, keysOf(after.data.extensions)), [])
    report.ok(`${label}: the book survived`, Array.isArray(after.data.character_book?.entries))
    report.ok(`${label}: merged in ${took.toFixed(0)} ms`, took < 5000, `${took.toFixed(0)} ms`)
  }
}

/* ------------------------------------------------------------- search terms */

{
  report.group('every card offers something to search with')
  const sb = sandbox('terms')
  const host = loadHost(sb.home)
  const names = fs.readdirSync(REAL_CARDS).filter((n) => /\.json$/i.test(n) && !/MVU/i.test(n))
  const cards = names.map((n, i) => ({
    id: `t${i}`,
    label: n.replace(/\.json$/i, ''),
    plain: { path: path.join(REAL_CARDS, n) },
  }))
  host.db.cfg = host.normalizeCfg({ cards })
  host.db.loaded = true

  for (const entry of host.db.cfg.cards) {
    // Read-only: the card is opened to learn what it calls itself, never written.
    const terms = host.searchTermsOf(entry)
    report.ok(
      `${entry.label} → ${terms.map((t) => `「${t}」`).join(' ')}`,
      terms.length > 0,
      'no term at all means this card could never be located on a release page',
    )
  }
}

process.exit(report.finish() ? 1 : 0)
