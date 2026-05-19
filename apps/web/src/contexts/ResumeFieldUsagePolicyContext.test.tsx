import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

const mockResolve = vi.hoisted(() => vi.fn().mockReturnValue({ fields: { phone: { enabled: true }, email: { enabled: true } } }))

vi.mock('@trends/shared', () => ({
  resolveResumeFieldUsagePolicy: (...args: unknown[]) => mockResolve(...args),
}))

vi.mock('@/lib/workspace-ref', () => ({
  withWorkspaceHeaders: (headers: Record<string, string>) => headers,
}))

vi.mock('./WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev-workspace' }),
}))

import { ResumeFieldUsagePolicyProvider, useResumeFieldUsagePolicy } from './ResumeFieldUsagePolicyContext'

const defaultPolicy = { fields: { phone: { enabled: true }, email: { enabled: true } } }
let fetchSpy: ReturnType<typeof vi.spyOn>

function TestConsumer() {
  const policy = useResumeFieldUsagePolicy()
  return <div data-testid="policy">{JSON.stringify(policy)}</div>
}

describe('ResumeFieldUsagePolicyProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('provides default policy while fetch is in flight and makes fetch call', () => {
    fetchSpy.mockReturnValue(new Promise(() => {}))

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    expect(JSON.parse(screen.getByTestId('policy').textContent!)).toEqual(defaultPolicy)
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('updates policy from fetch response', async () => {
    const response = { success: true, config: { customField: 'value' } }
    const resolved = { fields: { phone: { enabled: false } }, custom: 'value' }
    mockResolve.mockImplementation(() => resolved)
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response)

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('policy').textContent!)).toEqual(resolved)
    })
  })

  it('falls back to default on fetch error', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'))

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('policy').textContent!)).toEqual(defaultPolicy)
    })
  })

  it('creates fetch with workspace headers', () => {
    fetchSpy.mockReturnValue(new Promise(() => {}))

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    expect(fetchSpy).toHaveBeenCalledWith('/api/config/resume-field-usage-policy', {
      headers: { 'X-Workspace-Slug': 'dev-workspace' },
    })
  })
})
