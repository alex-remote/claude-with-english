// F7: the addresses an OpenAI-compatible 请求地址 leads to. The field takes a
// Base URL (https://openrouter.ai/api/v1) or the full chat address
// (…/v1/chat/completions); either way the three come from the same base.

export type Endpoints = {
  chat: string
  models: string
  speech: string
}

/** Callers check `isHttpUrl` first; this only rewrites the address. */
export function endpoints(baseUrl: string): Endpoints {
  const base = baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  return {
    chat: `${base}/chat/completions`,
    models: `${base}/models`,
    speech: `${base}/audio/speech`,
  }
}

const AUTHORITY = /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]/?#]*\]|[^:/?#]*)/i

/**
 * The host name of an address, lowercased, without port or credentials; null
 * when it has none. A Key already saved is not sent to a new host until it is
 * saved again (获取模型列表 › 换了请求地址的域名).
 */
export function hostOf(url: string): string | null {
  const host = AUTHORITY.exec(url.trim())?.[1]
  return host ? host.toLowerCase() : null
}

export function isHttpUrl(url: string): boolean {
  const trimmed = url.trim()
  return /^https?:\/\/\S+$/i.test(trimmed) && hostOf(trimmed) !== null
}
