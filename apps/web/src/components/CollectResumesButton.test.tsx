import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectResumesButton } from './CollectResumesButton'
import type { CollectionSource } from '@/lib/search-profile-sources'

const { openMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
}))

const mockT = (_key: string, fallback?: string) => fallback ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
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
    expect(screen.getByRole('spinbutton', { name: 'Collect page limit' })).not.toBeDisabled()
    expect(screen.getByText(/Collecting up to 50 resumes across 1 page/)).toBeInTheDocument()
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

  it('calls onCollectionSourceChange with 51job type when 51job is selected', async () => {
    const user = userEvent.setup()
    const onCollectionSourceChange = vi.fn()

    render(
      <CollectResumesButton
        location="东莞"
        keywords={['CNC']}
        collectionSource={{ type: 'job5156' }}
        onCollectionSourceChange={onCollectionSourceChange}
      />
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), '51job')

    expect(onCollectionSourceChange).toHaveBeenCalledWith({ type: '51job' })
  })

  it('launches 51job collection URL when 51job is the initial source', async () => {
    const user = userEvent.setup()

    render(
      <Harness
        initialCollectionSource={{ type: '51job' }}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('51job')
    })

    await user.click(screen.getByRole('button', { name: 'Collect' }))

    const launchedUrl = new URL(openMock.mock.calls[0]?.[0] as string)
    expect(`${launchedUrl.origin}${launchedUrl.pathname}`).toBe('https://ehire.51job.com/Revision/talent/search')
    expect(launchedUrl.searchParams.get('keyword')).toBe('"Sales Engineer" OR "Sales Manager"')
    expect(launchedUrl.searchParams.get('location')).toBe('Kuala Lumpur MY')
    expect(launchedUrl.searchParams.get('tr_auto_sync')).toBe('true')
    expect(launchedUrl.searchParams.get('tr_max_pages')).toBe('1')
    expect(launchedUrl.searchParams.get('tr_min_age')).toBe('28')
    expect(launchedUrl.searchParams.get('tr_max_age')).toBe('40')
  })

  it('launches 51job collection with custom limits and auto-derives unsafe mode', async () => {
    const user = userEvent.setup()

    render(
      <Harness
        initialCollectionSource={{ type: '51job' }}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('51job')
    })

    await user.clear(screen.getByRole('spinbutton', { name: 'Limit' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Limit' }), '200')
    await user.clear(screen.getByRole('spinbutton', { name: 'Collect page limit' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Collect page limit' }), '5')
    await user.click(screen.getByRole('button', { name: 'Collect' }))

    const launchedUrl = new URL(openMock.mock.calls[0]?.[0] as string)
    expect(launchedUrl.searchParams.get('tr_limit')).toBe('200')
    expect(launchedUrl.searchParams.get('tr_max_pages')).toBe('5')
    expect(launchedUrl.searchParams.get('tr_unsafe_limits')).toBe('1')
  })

  it('pre-fills limit and maxPages from initialCollectLimit and initialMaxPages props', async () => {
    const user = userEvent.setup()

    render(
      <CollectResumesButton
        location="东莞"
        keywords={['CNC']}
        collectionSource={{ type: '51job' }}
        onCollectionSourceChange={vi.fn()}
        initialCollectLimit={150}
        initialMaxPages={4}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('51job')
    })

    expect(screen.getByRole('spinbutton', { name: 'Limit' })).toHaveValue(150)
    expect(screen.getByRole('spinbutton', { name: 'Collect page limit' })).toHaveValue(4)

    await user.click(screen.getByRole('button', { name: 'Collect' }))

    const launchedUrl = new URL(openMock.mock.calls[0]?.[0] as string)
    expect(launchedUrl.searchParams.get('tr_limit')).toBe('150')
    expect(launchedUrl.searchParams.get('tr_max_pages')).toBe('4')
    expect(launchedUrl.searchParams.get('tr_unsafe_limits')).toBe('1')
  })
})
