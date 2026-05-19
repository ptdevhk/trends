import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockRequestJson = vi.hoisted(() => vi.fn())
const mockParseCustomKeywordsPayload = vi.hoisted(() => vi.fn())

vi.mock('@/pages/system-settings/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/system-settings/lib')>()
  return {
    ...actual,
    parseCustomKeywordsPayload: (...args: unknown[]) => mockParseCustomKeywordsPayload(...args),
    useSettingsRequestJson: () => ({ requestJson: mockRequestJson }),
  }
})

import { SystemSettingsLocationsPage } from './SystemSettingsLocationsPage'

const sampleLocations = [
  { id: '1', keyword: 'Guangdong', level: 'province', parentKeyword: null, visible: true },
  { id: '2', keyword: 'Shenzhen', level: 'city', parentKeyword: 'Guangdong', visible: true },
  { id: '3', keyword: 'Dongguan', level: 'city', parentKeyword: 'Guangdong', visible: false },
]

describe('SystemSettingsLocationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseCustomKeywordsPayload.mockReturnValue({ systemLocations: sampleLocations })
    mockRequestJson.mockResolvedValue({})
  })

  it('renders loading state initially', () => {
    mockRequestJson.mockReturnValue(new Promise(() => {}))
    render(<SystemSettingsLocationsPage />)
    expect(screen.getByText(/Locations/)).toBeInTheDocument()
  })

  it('renders location table after data loads', async () => {
    render(<SystemSettingsLocationsPage />)
    // Guangdong appears as keyword + parent ref for 2 cities, so use getAllByText
    expect(await screen.findAllByText('Guangdong')).toHaveLength(3)
    expect(screen.getByText('Shenzhen')).toBeInTheDocument()
    expect(screen.getByText('Dongguan')).toBeInTheDocument()
  })

  it('shows visibility count badge', async () => {
    render(<SystemSettingsLocationsPage />)
    // 2 visible out of 3 total
    expect(await screen.findByText('2/3')).toBeInTheDocument()
  })

  it('filters locations by search query', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsLocationsPage />)
    expect(await screen.findAllByText('Guangdong')).toHaveLength(3)

    const searchInput = screen.getByPlaceholderText(/search locations/i)
    await user.type(searchInput, 'Shenzhen')

    expect(screen.getByText('Shenzhen')).toBeInTheDocument()
    expect(screen.queryByText('Dongguan')).not.toBeInTheDocument()
  })

  it('toggles location visibility on button click', async () => {
    const user = userEvent.setup()

    render(<SystemSettingsLocationsPage />)
    expect(await screen.findAllByText('Guangdong')).toHaveLength(3)

    // Find Hide buttons (for visible items)
    const hideButtons = screen.getAllByText('Hide')
    await user.click(hideButtons[0])

    expect(mockRequestJson).toHaveBeenCalledWith(
      '/api/config/custom-keywords/system-locations/1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ visible: false }) }),
    )
  })

  it('shows error banner on load failure', async () => {
    mockRequestJson.mockRejectedValue(new Error('Network error'))
    render(<SystemSettingsLocationsPage />)
    expect(await screen.findByText(/resumes\.error/)).toBeInTheDocument()
  })
})
