/**
 * Raw fetch wrappers for EXTERNAL (non-API) hosts and static app assets.
 * These must NOT go through apiClient: external hosts must not receive the
 * workspace slug or CSRF headers. Each purpose gets a named helper so the
 * raw `fetch(` call stays inside lib/.
 */

const EXTENSION_META_URL = '/extension/extension-meta.json'

/**
 * Loads the browser-extension metadata JSON (version info) served as a static
 * asset by the web app. Returns null when the asset is unavailable, mirroring
 * the historical call-site behavior of silently skipping on !ok.
 */
export async function fetchExtensionMetaJson(): Promise<unknown> {
  const response = await fetch(EXTENSION_META_URL)
  if (!response.ok) {
    return null
  }
  return response.json()
}
