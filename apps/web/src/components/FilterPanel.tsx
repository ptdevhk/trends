import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import type { ResumeFilters } from '@/types/resume'

interface FilterPanelProps {
  filters: ResumeFilters
  onChange: (filters: ResumeFilters) => void
  mode: 'ai' | 'original'
}

const EDUCATION_LEVELS = [
  { value: 'high_school', labelKey: 'resumes.filters.education.high_school' },
  { value: 'associate', labelKey: 'resumes.filters.education.associate' },
  { value: 'bachelor', labelKey: 'resumes.filters.education.bachelor' },
  { value: 'master', labelKey: 'resumes.filters.education.master' },
  { value: 'phd', labelKey: 'resumes.filters.education.phd' },
]

export function FilterPanel({ filters, onChange, mode }: FilterPanelProps) {
  const { t } = useTranslation()

  const [minExperience, setMinExperience] = useState('')
  const [maxExperience, setMaxExperience] = useState('')
  const [minMatchScore, setMinMatchScore] = useState('')
  const [skills, setSkills] = useState('')
  const [locations, setLocations] = useState('')
  const [education, setEducation] = useState<string[]>([])
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    setMinExperience(filters.minExperience?.toString() ?? '')
    setMaxExperience(filters.maxExperience?.toString() ?? '')
    setMinMatchScore(filters.minMatchScore?.toString() ?? '')
    setSkills(filters.skills?.join(',') ?? '')
    setLocations(filters.locations?.join(',') ?? '')
    setEducation(filters.education ?? [])
  }, [filters])

  const educationSet = useMemo(() => new Set(education), [education])

  const toggleEducation = (value: string) => {
    setEducation((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value)
      }
      return [...prev, value]
    })
  }

  const handleApply = () => {
    if (clearing) return
    onChange({
      ...filters,
      minExperience: minExperience ? Number(minExperience) : undefined,
      maxExperience: maxExperience ? Number(maxExperience) : undefined,
      minMatchScore: mode === 'ai' && minMatchScore ? Number(minMatchScore) : undefined,
      skills: skills
        ? skills
          .split(/[,，、]/g)
          .map((item) => item.trim())
          .filter(Boolean)
        : undefined,
      locations: locations
        ? locations
          .split(/[,，、]/g)
          .map((item) => item.trim())
          .filter(Boolean)
        : undefined,
      education: education.length ? education : undefined,
    })
  }

  const handleClear = () => {
    setClearing(true)
    setMinExperience('')
    setMaxExperience('')
    setMinMatchScore('')
    setSkills('')
    setLocations('')
    setEducation([])
    onChange({})
    window.setTimeout(() => setClearing(false), 200)
  }

  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold">筛选条件</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleClear} disabled={clearing} className="text-muted-foreground hover:text-foreground">
            {t('resumes.filters.clear')}
          </Button>
          <Button size="sm" onClick={handleApply} disabled={clearing}>
            {t('resumes.filters.apply')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Row 1: Numeric Filters */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.minExperience')}</label>
              <Input
                type="number"
                value={minExperience}
                onChange={(event) => setMinExperience(event.target.value)}
                placeholder="0"
                className="bg-background"
              />
            </div>
            <span className="mb-2 text-muted-foreground">-</span>
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.maxExperience')}</label>
              <Input
                type="number"
                value={maxExperience}
                onChange={(event) => setMaxExperience(event.target.value)}
                placeholder="10"
                className="bg-background"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.minMatchScore')}</label>
            <Input
              type="number"
              value={minMatchScore}
              onChange={(event) => setMinMatchScore(event.target.value)}
              placeholder="70"
              className="bg-background"
              disabled={mode !== 'ai'}
            />
          </div>
          {/* Spacer for 3rd column if needed or move skills here */}
        </div>

        {/* Row 2: Text Filters */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.skills')}</label>
            <Input
              value={skills}
              onChange={(event) => setSkills(event.target.value)}
              placeholder="例如：CNC, FANUC"
              className="bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.locations')}</label>
            <Input
              value={locations}
              onChange={(event) => setLocations(event.target.value)}
              placeholder="例如：东莞, 深圳"
              className="bg-background"
            />
          </div>
        </div>

        {/* Row 3: Education */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">{t('resumes.filters.education.title')}</label>
          <div className="flex flex-wrap gap-4">
            {EDUCATION_LEVELS.map((level) => (
              <label key={level.value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
                <Checkbox
                  checked={educationSet.has(level.value)}
                  onCheckedChange={() => toggleEducation(level.value)}
                />
                {t(level.labelKey)}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
