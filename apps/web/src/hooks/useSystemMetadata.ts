import { useEffect, useState } from 'react'
import type { SurfaceNavDefinition } from '@trends/shared'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'

type SystemMetadataIdentity = {
  appVersion: string
}

type SystemMetadataNavigation = {
  system: SurfaceNavDefinition[]
  settings: SurfaceNavDefinition[]
  systemSettings: SurfaceNavDefinition[]
  debugPage: SurfaceNavDefinition[]
}

export type SystemMetadata = {
  identity: SystemMetadataIdentity
  navigation: SystemMetadataNavigation
}

type SystemMetadataPayload = {
  success: true
  metadata: SystemMetadata
}

export function useSystemMetadata(): SystemMetadata | null {
  const [metadata, setMetadata] = useState<SystemMetadata | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/config/system-metadata', {
      headers: withWorkspaceHeaders(),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.json() as Promise<SystemMetadataPayload>
      })
      .then((payload) => {
        if (!cancelled && payload.success) {
          setMetadata(payload.metadata)
        }
      })
      .catch((error) => {
        console.error('Failed to load system metadata', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return metadata
}
