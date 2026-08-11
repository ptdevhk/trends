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

const mockT = (key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') return options
  const translations: Record<string, string> = {
    'shareLink.button': 'Share',
    'shareLink.copiedSearch': 'Share link copied',
    'shareLink.copiedSession': 'Session link copied',
    'shareLink.copiedPublic': 'Public share copied',
    'shareLink.publicButton': 'Public share',
    'shareLink.publicDialog.title': 'Create public share?',
    'shareLink.publicDialog.description': 'Create an immutable public snapshot link.',
    'shareLink.publicDialog.cancel': 'Cancel',
    'shareLink.publicDialog.confirm': 'Create public share',
    'shareLink.copyPreparedFailed': 'Automatic copy failed. Copy the link below manually.',
    'shareLink.copyUrlFailed': 'Failed to copy link. Copy the URL from the address bar manually.',
    'shareLink.createPublicFailed': 'Failed to create public share.',
    'shareLink.retryCopyFailed': 'Copy still failed. Copy the link below manually.',
    'shareLink.dialog.title': 'Copy share link manually',
    'shareLink.dialog.description': 'Automatic copy did not complete. The link is ready to copy manually.',
    'shareLink.dialog.titleLabel': 'Share title',
    'shareLink.dialog.urlLabel': 'Share link',
    'shareLink.dialog.retryCopy': 'Try copying again',
    'common.close': 'Close',
  }
  return translations[key] ?? (typeof options?.defaultValue === 'string' ? options.defaultValue : key)
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
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
    window.history.replaceState({}, '', '/dev/resumes?location=Dongguan&q=CNC')
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

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        `${window.location.origin}/dev/resumes?location=Dongguan&q=CNC`
      )
    })

    expect(ensureApiSession).not.toHaveBeenCalled()
    expect(toastSuccessMock).toHaveBeenCalledWith('Share link copied')
  })

  it('creates and copies a short sid link for bulky or session-backed state', async () => {
    window.history.replaceState({}, '', '/dev/resumes?location=Kuala+Lumpur+MY&q=%22Sales+Engineer%22')
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

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => {
      expect(ensureApiSession).toHaveBeenCalledWith({
        shareTitle: 'Kuala Lumpur · Sales Engineer',
        searchState: expect.objectContaining({
          location: 'Kuala Lumpur MY',
          keywords: ['Sales Engineer'],
          collectionSource: {
            type: 'seek',
            exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          },
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
    expect(toastSuccessMock).toHaveBeenCalledWith('Session link copied')
  })

  it('creates a durable sid link when share state includes a reference note', async () => {
    window.history.replaceState({}, '', '/dev/resumes?location=China&q=CNC')
    const ensureApiSession = vi.fn(async () => 'session-share-note')

    render(
      <ShareLinkButton
        shareTitle="China · CNC"
        state={{
          location: 'China',
          keywords: ['CNC'],
          requiredKeywords: [],
          filters: {},
          selectedTags: [],
          selectedCompanies: [],
          referenceNote: 'Priority shortlist for HR sync',
        }}
        ensureApiSession={ensureApiSession}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => {
      expect(ensureApiSession).toHaveBeenCalledWith({
        shareTitle: 'China · CNC',
        searchState: expect.objectContaining({
          location: 'China',
          keywords: ['CNC'],
          referenceNote: 'Priority shortlist for HR sync',
        }),
      })
    })

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      `${window.location.origin}/dev/resumes?sid=session-share-note`
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Session link copied')
  })

  it('confirms and copies a separate public share token link', async () => {
    window.history.replaceState({}, '', '/dev/resumes?location=Kuala+Lumpur&q=CNC')
    const ensureApiSession = vi.fn(async () => 'session-share-1')
    const createPublicShare = vi.fn(async () => ({
      publicPath: '/s/public-token-1',
    }))

    render(
      <ShareLinkButton
        shareTitle="Kuala Lumpur · CNC"
        state={{
          location: 'Kuala Lumpur',
          keywords: ['CNC'],
          requiredKeywords: [],
          filters: {},
          selectedTags: [],
          selectedCompanies: [],
        }}
        ensureApiSession={ensureApiSession}
        createPublicShare={createPublicShare}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Public share' }))

    expect(screen.getByText('Create public share?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create public share' }))

    await waitFor(() => {
      expect(createPublicShare).toHaveBeenCalledWith({
        shareTitle: 'Kuala Lumpur · CNC',
        searchState: expect.objectContaining({
          location: 'Kuala Lumpur',
          keywords: ['CNC'],
        }),
      })
    })

    expect(ensureApiSession).not.toHaveBeenCalled()
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      `${window.location.origin}/s/public-token-1`
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Public share copied')
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

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

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
          filters: {},
          selectedTags: [],
          selectedCompanies: [],
        }}
        ensureApiSession={ensureApiSession}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(await screen.findByTestId('share-link-fallback-dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue(`${window.location.origin}/dev/resumes?sid=session-share-1`)).toBeInTheDocument()
    expect(toastErrorMock).toHaveBeenCalledWith('Automatic copy failed. Copy the link below manually.')
  })
})
