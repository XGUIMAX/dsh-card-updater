/**
 * Test harness for the host half.
 *
 * `lib/index.js` is an ESM module for DSH and exports only `name` and `apply`,
 * so its merge engine, retention pass and path helpers are not reachable from a
 * test by importing it. Rather than export internals the shipped plugin does not
 * need, the module source is rewritten in memory: the `node:` imports come in as
 * parameters, the two `export` keywords come off, and every top-level binding is
 * handed back as one object.
 *
 * `DSH_HOME` is set before the module body runs, which is what makes the whole
 * thing sandboxable — every path the plugin derives (cards, backups, config,
 * chats) is built from it at module scope, so pointing it at a temporary
 * directory gives a test its own private install with no way to reach the real
 * one.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_DIR = path.resolve(HERE, '..')
export const HOST_FILE = path.join(PLUGIN_DIR, 'lib', 'index.js')

/**
 * Every `function` / `const` / `let` name a source text declares.
 *
 * Deliberately over-inclusive: a helper nested inside another function is picked
 * up too. That costs nothing because the generated accessor tests each name with
 * `typeof` before reading it, so a name that only exists in an inner scope comes
 * back `undefined` instead of throwing. Being over-inclusive is what reaches a
 * declaration that shares its line with a doc comment, which this file uses.
 */
function declaredNames(src) {
  const names = []
  const add = (n) => {
    if (n && !names.includes(n)) names.push(n)
  }
  for (const line of src.split(/\r?\n/)) {
    for (const m of line.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
    const decl = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (decl) add(decl[1])
    const cls = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (cls) add(cls[1])
  }
  return names
}

/**
 * Load the host half with `DSH_HOME` pointed at `sandboxHome`.
 * @param {string} sandboxHome - a directory to treat as `~/.dsh`.
 * @returns {Record<string, unknown>} every top-level host binding.
 */
export function loadHost(sandboxHome) {
  process.env.DSH_HOME = sandboxHome
  const raw = fs.readFileSync(HOST_FILE, 'utf8')
  if (/\bexport\s+default\b/.test(raw)) throw new Error('harness cannot rewrite a default export')
  const stripped = raw
    .replace(/^import\s[^\n]*?from\s+'node:[^']+'\s*$/gm, '')
    .replace(/^export\s+/gm, '')
  // `PLUGIN_DIR` is derived from `import.meta.url`, and keeping it pointed at the
  // real file is what lets the self-version read the real manifest.
  const fileUrl = 'file:///' + HOST_FILE.replace(/\\/g, '/')
  const src = stripped.replace(/import\.meta\.url/g, JSON.stringify(fileUrl))
  const names = declaredNames(src)
  const exposed = names
    .map((n) => `${JSON.stringify(n)}: typeof ${n} === 'undefined' ? undefined : ${n}`)
    .join(',')
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'fs',
    'os',
    'path',
    'crypto',
    'execFile',
    'fileURLToPath',
    `"use strict";\n${src}\n;return {${exposed}};`,
  )
  return factory(fs, os, path, crypto, execFile, fileURLToPath)
}

/* ------------------------------------------------------------- client half */

export const CLIENT_FILE = path.join(PLUGIN_DIR, 'client.js')

/**
 * A document just large enough to hold a stylesheet: a head, elements that
 * remember their attributes and text, and a `MutationObserver` that can be fired
 * by hand. Everything else the browser half does with the DOM is left to the
 * real browser; this exists so the style injector can be exercised without one.
 * @returns {{document: object, MutationObserver: Function, fire: Function, countStyles: Function}}
 */
export function createDom() {
  const makeElement = (tagName) => {
    const el = {
      tagName,
      attrs: {},
      textContent: '',
      parentNode: null,
      setAttribute(name, value) {
        el.attrs[name] = String(value)
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el)
      },
    }
    return el
  }
  const head = makeElement('head')
  head.children = []
  head.querySelector = (selector) => {
    const match = /^style\[([\w-]+)\]$/.exec(String(selector))
    if (!match) return null
    return head.children.find((child) => child.attrs[match[1]]) || null
  }
  head.appendChild = (node) => {
    node.parentNode = head
    head.children.push(node)
    return node
  }
  head.removeChild = (node) => {
    const at = head.children.indexOf(node)
    if (at >= 0) head.children.splice(at, 1)
    node.parentNode = null
    return node
  }

  const observers = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() {}
    disconnect() {}
  }

  return {
    document: { head, body: makeElement('body'), createElement: makeElement },
    MutationObserver: FakeMutationObserver,
    /** Pretend the head changed, which is what a real observer would be told. */
    fire() {
      for (const observer of observers) observer.callback([])
    },
    countStyles() {
      return head.children.filter((child) => child.attrs['data-dsh-card-updater']).length
    },
  }
}

/**
 * Load the browser half without a browser.
 *
 * `client.js` registers itself with `window.__ModuleLoader__.load({id, factory})`
 * and keeps everything inside that factory, so the only way in is to supply the
 * loader and let it hand the factory back. A stub `react` is enough: nothing in
 * here renders, the components are only asked to exist.
 *
 * The factory is rewritten so its last statement hands back every name it
 * declares under `__test`. That is the only addition to the shipped source, and
 * it is made to the text in memory, never to the file.
 * @returns {{client: object, internals: Record<string, unknown>, source: string, dom: object}} the module and its internals.
 */
export function loadClient() {
  const raw = fs.readFileSync(CLIENT_FILE, 'utf8')
  const names = declaredNames(raw)
  const exposed = names
    .map((n) => `${JSON.stringify(n)}: typeof ${n} === 'undefined' ? undefined : ${n}`)
    .join(',')
  const marker = /return \{ name: 'dsh-card-updater'/
  if (!marker.test(raw)) throw new Error('client half no longer ends with the expected export')
  const patched = raw.replace(marker, `return { __test: {${exposed}}, name: 'dsh-card-updater'`)

  let captured = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }
  const dom = createDom()
  // `document` and `MutationObserver` arrive as parameters so the module body's
  // own references resolve to this stub rather than to anything global.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'MutationObserver', patched)(fakeWindow, dom.document, dom.MutationObserver)
  if (!captured || typeof captured.factory !== 'function') throw new Error('client half did not register itself')

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    Fragment: 'Fragment',
  }
  const client = captured.factory((id) => {
    if (id === 'react') return react
    throw new Error(`unexpected require in the browser half: ${id}`)
  })
  return { client, internals: client.__test || {}, source: raw, react, dom }
}

/* ------------------------------------------------------------ test report */
export function createReport(title) {
  const state = { title, passed: 0, failed: 0, groups: [], failures: [], current: '' }
  const push = (line) => state.groups.push(line)
  return {
    state,
    group(name) {
      state.current = name
      push(`\n── ${name}`)
    },
    ok(name, cond, detail) {
      if (cond) {
        state.passed++
        push(`  ok   ${name}`)
      } else {
        state.failed++
        state.failures.push(`${state.current} / ${name}${detail === undefined ? '' : `\n       ${detail}`}`)
        push(`  FAIL ${name}${detail === undefined ? '' : `  → ${detail}`}`)
      }
    },
    eq(name, actual, expected) {
      const a = JSON.stringify(actual)
      const b = JSON.stringify(expected)
      this.ok(name, a === b, a === b ? undefined : `got ${a}, want ${b}`)
    },
    finish() {
      const { passed, failed, groups, failures } = state
      console.log(groups.join('\n'))
      console.log(`\n${'-'.repeat(60)}`)
      console.log(`${title}: ${passed} passed, ${failed} failed`)
      if (failures.length) {
        console.log('\nfailures:')
        for (const f of failures) console.log(`  - ${f}`)
      }
      return failed
    },
  }
}

/* -------------------------------------------------------------- sandbox fs */

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  return file
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** A card file in the Tavern workspace shape: `{kind, version, raw, meta}`. */
export function workspaceCard(data, extra) {
  return {
    kind: 'dsh-tavern',
    version: 1,
    raw: { spec: 'chara_card_v2', spec_version: '2.0', data, ...(extra || {}) },
    meta: { id: 'x', updatedAt: new Date(0).toISOString() },
  }
}

/** A bare V2 card, the shape an author publishes. */
export function v2Card(data) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data }
}

export function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
