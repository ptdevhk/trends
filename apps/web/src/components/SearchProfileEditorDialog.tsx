import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { rawApiClient } from '@/lib/api-helpers'
import { JobDescriptionSelect } from '@/components/JobDescriptionSelect'
import { LocationSelector } from '@/components/LocationSelector'
import { KeywordInput } from '@/components/KeywordInput'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

export type SearchProfileDetails = {
    id: string
    name: string
    status: 'active' | 'paused' | 'archived'
    location: string
    keywords: string[]
    jobDescription?: string
    filterPreset?: string
    schedule?: {
        enabled: boolean
        cron?: string
    }
}

type ProfileResponse = {
    success: boolean
    profile?: SearchProfileDetails
}

type ProfileFormState = {
    name: string
    location: string
    keywordsText: string
    jobDescription: string
    cron: string
    enabled: boolean
}

const DEFAULT_FORM: ProfileFormState = {
    name: '',
    location: '东莞',
    keywordsText: '',
    jobDescription: '',
    cron: '0 9 * * 1-5',
    enabled: true,
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
        cron: profile.schedule?.cron || '',
        enabled: profile.status === 'active',
    }
}

export interface SearchProfileEditorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    profileId: string | null
    initialData?: SearchProfileDetails
    onSaved?: () => void
}

export function SearchProfileEditorDialog({
    open,
    onOpenChange,
    profileId,
    initialData,
    onSaved,
}: SearchProfileEditorDialogProps) {
    const { t } = useTranslation()
    const [form, setForm] = useState<ProfileFormState>(DEFAULT_FORM)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (!open) {
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

    const handleSave = useCallback(async () => {
        const keywords = parseKeywords(form.keywordsText)
        if (!form.name.trim() || !form.location.trim() || keywords.length === 0) {
            toast.error(t('searchProfiles.validationError', { defaultValue: 'Name, location and keywords are required' }))
            return
        }

        const payload = {
            name: form.name.trim(),
            location: form.location.trim(),
            keywords,
            status: form.enabled ? 'active' : 'paused',
            jobDescription: form.jobDescription.trim() || undefined,
            schedule: {
                enabled: form.enabled,
                cron: form.cron.trim() || undefined,
            },
        }

        setSubmitting(true)
        try {
            if (profileId) {
                const { data } = await rawApiClient.PUT<{ success: boolean }>(`/api/search-profiles/${profileId}`, {
                    body: payload,
                })
                if (!data?.success) {
                    throw new Error('Failed to update profile')
                }
            } else {
                const { data } = await rawApiClient.POST<{ success: boolean }>('/api/search-profiles', {
                    body: payload,
                })
                if (!data?.success) {
                    throw new Error('Failed to create profile')
                }
            }

            onOpenChange(false)
            toast.success(t('searchProfiles.saveSuccess', { defaultValue: 'Profile saved' }))
            onSaved?.()
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
                        <Label htmlFor="profile-location">{t('searchProfiles.fields.location', { defaultValue: 'Location' })}</Label>
                        <LocationSelector
                            id="profile-location"
                            value={form.location}
                            onChange={(location) => setForm((previous) => ({ ...previous, location }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="profile-keywords">{t('searchProfiles.fields.keywords', { defaultValue: 'Keywords' })}</Label>
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
                            onChange={(value) => setForm((previous) => ({ ...previous, jobDescription: value }))}
                        />
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
