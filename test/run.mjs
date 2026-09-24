/**
 * Full pass over the host half, run against a private sandbox install.
 *
 * Every suite gets its own `DSH_HOME`, so nothing here can read or write the
 * real card directory. `node test/run.mjs` prints a per-case report and exits
 * non-zero when anything fails.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHost, loadClient, createReport, writeJson, readJson, workspaceCard, v2Card, rmrf, HOST_FILE } from './harness.mjs'

const ROOT = path.join(os.tmpdir(), 'dcu-test')

/** What `loadCard` returns, for a card built in memory instead of read from disk. */
function asLoaded(payload) {
  return { path: '', shell: 'v2', outer: payload, payload, data: payload.data || {} }
}

/**
 * Call an action the way the HTTP route does: a rejected argument comes back as
 * `{ok:false, error}` rather than as a thrown exception, which is what the
 * browser half reads.
 */
async function act(host, body) {
  try {
    return await host.handleAction(body)
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
}

/** A throwaway `~/.dsh` with the directories the plugin derives its paths from. */
function sandbox(name) {
  const base = path.join(ROOT, name)
  rmrf(base)
  const home = path.join(base, '.dsh')
  const res = path.join(home, 'profile-data', 'tavern', 'data', 'resources')
  const dirs = {
    home,
    res,
    cards: path.join(res, 'cards'),
    tool: path.join(home, 'profile-data', 'tavern', 'data', 'tools', 'card-updater'),
    originals: path.join(home, 'profile-data', 'tavern', 'data', 'originals', 'cards'),
    // The plugin reads `TAVERN_DATA` as the parent of `resources`, so the chat
    // index lives one level below the tavern directory, not directly in it.
    tavern: path.join(home, 'profile-data', 'tavern', 'data'),
  }
  dirs.chats = path.join(dirs.tavern, 'chats')
  for (const d of [dirs.cards, dirs.tool, dirs.originals, dirs.chats]) fs.mkdirSync(d, { recursive: true })
  return dirs
}

const report = createReport('dsh-card-updater host')

/* ------------------------------------------------------------------ paths */

{
  report.group('path helpers')
  const sb = sandbox('paths')
  const host = loadHost(sb.home)

  report.eq('resolveDirInput: empty asks for the drive list', host.resolveDirInput(''), host.DRIVE_LIST)
  report.eq('resolveDirInput: whitespace asks for the drive list', host.resolveDirInput('   '), host.DRIVE_LIST)
  report.eq('resolveDirInput: quoted path is unwrapped', host.resolveDirInput('"D:\\backups"'), 'D:\\backups')
  report.eq('resolveDirInput: bare drive letter gains a separator', host.resolveDirInput('D:'), 'D:\\')
  report.eq('resolveDirInput: drive root keeps its separator', host.resolveDirInput('D:\\'), 'D:\\')
  report.eq('resolveDirInput: trailing separator is trimmed', host.resolveDirInput('D:\\backups\\'), 'D:\\backups')
  report.eq(
    'resolveDirInput: a relative name resolves under the card directory',
    host.resolveDirInput('sub'),
    path.join(sb.cards, 'sub'),
  )
  report.eq('resolveDirInput: forward slashes are accepted', host.resolveDirInput('D:/backups'), path.normalize('D:/backups'))

  report.eq('parentOf: one level up', host.parentOf('D:\\a\\b'), 'D:\\a')
  report.eq('parentOf: a drive root has no folder above it', host.parentOf('D:\\'), host.DRIVE_LIST)
  report.eq('parentOf: the drive list stays put', host.parentOf(host.DRIVE_LIST), host.DRIVE_LIST)
  report.eq('parentOf: a trailing separator is not its own parent', host.parentOf('D:\\a\\'), 'D:\\')

  report.ok('isInside: a child', host.isInside('C:\\a\\b', 'C:\\a'))
  report.ok('isInside: itself', host.isInside('C:\\a', 'C:\\a'))
  report.ok('isInside: a sibling sharing a prefix is not inside', !host.isInside('C:\\ab', 'C:\\a'))
  report.ok(
    'isInside: case differences do not matter on Windows',
    host.isInside('C:\\Users\\x', 'c:\\users'),
    'mixed case was treated as outside, which lets a folder be nested inside another',
  )
}

/* --------------------------------------------------------------- versions */

{
  report.group('version handling')
  const sb = sandbox('versions')
  const host = loadHost(sb.home)

  report.eq('versionParts: reads the first dotted run', host.versionParts('v1.2.3'), [1, 2, 3])
  report.eq('versionParts: no number at all', host.versionParts('abc'), null)
  report.eq('compareVersions: 1.10 beats 1.9', host.compareVersions('1.10', '1.9'), 1)
  report.eq('compareVersions: 5.3 equals 5.3.0', host.compareVersions('5.3', '5.3.0'), 0)
  report.eq('compareVersions: unreadable left side loses', host.compareVersions('x', '1.0'), -1)
  report.eq('compareVersions: unreadable right side wins', host.compareVersions('1.0', 'x'), 1)

  report.eq('extractVersionInfo: a labelled version', host.extractVersionInfo('版本 5.3'), {
    value: '5.3',
    kind: 'version',
  })
  report.eq('extractVersionInfo: a posting date is a date', host.extractVersionInfo('9.21更新').kind, 'date')
  report.eq(
    'extractVersionInfo: a build number glued to the label is skipped',
    host.extractVersionInfo('酒馆版本 1.12.0'),
    null,
  )
  report.eq(
    'extractVersionInfo: an unlabelled build-number line is still read as a version',
    host.extractVersionInfo('适用于酒馆 1.12.0'),
    { value: '1.12.0', kind: 'version' },
  )
  report.eq(
    'extractVersionInfo: a version on a line after a build number survives',
    host.extractVersionInfo('适用于酒馆 1.12.0\n版本 5.3'),
    { value: '5.3', kind: 'version' },
  )
  report.eq('extractVersion: bare fallback', host.extractVersion('no labels here, just 2.7'), '2.7')

  report.eq('bumpVersion: numeric tail', host.bumpVersion('0.5.5'), '0.5.6')
  report.eq('bumpVersion: uppercase V is preserved', host.bumpVersion('V1.4'), 'V1.5')
  report.eq('bumpVersion: non-numeric tail', host.bumpVersion('1.2b'), '1.3b')
}

/* --------------------------------------------------------- backup naming */

{
  report.group('backup naming and retention')
  const sb = sandbox('backups')
  const host = loadHost(sb.home)

  report.ok('isBackupName: a plain snapshot', host.isBackupName('1790183787427__plain__a.json'))
  report.ok('isBackupName: a card name with double underscores', host.isBackupName('1790183787427__plain__a__b.json'))
  report.ok('isBackupName: an unknown tag is not ours', !host.isBackupName('1790183787427__nope__a.json'))
  report.ok('isBackupName: a foreign file is not ours', !host.isBackupName('notes.json'))
  report.ok('isBackupName: a short stamp is not ours', !host.isBackupName('123__plain__a.json'))
  report.ok('isBackupName: a non-json tail is not ours', !host.isBackupName('1790183787427__plain__a.json.bak'))

  // 8 snapshots of one file and 2 of another, all within the per-file window.
  fs.mkdirSync(sb.tool, { recursive: true })
  const dir = path.join(sb.tool, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = (i) => 1790000000000 + i * 1000
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(dir, `${stamp(i)}__plain__a.json`), `a${i}`)
  fs.writeFileSync(path.join(dir, `${stamp(20)}__mvu__b.json`), 'b')
  // A file that is not a snapshot must never be touched by the retention pass.
  fs.writeFileSync(path.join(dir, 'notes.json'), 'mine')

  const pruned = await host.pruneBackups()
  report.eq('prune: keeps the per-file window', fs.readdirSync(dir).filter((n) => n.includes('__plain__a.json')).length, 5)
  report.eq('prune: a second file keeps its own window', fs.readdirSync(dir).filter((n) => n.includes('__mvu__b.json')).length, 1)
  report.ok('prune: a foreign file survives', fs.existsSync(path.join(dir, 'notes.json')))
  report.ok('prune: the oldest of the window is the one dropped', pruned.removed.includes(`${stamp(0)}__plain__a.json`))
  report.ok('prune: the newest of the window stays', fs.existsSync(path.join(dir, `${stamp(7)}__plain__a.json`)))

  // The ceiling has to give up the oldest, and must never leave a card with no
  // snapshot at all when it can help it.
  const sb2 = sandbox('ceiling')
  const host2 = loadHost(sb2.home)
  const dir2 = path.join(sb2.tool, 'backups')
  fs.mkdirSync(dir2, { recursive: true })
  const total = host2.BACKUP_KEEP_TOTAL
  report.ok('ceiling: the ceiling is the documented 1000', total === 1000, `got ${total}`)
  const files = total + 20
  for (let i = 0; i < files; i++) {
    fs.writeFileSync(path.join(dir2, `${stamp(i)}__plain__c${i}.json`), 'x')
  }
  await host2.pruneBackups()
  const left = fs.readdirSync(dir2)
  report.eq('ceiling: the folder comes down to the ceiling', left.length, total)
  report.ok(
    'ceiling: everything removed is the oldest',
    !left.includes(`${stamp(0)}__plain__c0.json`) && left.includes(`${stamp(files - 1)}__plain__c${files - 1}.json`),
  )

  // The tag list is the guard that keeps the retention pass off files this
  // plugin did not write, so it has to agree with the labels the panel offers and
  // with the tags the code actually passes to `backupFile`. These three drifted
  // apart: the panel had labels for two tags nothing writes any more, and the
  // host wrote three tags the panel had no label for.
  const written = new Set()
  for (const m of fs.readFileSync(HOST_FILE, 'utf8').matchAll(/backupFile\([^)]*?,\s*'([^']+)'/g)) {
    written.add(m[1])
  }
  report.ok('the scan found the snapshot tags in the source', written.size >= 6, `found ${[...written].join(', ')}`)
  report.eq(
    'every tag the code writes is one the tag list recognises',
    [...written].filter((t) => !host.BACKUP_TAGS.has(t)),
    [],
  )

  const { internals } = loadClient()
  const labels = new Set(
    Object.keys(internals.zh || {})
      .filter((k) => k.startsWith('tag.'))
      .map((k) => k.slice(4)),
  )
  report.eq(
    'every tag the host recognises has a panel label',
    [...host.BACKUP_TAGS].filter((t) => !labels.has(t)),
    [],
  )
  report.eq(
    'every panel label names a tag the host recognises',
    [...labels].filter((t) => !host.BACKUP_TAGS.has(t)),
    [],
  )
}

/* ----------------------------------------------------------------- config */

{
  report.group('config normalisation')
  const sb = sandbox('config')
  const host = loadHost(sb.home)

  const cfg = host.normalizeCfg({
    autoCheckMinutes: -5,
    mergeStrategy: 'full',
    bookPreferOriginal: false,
    backupDir: '  D:\\b  ',
    cards: [{ id: 'a', label: 'A', plain: { path: 'p.json' }, primary: { url: 'u', gates: ['g'] } }],
  })
  report.eq('normalizeCfg: a negative interval floors at zero', cfg.autoCheckMinutes, 0)
  report.eq('normalizeCfg: the strategy is kept', cfg.mergeStrategy, 'full')
  report.eq('normalizeCfg: a false boolean stays false', cfg.bookPreferOriginal, false)
  report.eq('normalizeCfg: the backup directory is trimmed', cfg.backupDir, 'D:\\b')
  report.eq('normalizeCfg: a card id is kept', cfg.cards[0].id, 'a')
  report.eq('normalizeCfg: the unknown-interval default is preserved', host.normalizeCfg({}).autoCheckMinutes, 0)

  const unknown = host.normalizeCfg({ cards: [{ id: 'x', extra: 1 }] })
  report.eq('normalizeCfg: an entry keeps every field the panel writes', Object.keys(unknown.cards[0]).sort().join(','), [
    'enabled',
    'id',
    'label',
    'mvu',
    'note',
    'pairVia',
    'plain',
    'primary',
    'syncPlain',
  ].join(','))

  // `save` replaces the whole config, so a round trip through a panel payload
  // must not silently drop anything the panel did not send.
  const sent = host.normalizeCfg(null)
  sent.cards = [
    {
      id: 'a',
      label: 'A',
      plain: { path: 'C:\\p.json', sig: 's' },
      mvu: { path: 'C:\\m.json' },
      primary: { url: 'https://x', match: 'k', sig: 'ps', feedSeen: ['f'] },
      mergedAt: '2020-01-01',
      bookSeen: { i1: 'h' },
    },
  ]
  const back = host.normalizeCfg(JSON.parse(JSON.stringify(sent)))
  report.eq('normalizeCfg: a merge record survives a round trip', back.cards[0].bookSeen, { i1: 'h' })
  report.eq('normalizeCfg: a merge time survives a round trip', back.cards[0].mergedAt, '2020-01-01')
  report.eq('normalizeCfg: a feed record survives a round trip', back.cards[0].primary.feedSeen, ['f'])
}

/* ------------------------------------------------------ card pairing scan */

{
  report.group('card directory pairing')
  const sb = sandbox('pairing')
  const host = loadHost(sb.home)

  // The naming convention the shipped cards actually use.
  const real = ['道渊v5.4.2.json', '道渊v5.4.2 MVU版本.json']
  report.ok('pairPathOf: the MVU name for an original', host.pairPathOf('道渊v5.4.2.json') === real[1])
  report.ok('pairPathOf: an MVU file maps back to its original', host.pairPathOf(real[1]) === real[0])
  report.ok('isMvuFile: recognises the shipped naming', host.isMvuFile(real[1]))
  report.ok('isMvuFile: an original is not an MVU file', !host.isMvuFile(real[0]))

  writeJson(path.join(sb.cards, real[0]), v2Card({ name: '道渊', character_version: '5.4.2' }))
  writeJson(path.join(sb.cards, real[1]), workspaceCard({ name: '道渊 MVU版本', character_version: '5.4.2' }))
  writeJson(
    path.join(sb.cards, '龙娘回廊！5.3.json'),
    v2Card({ name: '龙娘回廊', character_version: '5.3' }),
  )
  writeJson(
    path.join(sb.cards, '龙娘回廊！5.3 MVU版本.json'),
    workspaceCard({ name: '龙娘回廊 MVU版本', character_version: '5.3' }),
  )

  const suggested = host.suggestConfig(null)
  const byLabel = (l) => suggested.cards.find((c) => c.label === l)
  report.eq('suggestConfig: one entry per original', suggested.cards.length, 2)
  report.eq(
    'suggestConfig: an original is paired with its MVU copy',
    path.basename(String(byLabel('道渊v5.4.2')?.mvu?.path || '')),
    real[1],
  )
  report.eq('suggestConfig: pairing says how it was made', byLabel('道渊v5.4.2')?.pairVia, 'name')
  report.ok(
    'suggestConfig: no MVU file is offered as an original',
    suggested.cards.every((c) => !/MVU/.test(String(c.plain.path || ''))),
  )

  // A pairing decided at scan time must not be carried over by a rescan.
  const rescan = host.suggestConfig(suggested)
  report.eq('suggestConfig: a rescan does not duplicate entries', rescan.cards.length, 2)
}

/* ------------------------------------------------------------ merge engine */

{
  report.group('merge engine')
  const sb = sandbox('merge')
  const host = loadHost(sb.home)

  report.ok(
    'deepEqual: the same object written in another order',
    host.deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }),
    'JSON.stringify comparison calls two equal objects different when their keys were inserted in another order',
  )
  report.ok('deepEqual: nested difference is still caught', !host.deepEqual({ a: { x: 1 } }, { a: { x: 2 } }))

  const mvu = v2Card({
    name: 'A MVU版本',
    description: 'old',
    first_mes: 'hi <StatusPlaceHolder/>',
    character_book: {
      name: 'book',
      entries: [
        { id: 1, comment: 'lore', content: 'old lore', keys: ['k'] },
        { id: 2, comment: 'var rule', content: '使用 mvu_submit_update 更新变量', keys: [] },
      ],
    },
  })
  const plain = v2Card({
    name: 'A',
    description: 'new',
    first_mes: 'hi',
    character_book: {
      name: 'book',
      entries: [
        { id: 1, comment: 'lore', content: 'new lore', keys: ['k'] },
        { id: 2, comment: 'var rule', content: '请输出 <update> 和 JSON Patch', keys: [] },
        { id: 3, comment: 'extra', content: 'brand new', keys: ['e'] },
      ],
    },
  })

  const merged = host.mergeCards(asLoaded(mvu), asLoaded(plain), 'full', {
    preferOriginal: true,
  })
  const data = merged.payload.data
  report.eq('mergeCards: the author text arrives', data.description, 'new')
  report.ok(
    'mergeCards: a field carrying status-bar machinery is kept',
    data.first_mes === 'hi <StatusPlaceHolder/>',
    `got ${JSON.stringify(data.first_mes)}`,
  )
  report.ok('mergeCards: the MVU marker in the name survives', /MVU/.test(String(data.name)))

  const book = data.character_book.entries
  report.eq('mergeBook: the author text replaces an untouched entry', book.find((e) => e.id === 1).content, 'new lore')
  report.ok(
    'mergeBook: the copy protocol entry is held, not overwritten',
    book.find((e) => e.id === 2).content.includes('mvu_submit_update'),
  )
  report.eq('mergeBook: a new author entry is added', book.find((e) => e.id === 3)?.content, 'brand new')
  report.ok('mergeBook: the held entry is reported', merged.details.book.held.length === 1)

  // A user-edited entry, recorded as such, must survive the author's revision.
  const edited = host.mergeCards(asLoaded(mvu), asLoaded(plain), 'full', {
    preferOriginal: true,
    bookSeen: { i1: 'a-hash-that-does-not-match' },
  })
  report.eq(
    'mergeBook: an entry the user edited is left alone',
    edited.payload.data.character_book.entries.find((e) => e.id === 1).content,
    'old lore',
  )
  report.ok('mergeBook: the conflict is reported', edited.details.book.conflicts.length === 1)

  // The fingerprint is what separates "someone edited this on the copy" from
  // "the author revised this". Both look like an entry whose text differs from
  // the new original, and only the record tells them apart.
  const mine = v2Card({
    name: 'B MVU版本',
    character_book: { name: 'b', entries: [{ id: 1, comment: 'lore', content: 'my edit', keys: [] }] },
  })
  const author = v2Card({
    name: 'B',
    character_book: { name: 'b', entries: [{ id: 1, comment: 'lore', content: 'author new', keys: [] }] },
  })
  const seen = host.bookSnapshot(mine.data.character_book)
  const clean = host.mergeCards(asLoaded(mine), asLoaded(author), 'full', {
    preferOriginal: true,
    bookSeen: seen,
  })
  report.eq(
    'mergeBook: an untouched entry follows the author',
    clean.payload.data.character_book.entries[0].content,
    'author new',
  )
  report.ok('mergeBook: following the author is not reported as a conflict', clean.details.book.conflicts.length === 0)

  const touched = v2Card({
    name: 'B MVU版本',
    character_book: { name: 'b', entries: [{ id: 1, comment: 'lore', content: 'my edit, again', keys: [] }] },
  })
  const kept = host.mergeCards(asLoaded(touched), asLoaded(author), 'full', {
    preferOriginal: true,
    bookSeen: seen,
  })
  report.eq(
    'mergeBook: an entry edited after the last merge keeps the user text',
    kept.payload.data.character_book.entries[0].content,
    'my edit, again',
  )
  report.ok('mergeBook: the new edit is reported as a conflict', kept.details.book.conflicts.length === 1)

  // A record written against one entry must be read back against the same entry
  // even when the book has been reordered around it.
  const reordered = v2Card({
    name: 'B MVU版本',
    character_book: {
      name: 'b',
      entries: [
        { id: 7, comment: 'added later', content: 'z', keys: [] },
        { id: 1, comment: 'lore', content: 'my edit', keys: [] },
      ],
    },
  })
  const reorderedResult = host.mergeCards(asLoaded(reordered), asLoaded(author), 'full', {
    preferOriginal: true,
    bookSeen: seen,
  })
  report.eq(
    'mergeBook: a record keyed by entry id survives a reorder',
    reorderedResult.payload.data.character_book.entries.find((e) => e.id === 1).content,
    'author new',
  )
}

/* ------------------------------------------------------------ list a folder */

{
  report.group('folder listing')
  const sb = sandbox('listing')
  const host = loadHost(sb.home)
  fs.mkdirSync(path.join(sb.cards, 'inner'), { recursive: true })
  fs.writeFileSync(path.join(sb.cards, 'inner', 'a.json'), '{}')
  fs.writeFileSync(path.join(sb.cards, 'inner', 'b.txt'), 'x')

  const listing = host.listDirEntries(sb.cards)
  report.eq('listDirEntries: only json files are offered', listing.entries.map((e) => e.name).join(','), 'inner')
  report.eq('listDirEntries: a folder is marked as one', listing.entries[0].type, 'directory')
  report.eq('listDirEntries: the parent is one level up', listing.parent, path.dirname(sb.cards))

  const inner = host.listDirEntries(path.join(sb.cards, 'inner'))
  report.eq('listDirEntries: files sort before folders', inner.entries.map((e) => e.name).join(','), 'a.json')

  const missing = host.listDirEntries(path.join(sb.cards, 'nope'))
  report.ok('listDirEntries: a missing folder reports why', !!missing.error)

  const drives = host.listDirEntries('')
  report.ok('listDirEntries: an empty path is the drive list', drives.drives && drives.parent === null)
  report.ok('listDirEntries: the drive list has the system drive', drives.entries.some((e) => /^[A-Z]:\\$/.test(e.name)))
}

/* ------------------------------------------------------- snapshot writing */

{
  report.group('snapshot writing')
  const sb = sandbox('snapshots')
  const host = loadHost(sb.home)
  const card = path.join(sb.cards, 'a.json')
  writeJson(card, v2Card({ name: 'A' }))
  const dir = path.join(sb.tool, 'backups')

  const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0
  const made = []
  for (let i = 0; i < 200; i++) made.push(host.backupFile(card, 'plain'))
  const after = fs.readdirSync(dir).length
  report.eq(
    'backupFile: two hundred snapshots write two hundred files',
    after - before,
    200,
    )
  report.eq(
    'backupFile: no snapshot was silently overwritten',
    new Set(made).size,
    200,
  )
}

/* ---------------------------------------------------------- backup actions */

{
  report.group('backup actions')
  const sb = sandbox('acts')
  const host = loadHost(sb.home)
  const dir = path.join(sb.tool, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  // Something of the operator's own in the folder the setting points at.
  fs.writeFileSync(path.join(dir, 'notes.json'), 'mine')
  fs.writeFileSync(path.join(dir, '1790000000000__plain__a.json'), JSON.stringify(v2Card({ name: 'A' })))
  fs.writeFileSync(path.join(dir, '1790000000000__nope__a.json'), JSON.stringify(v2Card({ name: 'A' })))

  const delForeign = await act(host, { action: 'deleteBackup', name: 'notes.json' })
  report.ok(
    'deleteBackup: a file that is not a snapshot is refused',
    delForeign.ok === false,
    'the retention pass is careful never to touch foreign files, and delete reached past that guard',
  )
  report.ok('deleteBackup: the refused file is still there', fs.existsSync(path.join(dir, 'notes.json')))

  const delUnknownTag = await act(host, { action: 'deleteBackup', name: '1790000000000__nope__a.json' })
  report.ok('deleteBackup: an unknown tag is refused', delUnknownTag.ok === false)

  const delOurs = await act(host, { action: 'deleteBackup', name: '1790000000000__plain__a.json' })
  report.ok('deleteBackup: a real snapshot is removed', delOurs.ok === true)

  const esc1 = await act(host, { action: 'deleteBackup', name: '..\\..\\notes.json' })
  report.ok('deleteBackup: a parent reference is refused', esc1.ok === false)
  const esc2 = await act(host, { action: 'deleteBackup', name: 'C:\\Windows\\system.ini' })
  report.ok('deleteBackup: an absolute path is refused', esc2.ok === false)

  const badRestore = await act(host, { action: 'restoreBackup', name: 'notes.json' })
  report.ok('restoreBackup: a file that is not a snapshot is refused', badRestore.ok === false)
}

/* ------------------------------------------------------- backup folder set */

{
  report.group('backup folder')
  const sb = sandbox('folder')
  const host = loadHost(sb.home)

  let refused = false
  try {
    host.runSetBackupDir(sb.cards, false)
  } catch {
    refused = true
  }
  report.ok('setBackupDir: the card directory itself is refused', refused)

  let refusedCase = false
  try {
    host.runSetBackupDir(sb.cards.toUpperCase(), false)
  } catch {
    refusedCase = true
  }
  report.ok(
    'setBackupDir: the card directory is refused whatever the case',
    refusedCase,
    'a path typed with different case compares as a different folder, so the guard let it through',
  )

  // Writing a folder that is inside the card directory would put snapshots where
  // the updater then reads them back as cards.
  let refusedNested = false
  try {
    host.runSetBackupDir(path.join(sb.cards, 'sub'), false)
  } catch {
    refusedNested = true
  }
  report.ok('setBackupDir: a folder inside the card directory is refused', refusedNested)

  const outside = path.join(sb.home, 'snaps')
  const ok = host.runSetBackupDir(outside, false)
  report.eq('setBackupDir: a folder outside is accepted', ok.dir, path.resolve(outside))
  report.eq('setBackupDir: the setting is stored', host.backupDir(), path.resolve(outside))
  report.eq(
    'setBackupDir: the default folder is stored as empty',
    host.runSetBackupDir(host.DEFAULT_BACKUP_DIR, false).isDefault,
    true,
  )
  report.eq('setBackupDir: and reads back as the default', host.backupDir(), host.DEFAULT_BACKUP_DIR)

  // A path written with trailing space or a trailing separator is the same
  // folder, and must not be recorded as a different one.
  host.runSetBackupDir(outside, false)
  const again = host.runSetBackupDir(`${outside}${path.sep}`, false)
  report.eq('setBackupDir: a trailing separator is not a different folder', again.isDefault, false)

  const respelled = host.runSetBackupDir(outside.toUpperCase(), true)
  report.eq('setBackupDir: another spelling of the same folder is not a move', respelled.moved, 0)
  report.eq('setBackupDir: and the stored spelling is kept', host.backupDir(), path.resolve(outside))

  /* -------------------------------------------------- moving the folder */

  const from = path.join(sb.home, 'snapA')
  const to = path.join(sb.home, 'snapB')
  const snap = '1790000000001__plain__a.json'
  fs.mkdirSync(from, { recursive: true })
  fs.writeFileSync(path.join(from, snap), 'SNAPSHOT')
  fs.writeFileSync(path.join(from, 'notes.json'), 'mine')
  host.runSetBackupDir(from, false)

  const move = host.runSetBackupDir(to, true)
  report.eq('move: the snapshot travels', move.moved, 1)
  report.eq('move: it is now in the new folder', fs.existsSync(path.join(to, snap)), true)
  report.eq('move: and gone from the old one', fs.existsSync(path.join(from, snap)), false)
  report.eq('move: the setting points at the new folder', host.backupDir(), path.resolve(to))
  report.ok(
    'move: a file of the operator own stays where it was',
    fs.existsSync(path.join(from, 'notes.json')) && !fs.existsSync(path.join(to, 'notes.json')),
  )

  // The same name in both folders holding the same bytes: the source may go.
  fs.writeFileSync(path.join(from, snap), 'SNAPSHOT')
  const twice = host.runSetBackupDir(from, true)
  report.eq('move: a folder pair holding the same snapshot is not a copy', twice.moved, 0)
  report.eq('move: it is counted as already there', twice.kept, 1)
  report.eq('move: and the duplicate source is cleared away', fs.existsSync(path.join(to, snap)), false)
  report.eq('move: the snapshot survives where the setting now points', fs.existsSync(path.join(from, snap)), true)

  // The same name holding different bytes. Both are somebody's data, and the
  // move must not settle that by deleting one of them.
  fs.writeFileSync(path.join(to, snap), 'DIFFERENT')
  const clash = host.runSetBackupDir(to, true)
  report.eq('move: a name clash with other contents is reported', clash.skipped.length, 1)
  report.eq(
    'move: nothing is copied over the file already there',
    fs.readFileSync(path.join(to, snap), 'utf8'),
    'DIFFERENT',
  )
  report.ok(
    'move: and the snapshot in the old folder is kept',
    fs.existsSync(path.join(from, snap)),
    'the move deleted a source whose same-named target held different bytes',
  )
  report.eq('move: the setting still moved', host.backupDir(), path.resolve(to))
}

/* ------------------------------------------------------------ plugin start */

{
  report.group('plugin start')
  const sb = sandbox('start')
  fs.mkdirSync(sb.tool, { recursive: true })
  // The backup folder points at a drive this machine does not have, which is
  // what a laptop looks like once the external disk is unplugged.
  let missing = null
  for (let code = 90; code >= 65; code--) {
    const root = `${String.fromCharCode(code)}:\\`
    if (!fs.existsSync(root)) {
      missing = path.join(root, 'gone')
      break
    }
  }
  writeJson(path.join(sb.tool, 'config.json'), {
    version: 1,
    backupDir: missing,
    cards: [],
  })

  const host = loadHost(sb.home)
  let threw = null
  try {
    host.apply({ inject() {}, effect() {}, on() {}, get() {} })
  } catch (e) {
    threw = e && e.message ? e.message : String(e)
  }
  report.ok(
    'apply: an unreachable backup folder does not stop the plugin loading',
    !threw,
    threw || '',
  )
  if (missing) {
    report.ok(
      'apply: the panel still has a state to render',
      !!host.statePayload().ok,
    )
  }

  // A path Windows will not accept at all, which is what a typo looks like.
  const bad = sandbox('start-bad')
  writeJson(path.join(bad.tool, 'config.json'), { version: 1, backupDir: path.join(bad.home, 'a<b>c'), cards: [] })
  const host2 = loadHost(bad.home)
  let threw2 = null
  try {
    host2.apply({ inject() {}, effect() {}, on() {}, get() {} })
  } catch (e) {
    threw2 = e && e.message ? e.message : String(e)
  }
  report.ok('apply: a backup folder Windows refuses is survivable', !threw2, threw2 || '')
  report.ok('apply: and the panel is still reachable', !!host2.statePayload().ok)
  // The plugin must not have quietly decided to write somewhere else.
  report.eq('apply: the unusable setting is left as the operator typed it', host2.backupDir(), path.join(bad.home, 'a<b>c'))
}

/* ------------------------------------------------------------ import plain */

{
  report.group('import and rename')
  const sb = sandbox('import')
  const host = loadHost(sb.home)
  const mvuName = '道渊v5.4.2 MVU版本.json'
  writeJson(path.join(sb.cards, '道渊v5.4.2.json'), v2Card({ name: '道渊', character_version: '5.4.2' }))
  writeJson(path.join(sb.cards, mvuName), workspaceCard({ name: '道渊 MVU版本', character_version: '5.4.2' }))
  fs.writeFileSync(path.join(sb.originals, '道渊v5.4.2.png'), 'PNG')
  writeJson(path.join(sb.tavern, 'index.json'), {
    chats: [
      { id: 'c1', mode: 'debug', cardPath: 'cards/道渊v5.4.2.json', cardName: '道渊', updatedAt: 5, lastOpenedAt: 1 },
      { id: 'c2', mode: 'story', cardPath: 'cards/道渊v5.4.2.json', cardName: '道渊', updatedAt: 5, lastOpenedAt: 1 },
    ],
  })
  writeJson(path.join(sb.tavern, 'sessions.json'), { 'c1': 'sess-1' })

  host.db.cfg = host.normalizeCfg({
    cards: [
      {
        id: 'a',
        label: '道渊v5.4.2',
        plain: { path: path.join(sb.cards, '道渊v5.4.2.json') },
        mvu: { path: path.join(sb.cards, mvuName) },
        primary: { match: '道渊' },
      },
    ],
  })
  host.db.loaded = true

  const incoming = path.join(os.tmpdir(), 'dcu-test-incoming', '道渊v5.4.3.json')
  writeJson(incoming, v2Card({ name: '道渊', character_version: '5.4.3' }))

  const result = await host.importPlain('a', incoming)
  const entry = host.db.cfg.cards[0]

  report.eq('importPlain: the release lands under its own file name', path.basename(String(entry.plain.path)), '道渊v5.4.3.json')
  report.eq('importPlain: the old file is gone', fs.existsSync(path.join(sb.cards, '道渊v5.4.2.json')), false)
  report.eq('importPlain: the MVU copy follows the rename', path.basename(String(entry.mvu.path)), '道渊v5.4.3 MVU版本.json')
  report.eq('importPlain: the label follows', entry.label, '道渊')
  report.eq('importPlain: the release version is reported', result.version, '5.4.3')
  report.eq('importPlain: the snapshot was taken before the write', !!result.backup, true)

  const index = readJson(path.join(sb.tavern, 'index.json'))
  report.eq(
    'importPlain: conversations follow the rename',
    index.chats.filter((c) => c.cardPath === 'cards/道渊v5.4.3.json').length,
    2,
  )
  report.eq('repointChats: and their label follows', index.chats[0].cardName, '道渊')

  report.ok(
    'importPlain: the original keeps a picture under its own name',
    fs.existsSync(path.join(sb.originals, '道渊v5.4.3.png')),
    `originals now holds: ${fs.readdirSync(sb.originals).join(', ') || '(nothing)'}`,
  )
  report.ok(
    'importPlain: the copy gets its own picture too',
    fs.existsSync(path.join(sb.originals, '道渊v5.4.3 MVU版本.png')),
    `originals now holds: ${fs.readdirSync(sb.originals).join(', ') || '(nothing)'}`,
  )

  // Importing the file that is already in place is the "sync the names" path.
  const same = await host.importPlain('a', entry.plain.path)
  report.ok('importPlain: importing the card already in place is not an error', !!same.synced)
  report.eq('importPlain: it does not write another snapshot', same.backup, null)
}

/* --------------------------------------------------------------- self view */

{
  report.group('self state')
  const sb = sandbox('self')
  const host = loadHost(sb.home)
  writeJson(path.join(sb.cards, 'a.json'), v2Card({ name: 'A' }))
  const state = host.statePayload()
  report.eq('statePayload: reports ok', state.ok, true)
  report.ok('statePayload: names the card directory', String(state.cardDir).endsWith('cards'))
  report.ok('statePayload: reports the installed version', /^\d+\.\d+\.\d+$/.test(String(state.version)))
  report.eq('statePayload: lists the card files', state.files, ['a.json'])
  report.eq('statePayload: no folder chooser was reported', state.picker, null)
  report.eq('statePayload: keeps the ceiling visible to the panel', state.keepTotal, 1000)

  const noChoice = await act(host, { action: 'pickFolder' })
  report.ok('pickFolder: says so when the host has no chooser', noChoice.ok === false && !!noChoice.error)
  report.ok('pickFolder: the refusal reads as a fact, not a crash', !/undefined|\[object/.test(String(noChoice.error)))

  const unknown = await act(host, { action: 'nope' })
  report.ok('handleAction: an unknown action is refused', unknown.ok === false)
  report.eq('handleAction: and says which one', /nope/.test(String(unknown.error)), true)
}

process.exit(report.finish() ? 1 : 0)
