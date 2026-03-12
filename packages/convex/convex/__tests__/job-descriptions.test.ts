import { describe, expect, it } from 'vitest'

import { list_with_usage } from '../job_descriptions'

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const listWithUsageHandler = (list_with_usage as unknown as ConvexHandler<
  { workspaceSlug?: string },
  Array<Record<string, unknown>>
>)._handler

describe('job description legacy industry tags', () => {
  it('normalizes legacy industry tags in list_with_usage results', async () => {
    const jobDescriptions = [
      {
        _id: 'custom-jd-1',
        title: '车床销售',
        type: 'custom',
        workspaceSlug: 'dev',
        enabled: true,
        lastModified: 1,
        industryTags: ['machinery', 'cnc', 'automation', 'sales'],
      },
    ]

    const ctx = {
      db: {
        query(tableName: string) {
          if (tableName === 'job_descriptions') {
            return {
              async collect() {
                return jobDescriptions
              },
            }
          }

          if (tableName === 'resumes') {
            return {
              async collect() {
                return []
              },
            }
          }

          return {
            async collect() {
              return []
            },
          }
        },
      },
    }

    const result = await listWithUsageHandler(ctx as never, { workspaceSlug: 'dev' })
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      industryTags: ['machinery', 'sales'],
      usageCount: 0,
    }))
  })
})
