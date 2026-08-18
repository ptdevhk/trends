import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockRequestJson = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

vi.mock('lucide-react', () => ({
  Download: () => <svg data-testid="download-icon" />,
  Upload: () => <svg data-testid="upload-icon" />,
  Check: () => <svg data-testid="check-icon" />,
}))

vi.mock('@/pages/system-settings/lib', () => ({
  SettingsRequestError: class SettingsRequestError extends Error {
    readonly status: number
    readonly body: unknown

    constructor(status: number, body: unknown) {
      super(`HTTP ${status}`)
      this.name = 'SettingsRequestError'
      this.status = status
      this.body = body
    }
  },
  useSettingsRequestJson: () => ({
    requestJson: (path: string, init?: RequestInit) =>
      init === undefined ? mockRequestJson(path) : mockRequestJson(path, init),
  }),
}))

import { SystemSettingsWorkspacePage } from './SystemSettingsWorkspacePage'

const hrOpsEnvelope = {
  success: true,
  schemaVersion: 1,
  profile: 'hr-ops',
  workspaceSlug: 'dev',
  exportedAt: 1700000000000,
  tables: {
    candidateStatus: [{ _id: 'row-1' }, { _id: 'row-2' }],
    candidateBlocks: [{ _id: 'block-1' }],
    searchProfiles: [],
    workspaceConfig: [],
  },
}

const importResult = {
  success: true,
  schemaVersion: 1,
  profile: 'hr-ops',
  workspaceSlug: 'dev',
  mode: 'merge',
  applied: { candidateStatus: 2, candidateBlocks: 1, searchProfiles: 0, workspaceConfig: 0 },
  deleted: { candidateStatus: 0, candidateBlocks: 0, searchProfiles: 0, workspaceConfig: 0 },
}

function makeSnapshotFile(contents: unknown, name = 'snapshot.json'): File {
  return new File([JSON.stringify(contents)], name, { type: 'application/json' })
}

describe('SystemSettingsWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders export and import cards', () => {
    render(<SystemSettingsWorkspacePage />)
    expect(screen.getByTestId('ws-export-button')).toBeInTheDocument()
    expect(screen.getByTestId('ws-export-profile')).toBeInTheDocument()
    expect(screen.getByTestId('ws-import-file')).toBeInTheDocument()
    expect(screen.getByText('Export and import portable workspace snapshots (same format as the CLI).')).toBeInTheDocument()
  })

  it('exports hr-ops profile and shows the summary with counts and download button', async () => {
    mockRequestJson.mockResolvedValue(hrOpsEnvelope)
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.click(screen.getByTestId('ws-export-button'))

    expect(mockRequestJson).toHaveBeenCalledWith('/api/workspace/export?profile=hr-ops')
    expect(await screen.findByTestId('ws-export-summary')).toBeInTheDocument()
    expect(screen.getByText('dev')).toBeInTheDocument()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
    expect(screen.getByText('1 rows')).toBeInTheDocument()
    expect(screen.getByTestId('ws-download-button')).toBeInTheDocument()
    expect(mockToast.success).toHaveBeenCalledWith('Snapshot exported')
  })

  it('exports the full profile when selected', async () => {
    mockRequestJson.mockResolvedValue(hrOpsEnvelope)
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.selectOptions(screen.getByTestId('ws-export-profile'), 'full')
    await user.click(screen.getByTestId('ws-export-button'))

    expect(mockRequestJson).toHaveBeenCalledWith('/api/workspace/export?profile=full')
  })

  it('surfaces the server error body when export fails', async () => {
    mockRequestJson.mockRejectedValue(
      new (await import('@/pages/system-settings/lib')).SettingsRequestError(500, { error: 'boom' }),
    )
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.click(screen.getByTestId('ws-export-button'))

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('boom'))
  })

  it('downloads the exact export envelope as a JSON file', async () => {
    mockRequestJson.mockResolvedValue(hrOpsEnvelope)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.click(screen.getByTestId('ws-export-button'))
    await user.click(await screen.findByTestId('ws-download-button'))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json')
    expect(await blob.text()).toBe(JSON.stringify(hrOpsEnvelope))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('rejects an invalid file with an error message', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.upload(screen.getByTestId('ws-import-file'), makeSnapshotFile({ success: false }))

    expect(await screen.findByTestId('ws-import-file-error')).toHaveTextContent('Not a valid workspace snapshot file')
    expect(screen.queryByTestId('ws-import-preview')).not.toBeInTheDocument()
  })

  it('previews a valid file and imports it in merge mode with the envelope body', async () => {
    mockRequestJson.mockResolvedValue(importResult)
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.upload(screen.getByTestId('ws-import-file'), makeSnapshotFile(hrOpsEnvelope))

    const preview = await screen.findByTestId('ws-import-preview')
    expect(preview).toHaveTextContent('dev')
    expect(preview).toHaveTextContent('hr-ops')
    expect(preview).toHaveTextContent('1')
    expect(screen.getByTestId('ws-import-button')).toBeEnabled()

    await user.click(screen.getByTestId('ws-import-button'))

    expect(mockRequestJson).toHaveBeenCalledWith(
      '/api/workspace/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 1,
          profile: 'hr-ops',
          mode: 'merge',
          tables: hrOpsEnvelope.tables,
        }),
      }),
    )
    expect(await screen.findByTestId('ws-import-result')).toBeInTheDocument()
    expect(screen.getAllByText('2 rows').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 rows').length).toBeGreaterThan(0)
    expect(mockToast.success).toHaveBeenCalledWith('Snapshot imported')
  })

  it('requires the replace confirmation checkbox before importing in replace mode', async () => {
    mockRequestJson.mockResolvedValue(importResult)
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.upload(screen.getByTestId('ws-import-file'), makeSnapshotFile(hrOpsEnvelope))
    await screen.findByTestId('ws-import-preview')

    await user.selectOptions(screen.getByTestId('ws-import-mode'), 'replace')
    expect(screen.getByTestId('ws-import-replace-confirm')).toBeInTheDocument()
    expect(screen.getByTestId('ws-import-button')).toBeDisabled()

    await user.click(screen.getByTestId('ws-import-replace-confirm'))
    expect(screen.getByTestId('ws-import-button')).toBeEnabled()

    await user.click(screen.getByTestId('ws-import-button'))

    expect(mockRequestJson).toHaveBeenCalledWith(
      '/api/workspace/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 1,
          profile: 'hr-ops',
          mode: 'replace',
          tables: hrOpsEnvelope.tables,
        }),
      }),
    )
  })

  it('surfaces the server error body when import fails', async () => {
    mockRequestJson.mockRejectedValue(
      new (await import('@/pages/system-settings/lib')).SettingsRequestError(400, { error: 'bad snapshot' }),
    )
    const user = userEvent.setup()
    render(<SystemSettingsWorkspacePage />)

    await user.upload(screen.getByTestId('ws-import-file'), makeSnapshotFile(hrOpsEnvelope))
    await screen.findByTestId('ws-import-preview')
    await user.click(screen.getByTestId('ws-import-button'))

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('bad snapshot'))
  })
})
