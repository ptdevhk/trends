import { useEffect, useState } from 'react'
import { isImeComposition } from '@/lib/utils'
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
import { Textarea } from '@/components/ui/textarea'

export function CandidateNotesDialog({
  open,
  onOpenChange,
  candidateName,
  notes,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidateName: string
  notes: string
  onSave: (notes: string) => void
}) {
  const { t } = useTranslation()
  const existing = notes.trim()
  const [draft, setDraft] = useState(existing)
  const [editing, setEditing] = useState(existing.length === 0)

  useEffect(() => {
    if (!open) {
      return
    }
    const next = notes.trim()
    setDraft(next)
    setEditing(next.length === 0)
  }, [open, notes])

  const handleClose = () => {
    onOpenChange(false)
  }

  const handleSave = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      handleClose()
      return
    }
    onSave(trimmed)
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="candidate-notes-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('resumes.card.notesTitle', { defaultValue: 'Notes' })
              : t('resumes.card.notesViewTitle', { defaultValue: 'User Comment' })}
          </DialogTitle>
          <DialogDescription>
            {t('resumes.card.notesDescription', {
              name: candidateName || '--',
              defaultValue: '为 {{name}} 添加备注。',
            })}
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('resumes.card.notePlaceholderInput', { defaultValue: '输入备注...' })}
              className="min-h-[96px]"
              data-testid="candidate-notes-input"
              autoFocus
              onKeyDown={(e) => {
                if (isImeComposition(e)) {
                  return
                }
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSave()
                }
              }}
            />
            <p className="text-xs text-muted-foreground" data-testid="candidate-notes-shortcut-hint">
              {t('resumes.card.notesSaveShortcut', { defaultValue: 'Ctrl/⌘ + Enter to save' })}
            </p>
          </div>
        ) : (
          <p
            className="min-h-[96px] whitespace-pre-wrap break-words rounded-md border bg-muted/40 px-3 py-2 text-sm"
            data-testid="candidate-notes-view"
          >
            {draft}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} data-testid="candidate-notes-cancel">
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          {editing ? (
            <Button onClick={handleSave} data-testid="candidate-notes-save">
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
          ) : (
            <Button onClick={() => setEditing(true)} data-testid="candidate-notes-edit">
              {t('common.edit', { defaultValue: 'Edit' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
