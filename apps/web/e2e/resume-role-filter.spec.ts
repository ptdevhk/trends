import { expect, test } from '@playwright/test'

function countNonEngineerCards(roleTypes: Array<string | null>): number {
  return roleTypes.filter((value) => {
    if (!value) {
      return true
    }

    const types = value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)

    return !types.includes('engineer')
  }).length
}

test.describe('Resume quick role filter', () => {
  test('engineer role filter keeps only engineer-tagged resumes', async ({ page }) => {
    await page.goto('/dev/resumes?location=%E5%B9%BF%E4%B8%9C&jd=senior-mechanical-engineer')

    await expect(page.getByText('工程经验')).toBeVisible()

    const cards = page.getByTestId('resume-card')
    const nonEngineerBefore = countNonEngineerCards(await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-role-types'))
    ))

    await page.getByRole('spinbutton', { name: '要求工程经验 最少 年' }).fill('1')
    await page.getByRole('button', { name: '应用快速筛选' }).click()

    await expect.poll(async () => {
      const roleTypes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-role-types'))
      )
      return countNonEngineerCards(roleTypes)
    }).toBe(0)

    const nonEngineerAfter = countNonEngineerCards(await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-role-types'))
    ))

    expect(nonEngineerAfter).toBe(0)
    expect(nonEngineerAfter).toBeLessThanOrEqual(nonEngineerBefore)
  })
})

