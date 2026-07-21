import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const MAX_CUSTOM = 20
const MAX_KEYWORD_LENGTH = 32

export type PulseKeywordsDialogSeed = {
  version: string
  groups: Array<{ id: string; label: string; keywords: string[] }>
  defaultKeywords: string[]
}

export type PulseKeywordsDialogWorkspace = {
  version: 1
  enabled: string[]
  excluded: string[]
  custom: string[]
}

export type PulseKeywordsDialogState = {
  seed: PulseKeywordsDialogSeed
  workspace: PulseKeywordsDialogWorkspace
  effective: string[]
}

function normalizeKey(k: string): string {
  const nfkc = k.trim().normalize('NFKC')
  return nfkc.replace(/[A-Za-z]+/g, (m) => m.toLowerCase())
}

export type PulseKeywordsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Latest GET /api/research/pulse/keywords payload (seed + workspace). */
  initial: PulseKeywordsDialogState | null
  saving?: boolean
  onSave: (body: {
    enabled: string[]
    excluded: string[]
    custom: string[]
  }) => void | Promise<void>
}

/**
 * 管理关键词: toggle seed defaults (off → excluded) + add/remove custom keywords.
 * Cancel discards local edits; Save PUTs overlay and parent refreshes pulse.
 */
export function PulseKeywordsDialog({
  open,
  onOpenChange,
  initial,
  saving = false,
  onSave,
}: PulseKeywordsDialogProps) {
  const { t } = useTranslation()
  const [checkedDefaults, setCheckedDefaults] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState<string[]>([])
  const [enabled, setEnabled] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  // Reset local draft when dialog opens (Cancel discards by re-init on next open).
  useEffect(() => {
    if (!open || !initial) return
    const excludedNorm = new Set(initial.workspace.excluded.map(normalizeKey))
    const nextChecked = new Set<string>()
    for (const kw of initial.seed.defaultKeywords) {
      if (!excludedNorm.has(normalizeKey(kw))) {
        nextChecked.add(kw)
      }
    }
    setCheckedDefaults(nextChecked)
    setCustom([...initial.workspace.custom])
    setEnabled([...initial.workspace.enabled])
    setDraft('')
    setLocalError(null)
    // Only re-seed when open flips true / seed identity changes via open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const defaultKeywords = initial?.seed.defaultKeywords ?? []

  const toggleDefault = (kw: string, next: boolean) => {
    setCheckedDefaults((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(kw)
      else copy.delete(kw)
      return copy
    })
  }

  const addCustom = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_KEYWORD_LENGTH) {
      setLocalError(
        t('research.pulseKeywords.customTooLong', {
          defaultValue: `自定义词最长 ${MAX_KEYWORD_LENGTH} 字`,
          max: MAX_KEYWORD_LENGTH,
        }),
      )
      return
    }
    if (custom.length >= MAX_CUSTOM) {
      setLocalError(
        t('research.pulseKeywords.customMax', {
          defaultValue: `自定义词最多 ${MAX_CUSTOM} 个`,
          max: MAX_CUSTOM,
        }),
      )
      return
    }
    const norm = normalizeKey(trimmed)
    if (custom.some((c) => normalizeKey(c) === norm)) {
      setLocalError(
        t('research.pulseKeywords.customDuplicate', { defaultValue: '该词已在自定义列表中' }),
      )
      return
    }
    setLocalError(null)
    setCustom((prev) => [...prev, trimmed])
    setDraft('')
  }

  const removeCustom = (kw: string) => {
    setCustom((prev) => prev.filter((c) => c !== kw))
  }

  const handleSave = () => {
    const excluded = defaultKeywords.filter((kw) => !checkedDefaults.has(kw))
    void onSave({ enabled, excluded, custom })
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pulse-keywords-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('research.pulseKeywords.dialogTitle', { defaultValue: '管理关键词' })}
          </DialogTitle>
          <DialogDescription>
            {t('research.pulseKeywords.dialogDescription', {
              defaultValue: '控制市场动态默认词与自定义词（工作区共享）。关闭默认词会将其排除。',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <h3 className="mb-2 text-sm font-medium">
              {t('research.pulseKeywords.defaultsSection', { defaultValue: '默认词' })}
            </h3>
            <ul className="max-h-48 space-y-2 overflow-y-auto" data-testid="pulse-keywords-defaults">
              {defaultKeywords.map((kw) => {
                const id = `pulse-kw-default-${kw}`
                const isChecked = checkedDefaults.has(kw)
                return (
                  <li key={kw} className="flex items-center gap-2">
                    <label
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="h-4 w-4 rounded border border-primary"
                        checked={isChecked}
                        onChange={(e) => toggleDefault(kw, e.target.checked)}
                        data-testid="pulse-keyword-default-toggle"
                        data-keyword={kw}
                      />
                      <span>{kw}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">
              {t('research.pulseKeywords.customSection', { defaultValue: '自定义' })}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_KEYWORD_LENGTH}
                placeholder={t('research.pulseKeywords.customPlaceholder', {
                  defaultValue: '添加关键词',
                })}
                data-testid="pulse-keyword-custom-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustom()
                  }
                }}
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustom}
                data-testid="pulse-keyword-custom-add"
              >
                {t('research.pulseKeywords.addCustom', { defaultValue: '添加' })}
              </Button>
            </div>
            {localError ? (
              <p className="mt-1 text-xs text-red-600" data-testid="pulse-keywords-local-error">
                {localError}
              </p>
            ) : null}
            <ul className="mt-2 flex flex-wrap gap-1" data-testid="pulse-keywords-custom-list">
              {custom.map((kw) => (
                <li key={kw}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs hover:bg-slate-100"
                    onClick={() => removeCustom(kw)}
                    data-testid="pulse-keyword-custom-chip"
                    data-keyword={kw}
                    title={t('research.pulseKeywords.removeCustom', { defaultValue: '移除' })}
                  >
                    {kw}
                    <span aria-hidden className="text-muted-foreground">
                      ×
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={saving}
            data-testid="pulse-keywords-cancel"
          >
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !initial}
            data-testid="pulse-keywords-save"
          >
            {saving
              ? t('research.pulseKeywords.saving', { defaultValue: '保存中…' })
              : t('research.pulseKeywords.save', { defaultValue: '保存' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PulseKeywordsDialog
