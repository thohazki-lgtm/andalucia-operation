# Google Web Picker local credential provisioning

This procedure stores the Google Web OAuth client pair and restricted Picker browser API key in Windows Credential Locker. It does not start OAuth, Picker, or Google Drive access.

## Provision

From a local PowerShell window opened in the ANDALUCÍA OPERATION source directory, run:

```powershell
npm.cmd run cloud:provision-web-picker-credentials
```

At the first prompt, enter the full local path to the downloaded Google Web OAuth credentials JSON. The file is read in place and is not copied, changed, or deleted.

At the second prompt, type the restricted Google Picker browser API key. Input is hidden. Do not place the key on the command line, in an environment variable, or in chat.

The command validates the Web credential type, the `http://127.0.0.1:4175` JavaScript origin, the `http://127.0.0.1:4175/oauth/google/callback` redirect URI, and project number `716191827546`. It then stores two separate entries transactionally. Existing entries are never overwritten.

## Verify presence

Run:

```powershell
npm.cmd run cloud:verify-web-picker-credentials
```

Successful output contains only:

```text
WEB_OAUTH_CREDENTIAL_STORED=True
WEB_PICKER_API_KEY_STORED=True
WEB_PICKER_PROJECT_NUMBER_VALID=True
```

The verification command never displays credential values.
