import { describe, it, expect } from 'vitest'
import { checkAuthEnv, type AuthEnvInput } from './check-auth-env'

function makeInput(overrides: Partial<AuthEnvInput> = {}): AuthEnvInput {
  return {
    mode: 'local',
    CONVEX_WRITE_SECRET: '',
    AUTH_ALLOWED_ORIGINS: '',
    AUTH_DEV_BYPASS: '',
    AUTH_OIDC_ENABLED: '',
    AUTH_OIDC_ISSUER: '',
    AUTH_OIDC_CLIENT_ID: '',
    AUTH_OIDC_CLIENT_SECRET: '',
    AUTH_OIDC_REDIRECT_URI: '',
    ...overrides,
  }
}

describe('checkAuthEnv', () => {
  describe('local mode', () => {
    it('passes with all auth values empty', () => {
      const result = checkAuthEnv(makeInput({ mode: 'local' }))
      expect(result.errors).toHaveLength(0)
    })

    it('warns when AUTH_DEV_BYPASS is true', () => {
      const result = checkAuthEnv(makeInput({ mode: 'local', AUTH_DEV_BYPASS: 'true' }))
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_DEV_BYPASS')])
      )
    })

    it('passes when OIDC enabled with all required fields', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'local',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_ISSUER: 'https://casdoor.example.com',
        AUTH_OIDC_CLIENT_ID: 'my-app',
        AUTH_OIDC_CLIENT_SECRET: 'secret',
        AUTH_OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/oidc/callback',
      }))
      expect(result.errors).toHaveLength(0)
    })

    it('errors when OIDC enabled but issuer missing', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'local',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_CLIENT_ID: 'my-app',
        AUTH_OIDC_CLIENT_SECRET: 'secret',
        AUTH_OIDC_REDIRECT_URI: 'http://localhost:3000/callback',
      }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_OIDC_ISSUER')])
      )
    })

    it('errors when OIDC enabled but clientId missing', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'local',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_ISSUER: 'https://casdoor.example.com',
        AUTH_OIDC_CLIENT_SECRET: 'secret',
        AUTH_OIDC_REDIRECT_URI: 'http://localhost:3000/callback',
      }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_OIDC_CLIENT_ID')])
      )
    })

    it('errors when OIDC enabled but clientSecret missing', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'local',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_ISSUER: 'https://casdoor.example.com',
        AUTH_OIDC_CLIENT_ID: 'my-app',
        AUTH_OIDC_REDIRECT_URI: 'http://localhost:3000/callback',
      }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_OIDC_CLIENT_SECRET')])
      )
    })

    it('errors when OIDC enabled but redirectUri missing', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'local',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_ISSUER: 'https://casdoor.example.com',
        AUTH_OIDC_CLIENT_ID: 'my-app',
        AUTH_OIDC_CLIENT_SECRET: 'secret',
      }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_OIDC_REDIRECT_URI')])
      )
    })
  })

  describe('production mode', () => {
    it('requires CONVEX_WRITE_SECRET', () => {
      const result = checkAuthEnv(makeInput({ mode: 'production' }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('CONVEX_WRITE_SECRET')])
      )
    })

    it('requires AUTH_ALLOWED_ORIGINS', () => {
      const result = checkAuthEnv(makeInput({ mode: 'production' }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_ALLOWED_ORIGINS')])
      )
    })

    it('errors when AUTH_DEV_BYPASS is true', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'production',
        CONVEX_WRITE_SECRET: 'secret',
        AUTH_ALLOWED_ORIGINS: 'https://trends.pt-mes.com',
        AUTH_DEV_BYPASS: 'true',
      }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_DEV_BYPASS')])
      )
    })

    it('passes with valid production config and no OIDC', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'production',
        CONVEX_WRITE_SECRET: 'secret',
        AUTH_ALLOWED_ORIGINS: 'https://trends.pt-mes.com',
      }))
      expect(result.errors).toHaveLength(0)
    })

    it('validates OIDC redirect URI host matches an allowed origin host', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'production',
        CONVEX_WRITE_SECRET: 'secret',
        AUTH_ALLOWED_ORIGINS: 'https://trends.pt-mes.com',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_ISSUER: 'https://casdoor.example.com',
        AUTH_OIDC_CLIENT_ID: 'my-app',
        AUTH_OIDC_CLIENT_SECRET: 'secret',
        AUTH_OIDC_REDIRECT_URI: 'https://other-domain.com/api/auth/oidc/callback',
      }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('does not match')])
      )
    })

    it('passes when OIDC redirect URI host matches an allowed origin', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'production',
        CONVEX_WRITE_SECRET: 'secret',
        AUTH_ALLOWED_ORIGINS: 'https://trends.pt-mes.com',
        AUTH_OIDC_ENABLED: 'true',
        AUTH_OIDC_ISSUER: 'https://casdoor.example.com',
        AUTH_OIDC_CLIENT_ID: 'my-app',
        AUTH_OIDC_CLIENT_SECRET: 'secret',
        AUTH_OIDC_REDIRECT_URI: 'https://trends.pt-mes.com/api/auth/oidc/callback',
      }))
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('preview mode', () => {
    it('requires CONVEX_WRITE_SECRET', () => {
      const result = checkAuthEnv(makeInput({ mode: 'preview' }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('CONVEX_WRITE_SECRET')])
      )
    })

    it('requires AUTH_ALLOWED_ORIGINS', () => {
      const result = checkAuthEnv(makeInput({ mode: 'preview' }))
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('AUTH_ALLOWED_ORIGINS')])
      )
    })

    it('passes with valid preview config', () => {
      const result = checkAuthEnv(makeInput({
        mode: 'preview',
        CONVEX_WRITE_SECRET: 'secret',
        AUTH_ALLOWED_ORIGINS: 'https://preview.pt-mes.com',
      }))
      expect(result.errors).toHaveLength(0)
    })
  })
})
