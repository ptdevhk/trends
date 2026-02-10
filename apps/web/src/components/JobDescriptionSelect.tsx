import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { rawApiClient } from '@/lib/api-helpers'
import { Select } from '@/components/ui/select'

interface JobDescriptionOption {
  value: string
  label: string
}

interface JobDescriptionItem {
  name: string
  title?: string
}

interface JobDescriptionSelectProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'

export function JobDescriptionSelect({ value, onChange, disabled }: JobDescriptionSelectProps) {
  const { t } = useTranslation()
  const [systemOptions, setSystemOptions] = useState<JobDescriptionOption[]>([])

  // Fetch Custom JDs
  const customJDs = useQuery(api.job_descriptions.list, {})

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const { data } = await rawApiClient.GET<{ success: boolean; items?: JobDescriptionItem[] }>(
        '/api/job-descriptions',
        { params: { query: {} } }
      )
      if (!data?.success || !mounted) return
      const items = (data.items ?? []) as JobDescriptionItem[]
      const list = items.map((item) => ({
        value: item.name,
        label: `${item.title || item.name} (System)`,
      }))
      setSystemOptions(list)
    }
    load()
    return () => { mounted = false }
  }, [])

  const selectOptions = useMemo(() => {
    const customOptions = (customJDs ?? []).map(jd => ({
      value: jd._id,
      label: `✨ ${jd.title} (Custom)`
    }));

    return [
      { value: '', label: t('resumes.jobDescription.placeholder') },
      ...customOptions,
      ...systemOptions,
    ]
  }, [systemOptions, customJDs, t])

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
