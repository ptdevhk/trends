import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomerWatchBlock, WATCH_BRANCHES } from './CustomerWatchBlock'

const mockT = (_key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  let text = options?.defaultValue ?? _key
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      if (k === 'defaultValue') continue
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }))

const getMock = vi.fn()
const postMock = vi.fn()
vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { GET: (...a: unknown[]) => getMock(...a), POST: (...a: unknown[]) => postMock(...a) },
}))

const emptyWatchlist = { success: true, entries: [] }
const oneWatchlist = {
  success: true,
  entries: [
    {
      id: 'c-1',
      companyKey: 'quanshuo-jingmi',
      name: '铨硕精密',
      downstreamBranch: '压铸',
      sourceKind: 'videoChannel',
      sourceUrls: ['https://weixin.qq.com/sph/ALr3ch0zp9'],
      sourceAuthor: '铨硕精密',
      caption: '一体化压铸在珠三角落地',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}

const identifyVideo = {
  success: true,
  kind: 'videoChannel',
  result: {
    kind: 'videoChannel',
    name: '铨硕精密',
    author: '铨硕精密',
    caption: '一体化压铸在珠三角落地',
    url: 'https://weixin.qq.com/sph/ALr3ch0zp9',
    needsTopic: false,
  },
}
const identifyMp = {
  success: true,
  kind: 'mp',
  result: {
    kind: 'mp',
    name: null,
    url: 'https://mp.weixin.qq.com/s/AbC123xyz_89',
    needsTopic: true,
  },
}

describe('CustomerWatchBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue({ data: emptyWatchlist })
    postMock.mockResolvedValue({ data: oneWatchlist })
  })

  it('mounts, loads the watchlist, and shows empty state', async () => {
    render(<CustomerWatchBlock />)
    expect(screen.getByTestId('research-customer-watch')).toBeInTheDocument()
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/api/research/watchlist')
    })
    expect(await screen.findByTestId('research-watch-empty')).toBeInTheDocument()
  })

  it('identifies a videoChannel link → pre-fills name, adds to watchlist', async () => {
    getMock.mockResolvedValue({ data: emptyWatchlist })
    postMock.mockImplementation(async (path) => {
      if (path === '/api/research/watchlist/identify') return { data: identifyVideo }
      return { data: oneWatchlist } // add returns one entry
    })
    render(<CustomerWatchBlock />)
    await screen.findByTestId('research-watch-paste')

    fireEvent.change(screen.getByTestId('research-watch-paste'), {
      target: { value: 'https://weixin.qq.com/sph/ALr3ch0zp9' },
    })
    fireEvent.click(screen.getByTestId('research-watch-identify'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/watchlist/identify',
        expect.objectContaining({ body: expect.objectContaining({ url: 'https://weixin.qq.com/sph/ALr3ch0zp9' }) }),
      )
    })
    expect(await screen.findByText('铨硕精密')).toBeInTheDocument()
    expect(screen.getByTestId('research-watch-branches')).toBeInTheDocument()

    // pick a branch + add
    fireEvent.click(screen.getByTestId('research-watch-branch-压铸'))
    fireEvent.click(screen.getByTestId('research-watch-add'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/watchlist',
        expect.objectContaining({
          body: expect.objectContaining({ name: '铨硕精密', downstreamBranch: '压铸' }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('research-watch-list-ul')).toBeInTheDocument()
    })
    expect(screen.getByText('铨硕精密')).toBeInTheDocument()
  })

  it('identifies an mp link as manual-supplement (name input shown)', async () => {
    getMock.mockResolvedValue({ data: emptyWatchlist })
    postMock.mockImplementation(async (path) => {
      if (path === '/api/research/watchlist/identify') return { data: identifyMp }
      return { data: oneWatchlist }
    })
    render(<CustomerWatchBlock />)
    await screen.findByTestId('research-watch-paste')

    fireEvent.change(screen.getByTestId('research-watch-paste'), {
      target: { value: 'https://mp.weixin.qq.com/s/AbC123xyz_89' },
    })
    fireEvent.click(screen.getByTestId('research-watch-identify'))

    // manual name input appears (no auto name)
    expect(await screen.findByTestId('research-watch-confirm-input')).toBeInTheDocument()
    // add is disabled until a name is typed
    expect(screen.getByTestId('research-watch-add')).toBeDisabled()
    fireEvent.change(screen.getByTestId('research-watch-confirm-input'), {
      target: { value: '某下游客户' },
    })
    expect(screen.getByTestId('research-watch-add')).toBeEnabled()
  })

  it('renders WATCH_BRANCHES for selection', () => {
    expect(WATCH_BRANCHES).toContain('压铸')
    expect(WATCH_BRANCHES).toContain('模具')
  })
})
