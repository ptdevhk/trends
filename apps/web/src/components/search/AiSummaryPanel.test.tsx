import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSummaryPanel } from '@/components/search/AiSummaryPanel'

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
})
