import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemSettingsTaxonomyPage } from './SystemSettingsTaxonomyPage'
import type { TaxonomyCluster } from '@/lib/taxonomy'

const {
  requestJsonMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

const tMock = (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
  if (typeof options === 'string') {
    return options
  }

  const defaultValue = options?.defaultValue ?? key
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_: string, token: string) => {
    const value = options?.[token]
    return value === undefined || value === null ? '' : String(value)
  })
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('@/pages/system-settings/lib', async () => {
  const actual = await vi.importActual<typeof import('@/pages/system-settings/lib')>('@/pages/system-settings/lib')
  return {
    ...actual,
    useSettingsRequestJson: () => ({
      requestJson: requestJsonMock,
    }),
  }
})

function buildCluster(overrides: Partial<TaxonomyCluster> = {}): TaxonomyCluster {
  const id = overrides.id ?? 'cluster-1'
  const slug = overrides.slug ?? 'manufacturing-systems'
  const name = overrides.name ?? 'Manufacturing Systems'

  return {
    id,
    workspaceSlug: overrides.workspaceSlug ?? 'dev',
    name,
    slug,
    parentSlug: overrides.parentSlug,
    tags: overrides.tags ?? ['Machine Tools', 'Automation'],
    source: overrides.source ?? 'human',
    confidence: overrides.confidence,
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
  }
}

function buildPayload(items: TaxonomyCluster[]) {
  return {
    success: true,
    items: items.map((item) => ({
      id: item.id,
      workspaceSlug: item.workspaceSlug,
      name: item.name,
      slug: item.slug,
      parentSlug: item.parentSlug,
      tags: item.tags,
      source: item.source,
      confidence: item.confidence,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  }
}

describe('SystemSettingsTaxonomyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads and renders the existing taxonomy registry', async () => {
    requestJsonMock.mockResolvedValueOnce(buildPayload([
      buildCluster(),
      buildCluster({
        id: 'cluster-2',
        slug: 'draft-coverage',
        name: 'Draft Coverage',
        source: 'ai',
        status: 'draft',
        tags: ['Robotics'],
      }),
    ]))

    render(<SystemSettingsTaxonomyPage />)

    expect(requestJsonMock).toHaveBeenCalledWith('/api/taxonomy')
    expect(await screen.findByText('Manufacturing Systems')).toBeInTheDocument()
    expect(screen.getByText('Draft Coverage')).toBeInTheDocument()
    expect(screen.getByText('Cluster registry')).toBeInTheDocument()
  })

  it('creates a new taxonomy cluster with normalized payload fields', async () => {
    const user = userEvent.setup()
    const existingCluster = buildCluster()
    const newCluster = buildCluster({
      id: 'cluster-2',
      slug: 'backend-languages',
      name: 'Backend Languages',
      tags: ['Go', 'Java', 'Rust'],
      confidence: 0.75,
    })

    requestJsonMock
      .mockResolvedValueOnce(buildPayload([existingCluster]))
      .mockResolvedValueOnce(buildPayload([existingCluster, newCluster]))

    render(<SystemSettingsTaxonomyPage />)

    expect(await screen.findByText('Manufacturing Systems')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New Cluster' }))
    await user.type(screen.getByPlaceholderText('Backend Languages'), 'Backend Languages')
    expect(screen.getByDisplayValue('backend-languages')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Go, Java, Rust'), 'Go, Java, Rust')
    await user.type(screen.getByPlaceholderText('0.75'), '0.75')
    await user.click(screen.getByRole('button', { name: 'Create Cluster' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith('/api/taxonomy', expect.objectContaining({
        method: 'POST',
      }))
    })

    const saveCall = requestJsonMock.mock.calls.find((call) => call[0] === '/api/taxonomy' && call[1]?.method === 'POST')
    const body = JSON.parse(String(saveCall?.[1]?.body))

    expect(body).toEqual({
      name: 'Backend Languages',
      slug: 'backend-languages',
      tags: ['Go', 'Java', 'Rust'],
      source: 'human',
      confidence: 0.75,
      status: 'active',
    })
    expect(await screen.findByText('Backend Languages')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('debugConfig.saved')
  })

  it('deletes a taxonomy cluster with an encoded route id', async () => {
    const user = userEvent.setup()
    const cluster = buildCluster({
      id: 'cluster/with slash',
    })

    requestJsonMock
      .mockResolvedValueOnce(buildPayload([cluster]))
      .mockResolvedValueOnce(buildPayload([]))

    render(<SystemSettingsTaxonomyPage />)

    expect(await screen.findByText('Manufacturing Systems')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith('/api/taxonomy/cluster%2Fwith%20slash', {
        method: 'DELETE',
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('Manufacturing Systems')).not.toBeInTheDocument()
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('debugConfig.saved')
  })

  it('generates draft suggestions and refreshes the registry', async () => {
    const user = userEvent.setup()
    const existingCluster = buildCluster()
    const suggestedCluster = buildCluster({
      id: 'cluster-2',
      slug: 'robotics-platforms',
      name: 'Robotics Platforms',
      source: 'ai',
      status: 'draft',
      tags: ['Robotics', 'Cobots'],
    })

    requestJsonMock
      .mockResolvedValueOnce(buildPayload([existingCluster]))
      .mockResolvedValueOnce(buildPayload([suggestedCluster]))
      .mockResolvedValueOnce(buildPayload([existingCluster, suggestedCluster]))

    render(<SystemSettingsTaxonomyPage />)

    expect(await screen.findByText('Manufacturing Systems')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generate Drafts' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith('/api/taxonomy/suggest', {
        method: 'POST',
        body: JSON.stringify({ limit: 10 }),
      })
    })

    expect(await screen.findByText('Robotics Platforms')).toBeInTheDocument()
    expect(toastSuccessMock).toHaveBeenCalledWith('Generated 1 draft taxonomy suggestions')
  })
})
