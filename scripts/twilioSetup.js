/**
 * Creates the Twilio Verify service ParaliLink uses for login codes and prints
 * its SID. Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in server/.env.
 * Run: npm run twilio:setup --workspace server
 */
const sid = process.env.TWILIO_ACCOUNT_SID
const token = process.env.TWILIO_AUTH_TOKEN
if (!sid || !token) {
  console.error('Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to server/.env first (Twilio console → Account info).')
  process.exit(1)
}

const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
const call = async (method, url, params) => {
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${res.status} ${body.code ?? ''} ${body.message ?? ''}`)
  return body
}

try {
  const list = await call('GET', 'https://verify.twilio.com/v2/Services?PageSize=50')
  let service = list.services.find((s) => s.friendly_name === 'ParaliLink')
  if (!service) {
    service = await call('POST', 'https://verify.twilio.com/v2/Services', { FriendlyName: 'ParaliLink', CodeLength: '6' })
    console.info('[twilio] created Verify service "ParaliLink"')
  } else {
    console.info('[twilio] found existing Verify service "ParaliLink"')
  }
  console.info(`\nAdd this to server/.env:\n\nTWILIO_VERIFY_SERVICE_SID=${service.sid}\nSMS_PROVIDER=twilio\n`)
} catch (error) {
  console.error('[twilio] setup failed:', error.message)
  console.error('Check the Account SID and Auth Token in server/.env.')
  process.exit(1)
}
