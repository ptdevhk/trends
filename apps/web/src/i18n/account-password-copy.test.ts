import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import zhHans from './locales/zh-Hans.json'
import zhHant from './locales/zh-Hant.json'

describe('account password copy', () => {
  it('states the eight-character minimum in every supported locale', () => {
    expect(en.settings.account.passwordTooShort).toBe('Password must be at least 8 characters')
    expect(zhHans.settings.account.passwordTooShort).toBe('密码至少需要 8 个字符')
    expect(zhHant.settings.account.passwordTooShort).toBe('密碼至少需要 8 個字元')
  })
})
