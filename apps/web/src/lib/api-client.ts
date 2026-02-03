import createClient from 'openapi-fetch'
import type { paths } from './api-types'

const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
const baseUrl = rawBaseUrl.replace(/\/api\/?$/, '')

export const apiClient = createClient<paths>({ baseUrl })
