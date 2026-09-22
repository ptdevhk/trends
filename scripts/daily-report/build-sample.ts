/**
 * Task 2 — write the dated M3 static HTML from the frozen fixture into
 * output/daily-report/sample-YYYY-MM-DD.html (local scratch artifact, NOT the
 * production public path; the production source of truth is Convex).
 *
 * Run from repo root:  npx tsx scripts/daily-report/build-sample.ts
 * (no prod; writes a local scratch artifact only).
 */
import { parseDailyReportPack, renderDailyReportHtml } from '@trends/shared'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const FIXTURE = join(process.cwd(), 'config/daily-reports/frozen/2026-09-22.json')
const OUT = join(process.cwd(), 'output/daily-report/sample-2026-09-22.html')

const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const pack = parseDailyReportPack(raw)
const html = renderDailyReportHtml(pack)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html, 'utf8')
console.log(`wrote ${html.length} bytes -> ${OUT}`)
console.log(`opportunities=${pack.opportunities.length} stories=${pack.stories.length} source=${pack.source}`)
