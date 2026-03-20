import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

describe('OutreachModal latest work history', () => {
  it('sends only the latest three work history entries to draft generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subject: 'Hello', body: 'World' }),
      })
    vi.stubGlobal('fetch', fetchMock)

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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body ?? '{}'))

    expect(body.resume.companies).toEqual([
      'Current Co',
      'Recent Co',
      'Middle Co',
    ])
    expect(body.resume.companies).not.toContain('Oldest Co')

    vi.unstubAllGlobals()
  })
})
