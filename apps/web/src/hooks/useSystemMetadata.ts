import { useEffect, useState } from 'react'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'

type SystemMetadataIdentity = {
  appVersion: string
}

type SystemMetadataPayload = {
  success: true
  metadata: {
    identity: SystemMetadataIdentity
  }
}

export function useSystemMetadata(): SystemMetadataIdentity | null {
  const [identity, setIdentity] = useState<SystemMetadataIdentity | null>(null)

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
          setIdentity(payload.metadata.identity)
        }
      })
      .catch((error) => {
        console.error('Failed to load system metadata', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return identity
}
