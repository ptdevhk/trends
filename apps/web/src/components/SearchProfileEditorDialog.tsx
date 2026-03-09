import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { rawApiClient } from '@/lib/api-helpers'
import { JobDescriptionSelect } from '@/components/JobDescriptionSelect'
import { LocationSelector } from '@/components/LocationSelector'
import { KeywordInput } from '@/components/KeywordInput'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '../../../../packages/convex/convex/_generated/api'

export type SearchProfileFilters = {
    minExperience?: number
    maxExperience?: number | null
    minAge?: number
    maxAge?: number
    education?: string[]
    salaryRange?: {
        min?: number
        max?: number
    }
    locations?: string[]
}

export type SearchProfileDetails = {
    id: string
    name: string
    status: 'active' | 'paused' | 'archived'
    location: string
    keywords: string[]
    jobDescription?: string
    filterPreset?: string
    filters?: SearchProfileFilters
    schedule?: {
        enabled: boolean
        cron?: string
    }
}

type ProfileResponse = {
    success: boolean
    profile?: SearchProfileDetails
}

type JobDescriptionDetailApiResponse = {
    success: boolean
    item?: {
        title?: string
        location?: string
        suggestedFilters?: {
            minExperience?: number
            maxExperience?: number
            minAge?: number
            maxAge?: number
        }
        autoMatch?: {
            keywords?: string[]
        }
        requiredRoles?: Array<{
            min_years?: number
        }>
    }
}

type ProfileFormState = {
    name: string
    location: string
    keywordsText: string
    jobDescription: string
    minExperience: string
    maxExperience: string
    minAge: string
    maxAge: string
    cron: string
    enabled: boolean
}

const DEFAULT_FORM: ProfileFormState = {
    name: '',
    location: '东莞',
    keywordsText: '',
    jobDescription: '',
    minExperience: '1',
    maxExperience: '',
    minAge: '',
    maxAge: '',
    cron: '0 9 * * 1-5',
    enabled: true,
}

function normalizeStringArray(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
        return []
    }

    const seen = new Set<string>()
    const normalized: string[] = []
    values.forEach((value) => {
        const trimmed = value.trim()
        if (!trimmed || seen.has(trimmed)) {
            return
        }
        seen.add(trimmed)
        normalized.push(trimmed)
    })
    return normalized
}

function toKeywordsText(keywords: string[] | undefined, fallbackText?: string): string {
    const normalized = normalizeStringArray(keywords)
    if (normalized.length > 0) {
        return normalized.join(' ')
    }

    const fallback = fallbackText?.trim()
    return fallback && fallback.length > 0 ? fallback : ''
}

function toLocationText(locations: string[] | undefined, fallbackLocation?: string): string | undefined {
    const normalized = normalizeStringArray(locations)
    if (normalized.length > 0) {
        return normalized.join(',')
    }

    const fallback = fallbackLocation?.trim()
    return fallback && fallback.length > 0 ? fallback : undefined
}

function toNumericText(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function parseOptionalNumber(value: string): number | undefined {
    const normalized = value.trim()
    if (!normalized) return undefined
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function parseKeywords(value: string): string[] {
    return value
        .split(/[\s,，、]+/)
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
}

function toFormState(profile: SearchProfileDetails): ProfileFormState {
    return {
        name: profile.name,
        location: profile.location,
        keywordsText: profile.keywords.join(' '),
        jobDescription: profile.jobDescription || '',
        minExperience: typeof profile.filters?.minExperience === 'number' ? String(profile.filters.minExperience) : '1',
        maxExperience: typeof profile.filters?.maxExperience === 'number' ? String(profile.filters.maxExperience) : '',
        minAge: typeof profile.filters?.minAge === 'number' ? String(profile.filters.minAge) : '',
        maxAge: typeof profile.filters?.maxAge === 'number' ? String(profile.filters.maxAge) : '',
        cron: profile.schedule?.cron || '',
        enabled: profile.status === 'active',
    }
}

export interface SearchProfileEditorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    profileId: string | null
    initialData?: SearchProfileDetails
    onSaved?: (profile?: SearchProfileDetails) => void
}

export function SearchProfileEditorDialog({
    open,
    onOpenChange,
    profileId,
    initialData,
    onSaved,
}: SearchProfileEditorDialogProps) {
    const { t } = useTranslation()
    const { slug } = useWorkspace()
    const [form, setForm] = useState<ProfileFormState>(DEFAULT_FORM)
    const [submitting, setSubmitting] = useState(false)
    const [pendingJobDescriptionHydration, setPendingJobDescriptionHydration] = useState<{
        id: string
        requestId: number
    } | null>(null)
    const latestHydrationRequestIdRef = useRef(0)

    const convexJobDescriptions = useQuery(api.job_descriptions.list, { workspaceSlug: slug })
    const selectedConvexJobDescription = useMemo(() => {
        const normalizedJobDescriptionId = form.jobDescription.trim()
        if (!normalizedJobDescriptionId || !convexJobDescriptions) {
            return undefined
        }

        return convexJobDescriptions.find((item) => String(item._id) === normalizedJobDescriptionId)
    }, [convexJobDescriptions, form.jobDescription])
    const selectedConvexJobDescriptionDetail = useQuery(
        api.job_descriptions.get,
        selectedConvexJobDescription ? { id: selectedConvexJobDescription._id } : 'skip'
    )

    useEffect(() => {
        if (!open) {
            setPendingJobDescriptionHydration(null)
            return
        }

        // When opened
        if (initialData) {
            setForm(toFormState(initialData))
            return
        }

        if (profileId) {
            void loadProfile(profileId)
        } else {
            setForm(DEFAULT_FORM)
        }
    }, [open, profileId, initialData])

    useEffect(() => {
        if (!open || !pendingJobDescriptionHydration) {
            return
        }

        const { id, requestId } = pendingJobDescriptionHydration
        const completeHydration = () => {
            if (latestHydrationRequestIdRef.current !== requestId) {
                return
            }
            setPendingJobDescriptionHydration((current) => (
                current?.requestId === requestId ? null : current
            ))
        }

        if (convexJobDescriptions === undefined) {
            return
        }

        if (selectedConvexJobDescription) {
            if (selectedConvexJobDescriptionDetail === undefined) {
                return
            }

            const keywordsText = toKeywordsText(
                selectedConvexJobDescriptionDetail?.customKeywords,
                selectedConvexJobDescription.title
            )
            const location = toLocationText(undefined, selectedConvexJobDescriptionDetail?.location)
            const minExperience = selectedConvexJobDescriptionDetail?.minExperience

            setForm((previous) => ({
                ...previous,
                location: location ?? previous.location,
                keywordsText,
                minExperience: typeof minExperience === 'number' ? String(minExperience) : DEFAULT_FORM.minExperience,
                maxExperience: toNumericText(selectedConvexJobDescriptionDetail?.maxExperience),
                minAge: toNumericText(selectedConvexJobDescriptionDetail?.minAge),
                maxAge: toNumericText(selectedConvexJobDescriptionDetail?.maxAge),
            }))
            completeHydration()
            return
        }

        let cancelled = false

        const hydrateSystemJobDescription = async () => {
            try {
                const { data } = await rawApiClient.GET<JobDescriptionDetailApiResponse>(
                    `/api/job-descriptions/${encodeURIComponent(id)}`
                )
                if (cancelled || latestHydrationRequestIdRef.current !== requestId) {
                    return
                }

                const item = data?.item
                if (!item) {
                    return
                }

                const suggestedFilters = item.suggestedFilters
                const keywordsText = toKeywordsText(item.autoMatch?.keywords, item.title)
                const location = toLocationText(undefined, item.location)
                const minExperience = typeof item.requiredRoles?.[0]?.min_years === 'number'
                    ? item.requiredRoles[0].min_years
                    : suggestedFilters?.minExperience

                setForm((previous) => ({
                    ...previous,
                    location: location ?? previous.location,
                    keywordsText,
                    minExperience: typeof minExperience === 'number' ? String(minExperience) : DEFAULT_FORM.minExperience,
                    maxExperience: toNumericText(suggestedFilters?.maxExperience),
                    minAge: toNumericText(suggestedFilters?.minAge),
                    maxAge: toNumericText(suggestedFilters?.maxAge),
                }))
            } catch (error) {
                console.error('Failed to load job description defaults', error)
            } finally {
                if (!cancelled) {
                    completeHydration()
                }
            }
        }

        void hydrateSystemJobDescription()

        return () => {
            cancelled = true
        }
    }, [open, pendingJobDescriptionHydration, convexJobDescriptions, selectedConvexJobDescription, selectedConvexJobDescriptionDetail])

    const loadProfile = async (id: string) => {
        try {
            const { data } = await rawApiClient.GET<ProfileResponse>(`/api/search-profiles/${id}`)
            if (!data?.success || !data.profile) {
                toast.error(t('searchProfiles.loadDetailError', { defaultValue: 'Failed to load profile details' }))
                onOpenChange(false)
                return
            }
            setForm(toFormState(data.profile))
        } catch (error) {
            console.error('Failed to load profile', error)
            toast.error(t('searchProfiles.loadDetailError', { defaultValue: 'Failed to load profile details' }))
            onOpenChange(false)
        }
    }

    const handleJobDescriptionChange = useCallback((value: string) => {
        setForm((previous) => ({ ...previous, jobDescription: value }))

        const normalizedValue = value.trim()
        latestHydrationRequestIdRef.current += 1
        if (!normalizedValue) {
            setPendingJobDescriptionHydration(null)
            return
        }

        setPendingJobDescriptionHydration({
            id: normalizedValue,
            requestId: latestHydrationRequestIdRef.current,
        })
    }, [])

    const handleSave = useCallback(async () => {
        const keywords = parseKeywords(form.keywordsText)
        if (!form.name.trim() || keywords.length === 0) {
            toast.error(t('searchProfiles.validationError', { defaultValue: 'Name and keywords are required' }))
            return
        }

        const parsedMinExp = parseOptionalNumber(form.minExperience)
        const parsedMaxExp = parseOptionalNumber(form.maxExperience)
        const parsedMinAge = parseOptionalNumber(form.minAge)
        const parsedMaxAge = parseOptionalNumber(form.maxAge)

        const hasFilters = parsedMinExp !== undefined || parsedMaxExp !== undefined || parsedMinAge !== undefined || parsedMaxAge !== undefined

        const payload = {
            name: form.name.trim(),
            location: form.location.trim(),
            keywords,
            status: form.enabled ? 'active' : 'paused',
            jobDescription: form.jobDescription.trim() || null,
            filters: hasFilters ? {
                minExperience: parsedMinExp,
                maxExperience: parsedMaxExp,
                minAge: parsedMinAge,
                maxAge: parsedMaxAge,
            } : null,
            schedule: {
                enabled: form.enabled,
                cron: form.cron.trim() || undefined,
            },
        }

        setSubmitting(true)
        try {
            if (profileId) {
                const { data } = await rawApiClient.PUT<{ success: boolean; profile?: SearchProfileDetails }>(`/api/search-profiles/${profileId}`, {
                    body: payload,
                })
                if (!data?.success || !data.profile) {
                    throw new Error('Failed to update profile')
                }
                onSaved?.(data.profile)
            } else {
                const { data } = await rawApiClient.POST<{ success: boolean; profile?: SearchProfileDetails }>('/api/search-profiles', {
                    body: payload,
                })
                if (!data?.success || !data.profile) {
                    throw new Error('Failed to create profile')
                }
                onSaved?.(data.profile)
            }

            onOpenChange(false)
            toast.success(t('searchProfiles.saveSuccess', { defaultValue: 'Profile saved' }))
        } catch (error) {
            console.error('Failed to save profile', error)
            toast.error(t('searchProfiles.saveError', { defaultValue: 'Failed to save profile' }))
        } finally {
            setSubmitting(false)
        }
    }, [profileId, form, t, onOpenChange, onSaved])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {profileId
                            ? t('searchProfiles.editTitle', { defaultValue: 'Edit Profile' })
                            : t('searchProfiles.createTitle', { defaultValue: 'Create Profile' })}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                        <Label htmlFor="profile-name">{t('searchProfiles.fields.name', { defaultValue: 'Name' })}</Label>
                        <Input
                            id="profile-name"
                            value={form.name}
                            onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="profile-location">{t('searchProfiles.fields.location', { defaultValue: '地区:' })}</Label>
                        <LocationSelector
                            id="profile-location"
                            value={form.location}
                            onChange={(location) => setForm((previous) => ({ ...previous, location }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="profile-keywords">{t('searchProfiles.fields.keywords', { defaultValue: '关键词:' })}</Label>
                        <KeywordInput
                            id="profile-keywords"
                            value={form.keywordsText}
                            onChange={(keywordsText) => setForm((previous) => ({ ...previous, keywordsText }))}
                            placeholder={t('searchProfiles.fields.keywordsPlaceholder', { defaultValue: 'e.g. 车床 销售 CNC' })}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('searchProfiles.fields.jobDescription', { defaultValue: 'Job Description' })}</Label>
                        <JobDescriptionSelect
                            value={form.jobDescription}
                            onChange={handleJobDescriptionChange}
                        />
                    </div>

                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="profile-minExperience">{t('jdEditor.minRelatedExp', { defaultValue: '最低相关经验(年)' })}</Label>
                                <Input
                                    id="profile-minExperience"
                                    type="number"
                                    min={0}
                                    value={form.minExperience}
                                    onChange={(event) => setForm((previous) => ({ ...previous, minExperience: event.target.value }))}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="profile-maxExperience">{t('jdEditor.maxRelatedExp', { defaultValue: '最高相关经验(年)' })}</Label>
                                <Input
                                    id="profile-maxExperience"
                                    type="number"
                                    min={0}
                                    value={form.maxExperience}
                                    onChange={(event) => setForm((previous) => ({ ...previous, maxExperience: event.target.value }))}
                                />
                            </div>
                        </div>
                        <span className="text-xs text-muted-foreground">{t('jdEditor.defaultExp', { defaultValue: 'Default: min 1 year' })}</span>
                    </div>

                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="profile-minAge">{t('jdEditor.minAge', { defaultValue: '最低年龄' })}</Label>
                                <Input
                                    id="profile-minAge"
                                    type="number"
                                    min={0}
                                    value={form.minAge}
                                    onChange={(event) => setForm((previous) => ({ ...previous, minAge: event.target.value }))}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="profile-maxAge">{t('jdEditor.maxAge', { defaultValue: '最高年龄' })}</Label>
                                <Input
                                    id="profile-maxAge"
                                    type="number"
                                    min={0}
                                    value={form.maxAge}
                                    onChange={(event) => setForm((previous) => ({ ...previous, maxAge: event.target.value }))}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="profile-cron">{t('searchProfiles.fields.cron', { defaultValue: 'Cron Expression' })}</Label>
                        <Input
                            id="profile-cron"
                            value={form.cron}
                            onChange={(event) => setForm((previous) => ({ ...previous, cron: event.target.value }))}
                            placeholder="0 9 * * 1-5"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={form.enabled}
                            onCheckedChange={(checked) => setForm((previous) => ({ ...previous, enabled: checked === true }))}
                            id="profile-enabled"
                        />
                        <Label htmlFor="profile-enabled">{t('searchProfiles.fields.enabled', { defaultValue: 'Enabled' })}</Label>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('searchProfiles.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button onClick={() => void handleSave()} disabled={submitting}>
                        {submitting
                            ? t('searchProfiles.saving', { defaultValue: 'Saving...' })
                            : t('searchProfiles.save', { defaultValue: 'Save' })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
