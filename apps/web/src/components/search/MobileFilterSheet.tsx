import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FacetSidebar } from '@/components/search/FacetSidebar'
import type { FacetSidebarProps } from '@/components/search/FacetSidebar'

type MobileFilterSheetProps = FacetSidebarProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MobileFilterSheet({ open, onOpenChange, ...props }: MobileFilterSheetProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bottom-0 top-auto translate-y-0 rounded-t-[2rem] p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{t('resumes.searchPage.facets.filtersTitle')}</DialogTitle>
          <DialogDescription>
            {t('resumes.searchPage.facets.filtersDescriptionMobile')}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[75vh] overflow-y-auto px-6 pb-6">
          <FacetSidebar {...props} embedded />
        </div>
      </DialogContent>
    </Dialog>
  )
}
