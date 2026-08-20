import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  inferPolicyPreset,
  type CompanyPolicyEffects,
  type CompanyPolicyPreset,
} from '@trends/shared'
import { PageHeader } from '@/components/PageHeader'
import { BlacklistPage } from '@/pages/BlacklistPage'
import { useCompanyPolicies, type CompanyItem, type PolicyScope } from '@/hooks/useCompanyPolicies'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, isImeComposition } from '@/lib/utils'
import { hasWorkspaceAdminAccess } from '@/lib/workspace-access'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'

type PoliciesTab = 'candidates' | 'companies'

function presetLabel(preset: CompanyPolicyPreset, t: (key: string, options?: Record<string, unknown>) => string) {
  switch (preset) {
    case 'known_good':
      return t('settings.policies.presets.knownGood', { defaultValue: 'Known good' })
    case 'no_hire':
      return t('settings.policies.presets.noHire', { defaultValue: 'No-hire' })
    case 'none':
      return t('settings.policies.presets.none', { defaultValue: 'None' })
  }
}

function scopeLabel(scope: PolicyScope, t: (key: string, options?: Record<string, unknown>) => string) {
  switch (scope) {
    case 'cn':
      return t('settings.policies.scope.cn', { defaultValue: 'CN' })
    case 'my':
      return t('settings.policies.scope.my', { defaultValue: 'MY' })
    case 'workspace':
      return t('settings.policies.scope.workspace', { defaultValue: 'Workspace' })
  }
}

function scopeDisplayName(scope: PolicyScope, t: (key: string, options?: Record<string, unknown>) => string) {
  return scope === 'workspace'
    ? t('settings.policies.columns.policy', { defaultValue: 'Workspace policy' })
    : t('settings.policies.columns.policyMarket', {
        defaultValue: '{{scope}} market policy',
        scope: scopeLabel(scope, t),
      })
}

function CompaniesTab() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const { memberships } = useAuth()
  const isWorkspaceAdmin = hasWorkspaceAdminAccess(memberships, slug)
  // Market-scope policy editing is admin-only (T5); non-admins see the
  // workspace layer only.
  const availableScopes: PolicyScope[] = isWorkspaceAdmin
    ? ['workspace', 'cn', 'my']
    : ['workspace']
  const teamSlug = slug || 'hr'
  const {
    companies,
    policies,
    marketPolicies,
    loading,
    error,
    seedCanonical,
    upsertCompany,
    addAlias,
    setPolicyPreset,
    setCompanyArchived,
  } = useCompanyPolicies(true, isWorkspaceAdmin)

  const [policyScope, setPolicyScope] = useState<PolicyScope>('workspace')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newNameCn, setNewNameCn] = useState('')
  const [newNameEn, setNewNameEn] = useState('')
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({})

  const scopePolicies = useMemo(() => {
    if (policyScope === 'cn') {
      return marketPolicies.cn
    }
    if (policyScope === 'my') {
      return marketPolicies.my
    }
    return policies
  }, [marketPolicies, policies, policyScope])

  const policyByCompany = useMemo(() => {
    const map = new Map(scopePolicies.map((item) => [item.companyKey, item]))
    return map
  }, [scopePolicies])

  const filteredCompanies = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const visible = showArchived ? companies : companies.filter((item) => !item.archivedAt)
    const sorted = [...visible].sort((left, right) => left.displayName.localeCompare(right.displayName))
    if (!keyword) {
      return sorted
    }
    return sorted.filter((item) => {
      const haystack = [
        item.companyKey,
        item.displayName,
        item.nameCn ?? '',
        item.nameEn ?? '',
        ...item.aliases.map((alias) => alias.aliasDisplay),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [companies, search, showArchived])

  const handleSeed = async () => {
    setSeeding(true)
    const result = await seedCanonical(true)
    setSeeding(false)
    if (!result) {
      toast.error(t('settings.policies.toasts.seedFailed', { defaultValue: 'Failed to seed companies' }))
      return
    }
    toast.success(
      t('settings.policies.toasts.seedSuccess', {
        defaultValue:
          'Companies ok ({{created}} new / {{updated}} updated). Applied no-hire to {{policies}} company(ies) (skipped if already no-hire).',
        created: result.companiesCreated ?? 0,
        updated: result.companiesUpdated ?? 0,
        policies: result.policiesSeeded ?? 0,
      }),
    )
  }

  const handleCreate = async () => {
    const companyKey = newKey.trim()
    const displayName = newDisplayName.trim()
    if (!companyKey || !displayName) {
      toast.error(t('settings.policies.toasts.createRequired', { defaultValue: 'Company key and display name are required' }))
      return
    }
    setSavingKey(companyKey)
    const ok = await upsertCompany({
      companyKey,
      displayName,
      nameCn: newNameCn.trim() || undefined,
      nameEn: newNameEn.trim() || undefined,
      status: 'confirmed',
    })
    setSavingKey(null)
    if (!ok) {
      toast.error(t('settings.policies.toasts.createFailed', { defaultValue: 'Failed to create company' }))
      return
    }
    setNewKey('')
    setNewDisplayName('')
    setNewNameCn('')
    setNewNameEn('')
    toast.success(t('settings.policies.toasts.createSuccess', { defaultValue: 'Company saved' }))
  }

  const handlePreset = async (companyKey: string, preset: CompanyPolicyPreset) => {
    setSavingKey(companyKey)
    const ok = await setPolicyPreset(companyKey, preset, undefined, policyScope)
    setSavingKey(null)
    if (!ok) {
      toast.error(t('settings.policies.toasts.policyFailed', { defaultValue: 'Failed to update policy' }))
      return
    }
    toast.success(t('settings.policies.toasts.policyUpdated', { defaultValue: 'Company policy updated' }))
  }

  const handleAddAlias = async (companyKey: string) => {
    const alias = (aliasDrafts[companyKey] ?? '').trim()
    if (!alias) {
      return
    }
    setSavingKey(companyKey)
    const ok = await addAlias(companyKey, alias)
    setSavingKey(null)
    if (!ok) {
      toast.error(t('settings.policies.toasts.aliasFailed', { defaultValue: 'Failed to add alias' }))
      return
    }
    setAliasDrafts((previous) => ({ ...previous, [companyKey]: '' }))
    toast.success(t('settings.policies.toasts.aliasAdded', { defaultValue: 'Alias added' }))
  }

  const handleArchive = async (company: CompanyItem) => {
    setSavingKey(company.companyKey)
    const nextArchived = !company.archivedAt
    const ok = await setCompanyArchived(company.companyKey, nextArchived)
    setSavingKey(null)
    if (!ok) {
      toast.error(t('settings.policies.toasts.archiveFailed', { defaultValue: 'Failed to update archive state' }))
      return
    }
    if (nextArchived) {
      toast.success(
        t('settings.policies.toasts.archiveSuccess', {
          defaultValue: 'Archived {{name}}',
          name: company.displayName,
        }),
      )
    } else {
      toast.success(
        t('settings.policies.toasts.restoreSuccess', {
          defaultValue: 'Restored {{name}}',
          name: company.displayName,
        }),
      )
    }
  }

  return (
    <div className="space-y-6" data-testid="company-policies-panel">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{t('settings.policies.companiesTitle', { defaultValue: 'Company registry & policy' })}</CardTitle>
              <CardDescription>
                {policyScope === 'workspace'
                  ? t('settings.policies.companiesDescription', {
                      defaultValue:
                        'Manage known-good and no-hire companies for this workspace. Policy does not change AI score; search enforcement comes later.',
                    })
                  : t('settings.policies.companiesDescriptionMarket', {
                      defaultValue:
                        '{{scope}} market policy beats the workspace policy for resumes sourced from this market. Policy does not change AI score.',
                      scope: scopeLabel(policyScope, t),
                    })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label={t('settings.policies.scopeLabel', { defaultValue: 'Policy scope' })}>
                {availableScopes.map((scope) => (
                  <Button
                    key={scope}
                    type="button"
                    size="sm"
                    variant={policyScope === scope ? 'default' : 'ghost'}
                    onClick={() => setPolicyScope(scope)}
                    data-testid={`policy-scope-${scope}`}
                  >
                    {scopeLabel(scope, t)}
                  </Button>
                ))}
              </div>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('settings.policies.searchPlaceholder', {
                  defaultValue: 'Search company, alias, or key…',
                })}
                className="w-full sm:w-72"
                data-testid="company-search-input"
              />
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="company-show-archived-toggle"
              >
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                  className="h-4 w-4"
                />
                {t('settings.policies.showArchived', { defaultValue: 'Show archived' })}
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSeed()}
                disabled={seeding}
                data-testid="company-seed-button"
              >
                {seeding
                  ? t('settings.policies.seeding', { defaultValue: 'Seeding…' })
                  : t('settings.policies.seedCanonical', {
                      defaultValue: 'Reset Pro-Technic + Polywell to no-hire',
                    })}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading...' })}</div>
          ) : null}
          {!loading && error ? <div className="text-sm text-destructive">{error}</div> : null}
          {!loading && !error && filteredCompanies.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {policyScope === 'workspace'
                ? t('settings.policies.empty', {
                    defaultValue: 'No companies yet. Seed canonical companies or add one below.',
                  })
                : t('settings.policies.emptyMarket', {
                    defaultValue: 'No {{scope}} market policy yet. Set one to override the workspace policy for this market.',
                    scope: scopeLabel(policyScope, t),
                  })}
            </div>
          ) : null}

          {!loading && !error && filteredCompanies.length > 0 ? (
            <Table data-testid="company-policies-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.policies.columns.company', { defaultValue: 'Company' })}</TableHead>
                  <TableHead>{t('settings.policies.columns.aliases', { defaultValue: 'Aliases' })}</TableHead>
                  <TableHead>{scopeDisplayName(policyScope, t)}</TableHead>
                  <TableHead className="text-right">
                    {t('settings.policies.columns.actions', { defaultValue: 'Actions' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((company) => {
                  const policy = policyByCompany.get(company.companyKey)
                  const preset = inferPolicyPreset((policy?.effects as CompanyPolicyEffects | null) ?? null)
                  const busy = savingKey === company.companyKey
                  return (
                    <TableRow key={company.companyKey} data-testid="company-policy-row" data-company-key={company.companyKey}>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="font-medium">{company.displayName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{company.companyKey}</div>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="secondary">{company.status}</Badge>
                            {company.nameCn ? <Badge variant="outline">{company.nameCn}</Badge> : null}
                            {company.nameEn ? <Badge variant="outline">{company.nameEn}</Badge> : null}
                            {company.archivedAt ? (
                              <Badge variant="outline" data-testid="company-archived-badge">
                                {t('settings.policies.archivedBadge', { defaultValue: 'Archived' })}
                              </Badge>
                            ) : null}
                            <Link
                              to={`/${teamSlug}/research/${encodeURIComponent(company.companyKey)}?persona=hr`}
                              className="text-xs text-blue-600 hover:underline"
                              data-testid="company-research-deep-link"
                            >
                              {t('settings.policies.researchLink', {
                                defaultValue: 'Research (HR)',
                              })}
                            </Link>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => void handleArchive(company)}
                              data-testid="company-archive-toggle"
                            >
                              {company.archivedAt
                                ? t('settings.policies.restore', { defaultValue: 'Restore' })
                                : t('settings.policies.archive', { defaultValue: 'Archive' })}
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top max-w-[280px]">
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">
                            {company.aliases.length > 0
                              ? company.aliases.map((alias) => alias.aliasDisplay).join(' · ')
                              : t('settings.policies.noAliases', { defaultValue: 'No aliases' })}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={aliasDrafts[company.companyKey] ?? ''}
                              onChange={(event) =>
                                setAliasDrafts((previous) => ({
                                  ...previous,
                                  [company.companyKey]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' || isImeComposition(event)) return
                                event.preventDefault()
                                void handleAddAlias(company.companyKey)
                              }}
                              placeholder={t('settings.policies.aliasPlaceholder', { defaultValue: 'Add alias' })}
                              className="h-8"
                              data-testid="company-alias-input"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void handleAddAlias(company.companyKey)}
                            >
                              {t('settings.policies.addAlias', { defaultValue: 'Add' })}
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <Badge variant={preset === 'known_good' ? 'default' : preset === 'no_hire' ? 'destructive' : 'secondary'}>
                            {presetLabel(preset, t)}
                          </Badge>
                          {policy?.effects?.summary ? (
                            <div className="text-xs text-muted-foreground">{policy.effects.summary}</div>
                          ) : null}
                          {policy ? (
                            <div className="text-xs text-muted-foreground">
                              rev {policy.revision}
                              {policy.effects?.rankingEffect ? ` · ${policy.effects.rankingEffect}` : ''}
                            </div>
                          ) : policyScope === 'workspace' ? (
                            <div className="text-xs text-muted-foreground">
                              {t('settings.policies.noPolicy', { defaultValue: 'No workspace policy yet' })}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {t('settings.policies.noPolicyMarket', {
                                defaultValue: 'No {{scope}} market policy yet',
                                scope: scopeLabel(policyScope, t),
                              })}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={preset === 'known_good' ? 'default' : 'outline'}
                            disabled={busy}
                            onClick={() => void handlePreset(company.companyKey, 'known_good')}
                            data-testid="company-preset-known-good"
                          >
                            {presetLabel('known_good', t)}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={preset === 'no_hire' ? 'destructive' : 'outline'}
                            disabled={busy}
                            onClick={() => void handlePreset(company.companyKey, 'no_hire')}
                            data-testid="company-preset-no-hire"
                          >
                            {presetLabel('no_hire', t)}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void handlePreset(company.companyKey, 'none')}
                            data-testid="company-preset-none"
                          >
                            {presetLabel('none', t)}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.policies.addCompanyTitle', { defaultValue: 'Add company' })}</CardTitle>
          <CardDescription>
            {t('settings.policies.addCompanyDescription', {
              defaultValue: 'Create a confirmed company entry. Keep 宝力机械 and 宝惠 as separate keys.',
            })}
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isImeComposition(event)) {
              event.preventDefault()
            }
          }}
        >
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            placeholder={t('settings.policies.companyKeyPlaceholder', { defaultValue: 'company-key (e.g. acme-cnc)' })}
            data-testid="company-new-key"
          />
          <Input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder={t('settings.policies.displayNamePlaceholder', { defaultValue: 'Display name' })}
            data-testid="company-new-display-name"
          />
          <Input
            value={newNameCn}
            onChange={(event) => setNewNameCn(event.target.value)}
            placeholder={t('settings.policies.nameCnPlaceholder', { defaultValue: 'Chinese name (optional)' })}
          />
          <Input
            value={newNameEn}
            onChange={(event) => setNewNameEn(event.target.value)}
            placeholder={t('settings.policies.nameEnPlaceholder', { defaultValue: 'English name (optional)' })}
          />
          <div className="md:col-span-2">
            <Button type="submit" disabled={savingKey != null} data-testid="company-create-button">
              {t('settings.policies.createCompany', { defaultValue: 'Save company' })}
            </Button>
          </div>
        </CardContent>
        </form>
      </Card>
    </div>
  )
}

export function PoliciesPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: PoliciesTab = tabParam === 'companies' ? 'companies' : 'candidates'

  const setTab = (tab: PoliciesTab) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'candidates') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-6" data-testid="policies-page">
      <PageHeader
        title={t('settings.policies.title', { defaultValue: 'Policies' })}
        description={t('settings.policies.description', {
          defaultValue: 'Manage candidate blocks and company-level operational policy for this workspace.',
        })}
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('settings.policies.tabsLabel', { defaultValue: 'Policy sections' })}>
        <Button
          type="button"
          role="tab"
          aria-selected={activeTab === 'candidates'}
          variant={activeTab === 'candidates' ? 'default' : 'outline'}
          className={cn(activeTab === 'candidates' && 'shadow-sm')}
          onClick={() => setTab('candidates')}
          data-testid="policies-tab-candidates"
        >
          {t('settings.policies.tabs.candidates', { defaultValue: 'Candidates' })}
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={activeTab === 'companies'}
          variant={activeTab === 'companies' ? 'default' : 'outline'}
          className={cn(activeTab === 'companies' && 'shadow-sm')}
          onClick={() => setTab('companies')}
          data-testid="policies-tab-companies"
        >
          {t('settings.policies.tabs.companies', { defaultValue: 'Companies' })}
        </Button>
      </div>

      {activeTab === 'candidates' ? (
        <div data-testid="policies-candidates-panel">
          <BlacklistPage embedded />
        </div>
      ) : (
        <CompaniesTab />
      )}
    </div>
  )
}
