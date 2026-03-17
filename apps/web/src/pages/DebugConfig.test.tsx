import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SystemSettingsLayout from '@/layouts/SystemSettingsLayout'
import DebugConfig from './DebugConfig'
import { SystemSettingsConfigSourcesPage } from './system-settings/SystemSettingsConfigSourcesPage'
import { SystemSettingsKeywordsPage } from './system-settings/SystemSettingsKeywordsPage'
import { SystemSettingsLocationsPage } from './system-settings/SystemSettingsLocationsPage'

const resetMutation = vi.fn(async () => ({ count: 0, cleared: 0 }))

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  }
}

const tMock = (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
  if (typeof options === 'string') {
    return options
  }
  return options?.defaultValue ?? key
}

vi.mock('convex/react', () => ({
  useMutation: () => resetMutation,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function renderSettingsRoute(initialEntry: string) {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/:teamSlug/system/settings" element={<SystemSettingsLayout />}>
          <Route index element={<DebugConfig />} />
          <Route path="config-sources" element={<SystemSettingsConfigSourcesPage />} />
          <Route path="keywords" element={<SystemSettingsKeywordsPage />} />
          <Route path="locations" element={<SystemSettingsLocationsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('System settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/api/config/custom-keywords') && !init?.method) {
        return jsonResponse({
          success: true,
          tags: [
            {
              id: 'fanuc',
              keyword: 'FANUC',
              english: 'FANUC',
              category: 'brand',
            },
          ],
          categories: [
            {
              id: 'brand',
              name: 'Brand',
            },
          ],
          systemLocations: [
            {
              id: 'gd',
              keyword: '广东',
              level: 'province',
              visible: true,
            },
            {
              id: 'dg',
              keyword: '东莞',
              level: 'city',
              parentKeyword: '广东',
              visible: false,
            },
          ],
        })
      }

      if (url.endsWith('/api/industry/brands')) {
        return jsonResponse({
          success: true,
          data: [
            {
              id: 1,
              nameCn: '马扎克',
              nameEn: 'Mazak',
              type: 'machine',
              origin: 'brands.json',
            },
          ],
        })
      }

      if (url.endsWith('/api/config/source-groups')) {
        return jsonResponse({
          success: true,
          groups: [
            {
              key: 'prompt',
              label: 'Prompt Sources',
              description: 'Shared prompt definitions and locale-aware prompt assets.',
              audience: 'developer',
              sources: [
                {
                  key: 'resume-ai-prompts-active',
                  label: 'Resume AI prompts (active locale)',
                  relativePath: 'config/resume/ai-prompts.md',
                  type: 'markdown',
                  group: 'prompt',
                  audience: 'developer',
                  readOnly: true,
                  metadata: {
                    version: 4,
                    requestedLocale: 'en',
                    resolvedSourceLocale: 'zh-Hans',
                    fallbackToZhHans: true,
                  },
                },
              ],
            },
          ],
        })
      }

      if (url.endsWith('/api/config/sources/resume-ai-prompts-active')) {
        return jsonResponse({
          success: true,
          source: {
            key: 'resume-ai-prompts-active',
            label: 'Resume AI prompts (active locale)',
            relativePath: 'config/resume/ai-prompts.md',
            type: 'markdown',
            group: 'prompt',
            audience: 'developer',
            readOnly: true,
            metadata: {
              version: 4,
              updatedAt: '2026-03-10',
              description: 'Canonical resume AI prompt source',
              locale: 'en',
              requestedLocale: 'en',
              resolvedSourceLocale: 'zh-Hans',
              fallbackToZhHans: true,
            },
            rawSource: '## System Prompt\n- Focus on evidence',
            parsedPreview: {
              sections: [
                {
                  heading: 'System Prompt',
                  lineCount: 1,
                  subsectionHeadings: [],
                },
              ],
            },
          },
        })
      }

      if (url.endsWith('/api/config/custom-keywords/system-locations/dg') && init?.method === 'PUT') {
        return jsonResponse({ success: true })
      }

      throw new Error(`Unhandled fetch: ${url}`)
    }))
  })

  it('renders the overview hub with local settings navigation', () => {
    renderSettingsRoute('/dev/system/settings')

    expect(screen.getByText('Settings overview')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Open each system settings area in its own page.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Operations' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI and agents' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Locations' })).toBeInTheDocument()
  })

  it('loads config-source details on the config sources route', async () => {
    renderSettingsRoute('/dev/system/settings/config-sources')

    expect(await screen.findByText('Canonical resume AI prompt source')).toBeInTheDocument()
    expect(screen.getAllByText('config/resume/ai-prompts.md').length).toBeGreaterThan(0)
  })

  it('renders the dedicated locations page without keyword or config source sections', async () => {
    renderSettingsRoute('/dev/system/settings/locations')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'System location config' })).toBeInTheDocument()
    })

    expect(screen.getByText('Backed by Job5156 location data with per-chip visibility controls.')).toBeInTheDocument()
    expect(screen.getAllByText('广东').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'debugConfig.configSources' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'debugConfig.customKeywords' })).not.toBeInTheDocument()
  })

  it('renders the keywords route with editable and derived keyword data', async () => {
    renderSettingsRoute('/dev/system/settings/keywords')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Keywords' })).toBeInTheDocument()
    })

    expect(screen.getAllByText('FANUC').length).toBeGreaterThan(0)
    expect(screen.getByText('Mazak')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Keyword' })).toBeInTheDocument()
  })
})
