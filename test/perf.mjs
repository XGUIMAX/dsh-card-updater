/**
 * Timing pass over the host half.
 *
 * Everything here is measured, not estimated: the numbers come from this
 * machine, on the real cards the updater is used with. `node test/perf.mjs`
 * prints a table and fails only on an absurd regression, so it stays useful as
 * a report rather than as a gate.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHost, writeJson, v2Card, rmrf } from './harness.mjs'

const ROOT = path.join(os.tmpdir(), 'dcu-perf')
const REAL_CARDS = path.join(
  os.homedir(),
  '.dsh',
  'profile-data',
  'tavern',
  'data',
  'resources',
  'cards',
)

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6
const time = async (label, fn) => {
  const t0 = process.hrtime.bigint()
  const out = await fn()
  const took = ms(t0)
  console.log(`  ${label.padEnd(52)} ${took.toFixed(1).padStart(9)} ms`)
  return { took, out }
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

console.log('\ndsh-card-updater host timings\n')

/* ---------------------------------------------------------- panel state load */

{
  const sb = sandbox('state')
  const host = loadHost(sb.home)
  const card = path.join(sb.cards, 'a.json')
  writeJson(card, v2Card({ name: 'A' }))

  console.log('panel state load')
  const first = await time('statePayload, cold', () => host.statePayload())
  await time('statePayload, warm', () => host.statePayload())
  await time('statePayload, x100', () => {
    for (let i = 0; i < 100; i++) host.statePayload()
  })
  void first
}

/* --------------------------------------------------------- backup retention */

{
  const sb = sandbox('backups')
  const host = loadHost(sb.home)
  const card = path.join(sb.cards, 'a.json')
  writeJson(card, v2Card({ name: 'A', description: 'x'.repeat(200_000) }))
  const dir = path.join(sb.tool, 'backups')
  fs.mkdirSync(dir, { recursive: true })

  console.log('\nbackup folder with 1000 snapshots of a 200 KB card')
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < 1000; i++) {
    host.backupFile(card, 'plain')
  }
  console.log(`  ${'write 1000 snapshots'.padEnd(52)} ${ms(t0).toFixed(1).padStart(9)} ms`)

  await time('backupList over all 1000 snapshots', () => host.handleAction({ action: 'backupList' }))
  await time('pruneBackups from 1000 down to the window', () => host.pruneBackups())
  await time('backupList after the prune', () => host.handleAction({ action: 'backupList' }))

  // The ceiling path only runs when the folder is genuinely enormous, so it is
  // measured separately: 1100 distinct card files, none of which the per-file
  // window touches.
  const sb2 = sandbox('ceiling')
  const host2 = loadHost(sb2.home)
  const card2 = path.join(sb2.cards, 'b.json')
  writeJson(card2, v2Card({ name: 'B' }))
  const dir2 = path.join(sb2.tool, 'backups')
  fs.mkdirSync(dir2, { recursive: true })
  for (let i = 0; i < 1100; i++) {
    fs.writeFileSync(path.join(dir2, `${1790000000000 + i}__plain__c${i}.json`), '{}')
  }
  await time('pruneBackups with the ceiling in play', () => host2.pruneBackups())
  void host
}

/* ------------------------------------------------------------ merge on a card */

{
  const sb = sandbox('merge')
  const host = loadHost(sb.home)

  const names = fs.existsSync(REAL_CARDS)
    ? fs.readdirSync(REAL_CARDS).filter((n) => /\.json$/i.test(n) && !/MVU/i.test(n))
    : []
  if (!names.length) {
    console.log('\nmerge: no real cards found, using a synthetic pair')
  }

  console.log('\nmerge, real card pair where available')
  for (const name of names) {
    const mvuName = `${name.replace(/\.json$/i, '')} MVU版本.json`
    if (!fs.existsSync(path.join(REAL_CARDS, mvuName))) continue
    const plainSrc = path.join(REAL_CARDS, name)
    const mvuSrc = path.join(REAL_CARDS, mvuName)
    const size = (fs.statSync(plainSrc).size + fs.statSync(mvuSrc).size) / 1048576

    const plain = host.loadCard(plainSrc)
    const mvu = host.loadCard(mvuSrc)
    const entries = (plain.data.character_book && plain.data.character_book.entries?.length) || 0

    if (size < 0.2) continue
    const t0 = process.hrtime.bigint()
    host.mergeCards(mvu, plain, 'full', { preferOriginal: true })
    const took = ms(t0)
    // How much of that is the defensive copies, which the merge makes twice over
    // the same data: once for the whole payload and once for the world book.
    const t1 = process.hrtime.bigint()
    structuredClone(mvu.payload)
    const cloneCost = ms(t1)
    const t2 = process.hrtime.bigint()
    structuredClone(mvu.data.character_book || {})
    const bookCloneCost = ms(t2)
    console.log(
      `  ${`${name} (${size.toFixed(1)} MB, ${entries} book entries)`.padEnd(52)} ${took.toFixed(1).padStart(9)} ms` +
        `   clone ${cloneCost.toFixed(1)} + ${bookCloneCost.toFixed(1)}`,
    )
  }

  // A synthetic card with a large world book, so the book path is measured even
  // without the real cards present.
  const entries = 800
  const book = { name: 'b', entries: [] }
  for (let i = 0; i < entries; i++) {
    book.entries.push({ id: i, comment: `e${i}`, content: 'lorem ipsum '.repeat(200), keys: [`k${i}`] })
  }
  const bigPlain = v2Card({ name: 'B', description: 'd'.repeat(60_000), character_book: book })
  const bigMvu = v2Card({ ...bigPlain.data, name: 'B MVU版本', character_book: JSON.parse(JSON.stringify(book)) })
  const asLoaded = (payload) => ({ path: '', shell: 'v2', outer: payload, payload, data: payload.data })
  console.log(`\nsynthetic world book, ${entries} entries`)
  await time('mergeCards, full strategy', () => host.mergeCards(asLoaded(bigMvu), asLoaded(bigPlain), 'full', { preferOriginal: true }))
  await time('mergeCards, minimal strategy', () =>
    host.mergeCards(asLoaded(bigMvu), asLoaded(bigPlain), 'minimal', { preferOriginal: true }),
  )
  await time('bookSnapshot of the book', () => host.bookSnapshot(bigPlain.data.character_book))
}

console.log('')
