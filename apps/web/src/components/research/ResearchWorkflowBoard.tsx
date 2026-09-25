import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type WorkflowStage = 'harvest' | 'pool' | 'output'

type Props = {
  teamSlug: string
  harvest: ReactNode
  pool: ReactNode
  output: ReactNode
}

/**
 * Composed daily-sales workflow shell — real layout nodes, no #hash jumps.
 * Desktop: 3-column grid. Mobile: stage tabs swap the visible column.
 */
export function ResearchWorkflowBoard({ teamSlug, harvest, pool, output }: Props) {
  const { t } = useTranslation()
  // Start on 今日日报 — the report is the boss-facing output of the daily
  // workflow, and the first thing a visitor should see.
  const [stage, setStage] = useState<WorkflowStage>('output')

  const stages: Array<{ id: WorkflowStage; label: string; testId: string; hint: string }> = [
    {
      id: 'harvest',
      label: t('research.pipeline.harvest', { defaultValue: '⚡ 采收' }),
      testId: 'research-pipeline-tab-harvest',
      hint: t('research.pipeline.harvestHint', {
        defaultValue: '粘贴 boss 的微信链接，识别客户并加入监控清单。',
      }),
    },
    {
      id: 'pool',
      label: t('research.pipeline.pool', { defaultValue: '🗂 素材池' }),
      testId: 'research-pipeline-tab-pool',
      hint: t('research.pipeline.poolHint', {
        defaultValue: '浏览实时资讯与客户监控扩散的素材，可关键词筛选 / 推入日报。',
      }),
    },
    {
      id: 'output',
      label: t('research.pipeline.today', { defaultValue: '📰 今日日报' }),
      testId: 'research-pipeline-tab-today',
      hint: t('research.pipeline.todayHint', {
        defaultValue: '查看 / 重新生成今天的销售日报（定稿C 版式）。',
      }),
    },
  ]

  const activeStage = stages.find((s) => s.id === stage)

  return (
    <div data-testid="research-harvest-pipeline" className="space-y-3">
      <nav
        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
        data-testid="research-pipeline-tabs"
      >
        <span className="text-sm font-bold text-slate-900">
          {t('research.pipeline.nav', { defaultValue: '每日销售工作流' })}
        </span>
        {stages.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={s.testId}
            data-active={stage === s.id ? 'true' : 'false'}
            aria-current={stage === s.id ? 'step' : undefined}
            aria-label={s.hint}
            onClick={() => setStage(s.id)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              stage === s.id
                ? 'bg-blue-600 text-white'
                : 'border border-slate-200 text-slate-600 hover:border-blue-300 lg:bg-transparent',
            )}
          >
            {s.label}
          </button>
        ))}
        <Link
          to={`/${teamSlug}/settings/research`}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700"
          data-testid="research-pipeline-settings-link"
        >
          {t('research.pipeline.config', { defaultValue: '⚙ 配置' })}
        </Link>
      </nav>

      {/* Demo hint for the active stage: makes clicking a tab meaningful. */}
      {activeStage ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="research-pipeline-stage-hint"
        >
          <span className="font-medium text-slate-700">{activeStage.label}</span> · {activeStage.hint}
        </p>
      ) : null}

      {/* Stage panels. Clicking a tab shows ONLY that stage on every breakpoint
          (previously the 3 columns were always visible on desktop, so inactive
          tab clicks felt like no-ops). Mobile keeps the same single-panel view. */}
      <div
        className="grid gap-3 lg:grid-cols-1"
        data-testid="research-workflow-board"
        data-stage={stage}
      >
        <div
          className={cn('min-h-[20rem]', stage === 'harvest' ? 'block' : 'hidden')}
          data-testid="research-pipeline-input"
        >
          {harvest}
        </div>
        <div
          className={cn('min-h-[20rem]', stage === 'pool' ? 'block' : 'hidden')}
          data-testid="research-pipeline-pool"
        >
          {pool}
        </div>
        <div
          className={cn('min-h-[20rem]', stage === 'output' ? 'block' : 'hidden')}
          data-testid="research-pipeline-output"
        >
          {output}
        </div>
      </div>
    </div>
  )
}

export default ResearchWorkflowBoard
