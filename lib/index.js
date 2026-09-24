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
/**
 * Tavern's own data root. The card workspace keeps one conversation per card
 * under `chats/`, and that is the only durable record of a card having been
 * looked at, so it is what the debug column reads.
 */
const TAVERN_DATA = path.dirname(RES_DIR)
const DATA_DIR = path.join(DSH_HOME, 'profile-data', 'tavern', 'data', 'tools', 'card-updater')
const CFG_FILE = path.join(DATA_DIR, 'config.json')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
/**
 * Where snapshots go unless the folder has been changed in the panel. Kept
 * inside this tool's own data directory so an untouched install stays
 * self-contained and nothing outside it is written to.
 */
const DEFAULT_BACKUP_DIR = path.join(DATA_DIR, 'backups')
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
  // On by default: when the two books disagree about an entry, the author's text
  // is taken. The copy's text at that point is normally the older release rather
  // than a local edit, and leaving it alone is what kept revisions from arriving.
  bookPreferOriginal: true,
  // Off by default: the copy's version number is the author's to set, and bumping
  // it here left four cards on this machine reading one version ahead of what the
  // author published — 0.5.5 became 0.5.6, V1.4 became V1.5. That drift then has
  // to be untangled by hand. A merge copies content; deciding what version the
  // card is belongs to the workspace, where the card is in front of you.
  autoBumpVersion: false,
  allowMvuUpdate: false,
  // Session for the community index backend. Thread release links are answered
  // only to a signed-in caller, so this is the one credential the watch needs;
  // it is read from the search site's own localStorage and never sent anywhere
  // except that backend.
  indexToken: '',
  // Where snapshots go. Empty means the default folder inside this tool's own
  // data directory, which is what a fresh install should do without being asked.
  backupDir: '',
  cards: [],
}

const db = { cfg: structuredClone(DEFAULT_CFG), lastReport: null, loaded: false }
let timerDispose = null

/**
 * The folder snapshots are written to.
 *
 * Read per call rather than captured once: the folder is a setting, and picking
 * a new one has to apply to the very next write instead of after a restart. The
 * default keeps a fresh install working with nothing configured.
 * @returns {string} the absolute folder to write snapshots into.
 */
function backupDir() {
  const custom = String((db.cfg && db.cfg.backupDir) || '').trim()
  return custom || DEFAULT_BACKUP_DIR
}

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

/**
 * Whether two values hold the same thing.
 *
 * Compared structurally rather than by `JSON.stringify`, because that form is
 * sensitive to the order the keys were inserted in: `{a:1,b:2}` and `{b:2,a:1}`
 * serialise differently and the string comparison called them different. In the
 * merge that reads as "the two cards disagree about this field", so an author's
 * value that had not actually changed was written over the copy's.
 *
 * Scalars keep the loose comparison the merge was written against, where `1` and
 * `'1'` count as the same value.
 * @param {unknown} a - left value.
 * @param {unknown} b - right value.
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return String(a) === String(b)
  if (typeof a !== 'object') return String(a) === String(b)
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readText(p) {
  return fs.readFileSync(p, 'utf8')
}

/**
 * Write a file so a reader never sees a half-written one: the text lands in a
 * sibling first and is then renamed over the target, which is atomic.
 *
 * The temporary name carries the process id and a random tail rather than a
 * timestamp. Two writes to the same file inside one millisecond — a `save`
 * arriving while a check is finishing — used to resolve to the same temporary
 * name, and the second write then renamed a file the first had already moved.
 * @param {string} p - destination path.
 * @param {string} content - text to write.
 * @returns {boolean} true.
 */
function writeText(p, content) {
  ensureDir(path.dirname(p))
  const tmp = `${p}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, p)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* the temporary file never existed, or is already gone */
    }
    throw e
  }
  return true
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p)
  } catch {
    return false
  }
}

/**
 * True when `p` is `root` itself or sits inside it.
 *
 * Case is folded on Windows, where two paths differing only in case are the
 * same folder. Comparing them as written made `isInside` answer "outside" for a
 * path the operator had typed with different capitalisation, and the guards
 * built on it — the one that keeps the backup folder out of the card directory —
 * then let that path through and wrote snapshots where the scanner reads cards.
 * @param {string} p - the path to test.
 * @param {string} root - the folder it may sit in.
 * @returns {boolean}
 */
function isInside(p, root) {
  if (!p || !root) return false
  const fold = (v) => {
    const s = path.resolve(v)
    return process.platform === 'win32' ? s.toLowerCase() : s
  }
  const a = fold(p)
  const b = fold(root)
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
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

/**
 * Run one asynchronous job per item, a few at a time.
 *
 * Windows refuses an unbounded number of open handles, and a backup folder can
 * hold a thousand files, so the pool is capped rather than letting every unlink
 * start at once. `next` is read and advanced without an await between the two,
 * which is what makes the shared counter safe on a single thread.
 * @param {Array<unknown>} items - the work list.
 * @param {number} limit - how many jobs may be in flight together.
 * @param {(item: unknown) => Promise<void>} job - the work, which catches its own errors.
 * @returns {Promise<void>}
 */
async function forEachLimited(items, limit, job) {
  if (!items.length) return
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await job(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Whether two files hold the same bytes.
 *
 * Size first, which rejects almost every mismatch without reading anything, then
 * a byte comparison. Used when two folders already hold a file of the same name:
 * the name is not evidence that the contents match, and deleting one of them on
 * the strength of the name is how a folder move loses a snapshot.
 * @param {string} a - first file.
 * @param {string} b - second file.
 * @returns {boolean}
 */
function identical(a, b) {
  try {
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    if (sa.size !== sb.size) return false
    if (sa.size === 0) return true
    return fs.readFileSync(a).equals(fs.readFileSync(b))
  } catch {
    return false
  }
}

/**
 * Run one command and report how it went, without throwing on a non-zero exit.
 * @param {string} file - executable.
 * @param {string[]} args - argument vector; never interpreted by a shell.
 * @param {{ignoreExit?: boolean, timeoutMs?: number}} [opts] - `ignoreExit` treats
 *   any termination as success, for launchers that report a non-zero code even
 *   when they did what was asked.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
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
          // stdout is reported as well, since git says what it did there and a
          // caller reading a revision off it has nothing else to go on.
          stdout: String(stdout || ''),
          stderr: String(stderr || '') || (error ? String(error.message || error) : ''),
        })
      },
    )
  })
}

/**
 * Open a folder on Windows through the shell's own open verb.
 *
 * `explorer.exe <folder>` is the obvious route and it is not the one that works.
 * The folder does open, in a window this session never shows: measured on the
 * machine this was written for, one backup folder had thirty-one windows named
 * after it and not one of them was visible, so the panel reported success over a
 * folder nobody could see. `start` hands the path to the shell from inside the
 * calling process, and the window that comes back is a normal visible one: the
 * same thing a user gets by typing `start <folder>` in a console.
 *
 * The path travels as its own argv element and Node quotes it, so spaces and
 * ampersands inside a folder name stay inside the quotes and reach the shell as
 * part of the path. The empty argument before it is `start`'s title slot, which
 * has to be there or the quoted path is read as the title instead.
 * @param {string} target - absolute folder path.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
async function openViaWindowsShell(target) {
  // `start` is a cmd builtin, so it cannot be launched directly, and its exit
  // code is not a verdict on whether a window appeared.
  const run = await runCommand('cmd.exe', ['/c', 'start', '', target], { ignoreExit: true })
  if (run.stderr) log('shell open reported:', run.stderr.trim().slice(0, 200))
  return run
}

/**
 * Hand a folder to the desktop's file manager. Each platform gets its own verb:
 * the shell on Windows, `open` on macOS, and `xdg-open` on Linux, which is what
 * a desktop session there listens on.
 * @param {string} target - absolute path.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
function openInFileManager(target) {
  if (process.platform === 'darwin') return runCommand('open', [target])
  if (process.platform === 'win32') return openViaWindowsShell(target)
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

/**
 * Machinery a content field can carry that the author's original cannot know
 * about. The MVU copy runs a status bar, so its greetings tend to hold the
 * placeholder that draws it, the variable syntax that feeds it, or a whole
 * front-end script. A merge takes the author's value for every content field,
 * and for one of these that deletes the very thing the copy exists to run.
 */
const MVU_OWNED =
  /StatusPlaceHolder|<mvu[\s/>-]|mvu-status|TavernHelper|stat_data|<script|<style|\{\{\s*(?:get|set)var/i

function fieldCarriesMvu(value) {
  if (value === undefined || value === null) return false
  const text = Array.isArray(value) ? value.join('\n') : String(value)
  return MVU_OWNED.test(text)
}

/**
 * A script from the author's card that assumes the model writes the state into
 * its own output: a status bar to expand, a UI block to render, a JSON body to
 * parse.
 *
 * Converting a card moves all of that into the background settlement, so putting
 * one of these back does not restore a feature, it takes the card off its rails.
 * The cases measured in the card workspace were a script demanding `<update>` and
 * a JSON Patch, an opening script that fights the MVU opening entry, and status
 * bars claiming the placeholder the MVU view owns — where the two watch one
 * placeholder and script order decides which is ever seen.
 */
const AUTHOR_OUTPUT_PROTOCOL =
  /StatusPlaceHolder|<mvu[\s/>-]|mvu-status|状态栏|输出格式|输出协议|【GAME-START】|<update>|JSON ?Patch|json_patch/i

function looksLikeOutputProtocol(rule) {
  const text = [rule.scriptName, rule.findRegex, rule.replaceString].map((v) => String(v ?? '')).join('\n')
  return AUTHOR_OUTPUT_PROTOCOL.test(text)
}

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

/**
 * A stable name for one world book entry, so a record of what a merge put there
 * survives the author reordering or renumbering their book. The id is what both
 * sides already match on; the name is the fallback for an entry carrying none.
 */
function bookEntryKey(entry, idx) {
  if (!entry) return null
  if (entry.id !== undefined && entry.id !== null) return `i${entry.id}`
  if (entry.name !== undefined && entry.name !== null) return `n${entry.name}`
  return `x${idx}`
}

/**
 * Fingerprint every entry of a world book.
 *
 * Kept on the config entry after each merge so the next one can tell "the copy
 * still holds exactly what we put there" from "someone edited this". That is the
 * whole difference between following the author and overwriting the user: both
 * look like an entry whose text differs from the new original.
 * @param {object} book - a `character_book`.
 * @returns {Record<string, string>} entry key to content hash.
 */
function bookSnapshot(book) {
  const out = {}
  const entries = book && Array.isArray(book.entries) ? book.entries : []
  entries.forEach((e, idx) => {
    const key = bookEntryKey(e, idx)
    if (key) out[key] = hashText(JSON.stringify(e && e.content !== undefined ? e.content : ''))
  })
  return out
}

/**
 * Entries that carry a variable-system protocol rather than lore.
 *
 * Converting a card replaces the author's variable protocol wholesale. DSH
 * settles variables through `mvu_submit_update`, with absolute paths and
 * `replace / delta / insert / add / remove` semantics, read-only derived fields
 * and a growth table; a plain card asks the model to print `<update>` and a JSON
 * Patch instead, and its initial values are YAML without the `$meta` markers the
 * MVU engine needs. The two are not interchangeable: copying the author's rule
 * over the copy's does not "follow the new card", it unplugs settlement.
 *
 * What is worth taking from the author's version is the lore inside it — the
 * factions, the clocks, the rules that describe the world. That is a reading
 * job, not a string job, so these entries are held rather than swapped and the
 * log says so.
 */
const MVU_PROTOCOL =
  /mvu_submit_update|\[mvu_update\]|\[initvar\]|变量更新规则|变量初始化|变量输出格式/i

function isProtocolEntry(entry) {
  if (!entry) return false
  const head = String(entry.content || '').slice(0, 4000)
  return MVU_PROTOCOL.test(String(entry.comment || '')) || MVU_PROTOCOL.test(head)
}

/**
 * Merge the author's world book into the copy's.
 * @param {object} mvuBook - the book as the copy has it.
 * @param {object} plainBook - the book as the author ships it.
 * @param {boolean} preferOriginal - take the author's text for an entry both
 *   sides have with different content. Off means an entry the two disagree about
 *   always keeps the copy's text, which is what stopped the author's revisions
 *   from arriving at all.
 * @param {Record<string, string>} [seen] - fingerprints from the last merge. An
 *   entry that still matches its fingerprint is one nobody has touched, so the
 *   author's new text replaces it; an entry that does not match is the user's own
 *   work and is left alone. Without any record every disagreement counts as
 *   untouched, since the copy is a conversion of an older release rather than
 *   something the user was ever asked about.
 * @param {boolean} [adopt] - the caller already holds a private copy of `mvuBook`
 *   and lets this one modify it in place. Copying it again was the single largest
 *   cost of merging a large card: measured on a 16.8 MB card, 9.9 ms of a 21 ms
 *   merge was spent re-copying a world book that had just been copied as part of
 *   the payload. Without this flag the book is copied, as before.
 * @returns {{book: object, res: {added: number, updated: number, refreshed: number,
 *   conflicts: string[], held: string[], parked: string[]}}}
 */
function mergeBook(mvuBook, plainBook, preferOriginal, seen, adopt) {
  const res = { added: 0, updated: 0, refreshed: 0, conflicts: [], held: [], parked: [], duplicates: [] }
  if (!plainBook || !Array.isArray(plainBook.entries)) return { book: mvuBook, res }

  const record = seen && typeof seen === 'object' ? seen : null

  const usable = mvuBook && typeof mvuBook === 'object'
  const base = usable
    ? adopt
      ? mvuBook
      : clone(mvuBook)
    : { name: plainBook.name || '', entries: [] }
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
      const fresh = clone(src)
      // An author-side protocol entry with no matching slot on the copy is kept
      // for reference and switched off. Leaving both live hands the model two
      // rule sets for one variable system.
      if (isProtocolEntry(fresh)) {
        fresh.enabled = false
        res.parked.push(String(src.comment || src.name || ''))
      }
      base.entries.push(fresh)
      res.added++
      return
    }
    if (deepEqual(target.content, src.content) && deepEqual(target.keys, src.keys)) return
    // The copy's own protocol entry is never taken from the author, whatever the
    // fingerprints say. Its content may still be worth reading across by hand.
    if (isProtocolEntry(target)) {
      res.held.push(String(target.comment || target.name || ''))
      return
    }
    const targetEmpty = !target.content || !String(target.content).trim().length
    if (targetEmpty) {
      target.content = clone(src.content)
      target.keys = clone(src.keys)
      if (src.comment !== undefined) target.comment = clone(src.comment)
      res.updated++
      return
    }
    const key = bookEntryKey(target, idx)
    const now = hashText(JSON.stringify(target.content === undefined ? '' : target.content))
    const untouched = !record || !(key in record) || record[key] === now
    if (preferOriginal && untouched) {
      target.content = clone(src.content)
      target.keys = clone(src.keys)
      if (src.comment !== undefined) target.comment = clone(src.comment)
      res.refreshed++
    } else {
      res.conflicts.push(String(target.comment || target.name || `#${String(target.id ?? idx)}`))
    }
  })
  // Two entries with the same title but different ids both survive the merge, and
  // the model then reads the same lore twice. Seen on a real card after a bulk
  // update: a "关闭" entry ended up present twice, one of them forced constant.
  const seenTitles = new Map()
  for (const e of base.entries) {
    if (!e) continue
    const title = String(e.comment || e.name || '').trim()
    if (!title) continue
    if (!seenTitles.has(title)) seenTitles.set(title, [])
    seenTitles.get(title).push(e)
  }
  for (const [title, list] of seenTitles) {
    if (list.length < 2) continue
    const live = list.filter((e) => e.enabled !== false)
    res.duplicates.push(live.length > 1 ? `${title}（${live.length} 条同时启用）` : title)
  }

  return { book: base, res }
}

/**
 * Merge the author's card into the copy.
 * @param {object} mvuCard - the converted copy, as `loadCard` returned it.
 * @param {object} plainCard - the author's original, as `loadCard` returned it.
 * @param {string} strategy - `minimal`, `standard` or `full`.
 * @param {{preferOriginal?: boolean}} [opts] - `preferOriginal` lets the author's
 *   text win on a world book entry the two sides disagree about; see `mergeBook`.
 * @returns {{payload: object, changed: string[], details: object}}
 */
function mergeCards(mvuCard, plainCard, strategy, opts) {
  const settings = opts || {}
  const next = clone(mvuCard.payload) || {}
  const mvuData = next.data || {}
  const plainData = plainCard.data || {}
  const changed = []
  const details = { book: null, regexAdded: 0, strategy }

  // The log is a list of tags rather than prose: the panel renders them in the
  // reader's own language, and a host that hardcodes one language would show
  // Chinese to a reader who picked English.
  const fieldList = []
  const keptFields = []
  for (const field of PLAIN_FIELDS) {
    if (!(field in plainData)) continue
    if (deepEqual(mvuData[field], plainData[field])) continue
    // The copy's own name carries the marker that tells it apart from the
    // author's original. Taking the author's name would leave two entries in the
    // list reading exactly alike, with only the file line to separate them.
    if (field === 'name' && /MVU/i.test(String(mvuData.name || ''))) {
      keptFields.push(field)
      continue
    }
    // And a field holding status-bar machinery keeps what the copy has. The
    // author's value is the same prose with the part that makes it work removed,
    // so taking it is what silently breaks the status bar.
    if (fieldCarriesMvu(mvuData[field]) && !fieldCarriesMvu(plainData[field])) {
      keptFields.push(field)
      continue
    }
    mvuData[field] = clone(plainData[field])
    fieldList.push(field)
  }
  if (fieldList.length) changed.push(`fields:${fieldList.join(',')}`)
  if (keptFields.length) changed.push(`kept:${keptFields.join(',')}`)

  if (strategy !== 'minimal' && plainData.character_book) {
    const merged = mergeBook(
      mvuData.character_book,
      plainData.character_book,
      settings.preferOriginal !== false,
      settings.bookSeen,
      // `mvuData` belongs to the clone of the payload made at the top of this
      // function, so the book is already private and does not need copying again.
      true,
    )
    mvuData.character_book = merged.book
    details.book = merged.res
    if (merged.res.added) changed.push(`book:+${merged.res.added}`)
    if (merged.res.updated) changed.push(`book:~${merged.res.updated}`)
    if (merged.res.refreshed) changed.push(`book:from:${merged.res.refreshed}`)
    if (merged.res.conflicts.length) changed.push(`book:kept:${merged.res.conflicts.length}`)
    if (merged.res.held.length) changed.push(`book:held:${merged.res.held.length}`)
    if (merged.res.parked.length) changed.push(`book:parked:${merged.res.parked.length}`)
    if (merged.res.duplicates.length) changed.push(`book:dup:${merged.res.duplicates.length}`)
  } else if (plainData.character_book && !mvuData.character_book) {
    mvuData.character_book = clone(plainData.character_book)
    changed.push('book:adopted')
  }

  const mvuExt = mvuData.extensions && typeof mvuData.extensions === 'object' ? mvuData.extensions : {}
  const plainExt =
    plainData.extensions && typeof plainData.extensions === 'object' ? plainData.extensions : {}

  for (const key of EXT_KEYS) {
    if (key in plainExt && !(key in mvuExt)) {
      mvuExt[key] = clone(plainExt[key])
      changed.push(`ext:${key}`)
    }
  }

  // A converted copy owns its script list.
  //
  // Converting a card reworks the author's scripts and drops the ones the MVU
  // machinery replaces: a status bar written for a plain card, a shop screen, a
  // history compressor. Copying the author's list back over the top returns all
  // of them, where they fight whatever the conversion put in their place, and
  // which one wins comes down to script order. Measured on this machine, one
  // card had six of them to re-add and another seven. So they are reported
  // rather than installed, and the permissive setting only takes one that no
  // part of the status-bar machinery mentions.
  const plainRegex = Array.isArray(plainExt.regex_scripts) ? plainExt.regex_scripts : null
  if (plainRegex) {
    const mvuRegex = Array.isArray(mvuExt.regex_scripts) ? mvuExt.regex_scripts : (mvuExt.regex_scripts = [])
    const seen = new Set(mvuRegex.filter((r) => r && r.scriptName).map((r) => String(r.scriptName)))
    const candidates = plainRegex.filter((r) => r && r.scriptName && !seen.has(String(r.scriptName)))
    details.newScripts = candidates.map((r) => String(r.scriptName))
    details.regexAdded = 0
    details.regexSkipped = candidates.length
    if (strategy === 'full') {
      const added = []
      const held = []
      for (const rule of candidates) {
        if (looksLikeOutputProtocol(rule)) {
          held.push(String(rule.scriptName))
          continue
        }
        mvuRegex.push(clone(rule))
        added.push(String(rule.scriptName))
      }
      details.regexAdded = added.length
      details.regexSkipped = candidates.length - added.length
      details.regexHeld = held
      if (added.length) changed.push(`regex:+${added.length}`)
    }
    if (details.regexSkipped) changed.push(`scripts:kept:${details.regexSkipped}`)
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
  if (raw.bookPreferOriginal !== undefined) cfg.bookPreferOriginal = !!raw.bookPreferOriginal
  if (raw.autoBumpVersion !== undefined) cfg.autoBumpVersion = !!raw.autoBumpVersion
  if (raw.allowMvuUpdate !== undefined) cfg.allowMvuUpdate = !!raw.allowMvuUpdate
  if (raw.indexToken !== undefined) cfg.indexToken = String(raw.indexToken || '')
  if (typeof raw.backupDir === 'string') cfg.backupDir = raw.backupDir.trim()

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
        'bookSeen',
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
    autoBumpVersion: existing?.autoBumpVersion === true,
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
  // `@me` is what a direct-message thread looks like, and the lookup writes that
  // form when the thread carries no guild. Matching digits only meant a link the
  // plugin had just discovered could not be read back on the next check.
  const m = String(url || '').match(/discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d+)/i)
  if (!m) return null
  return { threadId: m[1], endpoint: `${INDEX_API}/search/thread/${m[1]}` }
}

/**
 * Flatten a thread record into the lines worth watching, plus the one structured
 * field that is worth more than all of them.
 *
 * The backend's shape is its own business and may change, so rather than
 * hard-coding a path this walks the payload and keeps the keys that carry the
 * answer wherever they sit. Whatever comes back has to survive the same version
 * scan as a web page, and the title is what feeds it.
 *
 * `latest_update.version` is read out separately. It is the number the index
 * itself tracks for the thread, so when it is filled in there is nothing to guess
 * at — no comparing a release date against a card version and hoping the larger
 * one wins. It is null for threads nobody has set it for, which is why the text
 * scan still runs as a fallback.
 * @param {unknown} payload - parsed response body.
 * @returns {{text: string, title: string, version: string|null}}
 */
function threadSummary(payload) {
  // Only what the author writes. The record also carries reply counts and the
  // time of the last message, and those move every time somebody posts, so
  // including them made the signature change on every reply and left the card
  // reading as updated while nothing about the card had changed. The update
  // timestamp is still read, a few lines below, where it counts as its own
  // signal instead of as a difference in this text.
  const wanted = /^(title|name|thread_name|thread_title|first_message_excerpt|description)$/i
  const lines = []
  const seen = new Set()
  let title = ''
  let version = null
  let updateAt = null
  const walk = (node, depth, insideUpdate) => {
    if (!node || depth > 6 || lines.length > 60) return
    if (Array.isArray(node)) {
      for (const v of node.slice(0, 20)) walk(v, depth + 1, insideUpdate)
      return
    }
    if (typeof node !== 'object') return
    const updateHere = insideUpdate || false
    for (const [key, value] of Object.entries(node)) {
      const inUpdate = updateHere || key === 'latest_update'
      if (key === 'version' && inUpdate && value !== null && value !== undefined && typeof value !== 'object') {
        const text = String(value).trim()
        if (text && !version) version = text
        continue
      }
      // The moment the author posted the message that carried the update. A fact
      // about the thread, not a number parsed out of prose.
      if (key === 'source_message_at' && inUpdate && typeof value === 'string' && !updateAt) {
        updateAt = value
      }
      if (typeof value === 'string' || typeof value === 'number') {
        if (!wanted.test(key)) continue
        const line = `${key}: ${value}`
        if (seen.has(line)) continue
        seen.add(line)
        lines.push(line)
        if (!title && /^(title|name|thread_name|thread_title)$/i.test(key)) title = String(value)
      } else {
        walk(value, depth + 1, inUpdate)
      }
    }
  }
  walk(payload, 0, false)
  return { text: lines.join('\n'), title, version, updateAt }
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
    // Trailing punctuation is part of how a card is named, not of its title:
    // "创世回廊！" appears on the index as "「创世回廊」", and searching with the
    // exclamation returns nothing at all. Only the tail is trimmed — punctuation
    // inside a name can be meaningful.
    .replace(/[\s！!。.，,、；;：:？?～~…·]+$/, '')
    .trim()
}

/**
 * Every term worth trying when looking a card up, most trustworthy first.
 *
 * A card's own `name` is not always what the author calls it. Measured on this
 * machine: the card filed as `来当小男友爆管人的米吧！` says `独占配信中v1.2` inside
 * itself, and its release thread announces it as `来当小男友爆管人的米吧！` —
 * the internal name and the title share not one character. Searching the card's
 * own name found nothing; the file name found the thread at once. That is the
 * ordinary shape of the problem, because a downloaded file is usually named
 * after the thread it came from, and that name is what the user keeps.
 *
 * So this answers with a list rather than one term, and the callers try each
 * until one of them matches the page. A marker the user typed still comes first:
 * it was typed for exactly this.
 * @param {object} entry - the config entry.
 * @returns {string[]} candidate terms, best first, without duplicates.
 */
function searchTermsOf(entry) {
  const out = []
  const add = (value) => {
    const raw = String(value == null ? '' : value)
      .replace(/\.json$/i, '')
      .trim()
    if (!raw) return
    const text = tidyTerm(raw) || raw
    if (text.length < 2) return
    const key = text.toLowerCase()
    if (out.some((t) => t.toLowerCase() === key)) return
    out.push(text)
  }

  add(entry.primary && entry.primary.match)

  const cardPath = String((entry.plain && entry.plain.path) || '').trim()
  if (cardPath && exists(cardPath)) {
    try {
      const card = loadCard(cardPath)
      add((card.data && card.data.name) || card.payload.name || '')
    } catch {
      // An unreadable card just falls through to the file-based guesses.
    }
  }

  // The file names, which is where the user's own wording lives, then the label.
  add(path.basename(cardPath))
  add(path.basename(String((entry.mvu && entry.mvu.path) || '')))
  add(entry.label)

  return out
}

/**
 * The single term to search with and to show, when only one can be had.
 * @param {object} entry - the config entry.
 * @returns {string} the best term, or '' when the card offers none.
 */
function searchTermOf(entry) {
  const terms = searchTermsOf(entry)
  return terms.length ? terms[0] : ''
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
  const terms = searchTermsOf(entry)
  if (!terms.length) return null
  // Recorded before the lookup runs and regardless of its outcome, so the
  // panel's manual search link offers the same wording either way.
  state.query = terms[0]
  if (state.url || !token) return null

  // Each name the card is known by gets a try, stopping at the first thread that
  // actually carries it. One query only — the card's own `name` — left a card
  // whose author titled the thread something else unfindable, which is the case
  // this list exists for.
  for (const query of terms) {
    const raw = await fetchText(
      `${INDEX_API}/search/suggestions?keyword=${encodeURIComponent(query)}&apply_preferences=true`,
      30000,
      { authorization: `Bearer ${token}`, accept: 'application/json' },
    )
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const threads = Array.isArray(parsed && parsed.threads) ? parsed.threads : []
    const needle = query.toLowerCase()
    const hit = threads.find((t) => String(t.title || '').toLowerCase().includes(needle))
    if (!hit || !hit.thread_id) continue

    state.url = hit.guild_id
      ? `https://discord.com/channels/${hit.guild_id}/${hit.thread_id}`
      : `https://discord.com/channels/@me/${hit.thread_id}`
    state.match = state.match || query
    // Kept so the panel's "search the index" link uses the wording that worked,
    // rather than one re-derived without access to the card file.
    state.query = query
    state.discoveredAt = nowIso()
    return { url: state.url, title: hit.title || '', query }
  }
  // Nothing matched. The first term stands as what to offer by hand, and the
  // rest are reported so the panel can propose them instead of a dead end.
  state.match = state.match || terms[0]
  return null
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
  const info = extractVersionInfo(text)
  return info ? info.value : null
}

/**
 * The newest number a page mentions, together with the label it came from.
 *
 * The two labels do not mean the same thing, so they are ranked rather than
 * pooled. "版本 5.3" states the card's version. "9.21更新" states when the release
 * was posted, and since a date is nearly always numerically larger, putting both
 * in one pool and taking the highest let a date stand in for a version — which
 * gave the right verdict while saying the wrong thing, and would call a card
 * updated every time an author edited the date alone.
 *
 * The caller is told which one it got, so a posting date can be reported as a
 * posting date instead of being printed as the card's version.
 * @param {string} text - visible page text.
 * @returns {{value: string, kind: 'version'|'date'}|null}} the number and its kind.
 */
function extractVersionInfo(text) {
  const body = String(text || '')
  // Same environment filter as before: a page often states which Tavern build it
  // was tested on, and that number outranks every card on the page.
  const environment = /(酒馆|tavern|sillytavern|模型|model|上下文|context|引擎|engine|node|python|browser)/i
  let sawLabel = false
  const collect = (re, skipEnvironment) => {
    const out = []
    let m
    while ((m = re.exec(body)) !== null) {
      sawLabel = true
      if (skipEnvironment) {
        // Only the characters immediately before the label are consulted. A long
        // window reaches back past the label it is judging: on "适用于酒馆
        // 1.12.0 版本 5.3" a twelve-character look-back saw 酒馆 and threw away
        // 5.3 as well, which is the version the line was actually stating. Six is
        // enough to catch "酒馆 version 1.12.0" and short enough not to swallow
        // the next clause. The window also stops at the start of the line, so a
        // line above cannot decide for the one below it.
        const lineStart = body.lastIndexOf('\n', m.index - 1) + 1
        if (environment.test(body.slice(Math.max(lineStart, m.index - 6), m.index))) continue
      }
      out.push(m[1] || m[2])
    }
    return out
  }
  const highest = (list) => {
    let best = null
    for (const v of list) if (best === null || compareVersions(v, best) > 0) best = v
    return best
  }

  // Read in two strengths, because the two labels do not mean the same thing.
  // "版本 5.3" is the card's version; "9.21更新" is the date the release was
  // posted, and a date is nearly always numerically larger than a version.
  // Pooling them and taking the highest let the date stand in for the version —
  // which happened to give the right verdict while saying the wrong thing, and
  // would report a new version every time an author edited the date alone.
  //
  // Up to ten non-digit characters may sit between label and number, since notes
  // are written as "版本更新记录：v1.2" as often as "版本: 1.2". The dot is
  // required, which is what keeps "更新了 3 张图" out. `beta` carries no trailing
  // boundary because it is glued to its number in "beta0.5.5". Authors also write
  // the marker the other way round — "【9.14更新 追加…】" — so the reversed order
  // (number first) is read as well for both strengths.
  const strong = /(?:\bversion\b|\bver\.?|\bbeta\.?|版本)[^\d\n]{0,10}v?(\d+(?:\.\d+){1,3})|\bv(\d+(?:\.\d+){1,3})/gi
  // `[ \t]*` rather than `\s*`: a newline between the number and the label means
  // they belong to different lines, and "适用于酒馆 1.12.0\n版本 5.3" would
  // otherwise pair the Tavern build with the version label on the next line.
  const strongTrailing = /(\d+(?:\.\d+){1,3})[ \t]*(?:版本)/gi
  const weak = /(?:\bupdate\b|更新|发布)[^\d\n]{0,10}v?(\d+(?:\.\d+){1,3})/gi
  const weakTrailing = /(\d+(?:\.\d+){1,3})[ \t]*(?:版更新|更新|发布)/gi

  const strongHits = [...collect(strong, true), ...collect(strongTrailing, true)]
  if (strongHits.length) return { value: highest(strongHits), kind: 'version' }

  const weakHits = [...collect(weak, true), ...collect(weakTrailing, true)]
  if (weakHits.length) return { value: highest(weakHits), kind: 'date' }

  if (sawLabel) return null

  // Nothing was labelled at all, so the bare scan is all there is. The lookbehind
  // keeps a fragment of a longer run out: without it, "0.5.5" also yields "5.5".
  const bare = body.match(/(?<![\d.])v?\d+\.\d+(?:\.\d+){0,3}\b/g) || []
  const value = highest(bare.map((b) => b.replace(/^v/i, '')))
  return value ? { value, kind: 'version' } : null
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
  // With no keyword there is nothing to tell this card's part of a page apart
  // from the rest of it, so nothing is claimed. Handing the whole body back
  // instead makes the caller hash the entire post, and on a busy thread every
  // reply then reads as an update to the card.
  if (!kw) return ''
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

/**
 * Take a snapshot of one card file.
 *
 * The name is `<ms>__<tag>__<card file>.json`, and the stamp is stepped forward
 * until it is free. Two snapshots of the same file inside one millisecond — the
 * pre-write pass and the restore that follows it — used to resolve to the same
 * name, so the second copy landed on the first and the folder kept one snapshot
 * where two were written. Stepping keeps the name a plain millisecond count, so
 * the retention pass reads it the same way it always did.
 * @param {string} p - the file to snapshot.
 * @param {string} tag - which operation this precedes.
 * @returns {string|null} the snapshot path, or null when there was nothing to copy.
 */
function backupFile(p, tag) {
  if (!p || !exists(p)) return null
  const dir = ensureDir(backupDir())
  const base = baseOf(p)
  let ms = Date.now()
  while (exists(path.join(dir, `${ms}__${tag}__${base}`))) ms += 1
  const dst = path.join(dir, `${ms}__${tag}__${base}`)
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
    // The index's own facts about the thread, when it has them.
    let threadVersion = null
    let threadUpdateAt = null
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
      threadVersion = summary.version
      threadUpdateAt = summary.updateAt
      if (!text) throw new Error('索引站没有返回这张贴子的信息')
    } else {
      text = stripHtml(raw)
    }
    if (!text) throw new Error('页面没有可读文本（可能需要登录才能查看）')

    // The link is the identity; the title is not.
    //
    // Authors rename their threads, and a keyword that used to appear in the
    // title stops matching the moment they do — which used to be reported as a
    // failure to locate the card, even though the link pointed straight at it.
    // So the keyword now only narrows the page when it is actually there to be
    // found. On a Discord thread the whole post belongs to this card anyway, so
    // a miss falls back to all of it. On a plain page that holds several cards
    // the keyword still does the locating, because there the scope is the only
    // thing separating one card from its neighbours.
    //
    // A card linked by hand never went through the lookup that fills the keyword
    // in, and an empty one used to leave the entire post treated as this card's
    // scope. Deriving it from the card is what the lookup would have done, and it
    // is written back so the panel can show which word is in use.
    //
    // Every name the card is known by gets a try and the first one the page
    // actually contains is the one that gets written back. Taking the card's own
    // `name` and stopping there — which is what this did — failed on a card the
    // author titled differently inside the file from how the thread announces it:
    // measured here, `独占配信中v1.2` against a thread reading `来当小男友爆管人的
    // 米吧！`, with not one character in common.
    const typed = String(state.match || '').trim()
    const candidates = []
    if (typed) candidates.push(typed)
    for (const term of searchTermsOf(entry)) if (!candidates.includes(term)) candidates.push(term)

    let keyword = typed || candidates[0] || ''
    let scoped = ''
    for (const term of candidates) {
      const found = scopeText(text, term)
      if (!found) continue
      keyword = term
      scoped = found
      break
    }
    if (scoped && keyword !== typed) {
      state.match = keyword
      state.query = keyword
    }
    const scope = scoped || (thread ? text : '')
    if (!scope) {
      throw new Error(
        candidates.length
          ? `页面上没有找到「${candidates.slice(0, 3).join('」「')}」，无法定位这张卡`
          : '这张卡没有可用的版本关键词，在普通发布页上无法确定哪一段属于它',
      )
    }

    // Everything is read from the scoped slice, signature included: on a page
    // holding several cards, a change anywhere else is not this card's news.
    //
    // The signature is only taken from a scope the keyword actually delimited. A
    // fallback scope is the whole thread, and a busy thread changes with every
    // reply, so hashing that would report the card as updated forever. With no
    // way to tell this card's part of the page from the rest, the version is left
    // to decide on its own.
    const sig = scoped ? hashText(scope) : state.sig || ''
    // The index's own version field wins whenever it is set. It is the number the
    // site tracks for this thread, so using it means never comparing a release
    // date against a card version and hoping the larger number is the right one.
    // Only when it is empty does the text scan run — and that scan reports whether
    // the number it found is a version or a posting date, so a date can be shown
    // as a date instead of being printed as the card's version.
    const info = threadVersion ? { value: threadVersion, kind: 'version' } : extractVersionInfo(scope)
    const version = info ? info.value : null
    const versionKind = info ? info.kind : null
    const gates = detectGates(scope)
    const first = !state.sig
    const changed = !!(scoped && !first && state.sig !== sig)
    // An author renaming their thread makes the title and the card disagree, while
    // the link underneath stays the same and still points at the right card. The
    // test is whether the title still contains the keyword that identifies this
    // card — not whether the title changed since last time, which never fires for
    // a rename that happened before the first check, and stays silent afterwards
    // because both reads see the new name. The link is the identity; this is only
    // about the label on top of it.
    const titleHasKeyword = !!(keyword && title && title.toLowerCase().includes(keyword.toLowerCase()))
    const renamed = !!(keyword && title && !titleHasKeyword)
    // The index records when the message carrying the latest update was posted.
    // That is a fact about the thread rather than a number parsed out of prose, so
    // it stands as its own signal that a release happened.
    const newUpdate = !!(threadUpdateAt && state.updateAt && threadUpdateAt !== state.updateAt)
    // The card's own `character_version` is the baseline. It says what this
    // machine actually has, and unlike the last number read off a page it does not
    // drift when an author edits their headline or re-dates a release. The
    // recorded page version is only a fallback, for cards that carry no version
    // of their own — which is the case the fallback exists for.
    let baseline = null
    try {
      const cardPath = entry.plain && entry.plain.path
      if (cardPath && exists(cardPath)) {
        const card = loadCard(cardPath)
        baseline = (card.data && card.data.character_version) || card.payload.character_version || null
      }
    } catch {
      baseline = null
    }
    if (!baseline) baseline = state.version || null

    // A version is compared as a version. A date is not: it says when the author
    // posted, not what the card contains, and reading "9.21" as a version that
    // beats "5.2" is a coincidence rather than a comparison — it would also call
    // a card updated when the author edited nothing but the date. So a date never
    // raises `newer` by itself. The update message time does, because a new
    // message from the author is an actual event.
    const comparable = versionKind === 'version' ? version : null
    const moved = !!(comparable && baseline && comparable !== baseline)
    let newer = moved ? compareVersions(comparable, baseline) > 0 : false
    if (!newer && newUpdate && !first) newer = true

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
    state.versionKind = versionKind
    state.updateAt = threadUpdateAt || state.updateAt || null
    state.renamedFrom = renamed ? keyword : null
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
      renamed,
      renamedFrom: renamed ? keyword : '',
      first,
      changed,
      newer,
      feed: feedNote,
      version,
      versionKind,
      baseline,
      updateAt: threadUpdateAt,
      newUpdate,
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
  ensureDir(backupDir())
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
  await pruneBackups()
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
/**
 * Point existing conversations at the card's new file name.
 *
 * Tavern stores each conversation's card as a path (`cards/<name>.json`), so
 * renaming the card leaves those paths dangling and the conversation reports that
 * its card is gone — while the card is sitting right there under a new name, and
 * every message is still on disk. There is no other way to say "same card, only
 * renamed": the alternative is opening the conversation and finding it unable to
 * load its card.
 *
 * @param {string} fromRel - the card's old path, relative to the card directory.
 * @param {string} toRel - its new one.
 * @returns {number} how many conversations were repointed.
 */
function repointChats(fromRel, toRel) {
  if (!fromRel || !toRel || fromRel === toRel) return 0
  const file = path.join(TAVERN_DATA, 'index.json')
  if (!exists(file)) return 0
  let doc
  try {
    doc = JSON.parse(readText(file))
  } catch (e) {
    log('chat index unreadable:', e && e.message ? e.message : e)
    return 0
  }
  const chats = Array.isArray(doc.chats) ? doc.chats : []
  const hits = chats.filter((c) => c && c.cardPath === fromRel)
  if (!hits.length) return 0

  // The name shown beside the conversation follows too. Tavern records the card's
  // own name here, not the file name, so it is read from the card. The stored path
  // is relative to the card directory, so the `cards/` prefix is stripped before
  // joining — keeping it would look for `cards/cards/…` and silently fall back.
  let label = ''
  try {
    const card = loadCard(path.join(CARD_DIR, String(toRel).replace(/^cards[/\\]/, '')))
    label = String((card.data && card.data.name) || card.payload.name || '').trim()
  } catch {
    label = ''
  }
  const fallback = toRel.replace(/^.*[/\\]/, '').replace(/\.json$/i, '')

  for (const chat of hits) {
    chat.cardPath = toRel
    if (chat.cardName) chat.cardName = label || fallback
  }
  try {
    // The index is Tavern's, so a copy goes aside before it is written. It is
    // small and rewritten often, which is exactly the shape of file that goes
    // wrong silently.
    backupFile(file, 'before-chat-repoint')
    writeText(file, JSON.stringify(doc, null, 2) + '\n')
  } catch (e) {
    log('chat index could not be written:', e && e.message ? e.message : e)
    return 0
  }
  return hits.length
}

/**
 * Move the pictures that belong to a card, so a rename does not orphan its avatar.
 *
 * Tavern pairs an avatar with a card by file name: a card at `cards/<stem>.json`
 * takes its picture from `originals/cards/<stem>.png` (and, less often, from a
 * file of the same stem sitting beside it). Renaming the card alone leaves the
 * picture under the old name, where nothing looks for it, and the card falls back
 * to a default avatar — which is a silent, visible loss, unlike a missing label.
 * @param {string} fromStem - the card's old file name, without extension.
 * @param {string} toStem - its new one.
 * @returns {string[]} the names of the pictures that moved.
 */
function moveCardImages(fromStem, toStem) {
  if (!fromStem || !toStem || fromStem === toStem) return []
  const moved = []
  for (const root of [ORIGINALS_DIR, CARD_DIR]) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const from = path.join(root, `${fromStem}${ext}`)
      const to = path.join(root, `${toStem}${ext}`)
      // Never overwrite: a picture already sitting under the new name is either
      // the right one already or somebody else's, and neither should be replaced.
      if (!exists(from) || exists(to)) continue
      try {
        fs.renameSync(from, to)
        moved.push(path.basename(to))
      } catch (e) {
        log('avatar rename failed:', e && e.message ? e.message : e)
      }
    }
  }
  return moved
}

/**
 * Bring a card's names in line with its files.
 *
 * A rename happens in pieces. The original file takes the release's name, but the
 * label, the search keyword and the MVU copy are separate strings, each written
 * back when the card went by its old name, and nothing connects them. Left alone
 * the panel shows one name, the index search looks for another, and the folder
 * holds a third. This runs them together so all three agree afterwards.
 *
 * The file name wins over the name recorded inside the card. Authors rename the
 * thread and the file the release ships with long before they remember the `name`
 * field, so the file is the more recent statement of what the card is called.
 * @param {object} entry - the configured card, mutated in place.
 * @param {{from: string, to: string}|null} renamed - the rename just performed, if any.
 * @returns {{label: string|null, keyword: string|null, mvu: string|null}} what moved.
 */
function syncNames(entry, renamed) {
  // `avatar` is a list of the picture files that ended up under the copy's name,
  // not a flag: the panel prints the note when the list is non-empty, and a bare
  // `true` has no `length`, so the note never appeared.
  const out = { label: null, keyword: null, mvu: null, mvuName: null, avatar: [], chats: 0 }
  const plainPath = String((entry.plain && entry.plain.path) || '')
  if (!plainPath) return out
  const stem = path.basename(plainPath).replace(/\.json$/i, '')
  if (!stem) return out

  // What the card calls itself wins over the file name.
  //
  // The file name is something the user renames freely, so it says whatever they
  // last typed. The name inside the card is what the author wrote, and it is what
  // the card reports to anything that opens it. When the two disagree the card is
  // the authority, and the file name is only a fallback for cards carrying no name
  // at all.
  let cardName = ''
  try {
    const card = loadCard(plainPath)
    cardName = String((card.data && card.data.name) || card.payload.name || '').trim()
  } catch {
    cardName = ''
  }
  const label = cardName || stem
  if (label !== entry.label) {
    entry.label = label
    out.label = label
  }

  // The keyword is what a search for this card looks like. Once the author renames
  // the thread, the old one matches nothing, and the check falls back to reading
  // the whole post.
  const keyword = String((entry.primary && entry.primary.match) || '').trim()
  if (keyword && !stem.includes(tidyTerm(keyword))) {
    const next = tidyTerm(stem)
    if (next.length >= 2 && next !== keyword) {
      entry.primary.match = next
      entry.primary.query = next
      out.keyword = next
    }
  }

  // The MVU copy follows the rename on three counts: its file name, its picture,
  // and the conversations that point at it. A copy whose name carries no marker is
  // left alone, since there is nothing there to tell a card name apart from the
  // rest of it.
  const mvuPath = String((entry.mvu && entry.mvu.path) || '')
  const mark = mvuPath
    ? path.basename(mvuPath)
        .replace(/\.json$/i, '')
        .match(/^(.*?)[\s_-]+(MVU.*)$/i)
    : null
  if (mvuPath && mark) {
    const wasStem = path.basename(mvuPath).replace(/\.json$/i, '')
    const nowStem = `${stem} ${mark[2]}`
    if (wasStem !== nowStem) {
      const nextMvu = path.join(path.dirname(mvuPath), `${nowStem}.json`)
      if (exists(nextMvu)) {
        log('sync: mvu copy kept its name, the new one already exists')
      } else {
        try {
          fs.renameSync(mvuPath, nextMvu)
          entry.mvu.path = nextMvu
          out.mvu = path.basename(nextMvu)
          // The MVU copy is the same card, so it takes the same picture. Carrying
          // its own old picture across would leave the previous release's art
          // sitting under the new name, which reads as an avatar that did not
          // update — the thing the user notices first.
          const fresh = path.join(ORIGINALS_DIR, `${stem}.png`)
          const target = path.join(ORIGINALS_DIR, `${nowStem}.png`)
          if (exists(fresh) && !exists(target)) {
            try {
              fs.copyFileSync(fresh, target)
              out.avatar = [path.basename(target)]
            } catch (e) {
              log('avatar copy failed:', e && e.message ? e.message : e)
              out.avatar = moveCardImages(wasStem, nowStem)
            }
          } else {
            out.avatar = moveCardImages(wasStem, nowStem)
          }
          out.chats = repointChats(`cards/${wasStem}.json`, `cards/${nowStem}.json`)
        } catch (e) {
          log('sync: mvu rename failed:', e && e.message ? e.message : e)
        }
      }
    }
  }

  // Give the MVU copy's own name the marker its file name already carries.
  //
  // Cards are listed by the name inside them, so a copy whose internal name is
  // identical to the original's produces two entries the user cannot tell apart:
  // both read 创世回廊5.3, and only the file line underneath says which is which.
  // The copy is the user's own derived card rather than the author's original, so
  // writing a marker into its name is not editing someone else's text.
  const marker = mark ? mark[2] : ''
  if (mvuPath && marker) {
    try {
      const copy = loadCard(entry.mvu.path)
      const inner = String((copy.data && copy.data.name) || copy.payload.name || '').trim()
      if (inner && !/MVU/i.test(inner)) {
        const next = `${inner} ${marker}`
        if (copy.payload.data) copy.payload.data.name = next
        else copy.payload.name = next
        backupFile(entry.mvu.path, 'before-name-marker')
        // `payload` is the card inside the outer document — a workspace card keeps
        // it under `raw`, alongside `kind`, `version` and `meta`. Writing the
        // payload alone would discard the shell, so the whole document goes back.
        writeText(entry.mvu.path, JSON.stringify(copy.outer, null, 2))
        out.mvuName = next
      }
    } catch (e) {
      log('sync: mvu name marker failed:', e && e.message ? e.message : e)
    }
  }
  return out
}

async function importPlain(cardId, fromPath) {
  if (!db.loaded) loadConfig()
  const entry = findEntry(cardId)
  if (!entry) throw new Error(`未找到条目: ${cardId}`)
  const from = String(fromPath || '').trim()
  if (!from) throw new Error('未选择文件')
  if (!exists(from)) throw new Error(`文件不存在：${from}`)
  const target = entry.plain?.path
  if (!target) throw new Error('这张卡还没设置原版卡路径')

  // Picking the card that is already in place is not a mistake: the contents are
  // current, but the label, keyword and MVU name may still describe the old one.
  // That is the only way to ask for a sync without touching the card, and it is
  // what the user means when they pick that file.
  if (path.resolve(from) === path.resolve(target)) {
    const moved = syncNames(entry, null)
    if (moved.label || moved.keyword || moved.mvu) {
      entry.updatedAt = nowIso()
      saveConfig()
    }
    return { target, backup: null, from, version: null, bytes: 0, synced: moved, renamed: null }
  }

  const text = readText(from)
  const info = unwrapCard(text)
  const version =
    (info.payload?.data && info.payload.data.character_version) || info.payload?.character_version || null
  const cardName = String((info.payload?.data && info.payload.data.name) || info.payload?.name || '').trim()

  const dir = path.dirname(target)
  ensureDir(dir)
  ensureDir(backupDir())

  // Follow the release's own file name.
  //
  // Authors rename cards — 创世回廊 became 龙娘回廊 — and the file the user
  // imported carries the new name. Writing the new contents into the old file
  // leaves the folder describing a card that no longer goes by that name, and the
  // entry label disagreeing with what the card says about itself.
  //
  // Four cases, because the imported file is not always somewhere else: people
  // download a release straight into the card folder, so the new name often
  // already exists on disk and there is nothing to rename.
  const wantedName = path.basename(from)
  const wantedPath = path.join(dir, wantedName)
  const sameName = wantedName === path.basename(target)
  const fromIsWanted = path.resolve(from) === path.resolve(wantedPath)

  const backup = backupFile(target, 'before-import')
  const renamed = { from: '', to: '' }
  let current = target

  if (sameName) {
    writeText(target, text)
  } else if (fromIsWanted) {
    // The release was downloaded into the card folder under its own name: adopt
    // that file, and drop the old one now that its contents live on under the new
    // name. The backup above already holds what it was.
    current = wantedPath
    entry.plain.path = current
    renamed.from = path.basename(target)
    renamed.to = wantedName
    try {
      if (path.resolve(target) !== path.resolve(wantedPath)) fs.unlinkSync(target)
    } catch (e) {
      log('import: old file could not be removed:', e && e.message ? e.message : e)
    }
  } else if (exists(wantedPath)) {
    // A different file already sits under the new name. Overwriting it would be a
    // surprise, so the contents land in the current file and the name stays.
    log('import: kept the old file name, a different file already uses the new one')
    writeText(target, text)
  } else {
    writeText(wantedPath, text)
    current = wantedPath
    entry.plain.path = current
    renamed.from = path.basename(target)
    renamed.to = wantedName
    try {
      if (path.resolve(target) !== path.resolve(wantedPath)) fs.unlinkSync(target)
    } catch (e) {
      log('import: old file could not be removed:', e && e.message ? e.message : e)
    }
  }

  // The original's own picture moves first.
  //
  // Tavern pairs a picture with a card by file name, and the MVU copy's picture
  // is copied out of the original's. Running this after the sync below meant the
  // copy was asked for a picture that had not been moved yet, found none, and
  // fell through to moving whatever sat under the copy's own old name — which
  // left the renamed copy with no picture at all and showed it the default
  // avatar.
  const fromStem = renamed.to ? renamed.from.replace(/\.json$/i, '') : ''
  const toStem = renamed.to ? renamed.to.replace(/\.json$/i, '') : ''
  const moved = renamed.to ? moveCardImages(fromStem, toStem) : []

  // The MVU copy, the label and the keyword all follow the new name. They are
  // separate strings written at different times and nothing else ties them
  // together, so they are brought in line in one place.
  const synced = syncNames(entry, renamed.to ? renamed : null)

  if (renamed.to) {
    synced.avatar = moved
    // And the conversations that point at the old file name follow it, or they
    // report that their card is gone while it sits there under the new name.
    synced.chats = repointChats(`cards/${renamed.from}`, `cards/${renamed.to}`)
  }

  entry.plain.sig = hashText(text)
  entry.plain.lastUpdateAt = nowIso()
  entry.updatedAt = nowIso()
  entry.importedAt = nowIso()
  entry.importedFrom = from
  // The release has been taken, so whatever was pending no longer is.
  delete entry.pending
  // Same retention pass as every other write; without it, importing would be the
  // one path that lets the backup directory grow without bound.
  await pruneBackups()
  saveConfig()
  return {
    target: current,
    backup,
    from,
    version,
    bytes: text.length,
    name: cardName,
    renamed: renamed.to ? renamed : null,
    synced,
  }
}

async function mergeEntry(entry) {
  const plainPath = entry.plain?.path
  const mvuPath = entry.mvu?.path
  if (!plainPath) throw new Error('未配置原版卡文件')
  if (!mvuPath) throw new Error('未配置 MVU 版文件')

  const plain = loadCard(plainPath)
  const mvu = loadCard(mvuPath)
  const strategy = db.cfg.mergeStrategy || 'standard'
  const merged = mergeCards(mvu, plain, strategy, {
    preferOriginal: db.cfg.bookPreferOriginal !== false,
    bookSeen: entry.bookSeen,
  })

  if (db.cfg.autoBumpVersion !== false && plain.data.character_version !== undefined) {
    const bumped = bumpVersion(plain.data.character_version)
    if (bumped && !deepEqual(merged.payload.data.character_version, bumped)) {
      merged.payload.data.character_version = bumped
      merged.changed.push(`version:${bumped}`)
    }
  }

  ensureDir(backupDir())
  const backups = []
  // Nothing is written when the merge produced exactly what is already on disk.
  //
  // It always used to write, which cost a full rewrite of the card — 17 MB for
  // the largest one on this machine — plus a snapshot of the file it replaced,
  // on every press of the merge button, whether or not anything had changed. Two
  // presses in a row therefore produced two identical snapshots and pushed older
  // history out of the retention window for nothing. `changed` cannot decide
  // this: it also carries the "kept" reports, which describe what the merge
  // deliberately did not touch.
  const nextText = buildCardText(mvu.shell, mvu.outer, merged.payload)
  const wrote = nextText !== readText(mvuPath)
  if (wrote) {
    const mvuBackup = backupFile(mvuPath, 'mvu')
    if (mvuBackup) backups.push(mvuBackup)
    writeText(mvuPath, nextText)
  }

  let plainTarget = null
  if (entry.syncPlain === true && db.cfg.syncPlain !== false) {
    const plainText = buildCardText(plain.shell, plain.outer, merged.payload)
    if (plainText !== readText(plainPath)) {
      const plainBackup = backupFile(plainPath, 'plain')
      if (plainBackup) backups.push(plainBackup)
      writeText(plainPath, plainText)
      entry.plain.sig = hashText(JSON.stringify(merged.payload))
      entry.plain.lastUpdateAt = nowIso()
      plainTarget = plainPath
    }
  }

  // Timestamps describe a write, so they only move when there was one. A card
  // that reports having just been merged, every time the button is pressed and
  // nothing changed, is a record of pressing the button.
  if (wrote) {
    entry.mvu.sig = hashText(JSON.stringify(merged.payload))
    entry.mvu.lastUpdateAt = nowIso()
    entry.mergedAt = nowIso()
  }
  entry.lastMergeChanged = merged.changed
  // What the book holds now, so the next merge can tell an entry nobody has
  // touched from one the user edited. Written even when the book did not change,
  // since this is the first record for cards merged before the field existed.
  entry.bookSeen = bookSnapshot(merged.payload.data && merged.payload.data.character_book)
  entry.lastError = null
  if (entry.pending) delete entry.pending.plain
  await pruneBackups()

  // The copy's file name, its picture, the conversations pointing at it and its
  // four names all follow the original. Doing it here is what keeps a merge from
  // leaving the two entries reading alike, and it is idempotent: a card that is
  // already consistent is only read.
  let synced = null
  try {
    synced = syncNames(entry, null)
  } catch (e) {
    log('merge: name sync failed:', e && e.message ? e.message : e)
  }

  return {
    target: mvuPath,
    plainTarget,
    wrote,
    changed: merged.changed,
    strategy,
    newScripts: merged.details.newScripts || [],
    regexSkipped: merged.details.regexSkipped || 0,
    synced,
    book: merged.details.book
      ? {
          added: merged.details.book.added,
          updated: merged.details.book.updated,
          refreshed: merged.details.book.refreshed,
          conflicts: merged.details.book.conflicts.length,
          kept: merged.details.book.conflicts.slice(0, 12),
          held: merged.details.book.held.slice(0, 12),
          parked: merged.details.book.parked.slice(0, 12),
          duplicates: merged.details.book.duplicates.slice(0, 12),
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
 * The host's own folder chooser, captured once when the plugin is applied.
 *
 * DSH ships the chooser as a plugin family (`dsh-host-directory-picker-*`) and
 * `capability()` says which of the two shapes is installed: a `native` one is
 * the Win32 dialog the operator already knows, a `browse` one is an in-app
 * listing. Reading it once keeps every request free of a service lookup, and
 * lets the panel say up front which of the two this deployment has.
 */
let pickerCapability = null

/** What a listing answers with when it is the drive list rather than a folder. */
const DRIVE_LIST = '::drives'

/**
 * Every drive root this machine answers for.
 *
 * Windows has no "list the drives" call in Node, and the two shell routes to
 * one (`wmic`, `Shell.Application`) cost a process per request. Probing the
 * twenty-six roots costs a stat each and cannot be wrong about what exists.
 * @returns {Array<{name: string, path: string, type: string}>}
 */
function listDrives() {
  const out = []
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`
    try {
      if (fs.existsSync(root)) out.push({ name: root, path: root, type: 'drive' })
    } catch {
      /* a drive that cannot be probed is not one this list should offer */
    }
  }
  return out
}

/**
 * Read a typed folder the way the operator meant it.
 *
 * The box accepts what a copied path looks like: surrounding quotes, either
 * slash, `D:` for a whole drive, and a bare name read from the card directory.
 * An empty box is not an error, it asks for the drive list, which is the one
 * view that makes another disk reachable at all.
 * @param {string|undefined|null} raw - what the operator typed.
 * @returns {string} an absolute directory, or the drive-list marker.
 */
function resolveDirInput(raw) {
  const text = String(raw == null ? '' : raw)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
  if (!text) return DRIVE_LIST
  if (text === DRIVE_LIST) return DRIVE_LIST
  const out = /^[A-Za-z]:$/.test(text)
    ? `${text}\\`
    : path.isAbsolute(text)
      ? path.normalize(text)
      : path.resolve(CARD_DIR, text)
  // `path.normalize` keeps a trailing separator, and a folder whose own name
  // ends in one is its own parent, which turns "up" into a button that does
  // nothing. A drive root is the one separator that belongs where it is.
  if (!/^[A-Za-z]:[\\/]$/.test(out) && /[\\/]$/.test(out) && out.length > 1) {
    return out.replace(/[\\/]+$/, '')
  }
  return out
}

/**
 * The folder one step above, or the drive list at a drive root.
 *
 * `path.dirname('C:\\')` answers the root itself, so a root is exactly the
 * case with no folder above it, and the old constant answer was the card
 * directory, which meant "up" either did nothing or jumped somewhere
 * unrelated. The drive list is what makes another disk reachable at all.
 * @param {string} dir - an absolute directory.
 * @returns {string} the parent directory or the drive-list marker.
 */
function parentOf(dir) {
  if (dir === DRIVE_LIST) return DRIVE_LIST
  const up = path.dirname(dir)
  return up === dir ? DRIVE_LIST : up
}

/**
 * Directory listing for the manual file picker: card files first, then the
 * sibling folders, so the browser can both drill down and jump sideways.
 * @param {string} target - a typed path, an absolute directory, or empty.
 * @returns {{dir: string, parent: string|null, drives: boolean, entries: Array<{name: string, path: string, type: string}>, error?: string}}
 */
function listDirEntries(target) {
  const dir = resolveDirInput(target)
  if (dir === DRIVE_LIST) {
    return { dir: DRIVE_LIST, parent: null, drives: true, entries: listDrives() }
  }
  const out = { dir, parent: parentOf(dir), drives: false, entries: [] }
  try {
    if (!fs.statSync(dir).isDirectory()) {
      out.error = `not a folder: ${dir}`
      return out
    }
  } catch (e) {
    out.error = e && e.message ? e.message : String(e)
    return out
  }
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

/**
 * Tags this plugin writes into a snapshot name, plus the two an earlier revision
 * wrote.
 *
 * A folder that is not the default one may hold files of its own, so every read,
 * every prune and every move is limited to names carrying one of these tags.
 * Pointing the setting at a folder full of unrelated JSON must not put that JSON
 * in reach of the retention pass, which deletes.
 *
 * `plain-before-merge` and `before-rollback` are no longer written, but snapshots
 * carrying them can still be sitting in a folder. Leaving them out of this list
 * would have made those files invisible to the panel and immune to retention,
 * which is a worse outcome than the tag list being one entry longer than the set
 * of tags in use.
 */
const BACKUP_TAGS = new Set([
  'plain',
  'mvu',
  'manual',
  'before-import',
  'before-restore',
  'before-name-marker',
  'before-chat-repoint',
  'plain-before-merge',
  'before-rollback',
])

/**
 * Whether a bare file name is one of this plugin's snapshots, which are named
 * `<ms>__<tag>__<card file>.json`.
 * @param {string} name - a file name, no directory part.
 * @returns {boolean}
 */
function isBackupName(name) {
  const text = String(name || '')
  if (!/\.json$/i.test(text)) return false
  const parts = text.split('__')
  return parts.length >= 3 && /^\d{10,}$/.test(parts[0]) && BACKUP_TAGS.has(parts[1])
}

/**
 * A snapshot name from a request, checked before it is unpacked into a path.
 *
 * Two separate things are being kept out. A separator or a parent reference
 * would reach outside the backup folder. And a name this plugin never wrote —
 * the folder is a setting, and the operator's own files can sit in it — would
 * let a request delete or overwrite something that is not a snapshot at all.
 * The retention pass is careful about exactly that, and these two actions were
 * reaching past it: a request naming `notes.json` deleted the file.
 * @param {unknown} raw - the name as the browser sent it.
 * @returns {string} the checked name.
 */
function snapshotNameOrThrow(raw) {
  const name = String(raw == null ? '' : raw).trim()
  if (!name) throw new Error('缺少备份文件名')
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('非法的备份文件名')
  if (!isBackupName(name)) throw new Error('这不是本工具写出的备份文件')
  return name
}

/** Copies kept per card file before the oldest of that file is pruned. */
const BACKUP_KEEP_PER_FILE = 5
/**
 * Hard ceiling on the whole folder, as a guard against runaway growth.
 *
 * Raised from 400 at the operator's request. A snapshot of a card with a large
 * world book runs a couple of megabytes, so a full folder of these is worth a
 * few gigabytes on disk; that is the trade the ceiling is buying room for.
 */
const BACKUP_KEEP_TOTAL = 1000

/**
 * Automatic retention, counted per card file rather than per folder: each file
 * keeps its newest `BACKUP_KEEP_PER_FILE` snapshots, so adding cards never
 * evicts another card's history. The folder-wide ceiling only guards against
 * runaway growth, and the newest snapshot of every file is always pinned.
 * @returns {Promise<{removed: string[], kept: number, files: number}>}
 */
async function pruneBackups() {
  const out = { removed: [], kept: 0, files: 0 }
  let names
  try {
    names = fs
      .readdirSync(backupDir())
      .filter((n) => isBackupName(n))
      .sort()
  } catch {
    return out
  }

  const parse = (name) => {
    const parts = name.split('__')
    return { ms: Number.parseInt(parts[0], 10) || 0, tag: String(parts[1] || '').toLowerCase(), file: parts.slice(2).join('__') }
  }

  // Newest-first per file, so the first N seen for a file are the ones to keep.
  // The parsed stamp is kept beside each name so the ceiling pass below does not
  // have to split the same strings again.
  const infoByName = new Map()
  const byFile = new Map()
  names.forEach((name) => {
    const info = parse(name)
    infoByName.set(name, info)
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

  // Then enforce the folder-wide ceiling by dropping the oldest survivors. The
  // stamp comes out of the map built above rather than being parsed again inside
  // the comparator, which on a thousand-element sort re-split every name about
  // ten times over.
  const overCeiling = names.length - finalRemove.length - BACKUP_KEEP_TOTAL
  if (overCeiling > 0) {
    const oldestFirst = [...keep].sort((a, b) => infoByName.get(a).ms - infoByName.get(b).ms)
    finalRemove.push(...oldestFirst.slice(0, overCeiling))
  }

  // Deleted a few at a time rather than one after another: a full prune on this
  // machine removes about a thousand files, and serially that held the event loop
  // for 1.4 s, which the panel feels as a freeze while a card is being written.
  const dir = backupDir()
  await forEachLimited(finalRemove, 24, async (name) => {
    try {
      await fs.promises.unlink(path.join(dir, name))
      out.removed.push(name)
    } catch (e) {
      log('prune failed:', e && e.message ? e.message : e)
    }
  })
  out.kept = names.length - out.removed.length
  out.files = byFile.size
  return out
}

/**
 * Manual backup: snapshot every tracked card file on demand, so the user owns
 * the timing instead of relying only on the pre-write snapshots.
 * @returns {{items: Array<{path: string, backup: string|null}>, pruned: number}}
 */
async function manualBackup() {
  if (!db.loaded) loadConfig()
  ensureDir(backupDir())
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
  const pruned = await pruneBackups()
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

/** MIME type for a card image, by extension. */
function imageContentType(p) {
  const ext = path.extname(String(p || '')).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

/**
 * Serve a card avatar.
 *
 * Source images run 1–15 MB and are displayed at 48px, so this used to run a
 * system image tool to pre-scale them. That meant launching an external process
 * with a policy override and a command string assembled at runtime, which reads
 * to endpoint protection like a script launcher rather than a thumbnail
 * generator. The stylesheet already sets `object-fit: cover`, so the original is
 * handed over as-is and the browser does the scaling.
 * @param {string} cardPath - absolute path of the card JSON.
 * @returns {Promise<{buffer: Buffer, contentType: string} | null>}
 */
async function avatarThumb(cardPath) {
  const src = avatarCandidates(cardPath).find((p) => exists(p))
  if (!src) return null

  try {
    return { buffer: fs.readFileSync(src), contentType: imageContentType(src) }
  } catch {
    return null
  }
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

/* --------------------------------------------------- card workspace state */

/** Where Tavern lives, quoted at anyone running this plugin without it. */
const TAVERN_URL = 'https://github.com/flizzywine/dsh-tavern'

/** Last workspace scan, so a panel refresh does not re-read every conversation. */
const debugCache = { at: 0, data: null }
const DEBUG_CACHE_MS = 30_000
/**
 * How recently a workspace conversation has to have moved to count as running.
 *
 * A debug conversation appends to its journal on every turn, so a conversation
 * that wrote seconds ago is being worked on; calling that one "debugged" would
 * say the check is over while it is still going. The window is short on purpose:
 * the journal also stops moving the moment a turn finishes, so a long window
 * would keep reporting a finished conversation as running, which is the opposite
 * mistake and the more annoying one.
 */
const DEBUG_BUSY_MS = 2 * 60 * 1000

/**
 * What the Tavern card workspace has to say about each card.
 *
 * Every card gets a conversation under `data/chats`, and a conversation's newest
 * snapshot names the card it is bound to and the mode it runs in. A workspace
 * conversation (`card`) is the record of the card having been looked at; a play
 * conversation (`story`, `script`) is what the workspace's own debug entry is
 * opened from. Both are read straight off disk and nothing is written back: the
 * workspace owns this data, and a plugin guessing at it would eventually guess
 * wrong.
 * @returns {{at: string, cards: Record<string, {debugAt: string|null, sessionId: string|null}>}}
 *   entries keyed by card file name, which is all a snapshot records.
 */
/**
 * Whether DSH Tavern is here at all.
 *
 * Every card this plugin knows about comes out of Tavern's resource directory and
 * every action it takes writes back into it, so without Tavern there is nothing
 * to manage. Reporting that plainly beats an empty list that looks like a bug.
 * @returns {{installed: boolean, cardDir: string, dataDir: string, url: string}}
 */
function tavernPresence() {
  // Either half is enough: the data root appears the first time Tavern runs, and
  // the application directory appears as soon as it is installed. Requiring the
  // data root alone would call a fresh install missing, which is exactly the
  // person who needs the pointer.
  const appDir = path.join(DSH_HOME, 'apps', 'dsh-tavern')
  return {
    installed: exists(TAVERN_DATA) || exists(appDir),
    hasCards: exists(CARD_DIR),
    cardDir: CARD_DIR,
    dataDir: TAVERN_DATA,
    appDir,
    url: TAVERN_URL,
  }
}

function cardWorkspaceState() {
  const now = Date.now()
  if (debugCache.data && now - debugCache.at < DEBUG_CACHE_MS) return debugCache.data
  const cards = {}
  try {
    // chat id -> session id, so a conversation can be named the way the workspace
    // names it.
    const sessions = new Map()
    try {
      const map = JSON.parse(readText(path.join(TAVERN_DATA, 'sessions.json')))
      for (const [sessionId, chatId] of Object.entries(map || {})) sessions.set(String(chatId), String(sessionId))
    } catch {
      /* optional */
    }
    // The workspace publishes one index of its conversations carrying the card
    // binding, the mode, the last update, and the last time each was opened.
    // Opening is recorded when a conversation is actually selected, so "written
    // to since anyone opened it" is a fact rather than a guess — and reading one
    // file beats walking every conversation directory.
    //
    // Missing is not an error: the workspace writes this index once it has a
    // conversation to record, so a fresh install has none, and reading it the
    // strict way made every panel load log a scan failure that meant nothing.
    let index = { chats: [] }
    try {
      index = JSON.parse(readText(path.join(TAVERN_DATA, 'index.json')))
    } catch {
      /* no conversation has been started yet */
    }
    for (const chat of index.chats || []) {
      const name = chat && chat.cardPath ? path.basename(String(chat.cardPath)) : ''
      if (!name) continue
      const row =
        cards[name] || (cards[name] = { debugAt: null, sessionId: null, chats: 0, movedAt: 0, unread: false, recent: '' })
      const updated = Number(chat.updatedAt) || 0
      const opened = Number(chat.lastOpenedAt) || 0
      const mode = String((chat && chat.mode) || 'story')
      // A play conversation is what the workspace's debug entry opens from.
      if (mode === 'story' || mode === 'script') {
        if (!row.sessionId) row.sessionId = sessions.get(String(chat.id)) || null
        continue
      }
      row.chats++
      // Only the newest conversation per card decides this: an older one that was
      // never reopened says nothing about the card's current state.
      if (updated > row.movedAt) {
        row.movedAt = updated
        row.recent = String(chat.id)
        row.unread = updated > opened
      }
      if (updated && (!row.debugAt || updated > Date.parse(row.debugAt))) row.debugAt = new Date(updated).toISOString()
    }
    // The index records changes, not whether a conversation is still being written
    // to, so the newest conversation's journal is consulted for that.
    for (const row of Object.values(cards)) {
      let lastWrite = row.movedAt
      if (row.recent) {
        try {
          const jl = path.join(TAVERN_DATA, 'chats', row.recent, 'journals')
          for (const f of fs.readdirSync(jl)) {
            const m = fs.statSync(path.join(jl, f)).mtimeMs
            if (m > lastWrite) lastWrite = m
          }
        } catch {
          /* no journal yet: the index time stands in */
        }
      }
      row.busy = !!(lastWrite && now - lastWrite < DEBUG_BUSY_MS)
      // The card's newest debug conversation was written to after the last time
      // anyone opened it, and is not still being written to now.
      row.changed = !!(row.unread && !row.busy)
      delete row.movedAt
      delete row.unread
      delete row.recent
    }
  } catch (e) {
    log('card workspace scan failed:', e && e.message ? e.message : e)
  }
  const data = { at: new Date().toISOString(), cards }
  debugCache.at = now
  debugCache.data = data
  return data
}

/**
 * When each configured card file was last written, keyed by entry and slot.
 *
 * A debug record describes the card as it was at the time. Replacing the file —
 * picking another one, importing a release, updating the original — leaves that
 * record describing something that is no longer there, and the modification time
 * is what says so.
 * @returns {Record<string, number>} `entryId:slot` to milliseconds, 0 when unreadable.
 */
function cardFileTimes() {
  const out = {}
  for (const entry of db.cfg.cards || []) {
    for (const slot of ['plain', 'mvu']) {
      const p = entry[slot] && entry[slot].path
      if (!p) continue
      try {
        out[`${entry.id}:${slot}`] = fs.statSync(p).mtimeMs
      } catch {
        out[`${entry.id}:${slot}`] = 0
      }
    }
  }
  return out
}

/**
 * Which of an entry's configured files are no longer on disk.
 *
 * Deleting a card in Tavern removes the file, and nothing removes the entry that
 * points at it: the config is a list of paths, and a path that stops resolving
 * is indistinguishable from one that never did. The entry then sits in the panel
 * offering a check button whose only possible answer is a failure. One measured
 * here was a card deleted long before, with both slots gone and nothing in the
 * panel saying so.
 *
 * `gone` is true only when every slot the entry configures is missing. A card
 * with one slot left is half there, and its release link is still worth keeping.
 * @param {object} entry - a config entry.
 * @returns {{plain: boolean, mvu: boolean, configured: number, gone: boolean}}
 */
function missingOfEntry(entry) {
  const out = { plain: false, mvu: false, configured: 0, gone: false }
  for (const slot of ['plain', 'mvu']) {
    const p = String((entry && entry[slot] && entry[slot].path) || '').trim()
    if (!p) continue
    out.configured += 1
    if (!exists(p)) out[slot] = true
  }
  const missing = (out.plain ? 1 : 0) + (out.mvu ? 1 : 0)
  out.gone = out.configured > 0 && missing === out.configured
  return out
}

/**
 * Every entry with a file to report, keyed by entry id.
 *
 * Nothing uses this to delete anything on its own: a card on a disk that is not
 * plugged in looks exactly like a card that was deleted, and only one of those
 * two wants its release link thrown away. The panel is told, and the operator
 * decides.
 * @returns {Record<string, {plain: boolean, mvu: boolean, gone: boolean}>}
 */
function missingOfCards() {
  const out = {}
  for (const entry of db.cfg.cards || []) {
    const miss = missingOfEntry(entry)
    if (!miss.configured || (!miss.plain && !miss.mvu)) continue
    out[entry.id] = { plain: miss.plain, mvu: miss.mvu, gone: miss.gone }
  }
  return out
}

function statePayload() {
  if (!db.loaded) loadConfig()
  return {
    ok: true,
    config: db.cfg,
    lastReport: db.lastReport,
    cardDir: CARD_DIR,
    dataDir: DATA_DIR,
    backupDir: backupDir(),
    backupDirDefault: DEFAULT_BACKUP_DIR,
    // Retention travels with the state, not just with the backup list: the
    // line that explains it sits in the main panel, and reading it from here
    // keeps the sentence and the constants from drifting apart.
    keepPerFile: BACKUP_KEEP_PER_FILE,
    keepTotal: BACKUP_KEEP_TOTAL,
    // Which folder chooser this host has, so the panel can offer the system
    // dialog first and have an answer ready when it cannot.
    picker: pickerCapability && pickerCapability.kind ? pickerCapability.kind : null,
    files: listNames(CARD_DIR, (n) => /\.json$/i.test(n)),
    hashMode: 'sha256',
    // The installed version travels with every state load, so the header can
    // label itself before the first update check has run.
    version: selfVersion(),
    // Per-card debug state from the Tavern card workspace, cached for half a
    // minute so opening the panel repeatedly does not re-read every conversation.
    workspace: cardWorkspaceState(),
    // Whether the host this plugin is a companion to is present at all.
    tavern: tavernPresence(),
    // When each configured card file was last written, so a debug record older
    // than the file can be recognised as no longer describing it.
    fileTimes: cardFileTimes(),
    // Which configured files the disk no longer has, so the panel can say so
    // instead of showing an entry that looks ordinary and cannot work.
    missing: missingOfCards(),
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
 * Update the plugin from its own repository.
 *
 * Detection can already tell that a newer version exists, and pointing the user at
 * a releases page is the least useful possible answer to that: they came to the
 * plugin for it, and the plugin knows exactly what to do. It ships as a git
 * checkout when installed from source, so updating is a pull.
 *
 * `--ff-only` rather than a plain pull: a local edit should stop the update and
 * say so, not produce a merge commit nobody asked for. The revision is read before
 * and after, because "the pull succeeded" and "anything actually moved" are
 * different statements and the panel wants the second one.
 * @returns {Promise<{ok: boolean, before: string, after: string, changed: boolean, note: string}>}
 */
async function selfUpdate() {
  const dir = PLUGIN_DIR
  if (!dir || !exists(path.join(dir, '.git'))) {
    throw new Error('这个插件不是 git 检出，没法自动更新；请用 dsh plugin 重新安装')
  }
  const rev = async () => {
    const r = await runCommand('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 15000 })
    return r.ok ? r.stdout.trim() : ''
  }
  const before = await rev()

  const pull = await runCommand('git', ['-C', dir, 'pull', '--ff-only'], { timeoutMs: 120000 })
  if (!pull.ok) {
    const message = String(pull.stderr || pull.stdout || '').trim().split('\n')[0]
    throw new Error(message || 'git pull 失败')
  }

  const after = await rev()
  // The version reads from the file on disk, so it reflects the pull immediately,
  // but the update check caches its last answer for two minutes — long enough that
  // the panel would keep insisting a newer version exists right after installing
  // it. Clearing that cache makes the next check ask GitHub again.
  updateCache.at = 0
  updateCache.data = null
  return {
    ok: true,
    before,
    after,
    changed: !!before && before !== after,
    note: String(pull.stdout || '').trim().split('\n').slice(-1)[0] || '',
    version: selfVersion(),
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

/**
 * Point snapshots at a different folder.
 *
 * The folder is validated before it is stored, because every later write goes
 * through it and a bad path would otherwise only surface as a failed backup,
 * which is the worst moment to find out. Snapshots already in the old folder are
 * carried over by default: they are the rollback targets for the cards on disk,
 * and leaving them behind would silently split one history into two.
 * @param {string} raw - the folder the user picked; empty restores the default.
 * @param {boolean} move - carry the existing snapshots across.
 * @returns {{dir: string, previous: string, moved: number, kept: number, isDefault: boolean}}
 */
function runSetBackupDir(raw, move) {
  if (!db.loaded) loadConfig()
  const previous = backupDir()

  let text = String(raw || '').trim()
  if (text === '~') text = os.homedir()
  else if (text.startsWith('~/') || text.startsWith('~\\')) text = path.join(os.homedir(), text.slice(2))
  const next = text ? path.resolve(text) : DEFAULT_BACKUP_DIR

  // Two spellings of one folder are one folder. Comparing the strings made
  // `d:\backups` against `D:\backups` read as a move, so the plugin rebuilt the
  // folder, ran the whole copy pass over it and rewrote the setting for nothing.
  const same = (a, b) => a === b || (isInside(a, b) && isInside(b, a))
  const isDefault = same(next, DEFAULT_BACKUP_DIR)

  if (!same(next, previous)) {
    if (isInside(next, CARD_DIR) || isInside(next, RES_DIR)) {
      throw new Error('备份目录不能放在卡片目录里，否则备份会被当成人物卡')
    }
    if (isInside(next, previous)) throw new Error('新目录不能放在当前备份目录里面')
    ensureDir(next)
    let stat = null
    try {
      stat = fs.statSync(next)
    } catch {
      stat = null
    }
    if (!stat || !stat.isDirectory()) throw new Error(`${next} 不是目录`)
    // Write once now: a folder that cannot be written would otherwise only fail
    // at the next card write, which is the one moment a backup has to succeed.
    const probe = path.join(next, `.dsh-card-updater-write-test-${process.pid}`)
    try {
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
    } catch (e) {
      throw new Error(`这个目录写不进去：${e && e.message ? e.message : String(e)}`)
    }
  }

  let moved = 0
  let kept = 0
  const skipped = []
  // Only genuine snapshots travel, and only when asked: a folder that is not the
  // default one may hold the user's own files, and those are not this tool's.
  if (move && !same(next, previous)) {
    ensureDir(next)
    const names = listNames(previous, (n) => isBackupName(n))
    const failed = []
    // Copy everything first, delete the originals only once all of them landed.
    //
    // Copy-then-delete, rather than copying and deleting one file at a time, is
    // what makes an interrupted move recoverable: at no point does a snapshot
    // exist in neither folder, and running the move again picks up where it
    // stopped. The old code deleted each source as it copied, and then wrote the
    // new folder into the config even when a copy had failed — which left the
    // snapshots that never made it stranded in a folder nothing pointed at.
    const cleared = []
    for (const name of names) {
      const src = path.join(previous, name)
      const dst = path.join(next, name)
      if (exists(dst)) {
        // Same name, and possibly not the same file. Only the byte comparison
        // can say, and a name is not enough to delete somebody's snapshot over.
        if (identical(src, dst)) {
          kept += 1
          cleared.push(src)
        } else {
          skipped.push(name)
        }
        continue
      }
      try {
        copyFile(src, dst)
        moved += 1
        cleared.push(src)
      } catch (e) {
        failed.push(name)
        log('backup move failed:', name, e && e.message ? e.message : e)
      }
    }
    if (failed.length) {
      throw new Error(
        `有 ${failed.length} 个备份没能复制到 ${next}，原备份目录保持不变；修好之后可以再试一次（已复制的不会重复）：${failed
          .slice(0, 3)
          .join('、')}`,
      )
    }
    for (const src of cleared) {
      try {
        fs.unlinkSync(src)
      } catch (e) {
        log('backup source could not be removed:', src, e && e.message ? e.message : e)
      }
    }
  }

  // Keep the spelling that was already stored when the two are the same folder,
  // so asking for `D:\backups\` does not rewrite the setting into a different
  // form every time it is typed.
  db.cfg.backupDir = isDefault ? '' : same(next, previous) ? previous : next
  saveConfig()
  return { dir: next, previous, moved, kept, skipped, isDefault }
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
      const dir = backupDir()
      let all = []
      try {
        all = fs.readdirSync(dir).filter((n) => isBackupName(n))
      } catch {
        all = []
      }
      // One stat per snapshot, a few at a time. There can be a thousand of them,
      // and asking for their sizes one after another held the event loop for
      // 48 ms on this machine; the pool keeps the panel's own request from being
      // queued behind the answer to it.
      const rows = []
      await forEachLimited(all, 24, async (name) => {
        const parts = name.split('__')
        const ms = Number.parseInt(parts[0], 10)
        let size = 0
        try {
          size = (await fs.promises.stat(path.join(dir, name))).size
        } catch {
          size = 0
        }
        rows.push({
          name,
          tag: parts[1] || '',
          file: parts.slice(2).join('__'),
          size,
          at: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
          ms: Number.isFinite(ms) ? ms : 0,
        })
      })
      const items = rows
        .sort((a, b) => b.ms - a.ms)
        // As long as the ceiling makes the folder: retention already keeps it
        // under `BACKUP_KEEP_TOTAL`, and a restore picker that hides snapshots
        // the plugin is deliberately keeping is a dead end. The list was cut
        // to 200 while the ceiling was 400, so raising the ceiling alone would
        // have quietly hidden most of what it now keeps.
        .slice(0, BACKUP_KEEP_TOTAL)
      const bytes = items.reduce((sum, it) => sum + it.size, 0)
      return {
        ok: true,
        dir,
        defaultDir: DEFAULT_BACKUP_DIR,
        keepPerFile: BACKUP_KEEP_PER_FILE,
        keepTotal: BACKUP_KEEP_TOTAL,
        count: all.length,
        bytes,
        items,
      }
    }
    case 'deleteBackup': {
      const name = snapshotNameOrThrow(body.name)
      const src = path.join(backupDir(), name)
      if (!exists(src)) throw new Error('备份不存在')
      fs.unlinkSync(src)
      return { ok: true, removed: name }
    }
    case 'restoreBackup': {
      const name = snapshotNameOrThrow(body.name)
      const parts = name.split('__')
      const cardFile = parts.slice(2).join('__')
      const target = path.join(CARD_DIR, cardFile)
      // A snapshot may only be restored onto a file inside the card directory,
      // and never onto the directory itself.
      if (!isInside(target, CARD_DIR) || path.resolve(target) === path.resolve(CARD_DIR)) {
        throw new Error('备份目标不在卡片目录内')
      }
      const src = path.join(backupDir(), name)
      if (!exists(src)) throw new Error('备份不存在')
      backupFile(target, 'before-restore')
      copyFile(src, target)
      await pruneBackups()
      return { ok: true, target }
    }
    case 'manualBackup':
      return { ok: true, result: await manualBackup() }
    case 'pruneMissing': {
      // The one place an entry is removed for a reason other than the operator
      // pressing delete on it, and it still only removes entries that have
      // nothing left on disk. A half-there card keeps its entry, and so does a
      // card whose disk is simply not mounted: both still have something to
      // point at, and that something is the release link the operator typed.
      if (!db.loaded) loadConfig()
      const removed = []
      const kept = []
      for (const entry of db.cfg.cards || []) {
        if (missingOfEntry(entry).gone) removed.push(String(entry.label || entry.id))
        else kept.push(entry)
      }
      if (removed.length) {
        db.cfg.cards = kept
        saveConfig()
      }
      return { ok: true, removed: removed.length, labels: removed }
    }
    case 'prune':
      return { ok: true, result: await pruneBackups() }
    case 'setBackupDir':
      return { ok: true, result: runSetBackupDir(body.dir, body.move !== false) }
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
    case 'pickFolder': {
      // The host's own chooser, called here rather than through the browser
      // half's `uiWorkspace`: that facade resolves only for a plugin whose
      // cordis inject lists it, and when it does not the failure reads as
      // "no chooser on this host", which is a different problem. Asking the
      // capability directly makes the answer the chooser's own words.
      const cap = pickerCapability
      if (!cap || typeof cap.pick !== 'function') {
        return {
          ok: false,
          error: cap
            ? `this host's folder chooser is "${cap.kind}", which has no system dialog`
            : 'this host has no folder chooser plugin loaded',
        }
      }
      const controller = new AbortController()
      try {
        const picked = await cap.pick(controller.signal)
        return { ok: true, path: picked || null, cancelled: !picked }
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) }
      }
    }
    case 'openFolder': {
      const target = String(body.path || CARD_DIR)
      // The backup folder only appears once something has been written there,
      // but the link pointing at it is offered from the first frame. Creating
      // it beats refusing to open a folder nobody has needed yet.
      if (!exists(target)) ensureDir(target)
      const run = await openInFileManager(target)
      if (!run.ok) throw new Error(run.stderr || `打不开 ${target}`)
      return { ok: true, target }
    }
    case 'selfcheck':
      return { ok: true, result: runSelfCheck() }
    case 'checkUpdate':
      return checkSelfUpdate(!!body.force)
    case 'selfUpdate':
      return selfUpdate()
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
  // The two folders below come from settings, not from this plugin, and either
  // can name a disk that is not plugged in or a path Windows will not accept.
  // Creating them used to happen unguarded, so an unreachable backup folder threw
  // out of `apply` and the plugin never loaded at all — which takes away the very
  // panel the setting would be fixed in.
  try {
    ensureDir(backupDir())
  } catch (e) {
    log('backup folder could not be created:', e && e.message ? e.message : e)
  }
  try {
    ensureDir(DL_DIR)
  } catch (e) {
    log('download folder could not be created:', e && e.message ? e.message : e)
  }
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

  // The folder chooser is a hard dependency of nothing: a deployment without
  // one still has the panel's own browser, so a missing service must not keep
  // the plugin off the page. The capability is read once because it is stable
  // for the service lifetime, and the reply is logged because "which chooser
  // does this host actually have" is the first question a broken pick starts.
  ctx.inject(['directoryPicker'], (pickerHost) => {
    try {
      pickerCapability = pickerHost.directoryPicker.capability()
      const kind = pickerCapability && pickerCapability.kind ? pickerCapability.kind : 'unreported'
      log(`folder chooser: ${kind}`)
    } catch (e) {
      pickerCapability = null
      log('folder chooser unavailable:', e && e.message ? e.message : e)
    }
  })

  ctx.inject(['webServer'], (host) => {
    registerRoutes(host)
    syncTimer()
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
