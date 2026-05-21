import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { GET: mockGet },
}))

vi.mock('./WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

import { BrandDisplayMapProvider, useBrandDisplayMapResolve } from './BrandDisplayMapContext'

function ResolveConsumer({ brandId }: { brandId: string }) {
  const { resolve } = useBrandDisplayMapResolve()
  return <div data-testid="result">{resolve(brandId)}</div>
}

function renderWithProvider(brandId: string) {
  return render(
    <BrandDisplayMapProvider>
      <ResolveConsumer brandId={brandId} />
    </BrandDisplayMapProvider>,
  )
}

describe('useBrandDisplayMapResolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves known brand to zhHans name', async () => {
    mockGet.mockResolvedValue({
      data: { fanuc: { displayName: 'Fanuc', zhHans: '发那科' } },
    })

    renderWithProvider('Fanuc')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('发那科')
    })
  })

  it('resolves case-insensitively (lowercased key lookup)', async () => {
    mockGet.mockResolvedValue({
      data: { siemens: { displayName: 'Siemens', zhHans: '西门子' } },
    })

    renderWithProvider('SIEMENS')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('西门子')
    })
  })

  it('trims whitespace before lookup', async () => {
    mockGet.mockResolvedValue({
      data: { mazak: { displayName: 'Mazak', zhHans: '马扎克' } },
    })

    renderWithProvider('  Mazak  ')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('马扎克')
    })
  })

  it('falls back to uppercase brandId for unknown brands', async () => {
    mockGet.mockResolvedValue({ data: {} })

    renderWithProvider('UnknownBrand')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('UNKNOWNBRAND')
    })
  })

  it('returns empty string for empty/whitespace-only brandId', async () => {
    mockGet.mockResolvedValue({ data: {} })

    renderWithProvider('   ')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('')
    })
  })

  it('returns empty string for empty string brandId', async () => {
    mockGet.mockResolvedValue({ data: {} })

    renderWithProvider('')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('')
    })
  })

  it('falls back to uppercase when map is null (fetch failed)', async () => {
    mockGet.mockRejectedValue(new Error('Network error'))

    renderWithProvider('SomeBrand')

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('SOMEBRAND')
    })
  })
})
