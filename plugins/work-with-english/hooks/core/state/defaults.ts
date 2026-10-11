import type { WweBook, WwePane, WwePara, WweSaved } from '../../../types'

// The initial values of the `$.state` entries the M2 features add; register.tsx
// names them in its atoms, and tests start from them.

export const INITIAL_PANE: WwePane = {
  view: 'settings',
  tab: 'translate',
  svcTab: 'claude',
  statsRange: 'week',
  errors: {},
  confirm: null,
  rev: 0,
  replyLanguage: null,
  openaiList: null,
  elevenList: null,
  openaiFetch: { status: 'idle', error: null },
  elevenFetch: { status: 'idle', error: null },
  keyStale: false,
  systemVoices: null,
  trying: null,
  cache: { status: 'loading', kb: 0 },
  autoFocus: null,
}

export const NO_PARA: WwePara = { status: 'none', zh: null, error: null, shown: false }

export const UNKNOWN_SAVED: WweSaved = { status: 'unknown' }

export const EMPTY_BOOK: WweBook = {
  status: 'loading',
  words: [],
  sentences: [],
  anki: { link: 'unknown', reason: null, hasEverConnected: false, pendingWords: 0, pendingSentences: 0 },
}
