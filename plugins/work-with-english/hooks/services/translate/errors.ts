import type { FailureKind, TransportFailure } from './types'

// Every way a request fails, in the words the features show after
// “<动作>失败：” or F6's “译文暂不可用：” (docs/dev-plan.md › 服务层 ›
// 失败原因; drafts to be reviewed at the demo). Each stands alone after the
// colon, so a page it names takes the outer quotes “”.

/** Which service sent it: a Claude Code account has no API key to blame. */
export type Service = 'claude' | 'openai' | 'elevenlabs'

export const REASONS = {
  claudeAuth: 'Claude Code 账号未登录或登录已过期',
  apiKey: 'API Key 不对或已过期',
  quota: '请求太多或额度用完',
  timeout: '30 秒内没有结果',
  modelUnavailable: '这个模型不可用，请到“服务”页换一个',
  generic: '未知错误',
  badFormat: '返回的内容无法解析',
  network: '网络连接失败',
  cancelled: '已取消',
  notImplemented: '暂不支持这个翻译服务',
  keyStale: '请求地址换了域名，请到“服务”页重新输入 API Key',
  notConfigured: '服务还没有配置完成，请到“服务”页填写',
  unplayable: '音频无法播放',
  noVoice: 'ElevenLabs 账号里没有可用的声音',
} as const

export type Described = { kind: FailureKind; reason: string }

export const badFormat: Described = { kind: 'bad-format', reason: REASONS.badFormat }
export const cancelled: Described = { kind: 'cancelled', reason: REASONS.cancelled }
export const notImplemented: Described = { kind: 'not-implemented', reason: REASONS.notImplemented }
export const generic: Described = { kind: 'other', reason: REASONS.generic }
export const timedOut: Described = { kind: 'timeout', reason: REASONS.timeout }
export const network: Described = { kind: 'network', reason: REASONS.network }
/** F7: the address moved to another domain and the Key was not entered again, so it is not sent */
export const keyStale: Described = { kind: 'auth', reason: REASONS.keyStale }
export const notConfigured: Described = { kind: 'other', reason: REASONS.notConfigured }
export const unplayable: Described = { kind: 'bad-format', reason: REASONS.unplayable }
export const noVoice: Described = { kind: 'other', reason: REASONS.noVoice }

/** What the OpenAI-compatible transport answers instead of sending, while the Key is held back */
export type KeyStale = { ok: false; reason: 'stale-key' }

// The kinds Claude Code gives an API error about the account or its key
const AUTH_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'cloud_credential_error',
])

// Out of credit: OpenAI answers it with 429, ElevenLabs with 401
const QUOTA_CODES = new Set(['insufficient_quota', 'quota_exceeded'])

/** An HTTP status and the error code its body names, in words. */
export function describeApiError(service: Service, status: number | null, error: string): Described {
  if (QUOTA_CODES.has(error)) {
    return { kind: 'quota', reason: REASONS.quota }
  }
  if (status === 401 || status === 403 || AUTH_ERRORS.has(error)) {
    return { kind: 'auth', reason: service === 'claude' ? REASONS.claudeAuth : REASONS.apiKey }
  }
  if (status === 429 || error === 'rate_limit' || error === 'billing_error') {
    return { kind: 'quota', reason: REASONS.quota }
  }
  if (error === 'model_not_found') {
    return { kind: 'model-unavailable', reason: REASONS.modelUnavailable }
  }
  if (status === null) {
    return { kind: 'network', reason: REASONS.network }
  }
  return { kind: 'other', reason: `${status} ${error}`.trim() }
}

const textField = (value: unknown, name: string): string | null => {
  const field = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined
  return typeof field === 'string' && field !== '' ? field : null
}

/**
 * The short code an error body names: OpenAI's `error.code` or `error.type`,
 * ElevenLabs' `detail.status` or `detail.code`; '' when it names none.
 */
export function errorCodeOf(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return ''
  }
  const error = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).error : undefined
  const detail = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).detail : undefined
  return (
    textField(error, 'code') ??
    textField(error, 'type') ??
    textField(detail, 'status') ??
    textField(detail, 'code') ??
    ''
  )
}

/**
 * Why a list of models or voices could not be had, as “获取模型列表失败：”
 * and “获取模型和声音失败：” go on (F7, F8): a wrong Key names its status and
 * says to check it; an OpenAI-compatible list can also be typed by hand.
 */
export function describeListFailure(
  service: 'openai' | 'elevenlabs',
  described: Described,
  status: number | null,
): Described {
  if (described.kind === 'auth') {
    const head = `${status ?? ''} ${REASONS.apiKey}`.trim()
    return {
      kind: 'auth',
      reason: service === 'openai' ? `${head}，请检查 API Key 或勾选“手动填写”` : `${head}，请检查 API Key`,
    }
  }
  return service === 'openai' ? { ...described, reason: `${described.reason}，可以勾选“手动填写”` } : described
}

/**
 * A transport's failure in words. `isCancelled` is whether the caller no
 * longer wants the result: the engine answers a timeout and a cancel alike.
 */
export function describe(failure: TransportFailure | KeyStale, service: Service, isCancelled: boolean): Described {
  switch (failure.reason) {
    case 'aborted':
      return isCancelled ? cancelled : timedOut
    case 'api-error':
      return describeApiError(service, failure.status, failure.error)
    case 'empty-reply':
      return badFormat
    case 'stale-key':
      return keyStale
    case 'reject':
      // A blocked model is the user's to change; any other refusal is a bug of ours
      return failure.cause === 'allowlist'
        ? { kind: 'model-unavailable', reason: REASONS.modelUnavailable }
        : { kind: 'invalid-request', reason: REASONS.generic }
  }
}
