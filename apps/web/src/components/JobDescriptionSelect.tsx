import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { rawApiClient } from '@/lib/api-helpers'
import { Select } from '@/components/ui/select'
import {
  buildJobDescriptionOptions,
  type ConvexJobDescriptionItem,
  type SystemJobDescriptionItem,
} from './job-description-options'
import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'

interface JobDescriptionSelectProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function JobDescriptionSelect({ value, onChange, disabled }: JobDescriptionSelectProps) {
  const { t } = useTranslation()
  const [systemJobDescriptions, setSystemJobDescriptions] = useState<SystemJobDescriptionItem[]>([])

  const convexJobDescriptions = useQuery(api.job_descriptions.list, {})

  const normalizedConvexJobDescriptions = useMemo<ConvexJobDescriptionItem[]>(
    () =>
      (convexJobDescriptions ?? []).map((item) => ({
        _id: String(item._id),
        title: item.title,
        type: item.type,
        enabled: item.enabled,
      })),
    [convexJobDescriptions]
  )

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const { data } = await rawApiClient.GET<{ success: boolean; items?: SystemJobDescriptionItem[] }>(
        '/api/job-descriptions',
        { params: { query: {} } }
      )
      if (!data?.success || !mounted) return
      setSystemJobDescriptions(data.items ?? [])
    }
    load()
    return () => { mounted = false }
  }, [])

  const selectOptions = useMemo(() => {
    return buildJobDescriptionOptions({
      placeholderLabel: t('resumes.jobDescription.placeholder'),
      convexJobDescriptions: normalizedConvexJobDescriptions,
      systemJobDescriptions,
    })
  }, [normalizedConvexJobDescriptions, systemJobDescriptions, t])

  return (
    <div className="flex items-center gap-1.5">
      <Select
        className="flex-1"
        options={selectOptions}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      {value && (
        <Link
          to="/config/jds"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title={t('resumes.jobDescription.manage')}
          aria-label={t('resumes.jobDescription.manage')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}
