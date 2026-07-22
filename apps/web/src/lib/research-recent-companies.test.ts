import { describe, expect, it } from 'vitest'
import {
  loadResearchRecentCompanies,
  upsertResearchRecentCompany,
} from './research-recent-companies'

function memStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear() { map.clear() },
    getItem(k) { return map.get(k) ?? null },
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
    key() { return null },
  }
}

describe('research-recent-companies', () => {
  it('upserts newest first and caps at 8', () => {
    const s = memStorage()
    for (let i = 0; i < 10; i += 1) {
      upsertResearchRecentCompany(
        { companyKey: `k${i}`, nameCn: `名${i}`, openedAt: i + 1 },
        s,
      )
    }
    const list = loadResearchRecentCompanies(s)
    expect(list).toHaveLength(8)
    expect(list[0]?.companyKey).toBe('k9')
    expect(list[list.length - 1]?.companyKey).toBe('k2')
  })

  it('moves existing key to front', () => {
    const s = memStorage()
    upsertResearchRecentCompany({ companyKey: 'fanuc', nameCn: '发那科', openedAt: 1 }, s)
    upsertResearchRecentCompany({ companyKey: 'mazak', nameCn: '山崎马扎克', openedAt: 2 }, s)
    upsertResearchRecentCompany({ companyKey: 'fanuc', nameCn: '发那科', openedAt: 3 }, s)
    const list = loadResearchRecentCompanies(s)
    expect(list[0]?.companyKey).toBe('fanuc')
    expect(list.filter((x) => x.companyKey === 'fanuc')).toHaveLength(1)
  })
})
