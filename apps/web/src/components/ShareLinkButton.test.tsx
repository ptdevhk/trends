import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ShareLinkButton } from './ShareLinkButton'

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('ShareLinkButton', () => {
  const clipboardWriteTextMock = vi.fn(async () => {})
  const execCommandMock = vi.fn(() => true)

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/dev/resumes')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandMock,
    })
  })

  it('copies the current URL directly for simple shareable search state', async () => {
    window.history.replaceState({}, '', '/dev/resumes?location=Dongguan&keyword=CNC')
    const ensureApiSession = vi.fn(async () => 'session-share-1')

    render(
      <ShareLinkButton
        shareTitle="Dongguan · CNC"
        state={{
          location: 'Dongguan',
          keywords: ['CNC'],
          requiredKeywords: [],
          filters: {},
          selectedTags: [],
          selectedCompanies: [],
        }}
        ensureApiSession={ensureApiSession}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '分享' }))

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        `${window.location.origin}/dev/resumes?location=Dongguan&keyword=CNC`
      )
    })

    expect(ensureApiSession).not.toHaveBeenCalled()
    expect(toastSuccessMock).toHaveBeenCalledWith('已复制分享链接')
  })

  it('creates and copies a short sid link for bulky or session-backed state', async () => {
    window.history.replaceState({}, '', '/dev/resumes?location=Kuala+Lumpur+MY&keyword=%22Sales+Engineer%22')
    const ensureApiSession = vi.fn(async () => 'session-share-1')
    const onCopyState = vi.fn()

    render(
      <ShareLinkButton
        shareTitle="Kuala Lumpur · Sales Engineer"
        state={{
          location: 'Kuala Lumpur MY',
          keywords: ['Sales Engineer'],
          requiredKeywords: ['CNC'],
          collectionSource: {
            type: 'seek',
            exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          },
          collectUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          filters: {
            minAge: 28,
          },
          selectedTags: ['STAR'],
          selectedCompanies: ['Acme'],
          selectedExperienceLevel: 'mid',
          jobDescriptionId: 'lathe-sales',
        }}
        ensureApiSession={ensureApiSession}
        onCopyState={onCopyState}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '分享' }))

    await waitFor(() => {
      expect(ensureApiSession).toHaveBeenCalledWith({
        shareTitle: 'Kuala Lumpur · Sales Engineer',
        searchState: expect.objectContaining({
          location: 'Kuala Lumpur MY',
          keywords: ['Sales Engineer'],
          collectUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
        }),
      })
    })

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      `${window.location.origin}/dev/resumes?sid=session-share-1`
    )
    expect(onCopyState).toHaveBeenCalledWith({
      shareUrl: `${window.location.origin}/dev/resumes?sid=session-share-1`,
      sessionId: 'session-share-1',
      usedSessionLink: true,
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('已复制会话链接')
  })

  it('reports the existing sid when copying a shared-link URL directly', async () => {
    window.history.replaceState({}, '', '/dev/resumes?sid=session-share-2')
    const ensureApiSession = vi.fn(async () => 'session-share-3')
    const onCopyState = vi.fn()

    render(
      <ShareLinkButton
        shareTitle="Shared search"
        state={{
          location: undefined,
          keywords: [],
          requiredKeywords: [],
          filters: {},
          selectedTags: [],
          selectedCompanies: [],
        }}
        ensureApiSession={ensureApiSession}
        onCopyState={onCopyState}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '分享' }))

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        `${window.location.origin}/dev/resumes?sid=session-share-2`
      )
    })

    expect(ensureApiSession).not.toHaveBeenCalled()
    expect(onCopyState).toHaveBeenCalledWith({
      shareUrl: `${window.location.origin}/dev/resumes?sid=session-share-2`,
      sessionId: 'session-share-2',
      usedSessionLink: true,
    })
  })

  it('opens a fallback dialog with the prepared link when automatic copy fails', async () => {
    clipboardWriteTextMock.mockRejectedValueOnce(new Error('clipboard blocked'))
    execCommandMock.mockReturnValue(false)
    const ensureApiSession = vi.fn(async () => 'session-share-1')

    render(
      <ShareLinkButton
        shareTitle="Kuala Lumpur · Sales Engineer"
        state={{
          location: 'Kuala Lumpur MY',
          keywords: ['Sales Engineer'],
          requiredKeywords: ['CNC'],
          collectionSource: {
            type: 'seek',
            exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          },
          collectUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          filters: {},
          selectedTags: [],
          selectedCompanies: [],
        }}
        ensureApiSession={ensureApiSession}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '分享' }))

    expect(await screen.findByTestId('share-link-fallback-dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue(`${window.location.origin}/dev/resumes?sid=session-share-1`)).toBeInTheDocument()
    expect(toastErrorMock).toHaveBeenCalledWith('自动复制失败，请手动复制下方链接')
  })
})
