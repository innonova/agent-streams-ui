import { execFileSync } from 'node:child_process'
/* eslint-disable playwright/no-skipped-test, playwright/no-wait-for-timeout --
   not a test: it takes pictures */
import fs from 'node:fs'
import path from 'node:path'
import { devices, expect, request, test, type Page } from '@playwright/test'
import { E2E_ROOT, MANAGER_PORT } from './constants'
import { agent, login, stream } from './helpers'

/**
 * Not a test: the screen, to be looked at. `LOOK=1 npx playwright test
 * e2e/look.spec.ts` fills the test manager with streams, groups and
 * agents in different states and writes screenshots to /tmp/look/, at a
 * desktop, a low screen and a phone, dark and light. A change to what is
 * shown is looked at this way before it is called done.
 */
test.skip(!process.env.LOOK, 'only when asked for: LOOK=1')
test.describe.configure({ mode: 'serial' })

const OUT = '/tmp/look'
const ids: Record<string, string> = {}

async function say(page: Page, id: string, text: string, wait = true) {
  await page.request.post(`/api/agents/${id}/turn`, { data: { text } })
  if (wait)
    await expect
      .poll(async () => {
        const row = (await (await page.request.get(`/api/agents/${id}`)).json()) as {
          status: { state: string }
        }
        return row.status.state
      })
      .toBe('idle')
}
/** The agent's own way in: its token and nothing else, so what it says is not taken for the person's. */
async function asAgent(page: Page, id: string) {
  await say(page, id, 'token')
  const { items } = (await (await page.request.get(`/api/agents/${id}/items?tail=10`)).json()) as {
    items: { item: { kind: string; text?: string } }[]
  }
  const token = items
    .map((i) =>
      i.item.kind === 'text' ? /token ([0-9a-f]{64})/.exec(i.item.text ?? '')?.[1] : null,
    )
    .find(Boolean)
  return request.newContext({
    baseURL: `http://127.0.0.1:${MANAGER_PORT}`,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  })
}

test('seed', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true })
  await login(page)
  const made = await page.request.post('/api/streams', {
    data: {
      name: 'payments-retry',
      group: 'mimiri',
      defaultProfile: 'fake',
      purpose:
        'Make failed card payments retry on a schedule, and tell the customer once.\n\nA good result: a failed renewal is retried after 1 hour, 1 day and 3 days, and support can see where a payment is in that sequence.',
    },
  })
  const pay = ((await made.json()) as { project: { id: string; path: string } }).project
  const sync = await stream(page, 'sync-conflicts', 'mimiri')
  const estate = await stream(page, 'estate', 'infrastructure')
  const dns = await stream(page, 'dns-cutover', 'infrastructure')
  const shed = await stream(page, 'tidy-the-shed')

  ids.builder = await agent(page, pay.id, 'builder')
  await say(
    page,
    ids.builder,
    'the retry schedule is 1 hour, 1 day, 3 days; then we stop and tell the customer',
  )
  await say(page, ids.builder, 'tool')
  await say(page, ids.builder, 'commit')
  const own = await asAgent(page, ids.builder)
  await own.post(`/api/agents/${ids.builder}/chat`, {
    data: {
      text: 'Chose exponential backoff capped at 3 days, since the processor rate-limits retries inside an hour.',
      kind: 'decision',
    },
  })
  await own.post(`/api/agents/${ids.builder}/chat`, {
    data: {
      text: 'Should a retry that succeeds send the customer a receipt, or stay silent? I am carrying on with the scheduler meanwhile.',
      kind: 'question',
    },
  })
  await agent(page, pay.id, 'reviewer')
  ids.merger = await agent(page, sync.id, 'merger', { permissions: 'ask' })
  await say(page, ids.merger, 'permission', false)
  const fable = await agent(page, estate.id, 'fable')
  await say(page, fable, 'what is the state of the cluster?')
  const helper = await agent(page, estate.id, 'helper')
  await say(page, helper, 'linger', false)
  const cut = await agent(page, dns.id, 'cutover')
  await say(page, cut, 'error', false)
  const sorter = await agent(page, shed.id, 'sorter')
  await page.request.post(`/api/agents/${sorter}/stop`, { data: {} })

  // features of the payments stream: one reported on, one under way, one planned, one done
  const features = path.join(E2E_ROOT, 'streams', '.store', 'payments-retry', 'features')
  fs.mkdirSync(features, { recursive: true })
  const feature = (slug: string, title: string, status: string, priority: number, body: string) =>
    fs.writeFileSync(
      path.join(features, `${slug}.md`),
      `---\ntitle: ${title}\nstatus: ${status}\npriority: ${priority}\ndependsOn: []\n---\n\n${body}\n`,
    )
  feature(
    'retry-schedule',
    'retry failed payments on a schedule',
    'review',
    10,
    [
      '## Purpose',
      '',
      'A card that fails once often works an hour later. Today a failed payment is final and the customer is told at once; we lose subscriptions that would have renewed.',
      '',
      'A good result: a failed renewal is retried after 1 hour, 1 day and 3 days, the customer hears from us once, at the end, and support can see where a payment is in that sequence.',
      '',
      '## Report (2026-11-22)',
      '',
      'Built and deployed to the dev stage, gated alone.',
      '',
      '### What changed',
      '',
      '- **The scheduler** keeps each failed payment with its next attempt and retries it at 1 hour, 1 day and 3 days.',
      '- **The customer mail** goes out once, after the last attempt.',
      '',
      '| Check | Result |',
      '|---|---|',
      '| Unit | 42 passed |',
      '| End to end, against the mock processor | 9 passed |',
      '',
      '### Left open',
      '',
      '- A retry that succeeds sends nothing; whether it should send a receipt is asked in the chat.',
    ].join('\n'),
  )
  feature(
    'receipt-on-success',
    'a receipt when a retry succeeds',
    'in-progress',
    20,
    'Depends on the answer in the chat.',
  )
  feature(
    'support-view',
    'support sees where a payment is',
    'planned',
    30,
    'A column in the admin list.',
  )
  feature(
    'dunning-copy',
    'the wording of the last mail',
    'done',
    5,
    'Agreed with support.\n\n## Report (2026-11-20)\n\nShipped.',
  )
  for (const text of [
    'The mock processor returns 500 on Sundays\nIt should not.',
    'Rename retry_at to next_attempt_at',
  ])
    await page.request.post(`/api/projects/${pay.id}/notes`, { data: { text } })

  // a clone in the payments stream with work in it, for what putting it away would say;
  // and two streams that are away already
  const source = path.join(E2E_ROOT, 'look-remote.git')
  const work = path.join(E2E_ROOT, 'look-work')
  for (const d of [source, work]) fs.rmSync(d, { recursive: true, force: true })
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd,
    })
  fs.mkdirSync(source, { recursive: true })
  git(source, 'init', '-q', '--bare', '-b', 'main')
  git(E2E_ROOT, 'clone', '-q', source, work)
  fs.writeFileSync(path.join(work, 'README.md'), '# billing\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'billing')
  git(work, 'push', '-q', 'origin', 'HEAD:main')
  await page.request.put('/api/repositories/billing', { data: { source } })
  await page.request.post(`/api/projects/${pay.id}/clones`, { data: { repository: 'billing' } })
  const clone = path.join(pay.path, 'billing')
  await expect.poll(() => fs.existsSync(path.join(clone, 'README.md'))).toBe(true)
  git(clone, 'checkout', '-q', '-b', 'payments-retry/scheduler')
  fs.writeFileSync(path.join(clone, 'scheduler.ts'), 'export const delays = [1, 24, 72]\n')
  git(clone, 'add', '-A')
  git(clone, 'commit', '-qm', 'the retry scheduler')
  fs.writeFileSync(path.join(clone, 'probe-output.json'), '{}\n')
  fs.writeFileSync(path.join(clone, 'notes-to-self.md'), 'x\n')
  for (const name of ['invoice-pdf', 'spring-cleanup']) {
    const done = await stream(page, name, name === 'invoice-pdf' ? 'mimiri' : null)
    await page.request.post(`/api/projects/${done.id}/archive`, { data: {} })
  }
})

const sizes = {
  desktop: { viewport: { width: 1500, height: 900 } },
  low: { viewport: { width: 1100, height: 700 } },
} as const

for (const [name, size] of Object.entries(sizes))
  for (const scheme of ['dark', 'light'] as const)
    test(`${name} ${scheme}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        ...size,
        colorScheme: scheme,
        baseURL: test.info().project.use.baseURL,
      })
      const page = await ctx.newPage()
      await login(page)
      await page.goto(`./a/${ids.builder}`)
      await expect(page.getByTestId('agent-title')).toBeVisible()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-1-chat.png` })
      await page.getByTestId('beside-features').click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-2-features.png` })
      await page.getByTestId('feature-row').first().click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-3-feature.png` })
      await page.getByTestId('beside-notes').click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-4-notes.png` })
      await page.getByTestId('beside-stream').click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-6-stream.png` })
      await page.getByTestId('beside-files').click()
      await page.getByTestId('file-tree').getByText('stream', { exact: true }).click()
      await page.getByTestId('file-tree').getByText('features', { exact: true }).click()
      await page.getByTestId('file-tree').getByText('retry-schedule.md', { exact: true }).click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-7-files.png` })
      await page.getByTestId('beside-chat').click()
      for (const g of await page.getByTestId('group-toggle').all()) await g.click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-5-folded.png` })
      for (const g of await page.getByTestId('group-toggle').all()) await g.click()
      await page.getByTestId('away-toggle').click()
      const row = page.locator('[data-test=tree-stream]', { hasText: 'payments-retry' })
      await row.getByTestId('stream-group').click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-8-away.png` })
      await row.getByTestId('stream-put-away').click()
      await expect(page.getByTestId('archive-agents')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/${name}-${scheme}-9-put-away.png` })
      await ctx.close()
    })

test('phone', async ({ browser }) => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 13']
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    userAgent,
    colorScheme: 'dark',
    baseURL: test.info().project.use.baseURL,
  })
  const page = await ctx.newPage()
  await login(page)
  await page.goto('./')
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/phone-1-tree.png` })
  await page.goto(`./a/${ids.builder}`)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/phone-2-chat.png` })
  await page.getByTestId('pane-tab-features').tap()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/phone-3-features.png` })
  await page.getByTestId('feature-row').first().tap()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/phone-4-feature.png` })
  await page.getByTestId('pane-tab-flow').tap()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/phone-5-flow.png` })
  await page.goto('./')
  await page.getByTestId('away-toggle').tap()
  const row = page.locator('[data-test=tree-stream]', { hasText: 'payments-retry' })
  await row.getByTestId('stream-group').tap()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/phone-6-away.png` })
  await row.getByTestId('stream-put-away').tap()
  await expect(page.getByTestId('archive-agents')).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/phone-7-put-away.png` })
  await ctx.close()
})
