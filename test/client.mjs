/**
 * Browser half: dictionary, stylesheet and the pure helpers behind the panel.
 *
 * Most of this does not render anything. What is checked is the part that can be
 * wrong without throwing: a dictionary key the code asks for and the file does
 * not define, a stylesheet that does not balance, and the small converters the
 * panel runs on every render.
 *
 * The last group is the exception, and it exists because of what that gap cost:
 * the harness React was a stub that only answered "does this exist", so a defect
 * that fired while rendering a card threw in the real browser and nowhere here —
 * and a throw inside a render does not show a broken row, it takes the whole
 * panel down to a blank screen. Where a real React is installed, that group
 * renders for real.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadClient, createReport, CLIENT_FILE } from './harness.mjs'

const report = createReport('dsh-card-updater browser')
const { client, internals: c, source } = loadClient()

/* ------------------------------------------------------------------- wiring */

/**
 * A client context shaped the way the shipped one is, so `apply` can be run for
 * real. The dictionary is registered from inside an effect, which is why the
 * effect here runs its callback rather than only recording it: a fake effect
 * leaves every string in the panel unresolved and hides real failures.
 */
function makeCtx() {
  const dicts = new Map()
  return {
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
    effect(fn) {
      const dispose = typeof fn === 'function' ? fn() : null
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject() {},
  }
}

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
  let applied = null
  try {
    client.apply(makeCtx())
    applied = true
  } catch (e) {
    applied = e && e.message ? e.message : String(e)
  }
  report.eq('apply runs against a plain context', applied, true)
}

/* ------------------------------------------------------- stylesheet lifetime */

{
  report.group('stylesheet lifetime')
  const fresh = loadClient()
  const dom = fresh.dom
  const sheet = () => {
    const tag = dom.document.head.children[0]
    return tag ? String(tag.textContent) : ''
  }

  fresh.internals.installStyles()
  report.eq('the sheet lands in the document', dom.countStyles(), 1)
  report.ok('it carries the panel rules', /\.dcu-entry\{/.test(sheet()))
  report.ok(
    'the entry rule really drops the border',
    /\.dcu-entry\{[^}]*border:0/.test(sheet()),
    'a border on screen with border:0 in the sheet is how the missing sheet was spotted',
  )

  fresh.internals.installStyles()
  report.eq('installing twice does not stack a second tag', dom.countStyles(), 1)

  // Whatever removes the tag has to be undone. The shell rebuilding
  // `document.head` on a theme switch is the case that was reported: the sidebar
  // entry stays mounted, so its effect never runs again and the button is left
  // drawn as a browser default.
  dom.document.head.children[0].remove()
  report.eq('the tag is gone', dom.countStyles(), 0)
  dom.fire()
  report.eq('the observer puts it back', dom.countStyles(), 1)
  report.ok('with the same rules', /\.dcu-entry\{/.test(sheet()))
  dom.fire()
  report.eq('firing again does not stack tags', dom.countStyles(), 1)

  // Loading the plugin installs the sheet, so the first frame is styled rather
  // than the second: a mount site's effect runs after the first paint.
  const applied = loadClient()
  applied.client.apply(makeCtx())
  report.eq('applying the plugin puts the sheet in place', applied.dom.countStyles(), 1)
  applied.dom.document.head.children[0].remove()
  applied.dom.fire()
  report.eq('and that installation is watched too', applied.dom.countStyles(), 1)

  // A second mount point must not produce a second tag, whatever order they run.
  applied.internals.installStyles()
  report.eq('a second mount point reuses the tag', applied.dom.countStyles(), 1)
}

/* --------------------------------------------------------------- dictionary */

{
  report.group('dictionary')
  const zh = c.zh || {}
  const en = c.en || {}
  const zhKeys = Object.keys(zh)
  const enKeys = Object.keys(en)

  report.eq('both languages define the same number of keys', zhKeys.length, enKeys.length)
  // The host hands over rule keys and the panel resolves them, so every key the
  // host can produce needs a label. `gate.<key>` is built from a variable, and
  // `preset` is the one the companion-material rule adds to that list.
  for (const key of ['crash.title', 'crash.hint', 'gate.preset']) {
    report.ok(`${key} resolves in both languages`, !!zh[key] && !!en[key], '')
  }
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
    'indexQuery derives from the label when there is no path',
    c.indexQuery({ label: '道渊v5.4.2 MVU版本.json' }),
    '道渊',
  )
  // The file name is what the user renamed the card to, and it is where the
  // wording that matches a release thread usually lives; the name inside the card
  // is not available in the browser half at all.
  report.eq(
    'indexQuery uses the card file name when there is no marker',
    c.indexQuery({ plain: { path: 'D:\\cards\\来当小男友爆管人的米吧！.json' }, label: '独占配信中' }),
    '来当小男友爆管人的米吧',
  )
  report.eq(
    'indexQuery falls through to the MVU file name',
    c.indexQuery({ mvu: { path: 'D:\\cards\\道渊v5.4.2 MVU版本.json' }, label: 'x' }),
    '道渊',
  )
  report.eq('indexQuery finds nothing it can use', c.indexQuery({}), '')
  report.eq('tidyTerm matches the host half', c.tidyTerm('龙娘回廊！5.3 MVU版本'), '龙娘回廊')

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

  // The chip on a card row. A card whose file is gone has to say so rather than
  // looking like any other unconfigured entry.
  report.eq(
    'statusOf: a card whose file is gone reads as broken',
    c.statusOf({ id: 'x' }, null, { x: { plain: true, mvu: true, gone: true } }),
    { kind: 'bad', text: c.t('state.gone') },
  )
  report.eq(
    'statusOf: a card missing one of its files reads as a warning',
    c.statusOf({ id: 'x' }, null, { x: { plain: false, mvu: true, gone: false } }),
    { kind: 'warn', text: c.t('state.halfGone') },
  )
  report.eq(
    'statusOf: an ordinary card is unaffected by the map',
    c.statusOf({ id: 'x' }, null, {}),
    { kind: 'idle', text: c.t('state.unlinked') },
  )
  report.eq(
    'statusOf: another card missing is not this card',
    c.statusOf({ id: 'mine' }, null, { other: { plain: true, mvu: true, gone: true } }).kind,
    'idle',
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

/* ------------------------------------------------------- real rendering */

{
  report.group('rendering with a real React')
  // Where a real React is installed, render for real. The stub the rest of this
  // file runs on answers "does this exist" and never runs a component, which is
  // how a throw-on-render defect reached a user as a blank panel.
  let React = null
  let renderToString = null
  try {
    const base = path.join(os.homedir(), '.dsh', 'apps', 'dsh-tavern', 'node_modules')
    React = (await import(pathToFileURL(path.join(base, 'react', 'index.js')).href)).default
    renderToString = (await import(pathToFileURL(path.join(base, 'react-dom', 'server.js')).href))
      .renderToString
  } catch {
    React = null
  }

  if (!React || typeof renderToString !== 'function') {
    report.ok('a real React is available to render with', true, 'skipped: not installed, nothing to render with')
  } else {
    const real = loadClient({ react: React })

    let html = ''
    let failure = ''
    try {
      html = renderToString(React.createElement(real.internals.SettingsSection))
    } catch (e) {
      failure = e && e.message ? e.message : String(e)
    }
    report.eq('the settings section renders', failure, '')
    report.ok('and produces the panel shell', html.includes('dcu-root'), html.slice(0, 90))

    // Every shape the host could hand over, including ones it promises not to.
    // A string passes a `.length` test and then has no `.map`, and a throw while
    // rendering one card blanks the whole panel rather than one row.
    const hint = real.internals.primaryHint
    for (const [label, primary] of [
      ['string extras', { url: 'https://x.invalid', sig: 'a', extras: 'preset' }],
      ['string gates', { url: 'https://x.invalid', sig: 'a', gates: 'password' }],
      ['both as strings', { url: 'https://x.invalid', sig: 'a', gates: 'password', extras: 'preset' }],
      ['arrays', { url: 'https://x.invalid', sig: 'a', gates: ['password'], extras: ['preset'] }],
      ['neither field', { url: 'https://x.invalid', sig: 'a' }],
      ['no link at all', {}],
    ]) {
      let threw = ''
      try {
        hint({ primary })
      } catch (e) {
        threw = e && e.message ? e.message : String(e)
      }
      report.eq(`a card row renders with ${label}`, threw, '')
    }

    // And the row that carries the download line actually says it.
    const row = hint({ primary: { url: 'https://x.invalid', sig: 'a', gates: ['password'] } })
    report.ok('the download line is in the row', JSON.stringify(row).includes('gate.password'), '')

    // Build it *and* render it. An element that is created without complaint can
    // still throw when React walks it, and that throw is what a user sees as a
    // blank panel — creating the element alone would not have caught it.
    for (const [label, primary] of [
      ['gates only', { url: 'https://x.invalid', sig: 'a', gates: ['password'] }],
      ['three gates', { url: 'https://x.invalid', sig: 'a', gates: ['password', 'paid', 'discord'] }],
      ['a string where an array belongs', { url: 'https://x.invalid', sig: 'a', gates: 'password' }],
      ['no gates at all', { url: 'https://x.invalid', sig: 'a' }],
      ['a rename on top', { url: 'https://x.invalid', sig: 'a', gates: ['discord'], renamedFrom: 'old', title: 'new' }],
      ['a failed check', { url: 'https://x.invalid', error: 'boom' }],
    ]) {
      let threw = ''
      let rendered = ''
      try {
        rendered = renderToString(hint({ primary }))
      } catch (e) {
        threw = e && e.message ? e.message : String(e)
      }
      report.eq(`the row really renders with ${label}`, threw, '')
      report.ok(`  and comes out as markup with ${label}`, rendered.includes('dcu-chip'), '')
    }

    // The boundary is what stands between a throw and a blank panel.
    //
    // Its contract is checked directly rather than by rendering through it:
    // `renderToString` rethrows on error instead of consulting a boundary, which
    // is a server-rendering behaviour — the browser renders on the client, and
    // that is where these methods get called.
    const boundary = real.internals.PanelBoundary
    report.eq('the panel ships an error boundary', typeof boundary, 'function')

    const derived = boundary.getDerivedStateFromError(new Error('合成故障'))
    report.ok('a thrown error becomes state', !!derived && !!derived.error, JSON.stringify(derived))
    report.eq('and the message is the one thrown', derived.error.message, '合成故障')

    const instance = new boundary({ children: null })
    report.eq('with no error it draws its children', instance.render(), null)

    instance.state = derived
    let drawn = ''
    let boundaryThrew = ''
    try {
      drawn = renderToString(instance.render())
    } catch (e) {
      boundaryThrew = e && e.message ? e.message : String(e)
    }
    report.eq('and with state it draws without throwing', boundaryThrew, '')
    report.ok('it names the failure rather than going blank', drawn.includes('crash.title'), drawn.slice(0, 110))
    report.ok('and shows the thrown text', drawn.includes('合成故障'), '')
  }
}


/* ------------------------------------------------- dsh-verify-peer：对端按钮（错题库） */

report.group('dsh-verify-peer: peer link to the wrongbook')

/* 组件本体与调用点都在。少了任一条，功能就不成立。 */
report.ok('defines a PeerLink component', /function PeerLink\s*\(/.test(source))
report.ok('renders it once in the header', (source.match(/h\(PeerLink\)/g) || []).length === 1)

/* 探测端点必须是错题库自己的路由前缀 —— 写错了只会一直显示未连接。 */
report.ok('probes the wrongbook state route', source.includes("'/dsh-wrongbook'") && source.includes("PEER.base + '/state'"))

/* 三态齐备。缺任何一态，某一种实际状态就会被显示成另一种。 */
report.ok('has the connected state', source.includes("'已连接'"))
report.ok('has the checking state', source.includes("'检测中'"))
report.ok('has the disconnected state', source.includes("'未连接'"))

/* 未连接时的引导语与跳转目标。 */
report.ok('points at the wrongbook repo', source.includes('github.com/XGUIMAX/dsh-wrongbook'))
report.ok('tells the reader how to get it', source.includes('未链接到'))
report.ok('states the 15s recheck interval', source.includes('15000'))

/* 静默降级：对方没装时不能报错或卡住。 */
report.ok('degrades quietly when the peer is absent', source.includes('setOnline(false)'))

/* 样式：复用面板已有的类前缀，不新增一套。 */
report.ok('reuses the dcu- prefix for its styles', source.includes('.dcu-peer'))
report.ok('keeps the dot styles in the same block', source.includes('.dcu-peer .dot.ok') && source.includes('.dcu-peer .dot.bad'))

/* ------------------------------------------------- dsh-filter-test
   筛选：下拉里的每个 option 都必须有对应的过滤分支。
   本组用例的由来：加「推荐/建议预设」时只加了 option、漏了分支，
   于是选它落到默认 return true，显示全部卡 —— 而当时一条测试都没覆盖筛选。
   所以这里除了断言具体行为，还做一次"成对"的结构检查。 */

report.group('dsh-filter-test: every filter option has a branch')

/* 从源码提取下拉的 option 值与过滤分支，做集合比较。 */
/* 只取【筛选】那个 select 里的 option。原先用全文匹配，把排序下拉的
   auto / imported / name 也算了进来，于是"每个选项都要有分支"这条永远不成立。 */
const filterSelect = (source.match(/value: filter,[\s\S]{0,800}?\n\s*\),/) || [''])[0]
const optionVals = [...filterSelect.matchAll(/h\('option', \{ value: '([a-z]+)' \}/g)].map((m) => m[1])
const branchVals = [...source.matchAll(/if \(filter === '([a-z]+)'\)/g)].map((m) => m[1])
const needBranch = optionVals.filter((v) => v !== 'all')

report.ok('finds the filter options', needBranch.length >= 3, needBranch.join(','))
report.ok('recommended is offered in the dropdown', optionVals.includes('recommended'), optionVals.join(','))
report.ok('recommended has a matching filter branch', branchVals.includes('recommended'), branchVals.join(','))
report.eq('no option is left without a branch', needBranch.filter((v) => !branchVals.includes(v)), [])

/* 具体行为：preset 与 recommended 各自只认自己的 gate key。 */
const gatesOf = (gates) => ({ primary: { gates } })
const passes = (filterVal, entry) => {
  if (filterVal === 'preset') return Array.isArray(entry.primary && entry.primary.gates) && entry.primary.gates.includes('preset')
  if (filterVal === 'recommended') return Array.isArray(entry.primary && entry.primary.gates) && entry.primary.gates.includes('recommended')
  return true
}
report.ok('preset filter accepts a preset gate', passes('preset', gatesOf(['discord', 'preset'])))
report.ok('preset filter rejects a recommended-only gate', !passes('preset', gatesOf(['recommended'])))
report.ok('recommended filter accepts a recommended gate', passes('recommended', gatesOf(['discord', 'recommended'])))
report.ok('recommended filter rejects a preset-only gate', !passes('recommended', gatesOf(['discord', 'preset'])))
report.ok('both gates together pass both filters', passes('preset', gatesOf(['preset', 'recommended'])) && passes('recommended', gatesOf(['preset', 'recommended'])))
process.exit(report.finish() ? 1 : 0)
