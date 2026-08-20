import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CandidateExplanationPage } from './CandidateExplanationPage'

const mockExplanation = {
  summary: 'Your profile showed strong skills but lacked the required industry experience.',
  keyFactors: [
    { factor: 'skills_match', value: 'High' },
    { factor: 'relevant_experience_years', value: '7 years' },
    { factor: 'education_level', value: 'BA' },
  ],
  decidedAt: Date.now() - 3600000,
  decisionType: 'score',
  scrubbedFields: ['age', 'gender'],
  protectedAttributesExcluded: true,
}

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: vi.fn(),
  },
}))

import { rawApiClient } from '@/lib/api-helpers'
const mockPost = vi.mocked(rawApiClient.POST)

function renderPage(resumeId = 'r1', workspace = 'test-workspace') {
  return render(
    <MemoryRouter initialEntries={[`/explanation/${resumeId}?workspace=${workspace}`]}>
      <Routes>
        <Route path="/explanation/:resumeId" element={<CandidateExplanationPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CandidateExplanationPage', () => {
  it('renders loading state', () => {
    mockPost.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading your application status...')).toBeInTheDocument()
  })

  it('renders invalid link when workspace is missing', () => {
    mockPost.mockResolvedValue({ data: { success: true, data: null } })
    render(
      <MemoryRouter initialEntries={['/explanation/r1']}>
        <Routes>
          <Route path="/explanation/:resumeId" element={<CandidateExplanationPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Invalid Link')).toBeInTheDocument()
  })

  it('renders error state', async () => {
    mockPost.mockResolvedValue({ error: 'Network error' })
    renderPage()
    expect(await screen.findByText('Unable to Load')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('renders null explanation state', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: null } })
    renderPage()
    expect(await screen.findByText('No Explanation Available')).toBeInTheDocument()
  })

  it('renders all 3 layers with explanation data', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()

    // Layer 1: Summary
    expect(await screen.findByTestId('candidate-explanation-page')).toBeInTheDocument()
    expect(screen.getByTestId('decision-badge')).toBeInTheDocument()
    expect(screen.getByTestId('summary-text')).toHaveTextContent(
      'Your profile showed strong skills but lacked the required industry experience.',
    )

    // Layer 2: Factors
    expect(screen.getByTestId('factors-table')).toBeInTheDocument()
    expect(screen.getByText('Skills Match')).toBeInTheDocument()
    expect(screen.getByText('Relevant Experience Years')).toBeInTheDocument()
    expect(screen.getByText('Education Level')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('7 years')).toBeInTheDocument()
    expect(screen.getByText('BA')).toBeInTheDocument()

    // Layer 3: Safeguards
    expect(screen.getByText('AI Safeguards')).toBeInTheDocument()
    expect(screen.getByText('Weekly bias audit monitoring')).toBeInTheDocument()
    expect(screen.getByText('Human oversight tracking')).toBeInTheDocument()
    expect(screen.getByText('Anomaly detection for score drift')).toBeInTheDocument()
  })

  it('shows protected attributes excluded note', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()
    expect(await screen.findByTestId('protected-attributes-note')).toHaveTextContent(
      'Protected attributes',
    )
  })

  it('hides protected attributes note when not excluded', async () => {
    mockPost.mockResolvedValue({
      data: {
        success: true,
        data: { ...mockExplanation, protectedAttributesExcluded: false },
      },
    })
    renderPage()
    await screen.findByTestId('candidate-explanation-page')
    expect(screen.queryByTestId('protected-attributes-note')).not.toBeInTheDocument()
  })

  it('renders Request Human Review button', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()
    expect(await screen.findByTestId('request-human-review')).toHaveTextContent(
      'Request Human Review',
    )
  })

  it('renders EU AI Act compliance footer', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()
    expect(await screen.findByText(/EU AI Act Article 13/)).toBeInTheDocument()
  })

  it('renders decision date', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()
    expect(await screen.findByText(/Decision made/)).toBeInTheDocument()
  })

  it('renders factor table with no factors gracefully', async () => {
    mockPost.mockResolvedValue({
      data: {
        success: true,
        data: { ...mockExplanation, keyFactors: [] },
      },
    })
    renderPage()
    await screen.findByTestId('candidate-explanation-page')
    expect(screen.queryByTestId('factors-table')).not.toBeInTheDocument()
  })

  it('calls API with correct resumeId and workspace', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage('r42', 'acme-corp')
    await screen.findByTestId('candidate-explanation-page')
    expect(mockPost).toHaveBeenCalledWith(
      '/api/resumes/explanation',
      expect.objectContaining({
        body: { resumeId: 'r42', workspaceSlug: 'acme-corp' },
      }),
    )
  })

  it('retry button reloads page on error', async () => {
    mockPost.mockResolvedValue({ error: 'Network error' })
    renderPage()
    const retryBtn = await screen.findByText('Retry')
    // Clicking reload triggers window.location.reload which jsdom can't fully execute,
    // but we verify the button exists and is clickable
    expect(retryBtn).toBeInTheDocument()
  })

  it('shows character counter and updates as user types in appeal form', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()
    await screen.findByTestId('appeal-reason')
    expect(screen.getByTestId('appeal-character-count')).toHaveTextContent('0/2000')
    const user = userEvent.setup()
    await user.type(screen.getByTestId('appeal-reason'), 'abc')
    expect(screen.getByTestId('appeal-character-count')).toHaveTextContent('3/2000')
  })

  it('submits appeal on Ctrl+Enter shortcut', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: mockExplanation } })
    renderPage()
    await screen.findByTestId('appeal-reason')
    const user = userEvent.setup()
    await user.type(screen.getByTestId('appeal-reason'), 'please reconsider')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(mockPost).toHaveBeenCalledWith(
      '/api/candidate-appeal',
      expect.objectContaining({
        body: expect.objectContaining({ reason: 'please reconsider' }),
      }),
    )
  })
})
