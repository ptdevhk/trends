import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { OutreachModal } from './OutreachModal'

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}))

const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('OutreachModal latest work history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends only the latest three work history entries to draft generation', async () => {
    postMock
      .mockResolvedValueOnce({
        data: { subject: 'Hello', body: 'World' },
        error: undefined,
        response: { ok: true, status: 200 },
      })

    render(
      <OutreachModal
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        analysis={{
          resumeId: 'resume-1',
          score: 80,
          recommendation: 'match',
          highlights: [],
          concerns: [],
          summary: 'Good fit',
          matchedAt: '2026-03-13T00:00:00.000Z',
        }}
        jobDescription={{
          id: 'jd-1',
          title: 'Sales Engineer',
          requirements: 'CNC sales',
        }}
        resume={{
          resumeId: 'resume-1',
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'alice@example.com',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [
            { raw: 'Oldest entry', companyName: 'Oldest Co', jobTitle: 'Old Role', startDate: '2018-01', endDate: '2019-01' },
            { raw: 'Recent entry', companyName: 'Recent Co', jobTitle: 'Recent Role', startDate: '2023-01', endDate: '2024-01' },
            { raw: 'Current entry', companyName: 'Current Co', jobTitle: 'Current Role', startDate: '2024-02', endDate: '至今' },
            { raw: 'Middle entry', companyName: 'Middle Co', jobTitle: 'Middle Role', startDate: '2021-01', endDate: '2022-01' },
          ],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
      />
    )

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
    const [, options] = postMock.mock.calls[0]
    const body = ((options as { body?: unknown }).body ?? {}) as {
      resume: { companies: string[]; summary?: string; jobIntention?: string }
    }

    expect(body.resume.companies).toEqual([
      'Current Co',
      'Recent Co',
      'Middle Co',
    ])
    expect(body.resume.companies).not.toContain('Oldest Co')
    expect(body.resume.summary).toBeUndefined()
    expect(body.resume.jobIntention).toBeUndefined()
  })

  function renderModal() {
    render(
      <OutreachModal
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        analysis={{
          resumeId: 'resume-1',
          score: 80,
          recommendation: 'match',
          highlights: [],
          concerns: [],
          summary: 'Good fit',
          matchedAt: '2026-03-13T00:00:00.000Z',
        }}
        jobDescription={{
          id: 'jd-1',
          title: 'Sales Engineer',
          requirements: 'CNC sales',
        }}
        resume={{
          resumeId: 'resume-1',
          name: 'Alice',
          profileUrl: 'https://example.com/resume-1',
          activityStatus: 'Active',
          age: '30',
          experience: '5',
          education: 'Bachelor',
          location: 'Dongguan',
          selfIntro: 'alice@example.com',
          jobIntention: 'Sales Engineer',
          expectedSalary: '10k-20k',
          workHistory: [],
          extractedAt: '2026-03-13T00:00:00.000Z',
        }}
      />
    )
  }

  it('copies subject and body to clipboard on Copy button click', async () => {
    const user = userEvent.setup()
    // userEvent.setup() installs its own clipboard stub; spy on the stub's writeText
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    postMock.mockResolvedValueOnce({
      data: { subject: 'Hello', body: 'World' },
      error: undefined,
      response: { ok: true, status: 200 },
    })

    renderModal()
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
    await screen.findByDisplayValue('World')

    const copyBtn = screen.getByRole('button', { name: /copy message/i })
    await user.click(copyBtn)

    expect(writeTextSpy).toHaveBeenCalledWith('Hello\n\nWorld')
  })

  it('sends outreach email on Ctrl+Enter in message body', async () => {
    const user = userEvent.setup()
    postMock.mockResolvedValueOnce({
      data: { subject: 'Hello', body: 'World' },
      error: undefined,
      response: { ok: true, status: 200 },
    })
    postMock.mockResolvedValueOnce({
      data: { success: true },
      error: undefined,
      response: { ok: true, status: 200 },
    })

    renderModal()
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))

    await user.click(screen.getByPlaceholderText(/write your message/i))
    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2))
    expect(postMock).toHaveBeenLastCalledWith('/api/notifications/send', expect.anything())
  })
})
