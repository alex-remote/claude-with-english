import type { WweBand } from '../../../types'

/** The band with nothing on it: before a message's first translation, and after it is sent. */
export const EMPTY_BAND: WweBand = {
  mode: 'none',
  target: '',
  source: '',
  marks: [],
  isOk: false,
  isPending: false,
  error: null,
  showTip: false,
  blocked: null,
}
