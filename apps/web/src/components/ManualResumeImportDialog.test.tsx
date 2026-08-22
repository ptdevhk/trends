import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualResumeImportDialog } from './ManualResumeImportDialog'

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockT = (_key: string, fallback?: string, options?: Record<string, unknown>) => {
  let value = fallback ?? _key
  if (options) {
    for (const [name, replacement] of Object.entries(options)) {
      value = value.split(`{{${name}}}`).join(String(replacement))
    }
  }
  return value
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => successMock(...args),
    error: (...args: unknown[]) => errorMock(...args),
  },
}))

const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

describe('ManualResumeImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads selected files and refreshes after a successful import', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    postMock.mockResolvedValue({
      data: {
        success: true,
        source: { key: '51job-manual', label: '51job-manual' },
        summary: {
          uploadedFiles: 1,
          discoveredFiles: 1,
          parsedResumes: 1,
          imported: 1,
          inserted: 1,
          updated: 0,
          unchanged: 0,
          deduped: 0,
          skipped: 0,
          failed: 0,
        },
        files: [
          {
            uploadName: '51job_张三(123456).docx',
            entryPath: '51job_张三(123456).docx',
            extension: '.docx',
            status: 'imported',
            resumeName: '张三',
            profileId: '123456',
            warnings: [],
          },
        ],
        warnings: [],
      },
      error: undefined,
      response: { ok: true, status: 200 },
    })

    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={onImported}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    const file = new File(['resume-content'], '51job_张三(123456).docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: 'Import resumes' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1)
    })

    const [path, options] = postMock.mock.calls[0] ?? []
    expect(path).toBe('/api/resumes/manual-import')
    const submittedForm = (options as { body: FormData }).body
    expect(submittedForm).toBeInstanceOf(FormData)
    expect(submittedForm.getAll('files')).toHaveLength(1)
    expect(submittedForm.get('location')).toBe('东莞')
    expect(submittedForm.get('keyword')).toBe('销售工程师')

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1)
      expect(successMock).toHaveBeenCalledWith('Resume import completed')
      expect(screen.getByText('Import summary')).toBeInTheDocument()
      expect(screen.getAllByText('51job_张三(123456).docx')).toHaveLength(2)
    })
  })

  it('shows API errors without calling refresh', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    postMock.mockResolvedValue({
      data: undefined,
      error: { success: false, error: 'Upload exceeds size limit' },
      response: { ok: false, status: 400 },
    })

    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={onImported}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    await user.upload(input, new File(['resume-content'], 'oversized.zip', { type: 'application/zip' }))
    await user.click(screen.getByRole('button', { name: 'Import resumes' }))

    await waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith('Upload exceeds size limit')
      expect(onImported).not.toHaveBeenCalled()
      expect(screen.getByText('Upload exceeds size limit')).toBeInTheDocument()
    })
  })

  it('shows unreadable PDF extraction failures without refreshing', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    postMock.mockResolvedValue({
      data: {
        success: true,
        source: { key: '51job-manual', label: '51job-manual' },
        summary: {
          uploadedFiles: 1,
          discoveredFiles: 1,
          parsedResumes: 0,
          imported: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          deduped: 0,
          skipped: 0,
          failed: 1,
        },
        files: [
          {
            uploadName: '东莞（加工中心）-周进佑.pdf',
            entryPath: '东莞（加工中心）-周进佑.pdf',
            extension: '.pdf',
            status: 'failed',
            error: 'PDF text extraction produced unusable content',
            warnings: [],
          },
        ],
        warnings: [],
      },
      error: undefined,
      response: { ok: true, status: 200 },
    })

    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={onImported}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    await user.upload(input, new File(['pdf'], '东莞（加工中心）-周进佑.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Import resumes' }))

    await waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith('PDF text extraction produced unusable content')
      expect(successMock).not.toHaveBeenCalled()
      expect(onImported).not.toHaveBeenCalled()
      expect(screen.getByText('Import summary')).toBeInTheDocument()
      expect(screen.getAllByText('东莞（加工中心）-周进佑.pdf')).toHaveLength(2)
      expect(screen.getByText('PDF text extraction produced unusable content')).toBeInTheDocument()
    })
  })

  it('does not show a success toast or refresh when every uploaded file fails', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    postMock.mockResolvedValue({
      data: {
        success: true,
        source: { key: '51job-manual', label: '51job-manual' },
        summary: {
          uploadedFiles: 1,
          discoveredFiles: 1,
          parsedResumes: 0,
          imported: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          deduped: 0,
          skipped: 0,
          failed: 1,
        },
        files: [
          {
            uploadName: '51job_张三(123456).doc',
            entryPath: '51job_张三(123456).doc',
            extension: '.doc',
            status: 'failed',
            error: 'Legacy .doc parsing is not supported yet',
            warnings: [],
          },
        ],
        warnings: [],
      },
      error: undefined,
      response: { ok: true, status: 200 },
    })

    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={onImported}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    await user.upload(input, new File(['legacy-doc'], '51job_张三(123456).doc', { type: 'application/msword' }))
    await user.click(screen.getByRole('button', { name: 'Import resumes' }))

    await waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith('Legacy .doc parsing is not supported yet')
      expect(successMock).not.toHaveBeenCalled()
      expect(onImported).not.toHaveBeenCalled()
      expect(screen.getByText('Import summary')).toBeInTheDocument()
      expect(screen.getByText('Legacy .doc parsing is not supported yet')).toBeInTheDocument()
    })
  })

  it('keeps success toast and refresh when imported rows exist alongside skipped files', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    postMock.mockResolvedValue({
      data: {
        success: true,
        source: { key: '51job-manual', label: '51job-manual' },
        summary: {
          uploadedFiles: 1,
          discoveredFiles: 2,
          parsedResumes: 1,
          imported: 1,
          inserted: 1,
          updated: 0,
          unchanged: 0,
          deduped: 0,
          skipped: 1,
          failed: 0,
        },
        files: [
          {
            uploadName: 'mixed.zip',
            entryPath: '51job_张三(123456).docx',
            extension: '.docx',
            status: 'imported',
            resumeName: '张三',
            profileId: '123456',
            warnings: [],
          },
          {
            uploadName: 'mixed.zip',
            entryPath: 'notes.txt',
            extension: '.txt',
            status: 'skipped',
            error: 'Unsupported file type',
            warnings: [],
          },
        ],
        warnings: [],
      },
      error: undefined,
      response: { ok: true, status: 200 },
    })

    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={onImported}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    await user.upload(input, new File(['archive'], 'mixed.zip', { type: 'application/zip' }))
    await user.click(screen.getByRole('button', { name: 'Import resumes' }))

    await waitFor(() => {
      expect(successMock).toHaveBeenCalledWith('Resume import completed')
      expect(errorMock).not.toHaveBeenCalled()
      expect(onImported).toHaveBeenCalledTimes(1)
      expect(screen.getByText('notes.txt')).toBeInTheDocument()
      expect(screen.getByText('Unsupported file type')).toBeInTheDocument()
    })
  })

  it('resets the hidden file input when Clear is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={vi.fn()}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    await user.upload(input, new File(['resume-content'], 'a.docx', { type: 'application/octet-stream' }))
    expect(screen.getByText('a.docx')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByText('No files selected yet.')).toBeInTheDocument()
    // re-uploading the same file still registers (input value was reset)
    await user.upload(input, new File(['resume-content'], 'a.docx', { type: 'application/octet-stream' }))
    expect(screen.getByText('a.docx')).toBeInTheDocument()
    expect(screen.getAllByText('a.docx')).toHaveLength(1)
  })

  it('resets the hidden file input when the last file is removed individually', async () => {
    const user = userEvent.setup()
    render(
      <ManualResumeImportDialog
        open
        onOpenChange={vi.fn()}
        location="东莞"
        keywords={['销售工程师']}
        onImported={vi.fn()}
      />
    )

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    await user.upload(input, new File(['resume-content'], 'a.docx', { type: 'application/octet-stream' }))
    expect(screen.getByText('a.docx')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove file' }))

    expect(screen.getByText('No files selected yet.')).toBeInTheDocument()
    // re-uploading the same file still registers (input value was reset)
    await user.upload(input, new File(['resume-content'], 'a.docx', { type: 'application/octet-stream' }))
    expect(screen.getByText('a.docx')).toBeInTheDocument()
    expect(screen.getAllByText('a.docx')).toHaveLength(1)
  })

  it('shows total size of selected files in the header', async () => {
    const user = userEvent.setup()
    render(<ManualResumeImportDialog open onOpenChange={vi.fn()} />)

    const input = screen.getByTestId('manual-resume-import-input') as HTMLInputElement
    const fileA = new File([new Uint8Array(1024 * 1024)], 'resume1.pdf', { type: 'application/pdf' })
    const fileB = new File([new Uint8Array(4 * 1024 * 1024)], 'bundle.zip', { type: 'application/zip' })
    await user.upload(input, [fileA, fileB])

    expect(screen.getByText('Selected files (2 · 5.0 MB)')).toBeInTheDocument()
  })
})
