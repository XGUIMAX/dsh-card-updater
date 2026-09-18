/**
 * dsh-card-updater — Host half.
 *
 * Detects remote character-card updates by link, refreshes the original card,
 * and merges the new content into the MVU variant without touching its status
 * bar, variable scripts or regex rules.
 *
 * Communication with the browser half is plain HTTP: the four routes below are
 * consumed by ./client.js through `fetch('/dsh-card-updater/...')`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-card-updater'

/**
 * The DSH home directory. `DSH_HOME` wins when the harness sets it; otherwise it
 * is `~/.dsh`, which resolves to the same place on every platform this runs on
 * and is what the installer scripts use too.
 */
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const RES_DIR = path.join(DSH_HOME, 'profile-data', 'tavern', 'data', 'resources')
const CARD_DIR = path.join(RES_DIR, 'cards')
const DATA_DIR = path.join(DSH_HOME, 'profile-data', 'tavern', 'data', 'tools', 'card-updater')
const CFG_FILE = path.join(DATA_DIR, 'config.json')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const DL_DIR = path.join(DATA_DIR, 'downloads')
/** Card avatars live beside the untouched originals that Tavern keeps. */
const ORIGINALS_DIR = path.join(
  DSH_HOME,
  'profile-data',
  'tavern',
  'data',
  'originals',
  'cards',
)
/** Scaled avatar cache; entries are keyed by source path + mtime + size. */
const AVATAR_CACHE = path.join(DATA_DIR, 'avatar-cache')
/** Bounding box for one avatar thumbnail. */
const AVATAR_SIZE = 96

/** Public repository this plugin ships from; the self-check reads its versions. */
const REPO_SLUG = 'XGUIMAX/dsh-card-updater'
const REPO_URL = `https://github.com/${REPO_SLUG}`
const REPO_API = `https://api.github.com/repos/${REPO_SLUG}`
/** Reported when the manifest beside this file cannot be read. */
const FALLBACK_VERSION = '1.0.0'
/**
 * Package root — `<root>/lib/index.js`, so one directory above this file. Left
 * empty when the module was not loaded from disk, which only costs the precise
 * installed version.
 */
const PLUGIN_DIR = (() => {
  try {
    return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    return ''
  }
})()

const DEFAULT_CFG = {
  version: 1,
  autoCheckMinutes: 0,
  mergeStrategy: 'standard',
  // Off by default: merging writes the MVU card only, leaving the original as
  // the author published it.
  syncPlain: false,
  autoBumpVersion: true,
  allowMvuUpdate: false,
  // Session for the community index backend. Thread release links are answered
  // only to a signed-in caller, so this is the one credential the watch needs;
  // it is read from the search site's own localStorage and never sent anywhere
  // except that backend.
  indexToken: '',
  cards: [],
}

const db = { cfg: structuredClone(DEFAULT_CFG), lastReport: null, loaded: false }
let timerDispose = null

/* ------------------------------------------------------------------ utils */

function log(...args) {
  try {
    console.log('[card-updater]', ...args)
  } catch {
    /* logging must never break a run */
  }
}

function nowIso() {
  return new Date().toISOString()
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

function baseOf(p) {
  return path.basename(String(p || ''))
}

function esc(s) {
  return String(s ?? '').replace(/'/g, "''")
}

function clone(v) {
  return v === undefined ? undefined : structuredClone(v)
}

function deepEqual(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return String(a) === String(b)
  if (typeof a !== 'object') return String(a) === String(b)
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readText(p) {
  return fs.readFileSync(p, 'utf8')
}

function writeText(p, content) {
  ensureDir(path.dirname(p))
  const tmp = `${p}.tmp-${Date.now()}`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, p)
  return true
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p)
  } catch {
    return false
  }
}

function listNames(dir, filter) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (!filter || filter(e.name)))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst))
  fs.copyFileSync(src, dst)
  return dst
}

function powershell(command, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '') || (error ? String(error.message || error) : ''),
        })
      },
    )
  })
}

/**
 * Run one command and report how it went, without throwing on a non-zero exit.
 * @param {string} file - executable.
 * @param {string[]} args - argument vector; never interpreted by a shell.
 * @param {{ignoreExit?: boolean, timeoutMs?: number}} [opts] - `ignoreExit` treats
 *   any termination as success, for launchers that report a non-zero code even
 *   when they did what was asked.
 * @returns {Promise<{ok: boolean, stderr: string}>}
 */
function runCommand(file, args, opts) {
  const settings = opts || {}
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: settings.timeoutMs || 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error || !!settings.ignoreExit,
          stderr: String(stderr || '') || (error ? String(error.message || error) : ''),
        })
      },
    )
  })
}

/**
 * Hand a folder to the desktop's file manager. Each platform gets its own verb:
 * explorer.exe on Windows, `open` on macOS, and `xdg-open` on Linux, which is
 * what a desktop session there listens on. The path travels as one argument
 * instead of inside a shell string, so nothing has to survive shell quoting.
 * @param {string} target - absolute path.
 * @returns {Promise<{ok: boolean, stderr: string}>}
 */
function openInFileManager(target) {
  if (process.platform === 'darwin') return runCommand('open', [target])
  // explorer.exe reports a non-zero exit even when the window did open, so its
  // exit code cannot be read as a verdict.
  if (process.platform === 'win32') return runCommand('explorer.exe', [target], { ignoreExit: true })
  return runCommand('xdg-open', [target])
}

async function download(url, dst, timeoutMs = 90000) {
  ensureDir(DL_DIR)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    ensureDir(path.dirname(dst))
    fs.writeFileSync(dst, buf)
    return { path: dst, bytes: buf.length, contentType: res.headers.get('content-type') || '' }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url, timeoutMs = 60000, extraHeaders) {
  ensureDir(DL_DIR)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'cache-control': 'no-cache',
        // Release pages are routinely behind a bare-request block; identifying
        // as a browser is what lets rentry and friends answer at all.
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/json,application/xhtml+xml,*/*;q=0.8',
        ...(extraHeaders || {}),
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/* -------------------------------------------------------------- card form */

const PLAIN_FIELDS = [
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
  'tags',
  'alternate_greetings',
]

const EXT_KEYS = ['talkativeness', 'fav', 'world', 'depth_prompt', 'xiaobaix-template']

function unwrapCard(text) {
  const parsed = JSON.parse(text)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.raw && typeof parsed.raw === 'object') {
      return { shell: 'workspace', outer: parsed, payload: parsed.raw }
    }
    if (parsed.data && typeof parsed.data === 'object') {
      if (parsed.kind && String(parsed.kind).startsWith('dsh-tavern') && !parsed.raw) {
        return { shell: 'workspace', outer: parsed, payload: { spec: 'chara_card_v2', data: {} } }
      }
      return { shell: 'v2', outer: parsed, payload: parsed }
    }
  }
  throw new Error('无法识别的卡片结构（既不是 V2 卡，也不是 Tavern 工作区卡）')
}

function loadCard(p) {
  const info = unwrapCard(readText(p))
  return {
    path: p,
    shell: info.shell,
    outer: info.outer,
    payload: info.payload,
    data: info.payload.data || {},
  }
}

function buildCardText(shell, outer, payload) {
  if (shell === 'workspace') {
    const next = clone(outer)
    next.raw = payload
    return JSON.stringify(next, null, 2)
  }
  return JSON.stringify(payload, null, 2)
}

function looksLikeImageUrl(url) {
  return /\.(png|jpe?g|webp|gif)$/i.test(String(url).split('?')[0])
}

function looksLikeCardText(text) {
  const head = String(text || '').replace(/^\uFEFF/, '').trimStart()
  if (head.charAt(0) !== '{') return false
  return (
    head.includes('"description"') ||
    head.includes('"first_mes"') ||
    head.includes('"personality"') ||
    head.includes('"raw"') ||
    head.includes('"data"')
  )
}

/* ----------------------------------------------------------- merge engine */

function mergeBook(mvuBook, plainBook) {
  const res = { added: 0, updated: 0, conflicts: [] }
  if (!plainBook || !Array.isArray(plainBook.entries)) return { book: mvuBook, res }

  const base =
    mvuBook && typeof mvuBook === 'object' ? clone(mvuBook) : { name: plainBook.name || '', entries: [] }
  if (!Array.isArray(base.entries)) base.entries = []
  if (!base.name && plainBook.name) base.name = plainBook.name

  const byId = new Map()
  for (const entry of base.entries) {
    if (entry && entry.id !== undefined && entry.id !== null) byId.set(String(entry.id), entry)
  }
  const byName = (nm) =>
    base.entries.find((e) => e && nm !== undefined && String(e.name) === String(nm)) || null

  plainBook.entries.forEach((src, idx) => {
    if (!src) return
    let target = src.id !== undefined && src.id !== null ? byId.get(String(src.id)) : null
    if (!target && src.name) target = byName(src.name)
    if (!target) {
      base.entries.push(clone(src))
      res.added++
      return
    }
    if (deepEqual(target.content, src.content) && deepEqual(target.keys, src.keys)) return
    const targetEmpty = !target.content || !String(target.content).trim().length
    if (targetEmpty) {
      target.content = clone(src.content)
      target.keys = clone(src.keys)
      if (src.comment !== undefined) target.comment = clone(src.comment)
      res.updated++
    } else {
      res.conflicts.push(String(target.comment || target.name || `#${String(target.id ?? idx)}`))
    }
  })
  return { book: base, res }
}

function mergeCards(mvuCard, plainCard, strategy) {
  const next = clone(mvuCard.payload) || {}
  const mvuData = next.data || {}
  const plainData = plainCard.data || {}
  const changed = []
  const details = { book: null, regexAdded: 0, strategy }

  for (const field of PLAIN_FIELDS) {
    if (!(field in plainData)) continue
    if (!deepEqual(mvuData[field], plainData[field])) {
      mvuData[field] = clone(plainData[field])
      changed.push(field)
    }
  }

  if (strategy !== 'minimal' && plainData.character_book) {
    const merged = mergeBook(mvuData.character_book, plainData.character_book)
    mvuData.character_book = merged.book
    details.book = merged.res
    if (merged.res.added) changed.push(`character_book(+${merged.res.added})`)
    if (merged.res.updated) changed.push(`character_book(~${merged.res.updated})`)
    if (merged.res.conflicts.length) changed.push(`character_book(保留${merged.res.conflicts.length})`)
  } else if (plainData.character_book && !mvuData.character_book) {
    mvuData.character_book = clone(plainData.character_book)
    changed.push('character_book')
  }

  const mvuExt = mvuData.extensions && typeof mvuData.extensions === 'object' ? mvuData.extensions : {}
  const plainExt =
    plainData.extensions && typeof plainData.extensions === 'object' ? plainData.extensions : {}

  for (const key of EXT_KEYS) {
    if (key in plainExt && !(key in mvuExt)) {
      mvuExt[key] = clone(plainExt[key])
      changed.push(`extensions.${key}`)
    }
  }

  if (strategy === 'full' && Array.isArray(plainExt.regex_scripts)) {
    const mvuRegex = Array.isArray(mvuExt.regex_scripts) ? mvuExt.regex_scripts : (mvuExt.regex_scripts = [])
    const seen = new Set(mvuRegex.filter((r) => r && r.scriptName).map((r) => String(r.scriptName)))
    const added = []
    for (const rule of plainExt.regex_scripts) {
      const nm = rule && rule.scriptName ? String(rule.scriptName) : null
      if (!nm || seen.has(nm)) continue
      seen.add(nm)
      mvuRegex.push(clone(rule))
      added.push(nm)
    }
    details.regexAdded = added.length
    if (added.length) changed.push(`regex_scripts(+${added.length})`)
  }

  mvuData.extensions = mvuExt
  next.data = mvuData
  if (strategy !== 'minimal' && plainCard.payload.create_date && !next.create_date) {
    next.create_date = plainCard.payload.create_date
  }
  return { payload: next, changed, details }
}

function bumpVersion(version) {
  const raw = String(version ?? '')
  if (!raw.trim()) return raw
  if (/mvu/i.test(raw)) {
    const m = raw.match(/^(.*?)-?mvu-?(\d*)$/i)
    if (m) return `${m[1].replace(/-+$/, '')}-mvu-${m[2] ? Number.parseInt(m[2], 10) + 1 : 2}`
    return `${raw}-mvu-2`
  }
  const m = raw.match(/^(.*?)(\d+)(\D*)$/)
  if (m) return `${m[1]}${Number.parseInt(m[2], 10) + 1}${m[3]}`
  return `${raw}-mvu-1`
}

/* -------------------------------------------------------------- config io */

function emptySlot() {
  return { path: '', src: { kind: 'url', url: '' }, sig: null, lastUpdateAt: null }
}

/**
 * The watch slot. A card is announced on a search page but handed out in a
 * community post, so this points at the page that actually carries the release
 * notes and keeps what the last visit saw: the text signature, the newest
 * version on it, and the conditions attached to the download.
 */
function emptyPrimary() {
  return {
    url: '',
    match: '',
    sig: null,
    version: null,
    gates: [],
    newer: false,
    changed: false,
    title: '',
    query: '',
    discoveredAt: null,
    networkError: false,
    feedSeen: [],
    feedTitle: '',
    feedAt: '',
    feedCount: 0,
    checkedAt: null,
    error: null,
  }
}

function normalizeCfg(raw) {
  const cfg = clone(DEFAULT_CFG)
  if (!raw || typeof raw !== 'object') return cfg
  if (typeof raw.autoCheckMinutes === 'number') cfg.autoCheckMinutes = Math.max(0, raw.autoCheckMinutes)
  if (typeof raw.mergeStrategy === 'string') cfg.mergeStrategy = raw.mergeStrategy
  if (raw.syncPlain !== undefined) cfg.syncPlain = !!raw.syncPlain
  if (raw.autoBumpVersion !== undefined) cfg.autoBumpVersion = !!raw.autoBumpVersion
  if (raw.allowMvuUpdate !== undefined) cfg.allowMvuUpdate = !!raw.allowMvuUpdate
  if (raw.indexToken !== undefined) cfg.indexToken = String(raw.indexToken || '')

  if (Array.isArray(raw.cards)) {
    cfg.cards = raw.cards.map((c, i) => {
      const entry = {
        id: c.id ? String(c.id) : `card-${i + 1}`,
        label: String(c.label || c.id || `card-${i + 1}`),
        enabled: c.enabled !== false,
        syncPlain: c.syncPlain === true,
        plain: emptySlot(),
        mvu: emptySlot(),
        primary: emptyPrimary(),
        pairVia: c.pairVia ? String(c.pairVia) : '',
        note: c.note ? String(c.note) : '',
      }
      for (const key of ['plain', 'mvu']) {
        const slot = c[key]
        if (!slot || typeof slot !== 'object') continue
        entry[key].path = slot.path ? String(slot.path) : ''
        if (slot.src) entry[key].src = clone(slot.src)
        entry[key].sig = slot.sig || null
        entry[key].lastUpdateAt = slot.lastUpdateAt || null
      }
      if (c.primary && typeof c.primary === 'object') {
        const p = c.primary
        entry.primary.url = p.url ? String(p.url) : ''
        entry.primary.match = p.match ? String(p.match) : ''
        entry.primary.sig = p.sig || null
        entry.primary.version = p.version == null ? null : String(p.version)
        entry.primary.gates = Array.isArray(p.gates) ? p.gates.map(String) : []
        entry.primary.newer = p.newer === true
        entry.primary.changed = p.changed === true
        entry.primary.title = p.title ? String(p.title) : ''
        entry.primary.query = p.query ? String(p.query) : ''
        entry.primary.discoveredAt = p.discoveredAt || null
        entry.primary.networkError = p.networkError === true
        entry.primary.feedSeen = Array.isArray(p.feedSeen) ? p.feedSeen.map(String) : []
        entry.primary.feedTitle = p.feedTitle ? String(p.feedTitle) : ''
        entry.primary.feedAt = p.feedAt ? String(p.feedAt) : ''
        entry.primary.feedCount = Number.isFinite(p.feedCount) ? p.feedCount : 0
        entry.primary.checkedAt = p.checkedAt || null
        entry.primary.error = p.error ? String(p.error) : null
      }
      for (const key of [
        'updatedAt',
        'mergedAt',
        'lastCheckAt',
        'lastCheckSummary',
        'lastError',
        'lastMergeChanged',
        'importedAt',
        'importedFrom',
        'pending',
      ]) {
        if (c[key] !== undefined) entry[key] = c[key]
      }
      return entry
    })
  }
  return cfg
}

function loadConfig() {
  try {
    if (exists(CFG_FILE)) {
      db.cfg = normalizeCfg(JSON.parse(readText(CFG_FILE)))
      db.loaded = true
      return db.cfg
    }
  } catch (e) {
    log('config load failed:', e && e.message ? e.message : e)
  }
  db.cfg = normalizeCfg(null)
  db.loaded = true
  return db.cfg
}

function saveConfig() {
  ensureDir(DATA_DIR)
  writeText(CFG_FILE, JSON.stringify(db.cfg, null, 2))
  return true
}

function findEntry(id) {
  return (db.cfg.cards || []).find((c) => c.id === id) || null
}

/* ------------------------------------------------------------- card scan */

function pairPathOf(name) {
  const base = String(name).replace(/\.json$/i, '')
  if (/\s+MVU\s*版本$/i.test(base)) return `${base.replace(/\s+MVU\s*版本$/i, '')}.json`
  return `${base} MVU版本.json`
}

function isMvuFile(name) {
  return /\s+MVU\s*版本(\.[^.]+)?\.json$/i.test(String(name))
}

/**
 * The pairing key for a card file: the name the card calls itself, tidied, with
 * the file name as the fallback for a card that cannot be read.
 *
 * File names are unreliable for this. The downloaded original is routinely
 * renamed on the way in while the MVU copy keeps the author's wording, so
 * "🐎艹大作战V35_PLUS" and "草妈大作战 MVU版本" share no characters at all while
 * both cards say "草妈大作战". Pairing on the file name misses that pair
 * entirely; pairing on what the cards say finds it.
 * @param {string} fileName - a file inside the card directory.
 * @returns {{key: string, from: 'name'|'file'}} lower-cased key and its origin.
 */
function cardKeyOf(fileName) {
  const full = path.join(CARD_DIR, fileName)
  try {
    const card = loadCard(full)
    const name = String((card.data && card.data.name) || card.payload.name || '').trim()
    const tidied = tidyTerm(name)
    if (tidied.length >= 2) return { key: tidied.toLowerCase(), from: 'name' }
  } catch {
    // An unreadable card just falls back to its file name.
  }
  const stem = String(fileName).replace(/\.json$/i, '')
  return { key: (tidyTerm(stem) || stem).toLowerCase(), from: 'file' }
}

function suggestConfig(existing) {
  const names = listNames(CARD_DIR, (n) => /\.json$/i.test(n))
  const present = new Set(names)
  const mvuFiles = names.filter(isMvuFile)
  const used = new Set()
  const cards = []

  // Index the MVU copies under the name their own card carries, so a pair can be
  // matched on what the cards say rather than on what the files are called. A key
  // claimed by several files is left unpaired: guessing between candidates would
  // bind a card to the wrong file, which is worse than leaving it to the user.
  const mvuByKey = new Map()
  for (const name of mvuFiles) {
    const { key } = cardKeyOf(name)
    if (!key) continue
    const list = mvuByKey.get(key) || []
    list.push(name)
    mvuByKey.set(key, list)
  }

  for (const name of names) {
    if (used.has(name) || isMvuFile(name)) continue
    used.add(name)
    const { key, from } = cardKeyOf(name)
    const entry = {
      id: `card-${cards.length + 1}`,
      label: name.replace(/\.json$/i, ''),
      enabled: true,
      syncPlain: false,
      plain: Object.assign(emptySlot(), { path: path.join(CARD_DIR, name) }),
      mvu: emptySlot(),
      primary: emptyPrimary(),
      pairVia: '',
      note: '',
    }

    // Card name first, because that is what the two cards agree on. Only when it
    // finds nothing does the file-name route run, exact match before prefix.
    let partner = null
    let viaName = false
    const byKey = (mvuByKey.get(key) || []).filter((m) => !used.has(m))
    if (byKey.length === 1) {
      partner = byKey[0]
      viaName = true
    }
    if (!partner) {
      const exact = pairPathOf(name)
      if (present.has(exact) && !used.has(exact)) partner = exact
    }
    if (!partner) {
      const prefix = name.replace(/\.json$/i, '').split(/[\s_\-—·:：()（）[\]【】]+/)[0] || ''
      const cands = mvuFiles.filter((m) => !used.has(m) && prefix && String(m).startsWith(prefix))
      if (cands.length === 1) {
        partner = cands[0]
        entry.pairVia = 'prefix'
      }
    }
    if (partner) {
      used.add(partner)
      entry.mvu.path = path.join(CARD_DIR, partner)
      if (!entry.pairVia) entry.pairVia = viaName && from === 'name' ? 'name' : 'file'
    }
    cards.push(entry)
  }

  for (const name of names) {
    if (used.has(name) || !isMvuFile(name)) continue
    used.add(name)
    cards.push({
      id: `card-${cards.length + 1}`,
      label: name.replace(/\.json$/i, ''),
      enabled: true,
      syncPlain: false,
      plain: emptySlot(),
      mvu: Object.assign(emptySlot(), { path: path.join(CARD_DIR, name) }),
      primary: emptyPrimary(),
      pairVia: 'solo',
    })
  }

  const prev = existing && Array.isArray(existing.cards) ? existing.cards : []
  for (const entry of cards) {
    const old = prev.find(
      (p) =>
        (p.plain?.path && entry.plain.path && p.plain.path === entry.plain.path) ||
        (p.mvu?.path && entry.mvu.path && p.mvu.path === entry.mvu.path),
    )
    if (!old) continue
    if (old.plain?.src) entry.plain.src = clone(old.plain.src)
    if (old.plain?.sig) entry.plain.sig = old.plain.sig
    if (old.mvu?.src) entry.mvu.src = clone(old.mvu.src)
    if (old.mvu?.sig) entry.mvu.sig = old.mvu.sig
    if (old.syncPlain !== undefined) entry.syncPlain = old.syncPlain
    // The old note is deliberately not carried over. It recorded a pairing
    // decision taken at scan time, so restoring it made a card that has since had
    // its MVU file attached go on claiming it had none.
    if (old.plain?.lastUpdateAt) entry.plain.lastUpdateAt = old.plain.lastUpdateAt
    if (old.mvu?.lastUpdateAt) entry.mvu.lastUpdateAt = old.mvu.lastUpdateAt
    if (old.updatedAt) entry.updatedAt = old.updatedAt
    if (old.mergedAt) entry.mergedAt = old.mergedAt
    if (old.lastMergeChanged) entry.lastMergeChanged = old.lastMergeChanged
    // Everything the watch owns has to survive a rescan too, or pressing
    // "rescan the card directory" would silently drop every release link, the
    // index session and the imported-file record along with it.
    if (old.primary) entry.primary = clone(old.primary)
    if (old.importedAt) entry.importedAt = old.importedAt
    if (old.importedFrom) entry.importedFrom = old.importedFrom
    if (old.lastCheckAt) entry.lastCheckAt = old.lastCheckAt
    if (old.lastCheckSummary) entry.lastCheckSummary = old.lastCheckSummary
    if (old.lastError) entry.lastError = old.lastError
    if (old.pending) entry.pending = old.pending
  }

  return {
    version: 1,
    mergeStrategy: existing?.mergeStrategy || DEFAULT_CFG.mergeStrategy,
    syncPlain: existing?.syncPlain === true,
    autoBumpVersion: existing?.autoBumpVersion !== false,
    allowMvuUpdate: !!existing?.allowMvuUpdate,
    autoCheckMinutes: existing?.autoCheckMinutes || 0,
    // Carried over explicitly: a rescan rebuilds the card list, and losing the
    // session here would quietly break every thread link until it is pasted again.
    indexToken: existing?.indexToken || '',
    cards,
  }
}

/* -------------------------------------------------------- page watching */

/** The index backend the community search site is built on. */
const INDEX_API = 'https://forum.shimmerday.top/v1'

/** Where a fresh token comes from: the Discord sign-in the index site itself uses. */
const INDEX_LOGIN = 'https://odysseia-forum-webpage.pages.dev/login'

/** Identifies as a browser; several release hosts answer nothing without it. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Read a JWT payload without checking its signature. The index backend issues
 * and signs these tokens; the only fact worth reading on this side is when one
 * stops being accepted, and that is printed in the clear.
 * @param {string} token - the raw token.
 * @returns {object|null} the payload, or null when this is not a JWT.
 */
function jwtPayload(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * The moment a token stops being accepted. The index issues them with a
 * seven-day life, so this tells "wrong token" apart from "last week's token"
 * without spending a request to be told the same thing.
 * @param {string} token - the raw token.
 * @returns {Date|null} the expiry, or null when the token carries none.
 */
function tokenExpiry(token) {
  const payload = jwtPayload(token)
  const exp = payload && Number(payload.exp)
  return Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000) : null
}

/**
 * Read a Discord thread link as an index lookup. Cards are handed out in
 * community threads, and the search site indexes exactly those threads; its
 * backend answers `/search/thread/<id>` with the thread record, whose title is
 * where authors put their own update marker ("【9.14更新 追加…】"). Scraping the
 * Discord page itself is not an option — it renders behind a login — so the
 * index is the only route to the same fact.
 * @param {string} url - the configured release link.
 * @returns {{threadId: string, endpoint: string}|null} lookup, or null when not a thread link.
 */
function indexTarget(url) {
  const m = String(url || '').match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/i)
  if (!m) return null
  return { threadId: m[1], endpoint: `${INDEX_API}/search/thread/${m[1]}` }
}

/**
 * Flatten a thread record into the few lines worth watching. The backend's shape
 * is its own business and may change, so rather than hard-coding a path this
 * walks the payload and keeps the keys that carry the answer wherever they sit.
 * Whatever comes back has to survive the same version scan as a web page, and
 * the title is what feeds it.
 * @param {unknown} payload - parsed response body.
 * @returns {{text: string, title: string}} flattened fields and the thread title.
 */
function threadSummary(payload) {
  const wanted = /^(title|name|thread_name|thread_title|last_message|last_message_at|updated_at|update_time|created_at|message_count|reply_count)$/i
  const lines = []
  const seen = new Set()
  let title = ''
  const walk = (node, depth) => {
    if (!node || depth > 6 || lines.length > 60) return
    if (Array.isArray(node)) {
      for (const v of node.slice(0, 20)) walk(v, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' || typeof value === 'number') {
        if (!wanted.test(key)) continue
        const line = `${key}: ${value}`
        if (seen.has(line)) continue
        seen.add(line)
        lines.push(line)
        if (!title && /^(title|name|thread_name|thread_title)$/i.test(key)) title = String(value)
      } else {
        walk(value, depth + 1)
      }
    }
  }
  walk(payload, 0)
  return { text: lines.join('\n'), title }
}

/**
 * The signed-in activity feed. The index site tracks every thread its members
 * watch and publishes one entry per release ("X 更新了作品 …"), which makes a
 * single request answer the question this whole feature exists to ask. It is
 * tried before the per-thread lookup because it covers every card at once.
 * @param {string} token - the index session token.
 * @param {number} limit - how many recent entries to read.
 * @returns {Promise<object[]>} feed entries, newest first, or [] when unreadable.
 */
async function fetchIndexNotifications(token, limit = 60) {
  if (!token) return []
  const url = `${INDEX_API}/notifications?limit=${limit}&offset=0`
  const raw = await fetchText(url, 45000, { authorization: `Bearer ${token}`, accept: 'application/json' })
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('索引站动态返回的不是 JSON（令牌可能无效）')
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (['items', 'list', 'data', 'results', 'records'].map((k) => parsed && parsed[k]).find(Array.isArray) || [])
  // Flattened once here rather than inside the per-card loop: every card is
  // compared against this same list, and serialising each entry again for each
  // of them would repeat that work once per card in the config.
  return list.map((item) => {
    let flat = ''
    try {
      flat = JSON.stringify(item)
    } catch {
      flat = ''
    }
    return { item, flat }
  })
}

/**
 * Entries from the feed that concern one card. The thread id is the reliable
 * join — it comes straight out of the configured link — and the configured
 * version marker plus the card label are the fallback for entries that only
 * carry a title.
 * @param {object} entry - the config entry.
 * @param {object[]} items - feed entries.
 * @returns {{hits: object[], title: string, at: string}} matches and their newest title.
 */
function matchNotifications(entry, feed) {
  const thread = indexTarget(entry.primary && entry.primary.url)
  const markers = [entry.primary && entry.primary.match, entry.label]
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 2)
  const hits = []
  for (const entryItem of feed) {
    // Entries arrive pre-flattened by fetchIndexNotifications; an entry that
    // could not be serialised simply cannot be matched and is skipped.
    const flat = entryItem.flat || ''
    if (!flat) continue
    if (thread && flat.includes(thread.threadId)) {
      hits.push(entryItem)
      continue
    }
    if (markers.some((mk) => flat.includes(mk))) hits.push(entryItem)
  }
  const newest = hits.length ? hits[0].item : null
  let title = ''
  let at = ''
  if (newest) {
    const summary = threadSummary(newest)
    title = summary.title || ''
    if (!title) {
      for (const key of ['message', 'body', 'content', 'text', 'summary']) {
        if (typeof newest[key] === 'string' && newest[key].trim()) {
          title = newest[key].trim()
          break
        }
      }
    }
    for (const key of ['created_at', 'createdAt', 'time', 'at', 'updated_at']) {
      if (newest[key]) {
        at = String(newest[key])
        break
      }
    }
  }
  return { hits, title, at }
}

/**
 * Whether a failure looks like the request never reached the host at all, as
 * opposed to the host answering with something unusable. The difference matters
 * to the person reading it: a refused or unresolvable connection points at the
 * machine's network path, while a 404 or a bad payload points at the link.
 * @param {unknown} message - the thrown error's message.
 * @returns {boolean} true for connection-level failures.
 */
function isNetworkError(message) {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|network error|timed? ?out|aborted/i.test(
    String(message || ''),
  )
}

/** Strip an MVU tag, a trailing version, and wrapping punctuation. */function tidyTerm(raw) {
  return String(raw || '')
    .replace(/\s*MVU\s*版本?\s*/gi, ' ')
    .replace(/[\s_-]*[vV]?\d+(?:[._]\d+)*[a-zA-Z_]*[\s_-]*$/, '')
    // Card names often arrive wrapped ("《道渊》"), and the brackets are not part
    // of the title on the index, so they are dropped from both ends only.
    .replace(/^[\s《【\[（(]+/, '')
    .replace(/[\s》】\]）)]+$/, '')
    .trim()
}

/**
 * The term to look a card up by, in order of how much it can be trusted. A
 * marker the user typed wins outright. Next comes the name printed inside the
 * original card itself: file names are not trustworthy, because the downloaded
 * original is routinely renamed on the way in and the MVU copy can be renamed
 * too, while the card's own `name` is what the author actually wrote. File names
 * and finally the label cover cards whose files cannot be read.
 * @param {object} entry - the config entry.
 * @returns {string} the search term.
 */
function searchTermOf(entry) {
  const marker = String((entry.primary && entry.primary.match) || '').trim()
  if (marker) return marker

  const cardPath = String((entry.plain && entry.plain.path) || '').trim()
  if (cardPath && exists(cardPath)) {
    try {
      const card = loadCard(cardPath)
      const name = String((card.data && card.data.name) || card.payload.name || '').trim()
      const tidied = tidyTerm(name)
      if (tidied.length >= 2) return tidied
    } catch {
      // An unreadable card just falls through to the file-based guesses.
    }
  }

  const mvuName = String((entry.mvu && entry.mvu.path) || '')
    .split(/[\\/]/)
    .pop()
  for (const raw of [mvuName, String(entry.label || '').trim()]) {
    if (!raw) continue
    const stem = raw.replace(/\.json$/i, '')
    return tidyTerm(stem) || stem
  }
  return ''
}

/**
 * Ask the index which thread a card belongs to, and remember the link. Cards are
 * announced in the community and the index keeps that mapping, so this removes
 * the step of hunting the thread down by hand. Only the suggestion endpoint
 * answers a keyword (the general search route ignores it), and only a result
 * whose title actually contains the term is accepted: binding a card to someone
 * else's thread would be worse than leaving the field empty for the user to fill.
 * @param {object} entry - the config entry, updated in place.
 * @param {string} token - the index session token.
 * @returns {Promise<{url: string, title: string}|null>} the link found, if any.
 */
async function discoverThread(entry, token) {
  const state = (entry.primary = entry.primary || emptyPrimary())
  const query = searchTermOf(entry)
  if (!query || query.length < 2) return null
  // Recorded before the lookup runs and regardless of its outcome, so the
  // panel's manual search link offers the same wording either way.
  state.query = query
  if (state.url || !token) return null

  const raw = await fetchText(
    `${INDEX_API}/search/suggestions?keyword=${encodeURIComponent(query)}&apply_preferences=true`,
    30000,
    { authorization: `Bearer ${token}`, accept: 'application/json' },
  )
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const threads = Array.isArray(parsed && parsed.threads) ? parsed.threads : []
  const needle = query.toLowerCase()
  const hit = threads.find((t) => String(t.title || '').toLowerCase().includes(needle))
  if (!hit || !hit.thread_id) return null

  state.url = hit.guild_id
    ? `https://discord.com/channels/${hit.guild_id}/${hit.thread_id}`
    : `https://discord.com/channels/@me/${hit.thread_id}`
  state.match = state.match || query
  // Kept so the panel's "search the index" link uses the same wording the
  // lookup used, rather than re-deriving it without access to the card file.
  state.query = query
  state.discoveredAt = nowIso()
  return { url: state.url, title: hit.title || '' }
}

/**
 * Conditions a release page can put on handing out its download. A version you
 * cannot fetch is still worth reporting, but the report has to say why the
 * fetch is not automatic, so each hit is named rather than merely counted.
 */
const GATE_RULES = [
  ['password', /密码|提取码|解压码|passcode|password/i],
  ['role', /需要?权限|权限不足|身份组|等级不足|required role|tier/i],
  ['reply', /回复可见|回帖可见|评论可见|reply to (?:unlock|view|see)/i],
  ['paid', /赞助|付费|购买|积分|金币|打赏|爱发电|afdian|patreon|booth/i],
  ['discord', /discord\.gg|discord\.com|discordapp\.com/i],
]

/**
 * Reduce a page to the text a reader would see. Scripts, styles and tags go
 * away and the entities that actually turn up in release notes are decoded,
 * which is all the search for a version or a download condition needs — a real
 * parser would buy nothing here and cost a dependency.
 * @param {string} html - raw response body.
 * @returns {string} visible text with collapsed whitespace.
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*3[49];/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Numeric parts of a version string, or null when it holds no digits. */
function versionParts(v) {
  const m = String(v == null ? '' : v).match(/\d+(?:\.\d+)*/)
  if (!m) return null
  return m[0].split('.').map((n) => Number.parseInt(n, 10))
}

/**
 * Order two versions. Component-wise rather than lexicographic, so 1.10 ranks
 * above 1.9 instead of below it.
 * @returns {number} 1, 0 or -1.
 */
function compareVersions(a, b) {
  const pa = versionParts(a)
  const pb = versionParts(b)
  if (!pa) return pb ? -1 : 0
  if (!pb) return 1
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/**
 * The newest version a page mentions. Labelled forms win, because a bare number
 * in release notes is as likely to be a date, a price or a download count; the
 * unlabelled scan is only a fallback for pages that label nothing at all.
 * Labels that describe the reading environment are skipped: collection pages
 * state which SillyTavern build they were tested on, and that number outranks
 * every card on the page. Skipping them suppresses the fallback too, or the
 * rejected number would simply be picked up again by the unlabelled scan.
 * @param {string} text - visible page text.
 * @returns {string|null} the highest version found.
 */
function extractVersion(text) {
  const body = String(text || '')
  const found = []
  let sawLabel = false
  // Up to ten non-digit characters may sit between the label and the number,
  // because release notes are written as "版本更新记录：v1.2" as often as
  // "版本: 1.2". A dot is required, which is what keeps "更新了 3 张图" out.
  // `beta` carries no trailing boundary: it is glued to its number in
  // "beta0.5.5", and a trailing \b there fails because `a` and `0` are both
  // word characters, which silently drops the label and leaves the unlabelled
  // scan to pick up a fragment like "5.5".
  const labelled = /(?:\bversion\b|\bver\.?|\bupdate\b|\bbeta\.?|版本|更新)[^\d\n]{0,10}v?(\d+(?:\.\d+){1,3})/gi
  // Many authors write the marker the other way round — "【9.14更新 追加…】",
  // where the number precedes the word that labels it — so the reverse order is
  // read too. Both styles are collected and the highest wins, which holds for
  // either because a release-date scheme and a version scheme each only grow.
  const trailing = /(\d+(?:\.\d+){1,3})\s*(?:版更新|更新|发布|version|update)/gi
  const environment = /(酒馆|tavern|sillytavern|模型|model|上下文|context|引擎|engine|node|python|browser)/i
  let m
  while ((m = labelled.exec(body)) !== null) {
    sawLabel = true
    if (environment.test(body.slice(Math.max(0, m.index - 12), m.index))) continue
    found.push(m[1])
  }
  let t
  while ((t = trailing.exec(body)) !== null) {
    sawLabel = true
    found.push(t[1])
  }
  if (!found.length && !sawLabel) {
    // The lookbehind keeps a fragment of a longer run out: without it, "0.5.5"
    // also yields "5.5" from its own tail.
    const bare = body.match(/(?<![\d.])v?\d+\.\d+(?:\.\d+){0,3}\b/g) || []
    for (const b of bare) found.push(b.replace(/^v/i, ''))
  }
  let best = null
  for (const v of found) if (best === null || compareVersions(v, best) > 0) best = v
  return best
}

/**
 * Narrow the page to the part that belongs to one card. Author pages collect
 * several cards and each carries its own release notes, so a whole-page scan
 * would happily report one card's version as another's. The keyword is often
 * repeated — in a navigation block, in the page toolbar, in a link title — and
 * the notes are under only one of those occurrences, so every position is
 * weighed rather than trusting the first or the last. A window runs from one
 * occurrence to the next, which is what keeps a card's notes from running into
 * its neighbour's, and the window that actually names a version wins.
 * @param {string} text - visible page text.
 * @param {string} keyword - the card's marker on that page, or empty for all of it.
 * @returns {string} the slice to search, or '' when the keyword is absent.
 */
function scopeText(text, keyword) {
  const body = String(text || '')
  const kw = String(keyword || '').trim()
  if (!kw) return body
  const needle = kw.toLowerCase()
  const lower = body.toLowerCase()
  // Release notes for one card can run long, and on a single-card page they are
  // followed by download links rather than by another card.
  const LIMIT = 4000
  let bestFrom = -1
  let bestTo = -1
  let bestScore = -1
  let at = lower.indexOf(needle)
  let seen = 0
  while (at >= 0 && seen < 40) {
    seen++
    const next = lower.indexOf(needle, at + 1)
    // Without a following occurrence the window would otherwise run to the end
    // of the page and swallow its footer, version stamp and edit toolbar.
    const stop = Math.min(next < 0 ? body.length : next, at + LIMIT)
    const window = body.slice(at, stop)
    let score = window.length
    if (extractVersion(window)) score += 100000
    if (score > bestScore) {
      bestScore = score
      bestFrom = at
      bestTo = stop
    }
    at = next
  }
  return bestFrom < 0 ? '' : body.slice(bestFrom, bestTo)
}

/** Which conditions the page attaches to its download. */
function detectGates(text) {
  const body = String(text || '')
  const hits = []
  for (const [key, re] of GATE_RULES) if (re.test(body)) hits.push(key)
  return hits
}

/* ------------------------------------------------------------ remote slot */

function normalizeSlot(slot) {
  if (!slot || slot.enabled === false) return null
  if (typeof slot === 'string') {
    return /^https?:/i.test(slot) ? { kind: 'url', url: slot } : { kind: 'file', path: slot }
  }
  if (slot.kind === 'file' && slot.path) return { kind: 'file', path: slot.path }
  if (slot.url) return { kind: 'url', url: slot.url }
  if (slot.path) return { kind: 'file', path: slot.path }
  return null
}

async function materialize(slot) {
  if (!slot) throw new Error('未配置来源')
  if (slot.kind === 'file') {
    const text = readText(slot.path)
    return { text, isRemote: false, ref: slot.path, hash: hashText(text), kind: 'json' }
  }
  if (looksLikeImageUrl(slot.url)) return { image: true, ref: slot.url, hash: null, kind: 'image' }
  const text = await fetchText(slot.url)
  if (!looksLikeCardText(text)) {
    throw new Error(`远端内容不是人物卡 JSON（前 80 字：${String(text).slice(0, 80).replace(/\s+/g, ' ')}）`)
  }
  return { text, isRemote: true, ref: slot.url, hash: hashText(text), kind: 'json' }
}

/* ------------------------------------------------------------ operations */

function backupFile(p, tag) {
  if (!p || !exists(p)) return null
  ensureDir(BACKUP_DIR)
  const dst = path.join(BACKUP_DIR, `${Date.now()}__${tag}__${baseOf(p)}`)
  copyFile(p, dst)
  return dst
}

/**
 * Look at the page a card is released on and see what it says about versions.
 * Three answers matter and they stay separate: whether the page moved at all,
 * whether the newest version it names is ahead of the one already recorded, and
 * what conditions the download carries. A page changes without a release
 * (comments, view counters) and a release can appear behind a password, so
 * flattening these into one boolean would throw away the useful half.
 * @param {object} entry - the config entry; its watch slot is updated in place.
 * @returns {Promise<object>} the finding.
 */
async function checkPrimary(entry, feedItems) {
  const url = String((entry.primary && entry.primary.url) || '').trim()
  if (!url) return { ok: false, skipped: true, url, reason: '未配置主要链接' }
  if (!/^https?:/i.test(url)) return { ok: false, url, error: '主要链接需要 http(s) 地址' }

  const state = (entry.primary = entry.primary || emptyPrimary())
  state.url = url
  state.checkedAt = nowIso()

  try {
    const thread = indexTarget(url)
    const token = String((db.cfg && db.cfg.indexToken) || '').trim()
    if (thread && !token) {
      throw new Error('这是 Discord 贴子链接，需要先在「合并设置」里填入索引站令牌')
    }

    let raw
    try {
      raw = await fetchText(thread ? thread.endpoint : url, 60000, thread ? { authorization: `Bearer ${token}` } : null)
    } catch (e) {
      const message = e && e.message ? e.message : String(e)
      if (thread && /HTTP 401|HTTP 403/.test(message)) throw new Error('索引站令牌无效或已过期，请重新获取')
      throw e
    }

    let text
    let title = ''
    if (thread) {
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error('索引站返回的不是贴子数据（令牌可能无效）')
      }
      const summary = threadSummary(parsed)
      text = summary.text
      title = summary.title
      if (!text) throw new Error('索引站没有返回这张贴子的信息')
    } else {
      text = stripHtml(raw)
    }
    if (!text) throw new Error('页面没有可读文本（可能需要登录才能查看）')

    const keyword = String(state.match || '').trim()
    const scope = scopeText(text, keyword)
    if (!scope) throw new Error(`页面上没有找到「${keyword}」，无法定位这张卡`)

    // Everything is read from the scoped slice, signature included: on a page
    // holding several cards, a change anywhere else is not this card's news.
    const sig = hashText(scope)
    const version = extractVersion(scope)
    const gates = detectGates(scope)
    const first = !state.sig
    const changed = !first && state.sig !== sig
    let baseline = state.version || null

    // With no baseline yet there is nothing to compare against, so fall back to
    // the version printed inside the local card: a page already ahead of it is
    // exactly the news this check exists to surface.
    if (!baseline && version) {
      try {
        const cardPath = entry.plain && entry.plain.path
        if (cardPath && exists(cardPath)) {
          const card = loadCard(cardPath)
          baseline = (card.data && card.data.character_version) || card.payload.character_version || null
        }
      } catch {
        baseline = null
      }
    }

    const moved = !!(version && baseline && version !== baseline)
    let newer = moved ? compareVersions(version, baseline) > 0 : false

    // The activity feed is already in hand: it is fetched once per check run, not
    // once per card, because the same list answers for every card and asking for
    // it fifteen times over would be fifteen identical requests. It says a
    // release happened even when the page or the thread title is unchanged
    // (authors often ship a new file under the same headline). Entries already
    // seen on an earlier pass are ignored, so a card does not read as updated
    // forever just because its release is still inside the feed window.
    let feedNote = null
    if (token && Array.isArray(feedItems)) {
      const feed = matchNotifications(entry, feedItems)
      if (feed.hits.length) {
        // Fingerprints come from the flattened form the fetch already produced,
        // so no entry is serialised a second time here.
        const fingerprint = (hit) => (hit.flat ? hashText(hit.flat).slice(0, 16) : '')
        const seenBefore = new Set(Array.isArray(state.feedSeen) ? state.feedSeen : [])
        const fresh = feed.hits.map(fingerprint).filter((fp) => fp && !seenBefore.has(fp))
        state.feedSeen = [...new Set([...seenBefore, ...feed.hits.map(fingerprint)])].filter(Boolean).slice(-40)
        state.feedTitle = feed.title || state.feedTitle || ''
        state.feedAt = feed.at || state.feedAt || ''
        state.feedCount = feed.hits.length
        if (fresh.length && !first) newer = true
        feedNote = { hits: feed.hits.length, fresh: first ? 0 : fresh.length, title: feed.title, at: feed.at }
      }
    }

    state.sig = sig
    state.version = version
    state.gates = gates
    state.newer = newer
    state.changed = changed
    state.title = title || state.title || ''
    state.error = null

    return {
      ok: true,
      url,
      keyword,
      source: thread ? 'index' : 'page',
      title: state.title,
      first,
      changed,
      newer,
      feed: feedNote,
      version,
      baseline,
      gates,
      chars: scope.length,
    }
  } catch (e) {
    const message = e && e.message ? e.message : String(e)
    state.error = message
    // Kept separate from the message so the panel can tell "the link is wrong"
    // apart from "this machine cannot reach the host right now".
    state.networkError = isNetworkError(message)
    state.newer = false
    return { ok: false, url, error: message, network: state.networkError }
  }
}

async function checkEntry(entry, feedItems) {
  const out = { id: entry.id, label: entry.label, plain: null, primary: null, discovered: null }

  // First, give a card without a release link a chance to get one. This runs
  // before the check so the very same pass can already read the thread it just
  // found, which is what makes "check everything and the links fill in" true.
  const token = String((db.cfg && db.cfg.indexToken) || '').trim()
  if (token) {
    try {
      const found = await discoverThread(entry, token)
      if (found) out.discovered = found
    } catch {
      // Discovery is a convenience; a failed lookup must not fail the check.
    }
  }

  const slot = normalizeSlot(entry.plain?.src)
  if (!slot) {
    out.plain = { ok: false, error: '未配置原版链接', skipped: true }
  } else {
    try {
      const mat = await materialize(slot)
      const first = !entry.plain.sig
      // A local file is the user's own copy, not a release feed. Hashing it and
      // calling the difference an update reports their own edits as upstream
      // news, which is the opposite of what a version check is for. The baseline
      // still advances so the slot stays comparable; it just never raises a flag.
      const local = slot.kind === 'file'
      const differs = !first && entry.plain.sig !== mat.hash
      const changed = differs && !local
      out.plain = { ok: true, changed, first, local, sig: mat.hash, ref: mat.ref }
      entry.plain.sig = mat.hash
      // `pending` means "a release is waiting to be applied", so only a real
      // change sets it. Setting it on the first sight of a source is what made a
      // freshly configured card announce an update before anything had moved.
      if (changed) {
        entry.pending = entry.pending || {}
        entry.pending.plain = { sig: mat.hash, ref: mat.ref, at: nowIso() }
      }
    } catch (e) {
      out.plain = { ok: false, error: e && e.message ? e.message : String(e) }
    }
  }
  // The watch runs even when the card link is missing or broken: the release
  // page is a separate source and often the only one that knows about a version.
  out.primary = await checkPrimary(entry, feedItems)
  return out
}

async function applyPlain(entry) {
  const slot = normalizeSlot(entry.plain?.src)
  if (!slot) throw new Error('未配置原版链接')
  const target = entry.plain.path || (slot.kind === 'file' ? '' : path.join(CARD_DIR, `${entry.label || 'card'}.json`))
  if (!target) throw new Error('未配置目标文件')

  ensureDir(path.dirname(target))
  ensureDir(BACKUP_DIR)
  const backup = backupFile(target, 'plain')
  let sig

  if (slot.kind === 'url' && looksLikeImageUrl(slot.url)) {
    const tmp = path.join(DL_DIR, `img-${Date.now()}.png`)
    const res = await download(slot.url, tmp)
    copyFile(tmp, target)
    sig = `img:${res.bytes}`
  } else {
    const mat = await materialize(slot)
    const info = unwrapCard(mat.text)
    writeText(target, JSON.stringify(info.outer, null, 2))
    sig = mat.hash
  }

  entry.plain.path = target
  entry.plain.sig = sig
  entry.plain.lastUpdateAt = nowIso()
  entry.updatedAt = nowIso()
  entry.lastError = null
  if (entry.pending) delete entry.pending.plain
  pruneBackups()
  return { target, backup, sig }
}

/**
 * Replace the local original with a card the user picked by hand. Once the
 * release link is the thing being watched, downloading is the step that wants a
 * human: the new file often arrives through a community post, a password or a
 * re-packaged archive. So this takes a path rather than a URL, copies it over
 * the original, and records when it happened, which is what the card then shows.
 * The file is parsed before anything is overwritten, so a wrong pick cannot
 * destroy the current card.
 * @param {string} cardId - config entry id.
 * @param {string} fromPath - the freshly downloaded card file.
 */
async function importPlain(cardId, fromPath) {
  if (!db.loaded) loadConfig()
  const entry = findEntry(cardId)
  if (!entry) throw new Error(`未找到条目: ${cardId}`)
  const from = String(fromPath || '').trim()
  if (!from) throw new Error('未选择文件')
  if (!exists(from)) throw new Error(`文件不存在：${from}`)
  const target = entry.plain?.path
  if (!target) throw new Error('这张卡还没设置原版卡路径')
  if (path.resolve(from) === path.resolve(target)) throw new Error('选中的就是当前原版卡，无需导入')

  const text = readText(from)
  const info = unwrapCard(text)
  const version =
    (info.payload?.data && info.payload.data.character_version) || info.payload?.character_version || null

  ensureDir(path.dirname(target))
  ensureDir(BACKUP_DIR)
  const backup = backupFile(target, 'before-import')
  writeText(target, text)

  entry.plain.sig = hashText(text)
  entry.plain.lastUpdateAt = nowIso()
  entry.updatedAt = nowIso()
  entry.importedAt = nowIso()
  entry.importedFrom = from
  // The release has been taken, so whatever was pending no longer is.
  delete entry.pending
  // Same retention pass as every other write; without it, importing would be the
  // one path that lets the backup directory grow without bound.
  pruneBackups()
  saveConfig()
  return { target, backup, from, version, bytes: text.length }
}

async function mergeEntry(entry) {
  const plainPath = entry.plain?.path
  const mvuPath = entry.mvu?.path
  if (!plainPath) throw new Error('未配置原版卡文件')
  if (!mvuPath) throw new Error('未配置 MVU 版文件')

  const plain = loadCard(plainPath)
  const mvu = loadCard(mvuPath)
  const strategy = db.cfg.mergeStrategy || 'standard'
  const merged = mergeCards(mvu, plain, strategy)

  if (db.cfg.autoBumpVersion !== false && plain.data.character_version !== undefined) {
    const bumped = bumpVersion(plain.data.character_version)
    if (bumped && !deepEqual(merged.payload.data.character_version, bumped)) {
      merged.payload.data.character_version = bumped
      merged.changed.push(`character_version→${bumped}`)
    }
  }

  ensureDir(BACKUP_DIR)
  const backups = []
  const mvuBackup = backupFile(mvuPath, 'mvu')
  if (mvuBackup) backups.push(mvuBackup)
  writeText(mvuPath, buildCardText(mvu.shell, mvu.outer, merged.payload))

  let plainTarget = null
  if (entry.syncPlain === true && db.cfg.syncPlain !== false) {
    const plainBackup = backupFile(plainPath, 'plain')
    if (plainBackup) backups.push(plainBackup)
    writeText(plainPath, buildCardText(plain.shell, plain.outer, merged.payload))
    entry.plain.sig = hashText(JSON.stringify(merged.payload))
    entry.plain.lastUpdateAt = nowIso()
    plainTarget = plainPath
  }

  entry.mvu.sig = hashText(JSON.stringify(merged.payload))
  entry.mvu.lastUpdateAt = nowIso()
  entry.mergedAt = nowIso()
  entry.lastMergeChanged = merged.changed
  entry.lastError = null
  if (entry.pending) delete entry.pending.plain
  pruneBackups()

  return {
    target: mvuPath,
    plainTarget,
    changed: merged.changed,
    strategy,
    book: merged.details.book
      ? {
          added: merged.details.book.added,
          updated: merged.details.book.updated,
          conflicts: merged.details.book.conflicts.length,
          kept: merged.details.book.conflicts.slice(0, 12),
        }
      : null,
    regexAdded: merged.details.regexAdded || 0,
    backups,
  }
}

async function runCheck(ids) {
  if (!db.loaded) loadConfig()
  const targets = (db.cfg.cards || []).filter(
    (c) => c.enabled !== false && (!ids || !ids.length || ids.includes(c.id)),
  )

  // The activity feed is pulled once for the whole run. It answers for every
  // card at once, and every card re-requesting it would repeat the same network
  // call as many times as there are cards in the list.
  let feedItems = []
  const token = String((db.cfg && db.cfg.indexToken) || '').trim()
  if (token && targets.length) {
    try {
      feedItems = await fetchIndexNotifications(token)
    } catch (e) {
      // The feed is one signal among several; a broken session must not stop the
      // links themselves from being read.
      log('feed fetch failed:', e && e.message ? e.message : e)
      feedItems = []
    }
  }

  const results = []
  for (const entry of targets) {
    try {
      results.push(await checkEntry(entry, feedItems))
    } catch (e) {
      results.push({ id: entry.id, label: entry.label, plain: { ok: false, error: String(e) } })
    }
  }
  for (const r of results) {
    const entry = findEntry(r.id)
    if (!entry) continue
    const bits = []
    if (r.plain?.ok) {
      bits.push(r.plain.changed ? '原版有更新' : r.plain.first ? '已记录基线' : '原版已最新')
    } else if (r.plain && !r.plain.skipped) {
      bits.push('原版检测失败')
    }
    if (r.primary) {
      if (r.primary.ok) {
        bits.push(r.primary.newer ? `主要链接有新版本 ${r.primary.version}` : '主要链接已最新')
        if (r.primary.gates && r.primary.gates.length) bits.push(`下载条件 ${r.primary.gates.join('/')}`)
      } else if (r.primary.skipped) {
        bits.push('未配置主要链接')
      } else {
        bits.push('主要链接检索失败')
      }
    }
    entry.lastCheckAt = nowIso()
    entry.lastCheckSummary = bits.join(' · ') || '未配置检测链接'
    const plainError = r.plain && r.plain.ok === false && !r.plain.skipped ? r.plain.error : null
    const primaryError = r.primary && r.primary.ok === false && !r.primary.skipped ? r.primary.error : null
    entry.lastError = plainError || primaryError || null
  }
  db.lastReport = { at: nowIso(), results }
  try {
    saveConfig()
  } catch (e) {
    log('save after check failed:', e && e.message ? e.message : e)
  }
  try {
    ensureDir(DATA_DIR)
    writeText(STATE_FILE, JSON.stringify(db.lastReport, null, 2))
  } catch (e) {
    log('state write failed:', e && e.message ? e.message : e)
  }
  return db.lastReport
}

async function runApply(cardId) {
  if (!db.loaded) loadConfig()
  const entry = findEntry(cardId)
  if (!entry) throw new Error(`未找到条目: ${cardId}`)
  try {
    const res = await applyPlain(entry)
    saveConfig()
    return res
  } catch (e) {
    // A release handed out behind a password, a permission or a sponsor wall
    // cannot be fetched by a plain request, and the error that comes back says
    // nothing about that: it looks exactly like a dead link. The last check
    // already recorded those conditions on the card, so the failure is reported
    // as what it is and the user is pointed at the route that does work.
    const gates = (entry.primary && entry.primary.gates) || []
    if (gates.length) {
      const gated = new Error('此人物卡来源无法直接更新，请访问原贴下载新卡后导入')
      gated.gated = true
      gated.reason = e && e.message ? e.message : String(e)
      throw gated
    }
    throw e
  }
}

async function runMerge(cardId) {
  if (!db.loaded) loadConfig()
  const entry = findEntry(cardId)
  if (!entry) throw new Error(`未找到条目: ${cardId}`)
  const res = await mergeEntry(entry)
  saveConfig()
  return res
}

async function runUpdateAndMerge(cardId) {
  const update = await runApply(cardId)
  const merge = await runMerge(cardId)
  return { ...merge, update }
}

async function runUpdateAll() {
  if (!db.loaded) loadConfig()
  const items = []
  for (const entry of db.cfg.cards || []) {
    if (entry.enabled === false || !entry.pending?.plain) continue
    try {
      const res = await applyPlain(entry)
      items.push({ id: entry.id, label: entry.label, ok: true, target: res.target })
    } catch (e) {
      items.push({ id: entry.id, label: entry.label, ok: false, error: String(e) })
    }
  }
  saveConfig()
  return { items }
}

function runSelfCheck() {
  const report = { at: nowIso(), hashMode: 'sha256', checks: {} }
  try {
    report.checks.hashStable = hashText('命定之诗') === hashText('命定之诗')
    report.checks.hashDistinct = hashText('命定之诗') !== hashText('命定之诗!')
  } catch (e) {
    report.checks.hashErr = String(e)
  }
  try {
    report.checks.cardsInDir = listNames(CARD_DIR, (n) => /\.json$/i.test(n)).length
    report.checks.sample = loadCard(path.join(CARD_DIR, '命定之诗v4.3.3.json')).data.name
  } catch (e) {
    report.checks.loadErr = String(e)
  }
  try {
    writeText(path.join(DATA_DIR, 'selfcheck.json'), JSON.stringify(report, null, 2))
  } catch {
    /* best effort */
  }
  return report
}

/**
 * Directory listing for the manual file picker: card files first, then the
 * sibling folders, so the browser can both drill down and jump sideways.
 * @param {string} target - absolute directory; the card directory when omitted.
 * @returns {{dir: string, parent: string | null, entries: Array<{name: string, path: string, type: string}>}}
 */
function listDirEntries(target) {
  const dir = target || CARD_DIR
  const out = { dir, parent: CARD_DIR, entries: [] }
  let dirents
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    out.error = e && e.message ? e.message : String(e)
    return out
  }

  const files = []
  const dirs = []
  for (const entry of dirents) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) dirs.push({ name: entry.name, path: full, type: 'directory' })
    else if (entry.isFile() && /\.json$/i.test(entry.name)) files.push({ name: entry.name, path: full, type: 'file' })
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  dirs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  out.entries = [...files, ...dirs]
  return out
}

/** Copies kept per card file before the oldest of that file is pruned. */
const BACKUP_KEEP_PER_FILE = 5
/** Hard ceiling on the whole folder, as a guard against runaway growth. */
const BACKUP_KEEP_TOTAL = 400

/**
 * Automatic retention, counted per card file rather than per folder: each file
 * keeps its newest `BACKUP_KEEP_PER_FILE` snapshots, so adding cards never
 * evicts another card's history. The folder-wide ceiling only guards against
 * runaway growth, and the newest snapshot of every file is always pinned.
 * @returns {{removed: string[], kept: number, files: number}}
 */
function pruneBackups() {
  const out = { removed: [], kept: 0, files: 0 }
  let names
  try {
    names = fs
      .readdirSync(BACKUP_DIR)
      .filter((n) => n.endsWith('.json'))
      .sort()
  } catch {
    return out
  }

  const parse = (name) => {
    const parts = name.split('__')
    return { ms: Number.parseInt(parts[0], 10) || 0, tag: String(parts[1] || '').toLowerCase(), file: parts.slice(2).join('__') }
  }

  // Newest-first per file, so the first N seen for a file are the ones to keep.
  const byFile = new Map()
  names.forEach((name) => {
    const info = parse(name)
    if (!byFile.has(info.file)) byFile.set(info.file, [])
    byFile.get(info.file).push({ name, ms: info.ms, tag: info.tag })
  })

  const keep = new Set()
  for (const [, list] of byFile) {
    list.sort((a, b) => b.ms - a.ms)
    list.slice(0, BACKUP_KEEP_PER_FILE).forEach((it) => keep.add(it.name))
    // Pin the newest snapshot of each kind as well, so a rollback target for a
    // specific operation (merge / manual / before-restore) never disappears.
    const seenTag = new Set()
    for (const it of list) {
      if (seenTag.has(it.tag)) continue
      seenTag.add(it.tag)
      keep.add(it.name)
    }
  }

  // Remove everything beyond each file's own retention window.
  const finalRemove = names.filter((n) => !keep.has(n))

  // Then enforce the folder-wide ceiling by dropping the oldest survivors.
  const overCeiling = names.length - finalRemove.length - BACKUP_KEEP_TOTAL
  if (overCeiling > 0) {
    const oldestFirst = keep.size
      ? [...keep].sort((a, b) => parse(a).ms - parse(b).ms)
      : []
    finalRemove.push(...oldestFirst.slice(0, overCeiling))
  }

  for (const name of finalRemove) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, name))
      out.removed.push(name)
    } catch (e) {
      log('prune failed:', e && e.message ? e.message : e)
    }
  }
  out.kept = names.length - out.removed.length
  out.files = byFile.size
  return out
}

/**
 * Manual backup: snapshot every tracked card file on demand, so the user owns
 * the timing instead of relying only on the pre-write snapshots.
 * @returns {{items: Array<{path: string, backup: string|null}>, pruned: number}}
 */
function manualBackup() {
  if (!db.loaded) loadConfig()
  ensureDir(BACKUP_DIR)
  const items = []
  for (const entry of db.cfg.cards || []) {
    const paths = [entry.plain && entry.plain.path, entry.mvu && entry.mvu.path]
    for (const p of paths) {
      if (!p || !exists(p)) continue
      if (items.some((it) => it.path === p)) continue
      try {
        items.push({ path: p, backup: backupFile(p, 'manual') })
      } catch (e) {
        items.push({ path: p, backup: null, error: e && e.message ? e.message : String(e) })
      }
    }
  }
  const pruned = pruneBackups()
  return { items, pruned: pruned.removed.length }
}

/**
 * Avatar sources, in priority order: the card's own PNG beside the original
 * snapshot, then a same-named file in the card directory, then any other image
 * shipped with this card.
 */
function avatarCandidates(cardPath) {
  const json = String(cardPath || '')
  if (!json || !/\.json$/i.test(json)) return []
  const base = path.basename(json).replace(/\.json$/i, '')
  const dir = path.dirname(json)
  const out = [path.join(ORIGINALS_DIR, `${base}.png`)]
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) out.push(path.join(dir, `${base}${ext}`))
  return out
}

/**
 * Serve a card avatar as a cached 96px thumbnail. Source images run 1–15 MB, so
 * scaling happens once per (file, mtime, size) triple and lands in the cache
 * folder; later requests are a straight read.
 * @param {string} cardPath - absolute path of the card JSON.
 * @returns {Promise<{buffer: Buffer, contentType: string} | null>}
 */
async function avatarThumb(cardPath) {
  const src = avatarCandidates(cardPath).find((p) => exists(p))
  if (!src) return null

  let stamp = '0'
  try {
    const info = fs.statSync(src)
    stamp = `${info.mtimeMs}-${info.size}`
  } catch {
    stamp = '0'
  }

  const key = hashText(`${src}|${stamp}`).slice(0, 24)
  const cached = path.join(AVATAR_CACHE, `${key}.png`)
  try {
    if (exists(cached)) return { buffer: fs.readFileSync(cached), contentType: 'image/png' }
  } catch {
    /* fall through to regeneration */
  }

  let buffer = null
  try {
    buffer = await scaleToPng(src, AVATAR_SIZE)
  } catch (e) {
    log('avatar scale failed:', e && e.message ? e.message : e)
  }
  if (!buffer) {
    try {
      return { buffer: fs.readFileSync(src), contentType: 'image/png' }
    } catch {
      return null
    }
  }

  try {
    ensureDir(AVATAR_CACHE)
    fs.writeFileSync(cached, buffer)
  } catch (e) {
    log('avatar cache write failed:', e && e.message ? e.message : e)
  }
  return { buffer, contentType: 'image/png' }
}

/**
 * Scale one image through PowerShell + System.Drawing without blocking the host
 * event loop. Keeps the aspect ratio and produces a PNG buffer.
 * @param {string} src - absolute source image.
 * @param {number} size - bounding box in pixels.
 * @returns {Promise<Buffer | null>}
 */
async function scaleToPng(src, size) {
  // System.Drawing is a Windows-only route. Everywhere else this returns null
  // and the caller's fallback serves the original PNG, letting the browser scale
  // it down with the object-fit already in the stylesheet: a little bandwidth on
  // a cache miss, and nothing after that.
  if (process.platform !== 'win32') return null
  ensureDir(AVATAR_CACHE)
  const outPath = path.join(AVATAR_CACHE, `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`)
  const cmd = [
    'Add-Type -AssemblyName System.Drawing',
    `$img = [System.Drawing.Image]::FromFile('${esc(src)}')`,
    'try {',
    `  $r = [Math]::Min(${size} / $img.Width, ${size} / $img.Height)`,
    '  $nw = [int][Math]::Max(1, [Math]::Round($img.Width * $r))',
    '  $nh = [int][Math]::Max(1, [Math]::Round($img.Height * $r))',
    '  $bmp = New-Object System.Drawing.Bitmap($nw, $nh)',
    '  $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.InterpolationMode = "HighQualityBicubic"',
    '  $g.DrawImage($img, 0, 0, $nw, $nh)',
    '  $g.Dispose()',
    `  $bmp.Save('${esc(outPath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '  $bmp.Dispose()',
    '} finally { $img.Dispose() }',
  ].join('\n')

  const result = await powershell(cmd, 90000)
  if (!result.ok || !exists(outPath)) {
    try {
      if (exists(outPath)) fs.unlinkSync(outPath)
    } catch {
      /* best effort */
    }
    return null
  }
  try {
    return fs.readFileSync(outPath)
  } finally {
    try {
      fs.unlinkSync(outPath)
    } catch {
      /* best effort */
    }
  }
}

/**
 * Pre-render avatars in the background so the first panel open reads cache
 * instead of paying the scale cost on the request path.
 */
async function warmAvatars() {
  const cards = db.cfg.cards || []
  let done = 0
  for (const entry of cards) {
    const p = entry.plain && entry.plain.path
    if (!p) continue
    try {
      await avatarThumb(p)
      done++
    } catch (e) {
      log('avatar warm failed:', e && e.message ? e.message : e)
    }
  }
  log(`avatar cache warmed for ${done} card(s)`)
}

/* ---------------------------------------------------------------- routes */

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (c) => chunks.push(c))
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        resolve({ raw: text })
      }
    })
    request.on('error', () => resolve({}))
  })
}

function statePayload() {
  if (!db.loaded) loadConfig()
  return {
    ok: true,
    config: db.cfg,
    lastReport: db.lastReport,
    cardDir: CARD_DIR,
    dataDir: DATA_DIR,
    backupDir: BACKUP_DIR,
    files: listNames(CARD_DIR, (n) => /\.json$/i.test(n)),
    hashMode: 'sha256',
    // The installed version travels with every state load, so the header can
    // label itself before the first update check has run.
    version: selfVersion(),
  }
}

/* --------------------------------------------------------- self update */

/**
 * The version this copy is running. It is read from the manifest next to the
 * code rather than compiled in, so a `git pull` is picked up on the next restart
 * without anything having to be edited by hand.
 * @returns {string} the installed version.
 */
function selfVersion() {
  if (!PLUGIN_DIR) return FALLBACK_VERSION
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8'))
    if (parsed && parsed.version) return String(parsed.version)
  } catch {
    /* the manifest is missing or unreadable: answer with the published number */
  }
  return FALLBACK_VERSION
}

/** Last answer, so repeated clicks do not spend the anonymous GitHub quota. */
const updateCache = { at: 0, data: null }
const UPDATE_CACHE_MS = 120_000

/**
 * Ask GitHub which version is published. A release is the better answer — it
 * carries its own page and date — so it is tried first; a repository that only
 * ever tags is answered by the tag list, and every tag is compared component-wise
 * instead of trusting the order the API returned them in.
 * @returns {Promise<{latest: string|null, url: string, publishedAt: string|null}>} what is published.
 */
async function remoteVersion() {
  const headers = { accept: 'application/vnd.github+json' }
  try {
    const rel = JSON.parse(await fetchText(`${REPO_API}/releases/latest`, 20000, headers))
    const tag = String((rel && (rel.tag_name || rel.name)) || '').trim()
    if (tag) {
      return { latest: tag, url: rel.html_url || REPO_URL, publishedAt: rel.published_at || null }
    }
  } catch {
    // No published release yet, or the endpoint refused: the tag list decides.
  }
  const tags = JSON.parse(await fetchText(`${REPO_API}/tags?per_page=100`, 20000, headers))
  if (!Array.isArray(tags) || !tags.length) return { latest: null, url: REPO_URL, publishedAt: null }
  let best = null
  for (const item of tags) {
    const tag = String((item && item.name) || '').trim()
    if (!tag) continue
    if (best === null || compareVersions(tag, best) > 0) best = tag
  }
  return {
    latest: best,
    url: best ? `${REPO_URL}/releases/tag/${encodeURIComponent(best)}` : REPO_URL,
    publishedAt: null,
  }
}

/**
 * Compare the installed version against what GitHub publishes.
 * @param {boolean} [force] - ignore the short-lived cache and ask again.
 * @returns {Promise<object>} the verdict for the browser half; `ok:false` when GitHub could not be reached.
 */
async function checkSelfUpdate(force) {
  const current = selfVersion()
  const now = Date.now()
  if (!force && updateCache.data && now - updateCache.at < UPDATE_CACHE_MS) {
    return { ok: true, ...updateCache.data, current, cached: true }
  }
  let remote
  try {
    remote = await remoteVersion()
  } catch (e) {
    const message = e && e.message ? e.message : String(e)
    const offline = isNetworkError(message)
    return {
      ok: false,
      current,
      error: message,
      // A request that never left the machine is the proxy again, not the repo:
      // this runs in a Node process that ignores the system proxy setting.
      networkError: offline,
      tunHint: offline,
    }
  }
  const data = {
    current,
    latest: remote.latest,
    hasUpdate: !!(remote.latest && compareVersions(remote.latest, current) > 0),
    // A repository that publishes no release and no tag cannot be compared, and
    // saying "up to date" there would be a guess rather than an answer.
    noRelease: !remote.latest,
    url: remote.url || REPO_URL,
    publishedAt: remote.publishedAt || null,
    checkedAt: new Date().toISOString(),
  }
  updateCache.at = now
  updateCache.data = data
  return { ok: true, ...data }
}

async function handleAction(body) {
  const action = String(body.action || '')
  switch (action) {
    case 'check':
      return { ok: true, report: await runCheck(body.ids || null) }
    case 'apply':
      // The gated case carries a flag the browser half shows verbatim rather than
      // behind the action name: the sentence is advice, and prefixed it would read
      // as a failure notice about a failure notice.
      try {
        return { ok: true, result: await runApply(body.cardId) }
      } catch (e) {
        if (e && e.gated) return { ok: false, gated: true, error: e.message }
        throw e
      }
    case 'importPlain':
      return { ok: true, result: await importPlain(body.cardId, body.from) }
    case 'merge':
      return { ok: true, result: await runMerge(body.cardId) }
    case 'updateAndMerge':
      try {
        return { ok: true, result: await runUpdateAndMerge(body.cardId) }
      } catch (e) {
        if (e && e.gated) return { ok: false, gated: true, error: e.message }
        throw e
      }
    case 'updateAll':
      return { ok: true, result: await runUpdateAll() }
    case 'save':
      db.cfg = normalizeCfg(body.config || db.cfg)
      db.loaded = true
      saveConfig()
      syncTimer()
      return { ok: true, config: db.cfg }
    case 'suggest': {
      if (!db.loaded) loadConfig()
      db.cfg = normalizeCfg(suggestConfig(db.cfg))
      saveConfig()
      return { ok: true, config: db.cfg }
    }
    case 'backupList': {
      let all = []
      try {
        all = fs.readdirSync(BACKUP_DIR).filter((n) => n.endsWith('.json'))
      } catch {
        all = []
      }
      const items = all
        .map((name) => {
          const parts = name.split('__')
          const ms = Number.parseInt(parts[0], 10)
          const tag = parts[1] || ''
          const file = parts.slice(2).join('__')
          let size = 0
          try {
            size = fs.statSync(path.join(BACKUP_DIR, name)).size
          } catch {
            size = 0
          }
          return {
            name,
            tag,
            file,
            size,
            at: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
            ms: Number.isFinite(ms) ? ms : 0,
          }
        })
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 200)
      const bytes = items.reduce((sum, it) => sum + it.size, 0)
      return {
        ok: true,
        dir: BACKUP_DIR,
        keepPerFile: BACKUP_KEEP_PER_FILE,
        keepTotal: BACKUP_KEEP_TOTAL,
        count: all.length,
        bytes,
        items,
      }
    }
    case 'deleteBackup': {
      const name = String(body.name || '')
      if (!name) throw new Error('缺少备份文件名')
      if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('非法的备份文件名')
      const src = path.join(BACKUP_DIR, name)
      if (!exists(src)) throw new Error('备份不存在')
      fs.unlinkSync(src)
      return { ok: true, removed: name }
    }
    case 'restoreBackup': {
      const name = String(body.name || '')
      if (!name) throw new Error('缺少备份文件名')
      // Same guard as delete: the name is unpacked into a path, so a separator or
      // a parent reference in it would reach outside the backup directory.
      if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('非法的备份文件名')
      const parts = name.split('__')
      if (parts.length < 3) throw new Error('无法解析备份名')
      const target = path.join(CARD_DIR, parts.slice(2).join('__'))
      if (!target.startsWith(CARD_DIR)) throw new Error('备份目标不在卡片目录内')
      const src = path.join(BACKUP_DIR, name)
      if (!exists(src)) throw new Error('备份不存在')
      backupFile(target, 'before-restore')
      copyFile(src, target)
      pruneBackups()
      return { ok: true, target }
    }
    case 'manualBackup':
      return { ok: true, result: manualBackup() }
    case 'prune':
      return { ok: true, result: pruneBackups() }
    case 'verifyIndex': {
      const token = String(body.token !== undefined ? body.token : (db.cfg && db.cfg.indexToken) || '').trim()
      if (!token) return { ok: true, configured: false, loggedIn: false }
      // An expired token admits it on its face, so the common failure is reported
      // without a round trip, and with the date the user has to act on.
      const expiry = tokenExpiry(token)
      const expiresAt = expiry ? expiry.toISOString() : null
      if (expiry && expiry.getTime() <= Date.now()) {
        return { ok: true, configured: true, loggedIn: false, expired: true, expiresAt, loginUrl: INDEX_LOGIN }
      }
      try {
        const raw = await fetchText(`${INDEX_API}/auth/checkauth`, 30000, {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        })
        let parsed = {}
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = {}
        }
        const loggedIn = parsed.loggedIn === true
        return {
          ok: true,
          configured: true,
          loggedIn,
          expiresAt,
          loginUrl: loggedIn ? '' : INDEX_LOGIN,
        }
      } catch (e) {
        const message = e && e.message ? e.message : String(e)
        return {
          ok: true,
          configured: true,
          loggedIn: false,
          expiresAt,
          loginUrl: INDEX_LOGIN,
          error: /HTTP 401|HTTP 403/.test(message) ? '令牌无效或已过期' : message,
        }
      }
    }
    case 'openFolder': {
      const target = String(body.path || CARD_DIR)
      if (!exists(target)) throw new Error(`目录不存在：${target}`)
      const run = await openInFileManager(target)
      if (!run.ok && run.stderr) throw new Error(run.stderr.split('\n')[0])
      return { ok: true, target }
    }
    case 'selfcheck':
      return { ok: true, result: runSelfCheck() }
    case 'checkUpdate':
      return checkSelfUpdate(!!body.force)
    default:
      throw new Error(`未知操作: ${action || '(空)'}`)
  }
}

function registerRoutes(ctx) {
  const routes = [
    {
      // Card avatar thumbnail: `?path=<card json>` resolves the matching PNG.
      path: '/dsh-card-updater/avatar',
      handler: async (request, response) => {
        if (request.method !== 'GET') return response.writeHead(405, { allow: 'GET' }).end()
        try {
          const url = new URL(request.url || '/', 'http://127.0.0.1')
          const shot = await avatarThumb(url.searchParams.get('path') || '')
          if (!shot) {
            response.writeHead(404, { 'cache-control': 'no-store' })
            response.end()
            return
          }
          response.writeHead(200, {
            'content-type': shot.contentType,
            'content-length': shot.buffer.length,
            // Keyed by the caller's path string; the file itself is content-stable.
            'cache-control': 'public, max-age=86400',
          })
          response.end(shot.buffer)
        } catch (e) {
          response.writeHead(500).end(String(e && e.message ? e.message : e))
        }
      },
    },
    {
      // Manual file picker: `?path=<dir>` lists one directory; omitting it
      // starts at the card directory.
      path: '/dsh-card-updater/list',
      handler: async (request, response) => {
        if (request.method !== 'GET') return response.writeHead(405, { allow: 'GET' }).end()
        try {
          const url = new URL(request.url || '/', 'http://127.0.0.1')
          sendJson(response, 200, listDirEntries(url.searchParams.get('path')))
        } catch (e) {
          sendJson(response, 500, { ok: false, error: e && e.message ? e.message : String(e) })
        }
      },
    },
    {
      path: '/dsh-card-updater/state',
      handler: async (request, response) => {
        if (request.method !== 'GET') return response.writeHead(405, { allow: 'GET' }).end()
        try {
          sendJson(response, 200, statePayload())
        } catch (e) {
          sendJson(response, 500, { ok: false, error: String(e) })
        }
      },
    },
    {
      path: '/dsh-card-updater/action',
      handler: async (request, response) => {
        if (request.method !== 'POST') return response.writeHead(405, { allow: 'POST' }).end()
        try {
          const body = await readBody(request)
          sendJson(response, 200, await handleAction(body))
        } catch (e) {
          sendJson(response, 200, { ok: false, error: e && e.message ? e.message : String(e) })
        }
      },
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map((route) =>
      ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }, `dsh-card-updater: ${route.path}`),
    )
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
    }
  }, 'dsh-card-updater: http routes')
}

function syncTimer() {
  if (timerDispose) {
    try {
      timerDispose()
    } catch {
      /* ignore */
    }
    timerDispose = null
  }
}

/* ----------------------------------------------------------------- apply */

export function apply(ctx) {
  ensureDir(DATA_DIR)
  ensureDir(BACKUP_DIR)
  ensureDir(DL_DIR)
  loadConfig()

  if (!db.cfg.cards?.length) {
    const suggested = suggestConfig(null)
    if (suggested.cards.length) {
      db.cfg = normalizeCfg(suggested)
      saveConfig()
      log(`bootstrap config: ${db.cfg.cards.length} entries`)
    }
  } else {
    log(`config loaded: ${db.cfg.cards.length} entries`)
  }

  ctx.inject(['webServer'], (host) => {
    registerRoutes(host)
    syncTimer()
    // Pre-render avatars off the request path; failures are non-fatal.
    void warmAvatars().catch((e) => log('avatar warm failed:', e && e.message ? e.message : e))
    if ((db.cfg.autoCheckMinutes || 0) > 0 && host.interval) {
      const dispose = host.interval(() => {
        void runCheck(null).catch((e) => log('auto check failed:', e && e.message ? e.message : e))
      }, Math.max(1, db.cfg.autoCheckMinutes) * 60_000)
      timerDispose = dispose
    }
    log('http routes ready; fs/shell/web services available')
  })

  ctx.effect(() => () => syncTimer(), 'dsh-card-updater: timer')
}
