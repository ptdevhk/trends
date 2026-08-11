import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

import {
  ResumeWorkHistoryLimitProvider,
  useResumeWorkHistoryLimit,
} from './ResumeWorkHistoryLimitContext'

function LimitConsumer() {
  const { limit, setLimit } = useResumeWorkHistoryLimit()

  return (
    <div>
      <span data-testid="limit">{limit}</span>
      <button type="button" onClick={() => setLimit(4)}>Set four</button>
      <button type="button" onClick={() => setLimit(99)}>Set invalid</button>
    </div>
  )
}

describe('ResumeWorkHistoryLimitProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and applies the configured global limit', async () => {
    getMock.mockResolvedValue({
      data: { success: true, limit: 5 },
      response: { ok: true, status: 200 },
    })

    render(
      <ResumeWorkHistoryLimitProvider>
        <LimitConsumer />
      </ResumeWorkHistoryLimitProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('limit')).toHaveTextContent('5')
    })
  })

  it('keeps the default when loading fails or returns an invalid value', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getMock
      .mockResolvedValueOnce({
        data: { success: true, limit: 99 },
        response: { ok: true, status: 200 },
      })
      .mockRejectedValueOnce(new Error('Network error'))

    const first = render(
      <ResumeWorkHistoryLimitProvider>
        <LimitConsumer />
      </ResumeWorkHistoryLimitProvider>,
    )

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('limit')).toHaveTextContent('3')
    first.unmount()

    render(
      <ResumeWorkHistoryLimitProvider>
        <LimitConsumer />
      </ResumeWorkHistoryLimitProvider>,
    )

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).toHaveBeenCalled()
    })
    expect(screen.getByTestId('limit')).toHaveTextContent('3')
  })

  it('updates the effective limit and normalizes invalid updates safely', async () => {
    getMock.mockResolvedValue({
      data: { success: true, limit: 3 },
      response: { ok: true, status: 200 },
    })

    render(
      <ResumeWorkHistoryLimitProvider>
        <LimitConsumer />
      </ResumeWorkHistoryLimitProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('limit')).toHaveTextContent('3')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set four' }))
    expect(screen.getByTestId('limit')).toHaveTextContent('4')

    fireEvent.click(screen.getByRole('button', { name: 'Set invalid' }))
    expect(screen.getByTestId('limit')).toHaveTextContent('3')
  })
})
