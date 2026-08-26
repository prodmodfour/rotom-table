import type { RotomDatabase } from './database'

const SECRET = /^[a-f0-9]{64}$/

export const gmToolkitPreviewSigningKey = (database: RotomDatabase): string => {
  const configured = process.env.ROTOM_GM_TOOLKIT_SIGNING_KEY?.trim()
  if (configured) {
    if (configured.length < 32) throw new Error('ROTOM_GM_TOOLKIT_SIGNING_KEY must contain at least 32 characters')
    return configured
  }
  const row = database.connection.prepare(`
    SELECT secret_value
    FROM gm_toolkit_secrets
    WHERE secret_id = 'preview-signing-v1'
  `).get() as { readonly secret_value?: unknown } | undefined
  if (!row || typeof row.secret_value !== 'string' || !SECRET.test(row.secret_value)) {
    throw new Error('The GM Toolkit preview signing secret is unavailable or malformed')
  }
  return row.secret_value
}
