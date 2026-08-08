import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSummaryPanel } from '@/components/search/AiSummaryPanel'

const mockT = (key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') {
    return options
  }

  const defaultValue =
    options && typeof options === 'object' && typeof options.defaultValue === 'string'
      ? options.defaultValue
      : key
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
    const value = options && typeof options === 'object' ? options[token] : undefined
    return value === undefined || value === null ? '' : String(value)
  })
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('AiSummaryPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-27T18:10:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows fallback copy when no summary is available', () => {
    render(<AiSummaryPanel />)

    expect(screen.getByText('No summary is available for the current search yet.')).toBeInTheDocument()
  })

  it('renders generated timing relative to now', () => {
    render(
      <AiSummaryPanel
        generatedAt={Date.parse('2026-03-27T18:05:00.000Z')}
        summary="Strong machine-tools coverage with a narrow senior skew."
      />
    )

    expect(screen.getByText('Strong machine-tools coverage with a narrow senior skew.')).toBeInTheDocument()
    expect(screen.getByText('Generated 5 minutes ago')).toBeInTheDocument()
  })

  it('shows loading skeletons instead of summary copy while pending', () => {
    const { container } = render(
      <AiSummaryPanel
        generatedAt={Date.parse('2026-03-27T18:09:30.000Z')}
        loading
        summary="This copy should stay hidden while loading."
      />
    )

    expect(screen.queryByText('This copy should stay hidden while loading.')).not.toBeInTheDocument()
    expect(screen.getByText('Generated 1 minute ago')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('renders the just-now timing branch for freshly generated summaries', () => {
    render(
      <AiSummaryPanel
        generatedAt={Date.parse('2026-03-27T18:09:40.000Z')}
        summary="Fresh summary."
      />
    )

    expect(screen.getByText('Fresh summary.')).toBeInTheDocument()
    expect(screen.getByText('Generated just now')).toBeInTheDocument()
  })

  it('omits the timing footer when no generated timestamp is provided', () => {
    render(<AiSummaryPanel summary="Summary without cache metadata." />)

    expect(screen.getByText('Summary without cache metadata.')).toBeInTheDocument()
    expect(screen.queryByText(/Generated /)).not.toBeInTheDocument()
  })
})
