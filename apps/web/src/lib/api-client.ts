import createClient from 'openapi-fetch'
import type { paths } from './api-types'
import { workspaceRef } from './workspace-ref'

const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
const baseUrl = rawBaseUrl.replace(/\/api\/?$/, '')

export const apiClient = createClient<paths>({ baseUrl })

apiClient.use({
  onRequest({ request }) {
    request.headers.set('X-Workspace-Slug', workspaceRef.get())
    return request
  },
})
