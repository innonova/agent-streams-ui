import { expect, type Page } from '@playwright/test'
import { ADMIN_PASSWORD } from './constants'

/** The addresses are relative: the application lives under /next/, where the manager serves it. */
export async function login(page: Page) {
  await page.goto('./')
  await expect(page).toHaveURL(/\/next\/login/)
  await page.getByTestId('login-name').fill('admin')
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('work')).toBeVisible()
}

/** A stream made through the API, for cases that are about something else. */
export async function stream(page: Page, name: string, group: string | null = null) {
  const res = await page.request.post('/api/streams', {
    data: { name, group, defaultProfile: 'fake' },
  })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { project: { id: string; path: string } }).project
}

/** A fake agent in it, idle. */
export async function agent(
  page: Page,
  projectId: string,
  name: string,
  more: Record<string, string> = {},
) {
  const res = await page.request.post(`/api/projects/${projectId}/agents`, {
    data: { name, ...more },
  })
  const id = ((await res.json()) as { agent: { id: string } }).agent.id
  await expect
    .poll(async () => {
      const row = (await (await page.request.get(`/api/agents/${id}`)).json()) as {
        status: { state: string }
      }
      return row.status.state
    })
    .toBe('idle')
  return id
}

/** How far the page overflows the screen, in px: it never scrolls as a whole. */
export const pageOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.documentElement
    return Math.max(d.scrollHeight - d.clientHeight, d.scrollWidth - d.clientWidth)
  })
