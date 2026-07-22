import { useEffect, useMemo, useState } from 'react'
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

export type HotlistPlatformsDialogSeed = {
  version: string
  groups: Array<{
    id: string
    label: string
    platforms: Array<{ id: string; name: string; expectedDomain?: string }>
  }>
  defaults: string[]
  catalogIds: string[]
}

export type HotlistPlatformsDialogWorkspace = {
  version: 1
  enabled: string[]
  excluded: string[]
}

export type HotlistPlatformsDialogState = {
  seed: HotlistPlatformsDialogSeed
  workspace: HotlistPlatformsDialogWorkspace
  effective: string[]
}

export type HotlistPlatformsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: HotlistPlatformsDialogState | null
  saving?: boolean
  onSave: (body: { enabled: string[]; excluded: string[] }) => void | Promise<void>
}

/**
 * 数据源: multi-select NewsNow platform ids for workspace ingest set.
 * Save sends enabled = currently checked catalog ids (must be non-empty).
 */
export function HotlistPlatformsDialog({
  open,
  onOpenChange,
  initial,
  saving = false,
  onSave,
}: HotlistPlatformsDialogProps) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !initial) return
    setChecked(new Set(initial.effective))
    setLocalError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const catalogOrder = initial?.seed.catalogIds ?? []

  const toggle = (id: string, next: boolean) => {
    setChecked((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(id)
      else copy.delete(id)
      return copy
    })
    setLocalError(null)
  }

  const enabledOrdered = useMemo(
    () => catalogOrder.filter((id) => checked.has(id)),
    [catalogOrder, checked],
  )

  const handleSave = () => {
    if (enabledOrdered.length === 0) {
      setLocalError(
        t('research.platforms.minOne', {
          defaultValue: '至少选择一个平台',
        }),
      )
      return
    }
    void onSave({ enabled: enabledOrdered, excluded: [] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="research-platforms-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('research.platforms.dialogTitle', { defaultValue: '数据源' })}
          </DialogTitle>
          <DialogDescription>
            {t('research.platforms.dialogDescription', {
              defaultValue:
                '选择本工作区下次「运行实时抓取」时拉取的热榜平台（NewsNow 兼容 ID）。',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {(initial?.seed.groups ?? []).map((group) => (
            <div key={group.id}>
              <h3 className="mb-2 text-sm font-medium">{group.label}</h3>
              <ul className="space-y-2">
                {group.platforms.map((platform) => {
                  const inputId = `research-platform-${platform.id}`
                  const isChecked = checked.has(platform.id)
                  return (
                    <li key={platform.id} className="flex items-center gap-2">
                      <label
                        htmlFor={inputId}
                        className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          className="h-4 w-4 rounded border border-primary"
                          checked={isChecked}
                          onChange={(e) => toggle(platform.id, e.target.checked)}
                          data-testid={`research-platform-toggle-${platform.id}`}
                          data-platform-id={platform.id}
                        />
                        <span>{platform.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {platform.id}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {localError ? (
            <p className="text-xs text-red-600" data-testid="research-platforms-local-error">
              {localError}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground" data-testid="research-platforms-selected-count">
            {t('research.platforms.selectedCount', {
              defaultValue: `已选 ${enabledOrdered.length} 个`,
              count: enabledOrdered.length,
            })}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || enabledOrdered.length === 0}
            data-testid="research-platforms-save"
          >
            {saving
              ? t('common.saving', { defaultValue: '保存中…' })
              : t('common.save', { defaultValue: '保存' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
