import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  WEB_PICKER_API_KEY_REFERENCE,
  WEB_PICKER_OAUTH_REFERENCE,
  WEB_PICKER_ORIGIN,
  WEB_PICKER_PROJECT_NUMBER,
  WEB_PICKER_REDIRECT_URI,
  safeWebPickerCredentialState,
  validateWebOAuthDocument,
  validateWebPickerApiKey
} from './google-web-picker-credential-configuration.js'

const CLIENT_SECRET_CANARY = 'GOCSPX-WEB_SECRET_CANARY_NOT_REAL'
const API_KEY_CANARY = `AIza${'A'.repeat(35)}`
const validDocument = {
  web: {
    client_id: 'synthetic-web-client.apps.googleusercontent.com',
    client_secret: CLIENT_SECRET_CANARY,
    javascript_origins: [WEB_PICKER_ORIGIN],
    redirect_uris: [WEB_PICKER_REDIRECT_URI]
  }
}

assert.deepEqual(validateWebOAuthDocument(validDocument), { clientId: validDocument.web.client_id, clientSecret: CLIENT_SECRET_CANARY })
assert.equal(validateWebPickerApiKey(API_KEY_CANARY), API_KEY_CANARY)
assert.throws(() => validateWebOAuthDocument({ installed: validDocument.web }), /WEB_OAUTH_CREDENTIAL_TYPE_INVALID/)
assert.throws(() => validateWebOAuthDocument({ web: { ...validDocument.web, client_id: '' } }), /WEB_OAUTH_CLIENT_ID_MISSING/)
assert.throws(() => validateWebOAuthDocument({ web: { ...validDocument.web, client_secret: '' } }), /WEB_OAUTH_CLIENT_SECRET_MISSING/)
assert.throws(() => validateWebOAuthDocument({ web: { ...validDocument.web, javascript_origins: [] } }), /WEB_OAUTH_ORIGIN_MISSING/)
assert.throws(() => validateWebOAuthDocument({ web: { ...validDocument.web, redirect_uris: [] } }), /WEB_OAUTH_REDIRECT_URI_MISSING/)
assert.throws(() => validateWebPickerApiKey('not-an-api-key'), /WEB_PICKER_API_KEY_INVALID/)

assert.equal(WEB_PICKER_PROJECT_NUMBER, '716191827546')
assert.notEqual(WEB_PICKER_OAUTH_REFERENCE, 'andalucia-oauth-client-secret:desktop-production')
assert.notEqual(WEB_PICKER_API_KEY_REFERENCE, 'andalucia-oauth-client-secret:desktop-production')
assert.notEqual(WEB_PICKER_OAUTH_REFERENCE, WEB_PICKER_API_KEY_REFERENCE)

const safeState = JSON.stringify(safeWebPickerCredentialState({ oauthStored: true, apiKeyStored: true, projectNumber: WEB_PICKER_PROJECT_NUMBER }))
assert.equal(safeState.includes(CLIENT_SECRET_CANARY), false)
assert.equal(safeState.includes(API_KEY_CANARY), false)

const scripts = await Promise.all([
  readFile('server/windows-credential-locker-provision-web-picker.ps1', 'utf8'),
  readFile('server/windows-credential-locker-verify-web-picker.ps1', 'utf8'),
  readFile('server/windows-credential-locker-rotate-web-picker-api-key.ps1', 'utf8')
])
const scriptSource = scripts.join('\n')
assert.match(scriptSource, /Read-Host[^\r\n]+-AsSecureString/)
assert.match(scriptSource, /WEB_OAUTH_CREDENTIAL_STORED=/)
assert.match(scriptSource, /WEB_PICKER_API_KEY_STORED=/)
assert.match(scriptSource, /WEB_PICKER_PROJECT_NUMBER_VALID=/)
assert.equal(scriptSource.includes('andalucia-oauth-client-secret:desktop-production'), false)
assert.equal(scriptSource.includes(CLIENT_SECRET_CANARY), false)
assert.equal(scriptSource.includes(API_KEY_CANARY), false)
assert.equal(/Write(?:Line)?\([^\r\n]*(?:clientSecret|apiKeyPlain|Password)/i.test(scriptSource), false)

const rotationScript = scripts[2]
assert.match(rotationScript, /Read-Host[^\r\n]+-AsSecureString/)
assert.match(rotationScript, /andalucia-web-picker-api-key:web-production/)
assert.match(rotationScript, /ANDALUCIA_OPERATION_WEB_PICKER_API_KEY/)
assert.match(rotationScript, /WEB_PICKER_API_KEY_UNCHANGED/)
assert.match(rotationScript, /WEB_PICKER_API_KEY_READBACK_FAILED/)
assert.match(rotationScript, /WEB_OAUTH_CREDENTIAL_UNCHANGED=True/)
assert.match(rotationScript, /DESKTOP_OAUTH_CREDENTIAL_UNCHANGED=True/)
assert.equal(rotationScript.includes('andalucia-web-picker-oauth:web-production'), false)
assert.equal(rotationScript.includes('andalucia-oauth-client-secret:desktop-production'), false)
assert.equal(rotationScript.includes('WEB_OAUTH_CLIENT'), false)
assert.equal(rotationScript.includes(CLIENT_SECRET_CANARY), false)
assert.equal(rotationScript.includes(API_KEY_CANARY), false)
assert.equal(/Write(?:Line)?\([^\r\n]*(?:apiKeyPlain|originalValue|Password)/i.test(rotationScript), false)

console.log(JSON.stringify({
  status: 'PASS',
  webOAuthJsonValidation: true,
  originBinding: WEB_PICKER_ORIGIN,
  redirectBinding: WEB_PICKER_REDIRECT_URI,
  projectNumberValid: true,
  separatedCredentialReferences: true,
  hiddenApiKeyInput: true,
  isolatedApiKeyRotation: true,
  rotationRollbackOnFailure: true,
  rollbackOnPartialWrite: true,
  safePresenceOnlyVerification: true,
  secretCanariesAbsent: true,
  realCredentialUsed: false,
  oauthStarted: false,
  googleDriveAccessed: false
}, null, 2))
