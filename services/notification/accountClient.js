function getAccountServiceUrl() {
  return (
    process.env.ACCOUNT_SERVICE_URL ||
    process.env.ACCOUNT_URL ||
    'http://account:3001'
  )
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || ''
  const raw = await response.text()
  if (!raw) return null

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function fetchAccountContact(accountId, kind = 'auto') {
  const normalizedId = String(accountId || '').trim()
  if (!normalizedId) {
    return {
      found: false,
      id: '',
      kind: 'unknown',
      phone: '',
      notificationPreferences: { inAppEnabled: true, smsEnabled: false },
    }
  }

  const response = await fetch(
    `${getAccountServiceUrl()}/account/internal/contact/${encodeURIComponent(normalizedId)}?kind=${encodeURIComponent(kind)}`
  )
  const data = await readBody(response)

  if (!response.ok) {
    const error = new Error((data && data.error) || `Account lookup failed (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }

  return data && typeof data === 'object'
    ? data
    : {
        found: false,
        id: normalizedId,
        kind,
        phone: '',
        notificationPreferences: { inAppEnabled: true, smsEnabled: false },
      }
}

export async function resolveNotificationDelivery({
  accountId,
  accountKind = 'auto',
  preferredChannel,
  userPhone,
  phone,
  explicitChannel = false,
}) {
  const normalizedChannel = String(preferredChannel || 'IN_APP').trim().toUpperCase() || 'IN_APP'
  const explicitPhone = String(userPhone || phone || '').trim()

  if (normalizedChannel !== 'SMS') {
    return {
      channel: normalizedChannel,
      userPhone: normalizedChannel === 'SMS' ? explicitPhone : '',
      preferenceReason: 'channel_not_sms',
      suppressed: false,
    }
  }

  if (!accountId) {
    if (explicitPhone) {
      return {
        channel: 'SMS',
        userPhone: explicitPhone,
        preferenceReason: 'explicit_phone',
        suppressed: false,
      }
    }

    return {
      channel: explicitChannel ? 'SMS' : 'IN_APP',
      userPhone: '',
      preferenceReason: 'missing_account',
      suppressed: explicitChannel,
    }
  }

  try {
    const contact = await fetchAccountContact(accountId, accountKind)
    const smsEnabled = Boolean(contact?.notificationPreferences?.smsEnabled)
    const storedPhone = String(contact?.phone || '').trim()

    if (smsEnabled && storedPhone) {
      return {
        channel: 'SMS',
        userPhone: storedPhone,
        preferenceReason: 'sms_enabled',
        suppressed: false,
      }
    }

    return {
      channel: explicitChannel ? 'SMS' : 'IN_APP',
      userPhone: '',
      preferenceReason: smsEnabled ? 'missing_phone' : 'sms_disabled',
      suppressed: explicitChannel,
    }
  } catch (error) {
    console.warn(
      `[notification/account] Contact lookup failed for ${String(accountId)}:`,
      error.message
    )
    return {
      channel: explicitChannel ? 'SMS' : 'IN_APP',
      userPhone: '',
      preferenceReason: 'lookup_failed',
      suppressed: explicitChannel,
    }
  }
}
