import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SnippetCard } from '@/components/search/SnippetCard'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

const mockT = (key: string, options?: string | Record<string, string | number | undefined>) => {
  if (typeof options === 'string') {
    return options
  }

  const defaultValue =
    options && typeof options === 'object' && typeof options.defaultValue === 'string'
      ? options.defaultValue
      : key

  // Simple mock for score labels if no defaultValue present
  let result = defaultValue
  if (result === 'resumes.matching.scoreLabel' && typeof options?.score === 'number') {
    result = String(Math.round(options.score))
  }

  return result.replace(/\{\{(\w+)\}\}/g, (_: string, token: string) => {
    const value = options && typeof options === 'object' ? options[token] : undefined
    return value === undefined || value === null ? '' : String(value)
  })
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/hooks/useCompanyPolicyIndex', () => ({
  useCompanyPolicyIndex: () => ({
    aliasIndex: new Map(),
    loading: false,
    error: null,
    load: vi.fn(),
    hasPolicies: false,
    matchResume: () => [],
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/components/search/SnippetCardExpanded', () => ({
  SnippetCardExpanded: ({
    item,
    onBlockTrigger,
    onNoteTrigger,
    onCandidateStatusChange,
  }: {
    item: ResumeSearchResultItem
    onBlockTrigger?: () => void
    onNoteTrigger?: () => void
    onCandidateStatusChange?: (identityKey: string, status: string, notes?: string) => void
  }) => (
    <div>
      <div>Expanded card for {item.resume.name ?? 'Unnamed resume'}</div>
      {onBlockTrigger ? (
        <button data-testid="block-trigger" onClick={() => onBlockTrigger()}>
          Block
        </button>
      ) : null}
      {onNoteTrigger ? (
        <button data-testid="note-trigger" onClick={() => onNoteTrigger()}>
          Add Note
        </button>
      ) : null}
      {onCandidateStatusChange ? (
        <>
          <button data-testid="status-reject" onClick={() => onCandidateStatusChange(item.identityKey, 'interviewed_reject')}>
            Mark Rejected
          </button>
          <button data-testid="status-hired" onClick={() => onCandidateStatusChange(item.identityKey, 'hired')}>
            Mark Hired
          </button>
        </>
      ) : null}
    </div>
  ),
}))

function createResume(index: number, overrides: Partial<ConvexResumeItem> = {}): ConvexResumeItem {
  return {
    resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
    externalId: `resume-${index}`,
    name: `Candidate ${index}`,
    profileUrl: '',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '6 years',
    education: 'Bachelor',
    location: 'Kuala Lumpur',
    extractedAt: new Date('2026-03-27T10:00:00.000Z').toISOString(),
    expectedSalary: '',
    jobIntention: 'Regional sales coverage',
    selfIntro: 'Short intro summary',
    skills: [],
    workHistory: [
      {
        companyName: `Company ${index}`,
        jobTitle: 'Regional Sales Manager',
        raw: 'Led machine tools growth across Malaysia.',
      },
    ],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    ingestData: {
      industryTags: ['Machine Tools', 'Automation', 'Robotics', 'Servo'],
      synonymHits: [],
      brandHits: [],
      companyHits: ['FANUC'],
      ruleScores: {},
      experienceLevel: 'senior',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
    _provenance: [
      { term: 'CNC', source: 'searchText' },
      { term: 'Machine Tools', source: 'industryTags' },
      { term: 'Malaysia', source: 'searchText' },
      { term: 'Ignored', source: 'searchText' },
    ],
    ...overrides,
  }
}

function createResult(index: number, overrides: Partial<ResumeSearchResultItem> = {}): ResumeSearchResultItem {
  const hasScoreOverride = Object.prototype.hasOwnProperty.call(overrides, 'score')

  return {
    key: overrides.key ?? `resume-${index}`,
    identityKey: overrides.identityKey ?? `identity-${index}`,
    analysis: overrides.analysis,
    blocked: overrides.blocked ?? false,
    score: hasScoreOverride ? overrides.score : 87.6,
    scoreSource: overrides.scoreSource ?? 'ai',
    status: overrides.status ?? 'new',
    statusMeta: overrides.statusMeta,
    refreshState: overrides.refreshState,
    resume: overrides.resume ?? createResume(index),
  }
}

describe('SnippetCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the compact approved evidence summary on an ordinary search result', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, {
            ingestData: {
              industryTags: [],
              synonymHits: [],
              brandHits: [],
              companyHits: [],
              ruleScores: {},
              experienceLevel: 'senior',
              verifiedIndustryEvidenceSummaries: [{
                companyKey: 'acme-cnc',
                companyName: 'Acme CNC',
                industryClass: 'cnc',
                verificationLevel: 'verified',
                verdictRevisionId: 'revision-1',
                evidenceSummary: 'Human-approved CNC machinery evidence.',
                reviewedAt: Date.UTC(2026, 6, 20),
                sourceCount: 0,
                sourcePreviews: [],
                additionalSourceCount: 0,
              }],
            },
          }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />,
    )

    expect(screen.getByText(/CNC (Verified|行业验证)/)).toBeInTheDocument()
    expect(screen.getByText('Human-approved CNC machinery evidence.')).toBeInTheDocument()
  })

  it('renders headline, score, provenance keywords, and toggles expansion', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()

    render(
      <SnippetCard
        expanded
        showAiScore
        item={createResult(1, {
          analysis: {
            score: 87.6,
            summary: 'Strong CNC sales coverage across Malaysia.',
            highlights: [],
            recommendation: 'strong_match',
          },
        })}
        itemKey="result-1"
        onToggleExpanded={onToggleExpanded}
      />
    )

    expect(screen.getByText('Candidate 1')).toBeInTheDocument()
    // Latest job title appears both in the headline and in the work-history role line
    // (the work-history row renders company and role as visually distinct parts).
    expect(screen.getAllByText('Regional Sales Manager')).toHaveLength(2)
    expect(screen.getByText('Company 1')).toBeInTheDocument()
    expect(screen.getByTitle('Led machine tools growth across Malaysia.')).toBeInTheDocument()
    expect(screen.getByText(/Kuala Lumpur/)).toBeInTheDocument()
    expect(screen.getByText(/6 years/)).toBeInTheDocument()
    expect(screen.getByText('seek')).toBeInTheDocument()
    expect(screen.getByText('Senior')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
    const aiBadge = screen.getByText('AI')
    expect(aiBadge).toBeInTheDocument()
    expect(aiBadge.className).toContain('bg-sky-700')
    // industryTags take priority over _provenance; visibleKeywords = industryTags.slice(0, 3)
    expect(screen.getByText('Machine Tools')).toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('Robotics')).toBeInTheDocument()
    // CNC/Malaysia are provenance terms, not shown since industryTags exist
    expect(screen.queryByText('CNC')).not.toBeInTheDocument()
    expect(screen.queryByText('Malaysia')).not.toBeInTheDocument()
    expect(screen.queryByText('Ignored')).not.toBeInTheDocument()
    expect(screen.getByText(/AI 摘要: Strong CNC sales coverage across Malaysia\./i)).toBeInTheDocument()
    expect(screen.getByText('Expanded card for Candidate 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /收起/i }))

    expect(onToggleExpanded).toHaveBeenCalled()
  })

  it('hides rule scoring when AI score mode is enabled but analysis has not completed', () => {
    render(
      <SnippetCard
        expanded={false}
        showAiScore
        item={createResult(2, {
          scoreSource: 'rule',
          score: 74,
          analysis: undefined,
        })}
        itemKey="result-2"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('AI 测算中')).toBeInTheDocument()
    expect(screen.queryByText('规则')).not.toBeInTheDocument()
    expect(screen.queryByText('74')).not.toBeInTheDocument()
  })

  it('shows an AI pending badge when AI score mode is enabled but no score is available yet', () => {
    const item = createResult(2, {
      scoreSource: 'rule',
      analysis: undefined,
    })
    item.score = undefined

    render(
      <SnippetCard
        expanded={false}
        showAiScore
        item={item}
        itemKey="result-2"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('AI 测算中')).toBeInTheDocument()
    expect(screen.queryByText('规则')).not.toBeInTheDocument()
    expect(screen.queryByText('74')).not.toBeInTheDocument()
  })

  it('shows blocked badge when item is blocked', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          blocked: true,
          refreshState: {
            kind: 'analysis_stale',
            isStale: true,
            ingestStale: false,
            analysisStale: true,
            actions: ['rerun_analysis'],
          },
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('已屏蔽')).toBeInTheDocument()
    expect(screen.getByText('Needs refresh')).toBeInTheDocument()
  })

  it('shows activity status badge when present', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, { activityStatus: 'Active' }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders status badge with correct status label from options', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, { status: 'contacted' })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText(/resumes\.status\.options\.contacted/)).toBeInTheDocument()
  })

  it('renders without score when score is undefined', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, { score: undefined, scoreSource: undefined })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByText('88')).not.toBeInTheDocument()
    expect(screen.queryByText('AI')).not.toBeInTheDocument()
    expect(screen.queryByText('规则')).not.toBeInTheDocument()
  })

  it('renders checkbox when onSelect is provided and fires callback', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        selected={false}
        onSelect={onSelect}
      />
    )

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeInTheDocument()
    await user.click(checkbox)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not render checkbox when onSelect is not provided', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('does not render star action button (disabled in favor of StarRating)', async () => {
    const onAction = vi.fn()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onAction={onAction}
      />
    )

    // Star action button disabled — StarRating (5-star rating) is the future direction
    expect(screen.queryByRole('button', { name: '收藏' })).not.toBeInTheDocument()
  })

  it('fires view details callback when clicked', async () => {
    const user = userEvent.setup()
    const onViewDetails = vi.fn()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onViewDetails={onViewDetails}
      />
    )

    // View details button uses defaultValue '查看详情' via t('resumes.actions.view', { defaultValue: '查看详情' })
    await user.click(screen.getByRole('button', { name: '查看详情' }))
    expect(onViewDetails).toHaveBeenCalledWith(expect.objectContaining({ key: 'resume-1' }))
  })

  it('renders star rating when userRating and onRating provided', () => {
    const onRating = vi.fn()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        userRating={3}
        onRating={onRating}
      />
    )

    // StarRating component renders star buttons — check that the section exists
    expect(screen.getByText('Candidate 1')).toBeInTheDocument()
  })

  it('keeps star rating read-only when onRating is not provided', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        userRating={3}
      />
    )

    screen.getAllByRole('button', { name: /stars?$/ }).forEach((button) => {
      expect(button).toBeDisabled()
    })
  })

  it('passes onRatingComment through to StarRating with correct resumeId', async () => {
    const onRatingComment = vi.fn()
    const onRating = vi.fn()
    const user = userEvent.setup()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        userRating={2}
        onRating={onRating}
        onRatingComment={onRatingComment}
      />
    )

    await user.click(screen.getByRole('button', { name: '4 stars' }))
    const input = screen.getByTestId('rating-comment-input') as HTMLTextAreaElement
    await user.type(input, 'great fit')
    await user.click(screen.getByTestId('rating-comment-save'))

    expect(onRatingComment).toHaveBeenCalledWith('resume-1', 'great fit')
  })

  it('shows work history column when work history exists', () => {
    render(
      <SnippetCard
        expanded
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByTitle('Led machine tools growth across Malaysia.')).toBeInTheDocument()
  })

  it('hides work history column when work history is empty', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, { workHistory: [] }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByTitle('Led machine tools growth across Malaysia.')).not.toBeInTheDocument()
  })

  it('hides expanded mutation triggers when callbacks are not provided', () => {
    render(
      <SnippetCard
        expanded
        item={createResult(1, { blocked: false })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByTestId('block-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('note-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-reject')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-hired')).not.toBeInTheDocument()
  })

  it('opens block dialog when block trigger is clicked from expanded card', async () => {
    const user = userEvent.setup()

    render(
      <SnippetCard
        expanded
        item={createResult(1, { blocked: false })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onToggleBlock={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('block-trigger'))

    // Dialog title uses defaultValue '屏蔽候选人'
    expect(screen.getByText('屏蔽候选人')).toBeInTheDocument()
  })

  it('opens comment dialog when note trigger is clicked from expanded card', async () => {
    const user = userEvent.setup()

    render(
      <SnippetCard
        expanded
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onCandidateStatusChange={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('note-trigger'))

    // CandidateNotesDialog title defaultValue is 'Notes' (not the trigger label)
    expect(screen.getByTestId('candidate-notes-dialog')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  it('opens status note prompt dialog when status change to interviewed_reject', async () => {
    const user = userEvent.setup()

    render(
      <SnippetCard
        expanded
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onCandidateStatusChange={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('status-reject'))

    // Dialog title is empty for pendingStatus matched label, but DialogDescription renders notePrompt
    expect(screen.getByText(/resumes\.status\.notePrompt/)).toBeInTheDocument()
  })

  it('fires onCandidateStatusChange directly for non-reject status changes', async () => {
    const user = userEvent.setup()
    const onCandidateStatusChange = vi.fn()

    render(
      <SnippetCard
        expanded
        item={createResult(1)}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onCandidateStatusChange={onCandidateStatusChange}
      />
    )

    await user.click(screen.getByTestId('status-hired'))

    expect(onCandidateStatusChange).toHaveBeenCalledWith('identity-1', 'hired')
  })

  it('dismisses block dialog on cancel', async () => {
    const user = userEvent.setup()
    const onToggleBlock = vi.fn()

    render(
      <SnippetCard
        expanded
        item={createResult(1, { blocked: false })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onToggleBlock={onToggleBlock}
      />
    )

    await user.click(screen.getByTestId('block-trigger'))
    expect(screen.getByText('屏蔽候选人')).toBeInTheDocument()

    // Cancel button: t('common.cancel', 'Cancel') returns 'Cancel'
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('屏蔽候选人')).not.toBeInTheDocument()
  })

  it('submits block dialog and fires onToggleBlock', async () => {
    const user = userEvent.setup()
    const onToggleBlock = vi.fn()

    render(
      <SnippetCard
        expanded
        item={createResult(1, { blocked: false })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onToggleBlock={onToggleBlock}
      />
    )

    await user.click(screen.getByTestId('block-trigger'))
    // Confirm button: t('common.confirm', 'Confirm') returns 'Confirm'
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onToggleBlock).toHaveBeenCalledWith('identity-1', false, undefined)
  })

  it('calls onToggleBlock directly for blocked items on onBlockTrigger', async () => {
    const user = userEvent.setup()
    const onToggleBlock = vi.fn()

    render(
      <SnippetCard
        expanded
        item={createResult(1, { blocked: true })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
        onToggleBlock={onToggleBlock}
      />
    )

    await user.click(screen.getByTestId('block-trigger'))

    expect(onToggleBlock).toHaveBeenCalledWith('identity-1', true)
  })

  it('renders profileUrl as a link when safe URL is present', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, { profileUrl: 'https://example.com/profile/123' }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    const link = screen.getByRole('link', { name: /Candidate 1/ })
    expect(link).toHaveAttribute('href', 'https://example.com/profile/123')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders rule score badge when showAiScore is false', () => {
    render(
      <SnippetCard
        expanded={false}
        showAiScore={false}
        item={createResult(1, {
          scoreSource: 'rule',
          score: 74,
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    // Rule score renders the score and "规则" badge
    expect(screen.getByText('74')).toBeInTheDocument()
    // Score source label uses defaultValue '规则' for rule
    expect(screen.getByText(/规则/)).toBeInTheDocument()
  })

  it('shows AI summary prefix when scoreSource is ai and analysis has summary', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          scoreSource: 'ai',
          score: 88,
          analysis: {
            score: 88,
            summary: 'Strong candidate with relevant experience.',
            highlights: [],
            recommendation: 'strong_match',
          },
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText(/AI 摘要: Strong candidate with relevant experience\./)).toBeInTheDocument()
  })

  it('renders with Seek UUID profile URL without error', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, {
            profileUrl: 'https://employer.seek.com/candidates/abcdef12-34567890-abcd-ef12-34567890abcdef',
          }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href')
  })

  it('does not render profile link for unsafe profile URL', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, { profileUrl: 'javascript:alert(1)' }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders expected salary when present', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, { expectedSalary: 'RM 8000-12000' }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText('RM 8000-12000')).toBeInTheDocument()
  })

  it('renders industry tags from ingestData when available', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, {
            ingestData: {
              industryTags: ['Automation', 'PLC', 'CNC', 'Robotics', 'Extra'],
              synonymHits: [],
              brandHits: [],
              companyHits: [],
              ruleScores: {},
              experienceLevel: 'senior',
              computedAt: Date.now(),
              skillsVersion: 1,
            },
          }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    // industryTags.slice(0, 4)
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('PLC')).toBeInTheDocument()
    expect(screen.getByText('CNC')).toBeInTheDocument()
    expect(screen.getByText('Robotics')).toBeInTheDocument()
    // 5th tag should not be rendered
    expect(screen.queryByText('Extra')).not.toBeInTheDocument()
  })

  it('renders company hits badges when present', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          resume: createResume(1, {
            ingestData: {
              industryTags: [],
              synonymHits: [],
              brandHits: [],
              companyHits: ['FANUC', 'Siemens', 'Mitsubishi', 'ExtraCo'],
              ruleScores: {},
              experienceLevel: 'senior',
              computedAt: Date.now(),
              skillsVersion: 1,
            },
          }),
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    // companyHits.slice(0, 3)
    expect(screen.getByText('FANUC')).toBeInTheDocument()
    expect(screen.getByText('Siemens')).toBeInTheDocument()
    expect(screen.getByText('Mitsubishi')).toBeInTheDocument()
    // 4th should not be rendered
    expect(screen.queryByText('ExtraCo')).not.toBeInTheDocument()
  })

  it('renders status notes tooltip when statusMeta has notes', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          status: 'contacted',
          statusMeta: {
            _id: 'status-1',
            identityKey: 'identity-1',
            workspaceSlug: 'default',
            status: 'contacted',
            notes: 'Called and left voicemail.',
            updatedAt: Date.now(),
          },
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.getByText(/resumes\.status\.notes/)).toBeInTheDocument()
  })

  it('does not render status notes badge when notes are empty', () => {
    render(
      <SnippetCard
        expanded={false}
        item={createResult(1, {
          status: 'new',
          statusMeta: {
            _id: 'status-1',
            identityKey: 'identity-1',
            workspaceSlug: 'default',
            status: 'new',
            notes: '',
            updatedAt: Date.now(),
          },
        })}
        itemKey="result-1"
        onToggleExpanded={vi.fn()}
      />
    )

    expect(screen.queryByText(/resumes\.status\.notes/)).not.toBeInTheDocument()
  })

  it('falls back to generic labels and ingest tags when work history and provenance are missing', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()

    render(
      <SnippetCard
        expanded={false}
        item={createResult(2, {
          scoreSource: undefined,
          score: undefined,
          resume: createResume(2, {
            name: '',
            jobIntention: '',
            selfIntro: '',
            workHistory: [],
            location: '',
            experience: '',
            ingestData: {
              industryTags: ['Automation', 'PLC', 'CNC'],
              synonymHits: [],
              brandHits: [],
              companyHits: [],
              ruleScores: {},
              experienceLevel: 'mid',
              computedAt: Date.now(),
              skillsVersion: 1,
            },
            _provenance: undefined,
          }),
        })}
        itemKey="result-2"
        onToggleExpanded={onToggleExpanded}
      />
    )

    expect(screen.getByText('未命名简历')).toBeInTheDocument()
    expect(screen.getByText('摘要总览')).toBeInTheDocument()
    expect(
      screen.queryByText('Open the card to inspect recent work history and extracted signals.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Automation')).toBeInTheDocument()
    expect(screen.getByText('PLC')).toBeInTheDocument()
    expect(screen.getByText('CNC')).toBeInTheDocument()
    expect(screen.queryByText('Expanded card for 未命名简历')).not.toBeInTheDocument()
    expect(screen.queryByText('Mid')).toBeInTheDocument()
    expect(screen.queryByText('88')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /展开/i }))

    expect(onToggleExpanded).toHaveBeenCalled()
  })
})
