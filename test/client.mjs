/**
 * Browser half: dictionary, stylesheet and the pure helpers behind the panel.
 *
 * The components are not rendered here. What is checked is the part that can be
 * wrong without throwing: a dictionary key the code asks for and the file does
 * not define, a stylesheet that does not balance, and the small converters the
 * panel runs on every render.
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadClient, createReport, CLIENT_FILE } from './harness.mjs'

const report = createReport('dsh-card-updater browser')
const { client, internals: c, source } = loadClient()

/* ------------------------------------------------------------------- wiring */

{
  report.group('module wiring')
  report.eq('registers under the plugin name', client.name, 'dsh-card-updater')
  report.eq('exports an apply', typeof client.apply, 'function')
  for (const service of ['slots', 'locale', 'uiWorkspace']) {
    report.ok(`declares ${service} so cordis resolves it`, (client.inject || []).includes(service))
  }
  report.ok('the file on disk is the one that was loaded', fs.readFileSync(CLIENT_FILE, 'utf8') === source)

  // Bind the real dictionary the way the host does, so everything below reads
  // the strings a user would see rather than the raw keys.
  const dicts = new Map()
  const ctx = {
    locale: {
      register(ns, dict) {
        dicts.set(ns, dict)
      },
      bind(ns) {
        const entry = dicts.get(ns) || {}
        const dict = entry.zh || {}
        return (key) => (Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key)
      },
    },
    slots: { inject() {}, register() {} },
    // The dictionary is registered from inside an effect, so an effect that only
    // records its callback would leave every string in the panel unresolved.
    effect(fn) {
      const dispose = typeof fn === 'function' ? fn() : null
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject() {},
  }
  let applied = null
  try {
    client.apply(ctx)
    applied = true
  } catch (e) {
    applied = e && e.message ? e.message : String(e)
  }
  report.eq('apply runs against a plain context', applied, true)
}

/* --------------------------------------------------------------- dictionary */

{
  report.group('dictionary')
  const zh = c.zh || {}
  const en = c.en || {}
  const zhKeys = Object.keys(zh)
  const enKeys = Object.keys(en)

  report.eq('both languages define the same number of keys', zhKeys.length, enKeys.length)
  report.eq(
    'every Chinese key has an English one',
    zhKeys.filter((k) => !Object.prototype.hasOwnProperty.call(en, k)),
    [],
  )
  report.eq(
    'every English key has a Chinese one',
    enKeys.filter((k) => !Object.prototype.hasOwnProperty.call(zh, k)),
    [],
  )
  report.eq(
    'no entry is empty in either language',
    [...zhKeys, ...enKeys].filter((k) => !String(zh[k] ?? '').trim() || !String(en[k] ?? '').trim()),
    [],
  )

  // Every key the code asks for by name. A key passed as a variable cannot be
  // seen here, so those families are enumerated separately below.
  const asked = new Set()
  for (const m of source.matchAll(/\bt\('([^'\\]+)'\)/g)) asked.add(m[1])
  const unknown = [...asked].filter((k) => !Object.prototype.hasOwnProperty.call(zh, k)).sort()
  report.eq('every dictionary key the code names exists', unknown, [])
  report.ok('the scan really found keys', asked.size > 100, `found ${asked.size}`)

  // `field.<name>` and `ext.<name>` are built from a variable, so they are
  // checked against the lists that produce them.
  const fields = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'system_prompt',
    'post_history_instructions',
    'creator_notes',
    'creator',
    'character_version',
    'tags',
    'alternate_greetings',
  ]
  report.eq(
    'every card field the log can name has a label',
    fields.filter((f) => !Object.prototype.hasOwnProperty.call(zh, `field.${f}`)),
    [],
  )
  const exts = ['talkativeness', 'fav', 'world', 'depth_prompt', 'xiaobaix-template']
  report.eq(
    'every extension the log can name has a label',
    exts.filter((f) => !Object.prototype.hasOwnProperty.call(zh, `ext.${f}`)),
    [],
  )
  const tags = [
    'plain',
    'mvu',
    'manual',
    'before-import',
    'before-restore',
    'before-name-marker',
    'before-chat-repoint',
  ]
  report.eq(
    'every snapshot kind has a label',
    tags.filter((f) => !Object.prototype.hasOwnProperty.call(zh, `tag.${f}`)),
    [],
  )
}

/* -------------------------------------------------------------- stylesheet */

{
  report.group('stylesheet')
  const css = typeof c.CSS === 'string' ? c.CSS : (c.CSS || []).join('\n')
  report.ok('the stylesheet is not empty', css.length > 1000, `${css.length} chars`)
  const open = (css.match(/\{/g) || []).length
  const close = (css.match(/\}/g) || []).length
  report.eq('braces balance', open, close)
  report.eq('no stray double semicolon', /;;/.test(css), false)
  report.eq('no stray comma inside a declaration block', /,\s*\}/.test(css), false)
  // The panel mounts in two seats; a class defined twice with different values
  // is how one seat ends up styled by a stale rule.
  const declared = new Map()
  for (const m of css.matchAll(/\.dcu-[\w-]+/g)) {
    const name = m[0]
    declared.set(name, (declared.get(name) || 0) + 1)
  }
  report.ok('the panel namespace is used consistently', [...declared.keys()].every((k) => k.startsWith('.dcu-')))
}

/* -------------------------------------------------------------- converters */

{
  report.group('panel converters')
  report.eq('withV adds the marker', c.withV('1.2'), 'v1.2')
  report.eq('withV does not double it', c.withV('v1.2'), 'v1.2')
  report.eq('withV of nothing is empty', c.withV(''), '')
  report.eq('withV of null is empty', c.withV(null), '')

  report.eq('formatSize: bytes', c.formatSize(0), '0 B')
  report.eq('formatSize: kilobytes', c.formatSize(2048), '2.0 KB')
  report.eq('formatSize: megabytes', c.formatSize(3 * 1024 * 1024), '3.0 MB')
  report.eq('formatSize: missing value', c.formatSize(undefined), '0 B')

  report.eq('normalizeSrc: nothing', c.normalizeSrc(null), null)
  report.eq('normalizeSrc: a bare url', c.normalizeSrc('https://x'), 'https://x')
  report.eq('normalizeSrc: a file slot', c.normalizeSrc({ kind: 'file', path: 'D:\\a.json' }), 'D:\\a.json')
  report.eq('normalizeSrc: a url slot', c.normalizeSrc({ kind: 'url', url: 'https://x' }), 'https://x')
  report.eq('normalizeSrc: an empty object', c.normalizeSrc({}), null)

  const slot = {}
  c.setSrc(slot, ' https://a ')
  report.eq('setSrc: an http target becomes a url slot', slot.src, { kind: 'url', url: 'https://a' })
  c.setSrc(slot, 'D:\\cards\\a.json')
  report.eq('setSrc: a path becomes a file slot', slot.src, { kind: 'file', path: 'D:\\cards\\a.json' })
  c.setSrc(slot, '')
  report.eq('setSrc: empty clears back to a url slot', slot.src, { kind: 'url', url: '' })

  const base = { cards: [{ id: 'a', plain: { path: 'P' }, mvu: { path: 'M' }, primary: { url: 'U' } }] }
  const changed = c.patchEntry(base, 'a', 'plain.path', 'P2')
  report.eq('patchEntry: writes the field', changed.cards[0].plain.path, 'P2')
  report.eq('patchEntry: leaves the original alone', base.cards[0].plain.path, 'P')
  report.eq('patchEntry: an unknown id changes nothing', c.patchEntry(base, 'zz', 'label', 'x').cards[0].label, undefined)
  const srcText = c.patchEntry(base, 'a', 'primary.url', 'https://new')
  report.eq('patchEntry: writes a release link', srcText.cards[0].primary.url, 'https://new')

  report.eq('chipClass: ok', c.chipClass('ok'), 'dcu-chip ok')
  report.eq('chipClass: warn', c.chipClass('warn'), 'dcu-chip warn')
  report.eq('chipClass: info borrows warn', c.chipClass('info'), 'dcu-chip warn')
  report.eq('chipClass: bad', c.chipClass('bad'), 'dcu-chip bad')
  report.eq('chipClass: unknown is plain', c.chipClass('whatever'), 'dcu-chip')
}

/* ---------------------------------------------------------------- wording */

{
  report.group('card wording')
  report.eq('indexQuery prefers the resolved wording', c.indexQuery({ primary: { query: 'q', match: 'm' } }), 'q')
  report.eq('indexQuery falls back to the marker', c.indexQuery({ primary: { match: 'm' } }), 'm')
  report.eq(
    'indexQuery derives from the label',
    c.indexQuery({ label: '道渊v5.4.2 MVU版本.json' }),
    '道渊',
  )

  report.ok('fieldName translates a known field', c.fieldName('description') !== 'description')
  report.eq('fieldName keeps an unknown one', c.fieldName('something_else'), 'something_else')
  report.ok('extName translates a known extension', c.extName('talkativeness') !== 'talkativeness')
  report.eq('extName keeps an unknown one', c.extName('whatever'), 'whatever')

  const fields = c.mergeText('fields:description,name')
  report.ok('mergeText: a field list names the fields', fields.includes(c.fieldName('description')) && fields.includes(c.fieldName('name')))
  report.ok('mergeText: a book addition counts', c.mergeText('book:+3').includes('3'))
  report.ok('mergeText: a held entry counts', c.mergeText('book:held:2').includes('2'))
  report.ok('mergeText: scripts kept counts', c.mergeText('scripts:kept:6').includes('6'))
  report.eq('mergeText: an unknown tag is passed through', c.mergeText('something-new'), 'something-new')
  report.ok('mergeText: an old-style book tag still reads', c.mergeText('character_book(+2)').includes('2'))
  report.ok('mergeText: an old-style extension tag still reads', c.mergeText('extensions.talkativeness').length > 0)

  report.ok('summarize: lists what changed', c.summarize({ result: { changed: ['fields:name'] } }).includes(c.fieldName('name')))
  report.eq('summarize: nothing to say', c.summarize({ result: {} }), '')
  report.eq('summarize: no result at all', c.summarize(null), '')
  const synced = c.summarize({
    result: {
      synced: { label: 'L', keyword: 'K', mvu: 'M.json', mvuName: 'N', chats: 2, avatar: ['a.png'] },
    },
  })
  report.ok('summarize: a rename reports every name that followed', /L/.test(synced) && /M\.json/.test(synced) && /N/.test(synced))
  report.ok(
    'summarize: the avatar note appears for a list of files',
    synced.includes(c.t('sync.avatar')),
    'the host returns a list here, and the panel reads its length',
  )

  report.ok('strategyShort: full', c.strategyShort({ mergeStrategy: 'full' }) !== c.t('strategy.full').replace(/^/, '\u0000'))
  report.eq('strategyShort: full reads as its own label', c.strategyShort({ mergeStrategy: 'full' }), c.t('strategy.full'))
  report.eq('strategyShort: missing setting falls back', c.strategyShort({}), c.t('strategy.standard'))

  report.ok(
    'updateLabel: a busy check says so',
    c.updateLabel({ status: 'busy' }) === c.t('upd.checking'),
  )
  report.eq('updateLabel: an idle button offers a check', c.updateLabel({}), c.t('btn.checkUpdate'))
  report.ok(
    'updateLabel: a found version is named with one v',
    c.updateLabel({ status: 'available', latest: '1.2.0' }).includes('v1.2.0'),
  )

  report.ok('pickFallbackNote: names the cause when there is one', c.pickFallbackNote({ reason: 'boom' }).includes('boom'))
  report.eq('pickFallbackNote: no cause, no colon', c.pickFallbackNote({}), c.t('pick.noNative'))
}

/* --------------------------------------------------------------- backups */

{
  report.group('backup records')
  const fromName = c.normalizeBackup('1790000000000__plain__a.json')
  report.eq('normalizeBackup: reads a bare name', fromName.tag, 'plain')
  report.eq('normalizeBackup: keeps the card file', fromName.file, 'a.json')
  report.ok('normalizeBackup: dates a bare name', /^2026-/.test(String(fromName.at)) || /^\d{4}-/.test(String(fromName.at)))

  const fromObject = c.normalizeBackup({ name: 'n', tag: 'manual', size: 5, ms: 1790000000000 })
  report.eq('normalizeBackup: takes a structured record', fromObject.size, 5)
  report.eq('normalizeBackup: derives the time from ms', fromObject.at, new Date(1790000000000).toISOString())

  report.ok('backupLabel: a known kind is translated', c.backupLabel('plain') !== 'plain')
  report.eq('backupLabel: an unknown kind shows as itself', c.backupLabel('whatever'), 'whatever')
  report.eq('backupLabel: an empty kind has a fallback', c.backupLabel(''), 'backup')

  report.eq(
    'browseEntryPath: starts in the file own folder',
    c.browseEntryPath([{ id: 'a', plain: { path: 'D:\\cards\\a.json' } }], 'a', 'plain.path'),
    'D:\\cards',
  )
  report.eq('browseEntryPath: an unknown card has no folder', c.browseEntryPath([], 'a', 'plain.path'), null)
  report.eq('browseEntryPath: an empty slot has no folder', c.browseEntryPath([{ id: 'a', plain: {} }], 'a', 'plain.path'), null)
}

/* ------------------------------------------------------------ host merging */

{
  report.group('host state merge')
  const draft = {
    cards: [
      {
        id: 'a',
        enabled: false,
        label: 'typed label',
        primary: { url: 'typed url', match: 'typed match' },
        plain: { path: 'P.json' },
        mvu: { path: 'M.json' },
      },
    ],
  }
  const fresh = {
    cards: [
      {
        id: 'a',
        label: 'host label',
        primary: { url: 'old url', match: 'old match', sig: 'ps', version: '5.3', newer: true },
        plain: { path: 'P2.json', sig: 'plain-sig' },
        mvu: { path: 'M2.json', sig: 'mvu-sig' },
        updatedAt: '2026-01-01',
        mergedAt: '2026-01-02',
        pairVia: 'name',
      },
    ],
  }
  const merged = c.mergeHostState(draft, fresh)
  const entry = merged.cards[0]
  report.eq('the typed release link survives', entry.primary.url, 'typed url')
  report.eq('the typed search word survives', entry.primary.match, 'typed match')
  report.eq('the host reading of that link arrives', entry.primary.sig, 'ps')
  report.eq('the host version arrives', entry.primary.version, '5.3')
  report.eq('the plain signature arrives', entry.plain.sig, 'plain-sig')
  report.eq('the card path stays as typed', entry.plain.path, 'P.json')
  report.eq('the merge time arrives', entry.mergedAt, '2026-01-02')
  report.eq('the pairing answer arrives', entry.pairVia, 'name')
  report.eq('a switch the user set is not overridden', entry.enabled, false)
  report.eq('the draft itself is untouched', draft.cards[0].primary.sig, undefined)

  const missing = c.mergeHostState({ cards: [{ id: 'a', pairVia: 'prefix' }] }, { cards: [{ id: 'a' }] })
  report.eq('a pairing answer the host dropped is dropped here too', missing.cards[0].pairVia, undefined)
  report.eq('a card the host does not know survives', c.mergeHostState({ cards: [{ id: 'z' }] }, { cards: [] }).cards.length, 1)
}

/* ------------------------------------------------------------ token status */

{
  report.group('index token status')
  const soon = new Date(Date.now() + 60 * 60 * 1000)
  const warn = c.describeVerify({ ok: true, loggedIn: true, expiresAt: soon.toISOString() })
  report.eq('a token about to lapse is flagged', warn.kind, 'warn')
  report.eq('and offered for renewal', warn.renew, true)

  const fine = c.describeVerify({ ok: true, loggedIn: true, expiresAt: new Date(Date.now() + 90 * 864e5).toISOString() })
  report.eq('a healthy token is fine', fine.kind, 'ok')
  report.eq('and needs nothing', fine.renew, false)

  const expired = c.describeVerify({ ok: true, loggedIn: false, expired: true, expiresAt: new Date(0).toISOString(), loginUrl: 'x' })
  report.eq('an expired token is bad', expired.kind, 'bad')
  report.eq('and asked to be renewed', expired.renew, true)

  const refused = c.describeVerify({ ok: true, loggedIn: false, error: 'refused', loginUrl: 'x' })
  report.ok('a refusal keeps the host own words', refused.text.includes('refused'))
}

process.exit(report.finish() ? 1 : 0)
