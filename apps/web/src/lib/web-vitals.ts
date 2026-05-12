import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals'
import type { Metric } from 'web-vitals'
import { apiBaseUrl } from './api-client'

/**
 * Report Core Web Vitals to the BFF analytics endpoint.
 * Fire-and-forget — errors are silently ignored.
 * Only runs in production.
 */
function reportMetric(metric: Metric): void {
  if (!import.meta.env.PROD) {
    console.debug('[web-vitals]', metric.name, metric.value, metric)
    return
  }

  const workspace =
    document.querySelector<HTMLMetaElement>('meta[name="workspace-slug"]')?.content ??
    window.location.pathname.split('/')[1] ??
    'default'

  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
  })

  if (navigator.sendBeacon) {
    navigator.sendBeacon(`${apiBaseUrl}/api/web-vitals/report`, new Blob([body], { type: 'application/json' }))
  } else {
    fetch(`${apiBaseUrl}/api/web-vitals/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': workspace },
      body,
      keepalive: true,
    }).catch(() => {})
  }
}

export function initWebVitals(): void {
  onLCP(reportMetric)
  onCLS(reportMetric)
  onINP(reportMetric)
  onFCP(reportMetric)
  onTTFB(reportMetric)
}
