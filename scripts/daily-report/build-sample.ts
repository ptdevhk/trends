/**
 * Task 2 — write the dated M3 static HTML from the frozen fixture into
 * apps/web/public/daily/YYYY-MM-DD.html (public share door).
 *
 * Run from repo root:  npx tsx scripts/daily-report/build-sample.ts
 * (no prod; writes a local public artifact only).
 */
import { parseDailyReportPack, renderDailyReportHtml } from '@trends/shared'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const FIXTURE = join(process.cwd(), 'config/daily-reports/frozen/2026-09-22.json')
const OUT = join(process.cwd(), 'apps/web/public/daily/2026-09-22.html')

const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const pack = parseDailyReportPack(raw)
const html = renderDailyReportHtml(pack)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html, 'utf8')
console.log(`wrote ${html.length} bytes -> ${OUT}`)
console.log(`opportunities=${pack.opportunities.length} stories=${pack.stories.length} source=${pack.source}`)
