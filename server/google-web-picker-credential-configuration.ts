export const WEB_PICKER_PROJECT_ID = 'durable-timing-399711' as const
export const WEB_PICKER_PROJECT_NUMBER = '716191827546' as const
export const WEB_PICKER_ORIGIN = 'http://127.0.0.1:4175' as const
export const WEB_PICKER_REDIRECT_URI = 'http://127.0.0.1:4175/oauth/google/callback' as const
export const WEB_PICKER_OAUTH_REFERENCE = 'andalucia-web-picker-oauth:web-production' as const
export const WEB_PICKER_API_KEY_REFERENCE = 'andalucia-web-picker-api-key:web-production' as const
export const WEB_PICKER_OAUTH_USERNAME = 'ANDALUCIA_OPERATION_WEB_PICKER_OAUTH' as const
export const WEB_PICKER_API_KEY_USERNAME = 'ANDALUCIA_OPERATION_WEB_PICKER_API_KEY' as const

export type WebOAuthCredential = { clientId: string; clientSecret: string }

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const stringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : []

export const validateWebOAuthDocument = (value: unknown): WebOAuthCredential => {
  const web = record(record(value)?.web)
  if (!web) throw new Error('WEB_OAUTH_CREDENTIAL_TYPE_INVALID')
  const clientId = typeof web.client_id === 'string' ? web.client_id.trim() : ''
  const clientSecret = typeof web.client_secret === 'string' ? web.client_secret.trim() : ''
  if (!clientId || !clientId.endsWith('.apps.googleusercontent.com')) throw new Error('WEB_OAUTH_CLIENT_ID_MISSING')
  if (!clientSecret) throw new Error('WEB_OAUTH_CLIENT_SECRET_MISSING')
  if (!stringArray(web.javascript_origins).includes(WEB_PICKER_ORIGIN)) throw new Error('WEB_OAUTH_ORIGIN_MISSING')
  if (!stringArray(web.redirect_uris).includes(WEB_PICKER_REDIRECT_URI)) throw new Error('WEB_OAUTH_REDIRECT_URI_MISSING')
  return { clientId, clientSecret }
}

export const validateWebPickerApiKey = (value: string) => {
  const candidate = value.trim()
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(candidate)) throw new Error('WEB_PICKER_API_KEY_INVALID')
  return candidate
}

export const safeWebPickerCredentialState = (input: { oauthStored: boolean; apiKeyStored: boolean; projectNumber?: string }) => ({
  WEB_OAUTH_CREDENTIAL_STORED: input.oauthStored,
  WEB_PICKER_API_KEY_STORED: input.apiKeyStored,
  WEB_PICKER_PROJECT_NUMBER_VALID: input.projectNumber === WEB_PICKER_PROJECT_NUMBER
})
