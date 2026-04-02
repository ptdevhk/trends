import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectResumesButton } from './CollectResumesButton'
import type { CollectionSource } from '@/lib/search-profile-sources'

const { openMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

function Harness({
  initialCollectionSource,
}: {
  initialCollectionSource: CollectionSource
}) {
  const [collectionSource, setCollectionSource] = useState<CollectionSource | undefined>(initialCollectionSource)

  return (
    <CollectResumesButton
      location="Kuala Lumpur MY"
      keywords={['Sales Engineer', 'Sales Manager']}
      collectionSource={collectionSource}
      onCollectionSourceChange={setCollectionSource}
      collectUrl="https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1"
      minAge={28}
      maxAge={40}
    />
  )
}

describe('CollectResumesButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })))
    vi.stubGlobal('open', openMock)
  })

  it('switches between SEEK and Job5156 collection lanes without losing the exact SEEK URL', async () => {
    const user = userEvent.setup()

    render(
      <Harness
        initialCollectionSource={{
          type: 'seek',
          exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
        }}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('seek')
    })

    await user.click(screen.getByRole('button', { name: 'Collect' }))

    expect(openMock).toHaveBeenLastCalledWith(
      'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1&tr_auto_sync=true&tr_min_age=28&tr_max_age=40',
      'trends-collect-seek',
      'noopener,noreferrer'
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), '51job')
    expect(screen.getByRole('spinbutton', { name: 'Collect page limit' })).toBeDisabled()
    expect(screen.getByText('51job uses conservative mode: up to 50 resumes and 1 page per run.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collect' }))

    const job51Url = new URL(openMock.mock.calls[1]?.[0] as string)
    expect(`${job51Url.origin}${job51Url.pathname}`).toBe('https://ehire.51job.com/Revision/talent/search')
    expect(job51Url.searchParams.get('keyword')).toBe('"Sales Engineer" OR "Sales Manager"')
    expect(job51Url.searchParams.get('location')).toBe('Kuala Lumpur MY')
    expect(job51Url.searchParams.get('tr_auto_sync')).toBe('true')
    expect(job51Url.searchParams.get('tr_max_pages')).toBe('1')
    expect(job51Url.searchParams.get('tr_min_age')).toBe('28')
    expect(job51Url.searchParams.get('tr_max_age')).toBe('40')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'job5156')
    await user.click(screen.getByRole('button', { name: 'Collect' }))

    const job5156Url = new URL(openMock.mock.calls[2]?.[0] as string)
    expect(`${job5156Url.origin}${job5156Url.pathname}`).toBe('https://hr.job5156.com/search')
    expect(job5156Url.searchParams.get('keyword')).toBe('"Sales Engineer" OR "Sales Manager"')
    expect(job5156Url.searchParams.get('location')).toBe('Kuala Lumpur MY')
    expect(job5156Url.searchParams.get('tr_auto_sync')).toBe('true')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'seek')
    await user.click(screen.getByRole('button', { name: 'Collect' }))

    expect(openMock).toHaveBeenLastCalledWith(
      'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1&tr_auto_sync=true&tr_min_age=28&tr_max_age=40',
      'trends-collect-seek',
      'noopener,noreferrer'
    )
  })
})
