import type { FailureKind, TransportFailure } from './types'

// Every way a request fails, in the words the features show after
// “<动作>失败：” or F6's “译文暂不可用：” (docs/dev-plan.md › 服务层 ›
// 失败原因; drafts to be reviewed at the demo). Each stands alone after the
// colon, so a page it names takes the outer quotes “”.

/** Which service sent it: a Claude Code account has no API key to blame. */
export type Service = 'claude' | 'openai'

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
} as const

export type Described = { kind: FailureKind; reason: string }

export const badFormat: Described = { kind: 'bad-format', reason: REASONS.badFormat }
export const cancelled: Described = { kind: 'cancelled', reason: REASONS.cancelled }
export const notImplemented: Described = { kind: 'not-implemented', reason: REASONS.notImplemented }
export const generic: Described = { kind: 'other', reason: REASONS.generic }
export const timedOut: Described = { kind: 'timeout', reason: REASONS.timeout }

// The kinds Claude Code gives an API error about the account or its key
const AUTH_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'cloud_credential_error',
])

function describeApiError(service: Service, status: number | null, error: string): Described {
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

/**
 * A transport's failure in words. `isCancelled` is whether the caller no
 * longer wants the result: the engine answers a timeout and a cancel alike.
 */
export function describe(failure: TransportFailure, service: Service, isCancelled: boolean): Described {
  switch (failure.reason) {
    case 'aborted':
      return isCancelled ? cancelled : timedOut
    case 'api-error':
      return describeApiError(service, failure.status, failure.error)
    case 'empty-reply':
      return badFormat
    case 'reject':
      // A blocked model is the user's to change; any other refusal is a bug of ours
      return failure.cause === 'allowlist'
        ? { kind: 'model-unavailable', reason: REASONS.modelUnavailable }
        : { kind: 'invalid-request', reason: REASONS.generic }
  }
}
