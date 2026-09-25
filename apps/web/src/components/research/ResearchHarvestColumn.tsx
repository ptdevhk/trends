import { useTranslation } from 'react-i18next'
import { CustomerWatchBlock } from '@/components/research/CustomerWatchBlock'
import { ChannelsBriefingPanel } from '@/components/research/ChannelsBriefingPanel'
import { MpBriefingPanel } from '@/components/research/MpBriefingPanel'
import { Button } from '@/components/ui/button'

type Props = {
  ingesting: boolean
  onRunIngest: () => void
}

/**
 * Pipeline node ① — 采收 · 输入.
 * Customer watch + 视频号 + 公众号 + real ingest trigger.
 * Watchlist spread writes `rss:watch-*` rows that the material pool surfaces.
 */
export function ResearchHarvestColumn({ ingesting, onRunIngest }: Props) {
  const { t } = useTranslation()

  return (
    <section
      className="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3"
      data-testid="research-section-harvest"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700">
          {t('research.pipeline.inputTitle', { defaultValue: '采收 · 输入' })}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={ingesting}
          onClick={onRunIngest}
          data-testid="research-run-ingest"
        >
          {ingesting
            ? t('research.ingesting', { defaultValue: '正在抓取…' })
            : t('research.runIngest', { defaultValue: '运行实时抓取' })}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('research.pipeline.inputHint', {
          defaultValue: '视频号 / 公众号 / 新闻 / 热榜',
        })}
      </p>

      <CustomerWatchBlock />
      <ChannelsBriefingPanel />
      <MpBriefingPanel />
    </section>
  )
}

export default ResearchHarvestColumn
