import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

const mockResolve = vi.hoisted(() => vi.fn().mockReturnValue({ fields: { phone: { enabled: true }, email: { enabled: true } } }))

vi.mock('@trends/shared', () => ({
  resolveResumeFieldUsagePolicy: (...args: unknown[]) => mockResolve(...args),
}))

const getMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

vi.mock('./WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev-workspace' }),
}))

import { ResumeFieldUsagePolicyProvider, useResumeFieldUsagePolicy } from './ResumeFieldUsagePolicyContext'

const defaultPolicy = { fields: { phone: { enabled: true }, email: { enabled: true } } }

function TestConsumer() {
  const policy = useResumeFieldUsagePolicy()
  return <div data-testid="policy">{JSON.stringify(policy)}</div>
}

describe('ResumeFieldUsagePolicyProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('provides default policy while fetch is in flight and makes fetch call', () => {
    getMock.mockReturnValue(new Promise(() => {}))

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    expect(JSON.parse(screen.getByTestId('policy').textContent!)).toEqual(defaultPolicy)
    expect(getMock).toHaveBeenCalled()
  })

  it('updates policy from fetch response', async () => {
    const response = { success: true, config: { customField: 'value' } }
    const resolved = { fields: { phone: { enabled: false } }, custom: 'value' }
    mockResolve.mockImplementation(() => resolved)
    getMock.mockResolvedValue({ data: response, response: { ok: true, status: 200 } })

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
    getMock.mockRejectedValue(new Error('Network error'))

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('policy').textContent!)).toEqual(defaultPolicy)
    })
  })

  it('fetches the policy through the shared api client', () => {
    getMock.mockReturnValue(new Promise(() => {}))

    render(
      <ResumeFieldUsagePolicyProvider>
        <TestConsumer />
      </ResumeFieldUsagePolicyProvider>
    )

    expect(getMock).toHaveBeenCalledWith('/api/config/resume-field-usage-policy')
  })
})
