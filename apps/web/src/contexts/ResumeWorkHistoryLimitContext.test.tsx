import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and applies the configured global limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, limit: 5 }),
    }))

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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, limit: 99 }),
      })
      .mockRejectedValueOnce(new Error('Network error'))
    vi.stubGlobal('fetch', fetchMock)

    const first = render(
      <ResumeWorkHistoryLimitProvider>
        <LimitConsumer />
      </ResumeWorkHistoryLimitProvider>,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByTestId('limit')).toHaveTextContent('3')
    first.unmount()

    render(
      <ResumeWorkHistoryLimitProvider>
        <LimitConsumer />
      </ResumeWorkHistoryLimitProvider>,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).toHaveBeenCalled()
    })
    expect(screen.getByTestId('limit')).toHaveTextContent('3')
  })

  it('updates the effective limit and normalizes invalid updates safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, limit: 3 }),
    }))

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
