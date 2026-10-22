import type { WweBook, WweCard, WweCardSent, WwePane, WwePara, WweSaved, WweTasks } from '../../../types'

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

export const NO_TASKS: WweTasks = { lists: [], turn: 0, isShown: false }

export const NO_CARD: WweCard = { recap: '', ask: null, buttons: [] }

export const NOT_SENT: WweCardSent = { isCard: false }

export const EMPTY_BOOK: WweBook = {
  status: 'loading',
  words: [],
  sentences: [],
  anki: { link: 'unknown', reason: null, hasEverConnected: false, pendingWords: 0, pendingSentences: 0 },
}
