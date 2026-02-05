import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/lib/api-client'
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

export function JobDescriptionSelect({ value, onChange, disabled }: JobDescriptionSelectProps) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<JobDescriptionOption[]>([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const { data } = await (apiClient as any).GET('/api/job-descriptions', {
        params: {
          query: {},
        },
      })
      if (!data?.success || !mounted) return
      const items = (data.items ?? []) as JobDescriptionItem[]
      const list = items.map((item) => ({
        value: item.name,
        label: item.title ? `${item.title}` : item.name,
      }))
      setOptions(list)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const selectOptions = useMemo(() => {
    return [
      { value: '', label: t('resumes.jobDescription.placeholder') },
      ...options,
    ]
  }, [options, t])

  return (
    <Select
      options={selectOptions}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  )
}
