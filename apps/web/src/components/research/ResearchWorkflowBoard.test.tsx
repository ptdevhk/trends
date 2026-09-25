import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ResearchWorkflowBoard } from './ResearchWorkflowBoard'

const mockT = (key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

const HARVEST = <div data-testid="col-harvest">采收面板</div>
const POOL = <div data-testid="col-pool">素材池面板</div>
const OUTPUT = <div data-testid="col-output">日报面板</div>

// CSS isn't processed in jsdom (css:false) so Tailwind visibility classes are
// inert. Panel switching is driven by the container `data-stage` + each wrapper
// being toggled to `block` (active) vs `hidden` (inactive) — assert on that.
function activeStage(): string | null {
  return screen.getByTestId('research-workflow-board').getAttribute('data-stage')
}

function panelVisible(testId: string): boolean {
  return screen.getByTestId(testId).className.split(' ').includes('block')
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <ResearchWorkflowBoard teamSlug="hr" harvest={HARVEST} pool={POOL} output={OUTPUT} />
    </MemoryRouter>,
  )
}

describe('ResearchWorkflowBoard', () => {
  it('starts on 今日日报 (the report is the boss-facing output)', () => {
    renderBoard()
    expect(screen.getByTestId('research-pipeline-tab-today')).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(activeStage()).toBe('output')
    expect(panelVisible('research-pipeline-output')).toBe(true)
    expect(panelVisible('research-pipeline-input')).toBe(false)
    expect(panelVisible('research-pipeline-pool')).toBe(false)
  })

  it('clicking 采收 genuinely switches the active panel to harvest', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByTestId('research-pipeline-tab-harvest'))
    expect(screen.getByTestId('research-pipeline-tab-harvest')).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(activeStage()).toBe('harvest')
    expect(panelVisible('research-pipeline-input')).toBe(true)
    expect(panelVisible('research-pipeline-output')).toBe(false)
  })

  it('clicking 素材池 switches the active panel to pool', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByTestId('research-pipeline-tab-pool'))
    expect(activeStage()).toBe('pool')
    expect(panelVisible('research-pipeline-pool')).toBe(true)
    expect(panelVisible('research-pipeline-input')).toBe(false)
    expect(panelVisible('research-pipeline-output')).toBe(false)
  })

  it('shows a stage hint naming the active stage and its purpose', async () => {
    renderBoard()
    await userEvent.setup().click(screen.getByTestId('research-pipeline-tab-harvest'))
    const hint = screen.getByTestId('research-pipeline-stage-hint')
    expect(hint.textContent).toContain('⚡ 采收')
    expect(hint.textContent).toContain('粘贴 boss 的微信链接')
  })

  it('offers the settings link to /hr/settings/research', () => {
    renderBoard()
    expect(screen.getByTestId('research-pipeline-settings-link')).toHaveAttribute(
      'href',
      '/hr/settings/research',
    )
  })
})
