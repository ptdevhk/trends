import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QuickStartPanel } from './QuickStartPanel'

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}))

vi.mock('./JobDescriptionSelect', () => ({
  JobDescriptionSelect: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (value: string) => void
  }) => (
    <select
      data-testid="job-description-select"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="">Select job description</option>
      <option value="lathe-sales">车床销售工程师</option>
      <option value="senior-mechanical-engineer">高级机械工程师</option>
    </select>
  ),
}))

vi.mock('./KeywordChips', () => ({
  KeywordChips: () => <div data-testid="keyword-chips" />,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

describe('QuickStartPanel role-aware quick filter label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    postMock.mockResolvedValue({ data: { success: false } })
    getMock.mockImplementation(async (path: string) => {
      if (path.includes('/api/job-descriptions/lathe-sales')) {
        return {
          data: {
            success: true,
            item: {
              requiredRoles: [{ type: 'sales' }],
            },
          },
        }
      }

      if (path.includes('/api/job-descriptions/senior-mechanical-engineer')) {
        return {
          data: {
            success: true,
            item: {
              requiredRoles: [{ type: 'engineer' }],
            },
          },
        }
      }

      return {
        data: {
          success: true,
          item: {
            requiredRoles: [],
          },
        },
      }
    })
  })

  it('switches quick filter label between sales, engineer, and fallback', async () => {
    const { rerender } = render(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId="lathe-sales"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '要求销售经验 最少 年' })).toBeInTheDocument()
    })

    rerender(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId="senior-mechanical-engineer"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '要求工程经验 最少 年' })).toBeInTheDocument()
    })

    rerender(
      <QuickStartPanel
        defaultLocation="广东"
        defaultKeywords={[]}
        jobDescriptionId=""
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '要求相关经验 最少 年' })).toBeInTheDocument()
    })
  })
})
