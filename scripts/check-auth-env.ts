/**
 * Auth environment validation script.
 *
 * Usage:
 *   bunx tsx scripts/check-auth-env.ts --mode local|production|preview [--env-file .env]
 *
 * Validates auth-related environment variables for the target deployment mode.
 * Exit code 0 = all checks pass; exit code 1 = errors found.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type AuthEnvMode = 'local' | 'production' | 'preview'

export interface AuthEnvInput {
  mode: AuthEnvMode
  CONVEX_WRITE_SECRET: string
  AUTH_ALLOWED_ORIGINS: string
  AUTH_ADMIN_RESET_ENABLED: string
  AUTH_OIDC_ENABLED: string
  AUTH_OIDC_ISSUER: string
  AUTH_OIDC_CLIENT_ID: string
  AUTH_OIDC_CLIENT_SECRET: string
  AUTH_OIDC_REDIRECT_URI: string
  /** Preview bootstrap: ops admin password (via AUTH_BOOTSTRAP_PASSWORD or indirection). */
  AUTH_BOOTSTRAP_PASSWORD: string
  /** Preview bootstrap: HR demo password for workspace hr. */
  AUTH_HR_DEMO_PASSWORD: string
  BOOTSTRAP_ADMIN_USERS: string
  BOOTSTRAP_HR_DEMO_USER: string
}

export interface CheckResult {
  errors: string[]
  warnings: string[]
}

export function checkAuthEnv(input: AuthEnvInput): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const isProdLike = input.mode === 'production' || input.mode === 'preview'

  // Production/preview: require CONVEX_WRITE_SECRET
  if (isProdLike && !input.CONVEX_WRITE_SECRET) {
    errors.push('CONVEX_WRITE_SECRET is required in ' + input.mode + ' mode')
  }

  // Production/preview: require AUTH_ALLOWED_ORIGINS
  if (isProdLike && !input.AUTH_ALLOWED_ORIGINS) {
    errors.push('AUTH_ALLOWED_ORIGINS is required in ' + input.mode + ' mode')
  }

  // Preview bootstrap accounts (no-auth → auth migration gate)
  if (input.mode === 'preview') {
    const adminUsers = (input.BOOTSTRAP_ADMIN_USERS || 'admin').trim()
    const hrDemo = (input.BOOTSTRAP_HR_DEMO_USER || 'hr-demo').trim()
    if (!adminUsers) {
      errors.push('BOOTSTRAP_ADMIN_USERS is required in preview mode')
    }
    if (!hrDemo) {
      errors.push('BOOTSTRAP_HR_DEMO_USER is required in preview mode')
    }
    if (!input.AUTH_BOOTSTRAP_PASSWORD) {
      errors.push(
        'AUTH_BOOTSTRAP_PASSWORD is required in preview mode (ops admin seed/login)',
      )
    }
    if (!input.AUTH_HR_DEMO_PASSWORD) {
      errors.push(
        'AUTH_HR_DEMO_PASSWORD is required in preview mode (hr-demo seed/login on workspace hr)',
      )
    }
  }

  // AUTH_ADMIN_RESET_ENABLED: experimental admin password reset — warn on
  // accidental prod/preview enablement. Prod CAN enable it deliberately.
  if (isProdLike && input.AUTH_ADMIN_RESET_ENABLED === 'true') {
    errors.push(
      'AUTH_ADMIN_RESET_ENABLED is enabled — admin password reset should not be on by default in '
      + input.mode + ' mode; set explicitly only if you intend to use it'
    )
  }

  // OIDC validation: when enabled, all required fields must be set
  const oidcEnabled = input.AUTH_OIDC_ENABLED === 'true'
  if (oidcEnabled) {
    const oidcRequired: Array<[string, string]> = [
      ['AUTH_OIDC_ISSUER', input.AUTH_OIDC_ISSUER],
      ['AUTH_OIDC_CLIENT_ID', input.AUTH_OIDC_CLIENT_ID],
      ['AUTH_OIDC_CLIENT_SECRET', input.AUTH_OIDC_CLIENT_SECRET],
      ['AUTH_OIDC_REDIRECT_URI', input.AUTH_OIDC_REDIRECT_URI],
    ]
    for (const [key, value] of oidcRequired) {
      if (!value) {
        errors.push(key + ' is required when AUTH_OIDC_ENABLED is true')
      }
    }

    // In production/preview, redirect URI host must match an allowed origin host
    if (isProdLike && input.AUTH_OIDC_REDIRECT_URI && input.AUTH_ALLOWED_ORIGINS) {
      const redirectHost = extractHost(input.AUTH_OIDC_REDIRECT_URI)
      const allowedHosts = input.AUTH_ALLOWED_ORIGINS.split(',').map((o) => extractHost(o.trim()))
      if (redirectHost && !allowedHosts.includes(redirectHost)) {
        errors.push(
          'AUTH_OIDC_REDIRECT_URI host (' + redirectHost + ') does not match any AUTH_ALLOWED_ORIGINS host'
        )
      }
    }
  }

  return { errors, warnings }
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!existsSync(filePath)) return vars
  const content = readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex < 1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    vars[key] = value
  }
  return vars
}

function resolveInput(mode: AuthEnvMode, envFilePath?: string): AuthEnvInput {
  let envVars: Record<string, string> = process.env as Record<string, string>
  if (envFilePath) {
    const fileVars = parseEnvFile(resolve(envFilePath))
    envVars = { ...process.env as Record<string, string>, ...fileVars }
  }
  const get = (key: string) => envVars[key] ?? ''
  const bootstrapPwEnv = get('BOOTSTRAP_ADMIN_PASSWORD_ENV') || 'AUTH_BOOTSTRAP_PASSWORD'
  const hrDemoPwEnv = get('BOOTSTRAP_HR_DEMO_PASSWORD_ENV') || 'AUTH_HR_DEMO_PASSWORD'
  return {
    mode,
    CONVEX_WRITE_SECRET: get('CONVEX_WRITE_SECRET'),
    AUTH_ALLOWED_ORIGINS: get('AUTH_ALLOWED_ORIGINS'),
    AUTH_ADMIN_RESET_ENABLED: get('AUTH_ADMIN_RESET_ENABLED'),
    AUTH_OIDC_ENABLED: get('AUTH_OIDC_ENABLED'),
    AUTH_OIDC_ISSUER: get('AUTH_OIDC_ISSUER'),
    AUTH_OIDC_CLIENT_ID: get('AUTH_OIDC_CLIENT_ID'),
    AUTH_OIDC_CLIENT_SECRET: get('AUTH_OIDC_CLIENT_SECRET'),
    AUTH_OIDC_REDIRECT_URI: get('AUTH_OIDC_REDIRECT_URI'),
    AUTH_BOOTSTRAP_PASSWORD: get(bootstrapPwEnv) || get('AUTH_BOOTSTRAP_PASSWORD'),
    AUTH_HR_DEMO_PASSWORD: get(hrDemoPwEnv) || get('AUTH_HR_DEMO_PASSWORD'),
    BOOTSTRAP_ADMIN_USERS: get('BOOTSTRAP_ADMIN_USERS'),
    BOOTSTRAP_HR_DEMO_USER: get('BOOTSTRAP_HR_DEMO_USER'),
  }
}

function main() {
  const args = process.argv.slice(2)
  let mode: AuthEnvMode = 'local'
  let envFile: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && i + 1 < args.length) {
      const m = args[i + 1]
      if (m === 'local' || m === 'production' || m === 'preview') {
        mode = m
      } else {
        console.error('Invalid mode: ' + m + '. Must be local, production, or preview.')
        process.exit(1)
      }
      i++
    } else if (args[i] === '--env-file' && i + 1 < args.length) {
      envFile = args[i + 1]
      i++
    }
  }

  const input = resolveInput(mode, envFile)
  const result = checkAuthEnv(input)

  for (const w of result.warnings) {
    console.warn('WARN  ' + w)
  }
  for (const e of result.errors) {
    console.error('ERROR ' + e)
  }

  if (result.errors.length > 0) {
    console.error('\nAuth environment check FAILED with ' + result.errors.length + ' error(s).')
    process.exit(1)
  }

  console.log('Auth environment check passed for mode: ' + mode)
}

// Run when invoked directly (not imported as module)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/check-auth-env.ts') ||
  process.argv[1].endsWith('\\check-auth-env.ts') ||
  process.argv[1].includes('check-auth-env')
)
if (isDirectRun) {
  main()
}
