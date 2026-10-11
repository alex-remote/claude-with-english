import type { WwePane, WwePara } from '../../../types'

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
}

export const NO_PARA: WwePara = { status: 'none', zh: null, error: null, shown: false }
