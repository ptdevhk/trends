import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { normalizeCompanyAlias } from '@trends/shared'

// Phase-1 MY companyKey catalog (Seq 4): deterministic seed plan + additive
// in-container driver mirroring the TH pattern (66cf6186). These tests pin the
// plan shape, the alias-normalization rules (Sdn Bhd suffixes), the disjointness
// from the existing 27-company August plan, and the driver mutation chain —
// aggregate employer surfaces only, never candidate data.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLAN_PATH = path.join(REPO_ROOT, 'deploy/seed-data/my-cnc-company-catalog-seed-plan.json')
const DRIVER_PATH = path.join(REPO_ROOT, 'deploy/seed-data/my-cnc-seed-company-industry.mjs')
const AUGUST_PLAN_PATH = path.join(REPO_ROOT, 'deploy/seed-data/company-industry-seed-plan.json')
const TH_PLAN_PATH = path.join(REPO_ROOT, 'deploy/seed-data/th-company-industry-seed-plan.json')

interface PlanSource {
  sourceId: string
  url: string
  sourceType: string
  trustTier: string
  title?: string
  evidenceExcerpt?: string
}

interface PlanCompany {
  companyKey: string
  employerName: string
  industryClass: string
  verificationLevel: string
  evidenceSummary: string
  decisionReason: string
  taxonomyVersion: string
  nextReviewAt: number
  proposalId: string
  revisionId: string
  aliases: string[]
  sources: PlanSource[]
}

const COMPANY_KEYS = [
  'companyKey',
  'employerName',
  'industryClass',
  'verificationLevel',
  'evidenceSummary',
  'decisionReason',
  'taxonomyVersion',
  'nextReviewAt',
  'proposalId',
  'revisionId',
  'aliases',
  'sources',
] as const

const SOURCE_KEYS = ['sourceId', 'url', 'sourceType', 'trustTier', 'title', 'evidenceExcerpt'] as const

function stripSdnBhd(name: string): string {
  return name.replace(/\s*[,]?\s*\(?\s*sdn\s*\.?\s*bhd\s*\.?\s*\)?\s*$/i, '').trim()
}

function loadPlan(): { companies: PlanCompany[]; market?: string; schemaVersion?: number } {
  return JSON.parse(readFileSync(PLAN_PATH, 'utf8'))
}

describe('MY CNC company catalog seed plan', () => {
  it('exists with the MY market envelope', () => {
    const plan = loadPlan()
    expect(plan.schemaVersion).toBe(1)
    expect(plan.market).toBe('MY')
    expect(Array.isArray(plan.companies)).toBe(true)
    expect(plan.companies.length).toBeGreaterThanOrEqual(5)
    expect(plan.companies.length).toBeLessThanOrEqual(40)
  })

  it('every company carries the approval-chain shape and nothing else (PII whitelist)', () => {
    for (const company of loadPlan().companies) {
      expect(Object.keys(company).sort()).toEqual([...COMPANY_KEYS].sort())
      expect(company.companyKey).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(company.employerName.length).toBeGreaterThan(1)
      expect(['cnc', 'industrial']).toContain(company.industryClass)
      expect(company.verificationLevel).toBe('verified')
      expect(company.taxonomyVersion).toBe('industry-v1')
      expect(typeof company.nextReviewAt).toBe('number')
      expect(company.proposalId).toBe(`my-cnc-seed-${company.companyKey}`)
      expect(company.revisionId).toBe(`my-cnc-rev-${company.companyKey}`)
      expect(company.evidenceSummary.length).toBeGreaterThan(10)
      expect(company.decisionReason.length).toBeGreaterThan(10)
      for (const source of company.sources) {
        expect(Object.keys(source).sort()).toEqual(
          [...SOURCE_KEYS].filter((k) => k in source).sort(),
        )
        expect(source.sourceId).toMatch(new RegExp(`^my-cnc-src-${company.companyKey}-\\d+$`))
        expect(source.url).toMatch(/^https?:\/\//)
        expect(source.sourceType.length).toBeGreaterThan(0)
        expect(['primary', 'secondary', 'tertiary']).toContain(source.trustTier)
      }
    }
  })

  it('ids are unique within the plan', () => {
    const companies = loadPlan().companies
    for (const field of ['companyKey', 'proposalId', 'revisionId'] as const) {
      const values = companies.map((c) => c[field])
      expect(new Set(values).size).toBe(values.length)
    }
    const sourceIds = companies.flatMap((c) => c.sources.map((s) => s.sourceId))
    expect(new Set(sourceIds).size).toBe(sourceIds.length)
  })

  it('is disjoint from the existing 27-company August plan', () => {
    const august = JSON.parse(readFileSync(AUGUST_PLAN_PATH, 'utf8')).companies
    const augustKeys = new Set(august.map((c: { companyKey: string }) => c.companyKey))
    const augustProposalIds = new Set(august.map((c: { proposalId: string }) => c.proposalId))
    const augustRevisionIds = new Set(august.map((c: { revisionId: string }) => c.revisionId))
    const augustSourceIds = new Set(
      august.flatMap((c: { sources: { sourceId: string }[] }) => c.sources.map((s) => s.sourceId)),
    )
    for (const company of loadPlan().companies) {
      expect(augustKeys.has(company.companyKey)).toBe(false)
      expect(augustProposalIds.has(company.proposalId)).toBe(false)
      expect(augustRevisionIds.has(company.revisionId)).toBe(false)
      for (const source of company.sources) {
        expect(augustSourceIds.has(source.sourceId)).toBe(false)
      }
    }
  })

  it('aliases follow the Sdn Bhd normalization rule and resolve uniquely', () => {
    const companies = loadPlan().companies
    const seenNormalized = new Map<string, string>()
    for (const company of companies) {
      expect(company.aliases.length).toBeGreaterThanOrEqual(1)
      expect(company.aliases[0]).toBe(company.employerName)
      const normalized = new Set<string>()
      for (const alias of company.aliases) {
        const norm = normalizeCompanyAlias(alias)
        expect(norm.length).toBeGreaterThan(0)
        normalized.add(norm)
        const prior = seenNormalized.get(norm)
        expect(prior ?? company.companyKey).toBe(company.companyKey)
        seenNormalized.set(norm, company.companyKey)
      }
      expect(normalized.size).toBe(company.aliases.length)
      // Sdn Bhd rule: full legal surface AND stripped variant must both be aliases.
      const stripped = stripSdnBhd(company.employerName)
      if (stripped && stripped.toLowerCase() !== company.employerName.toLowerCase()) {
        const aliasesNorm = company.aliases.map((a) => normalizeCompanyAlias(a))
        expect(aliasesNorm).toContain(normalizeCompanyAlias(stripped))
      }
    }
  })

  it('is disjoint from the TH catalog plan (keys, ids, alias surfaces)', () => {
    const th = JSON.parse(readFileSync(TH_PLAN_PATH, 'utf8')).companies
    const thKeys = new Set(th.map((c: { companyKey: string }) => c.companyKey))
    const thProposalIds = new Set(th.map((c: { proposalId: string }) => c.proposalId))
    const thRevisionIds = new Set(th.map((c: { revisionId: string }) => c.revisionId))
    const thSourceIds = new Set(
      th.flatMap((c: { sources: { sourceId: string }[] }) => c.sources.map((s) => s.sourceId)),
    )
    const thSurfaces = new Set<string>()
    for (const c of th) {
      thSurfaces.add(normalizeCompanyAlias(c.employerName))
      for (const alias of c.aliases || []) thSurfaces.add(normalizeCompanyAlias(alias))
    }
    for (const company of loadPlan().companies) {
      expect(thKeys.has(company.companyKey)).toBe(false)
      expect(thProposalIds.has(company.proposalId)).toBe(false)
      expect(thRevisionIds.has(company.revisionId)).toBe(false)
      for (const source of company.sources) {
        expect(thSourceIds.has(source.sourceId)).toBe(false)
      }
      // e.g. SAM Precision (M) Sdn Bhd must not shadow sam-precision-thailand
      for (const alias of company.aliases) {
        expect(thSurfaces.has(normalizeCompanyAlias(alias))).toBe(false)
      }
    }
  })

  it('aliases do not collide with the August plan employer surfaces (addAlias guard)', () => {
    const august = JSON.parse(readFileSync(AUGUST_PLAN_PATH, 'utf8')).companies
    const augustSurfaces = new Set<string>()
    for (const c of august) {
      augustSurfaces.add(normalizeCompanyAlias(c.employerName))
      const stripped = stripSdnBhd(c.employerName)
      if (stripped) augustSurfaces.add(normalizeCompanyAlias(stripped))
    }
    for (const company of loadPlan().companies) {
      for (const alias of company.aliases) {
        expect(augustSurfaces.has(normalizeCompanyAlias(alias))).toBe(false)
      }
    }
  })
})

describe('MY CNC company catalog seed driver', () => {
  it('parses as ESM', () => {
    execFileSync(process.execPath, ['--check', DRIVER_PATH], { stdio: 'pipe' })
  })

  it('drives the additive bootstrap chain with the alias-resolution smoke', () => {
    const driver = readFileSync(DRIVER_PATH, 'utf8')
    for (const needle of [
      '"companies:upsert"',
      '"companies:addAlias"',
      '"companies:upsertIndustryProposal"',
      '"companies:upsertIndustryEvidenceSource"',
      '"companies:approveIndustryProposal"',
      '"companies:resolveAliasesBatch"',
      'fetchStatus: "fetched"',
      'reviewAttestation',
      'SEED_OK',
      'SEED_FATAL',
      'already exists',
    ]) {
      expect(driver).toContain(needle)
    }
    // Additive smoke: must NOT assert an exact profile count (that is the
    // fresh-backend restore driver's contract).
    expect(driver).not.toContain('listIndustryProfiles')
  })

  it('never prints the write secret', () => {
    const driver = readFileSync(DRIVER_PATH, 'utf8')
    expect(driver).not.toMatch(/console\.(log|error)\([^)]*\bWS\b/)
  })
})
