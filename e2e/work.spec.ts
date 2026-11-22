import { devices, expect, test } from '@playwright/test'
import { agent, login, pageOverflow, stream } from './helpers'

/**
 * The one screen: the tree of every stream and project on the left, the
 * selected agent beside it, and nothing above either.
 */
test('a stream is started in a group, given an agent, and worked with, all on one screen', async ({
  page,
}) => {
  await login(page)
  await expect(page.getByTestId('empty')).toContainText('Pick an agent')

  // a stream, from the tree: its name, what it is for, the group it is listed under
  await page.getByTestId('new-stream').click()
  await page.getByTestId('new-stream-name').fill('spring-clean')
  await page.getByTestId('new-stream-purpose').fill('Empty the attic.')
  await page.getByTestId('new-stream-group').fill('house')
  await page.getByTestId('form-submit').click()
  // the next thing to do with it is an agent, so that form is already open
  await page.getByTestId('new-agent-name').fill('sorter')
  await page.getByTestId('new-agent-profile').selectOption('fake')
  await page.getByTestId('form-submit').click()

  // one screen: the agent beside the tree, its stream in its title, no bar above
  await expect(page).toHaveURL(/\/next\/a\/[0-9a-f-]+$/)
  await expect(page.getByTestId('agent-title')).toHaveText(/spring-clean\s*›\s*sorter/)
  const group = page.locator('[data-test=tree-group][data-group=house]')
  await expect(group.locator('[data-test=tree-stream][data-kind=stream]')).toContainText(
    'spring-clean',
  )
  await expect(group.getByTestId('agent-row')).toContainText('sorter')
  const tree = (await page.getByTestId('tree-pane').boundingBox())!
  const header = (await page.getByTestId('agent-header').boundingBox())!
  expect(tree.x).toBe(0)
  expect(tree.y).toBe(0)
  expect(header.y).toBe(0) // nothing above the agent
  expect(header.x).toBeGreaterThanOrEqual(tree.width)
  expect(header.height).toBeLessThan(48)
  expect(await pageOverflow(page)).toBe(0)

  // the flow and the chat side by side, each with its own input
  const flow = (await page.getByTestId('flow-pane').boundingBox())!
  const chat = (await page.getByTestId('chat-pane').boundingBox())!
  expect(flow.x + flow.width).toBeLessThanOrEqual(chat.x + 1)
  expect(chat.width).toBeGreaterThan(300)
  await page.getByTestId('turn-input').fill('hello there')
  await page.getByTestId('turn-input').press('Control+Enter')
  await expect(page.getByTestId('flow-pane')).toContainText('You said: hello there')
  await page.getByTestId('chat-input').fill('and one for the chat')
  await page.getByTestId('chat-input').press('Control+Enter')
  await expect(page.getByTestId('chat-pane')).toContainText('and one for the chat')

  // a reload comes back to the agent that was open
  await page.goto('./')
  await expect(page.getByTestId('agent-title')).toHaveText(/spring-clean\s*›\s*sorter/)
})

test('the tree: groups, what a folded row says, moving a stream, finding one', async ({ page }) => {
  await login(page)
  const quiet = await stream(page, 'quiet-one', 'alpha')
  const busy = await stream(page, 'busy-one', 'alpha')
  const loose = await stream(page, 'loose-end')
  await agent(page, quiet.id, 'idler')
  const asker = await agent(page, busy.id, 'asker', { permissions: 'ask' })
  await agent(page, loose.id, 'findable')
  await page.request.post(`/api/agents/${asker}/turn`, { data: { text: 'permission' } })
  await page.goto('./')

  const alpha = page.locator('[data-test=tree-group][data-group=alpha]')
  const ungrouped = page.locator('[data-test=tree-group][data-group=""]')
  await expect(alpha.getByTestId('tree-stream')).toHaveCount(2)
  await expect(ungrouped.getByTestId('group-toggle')).toContainText('not in a group')
  // a folded stream says that someone inside waits; open, the agent says for what
  const busyRow = alpha.locator('[data-test=tree-stream]', { hasText: 'busy-one' })
  await expect(busyRow.getByTestId('rollup-waiting')).toHaveText('1')
  await expect(
    alpha.locator('[data-test=tree-stream]', { hasText: 'quiet-one' }).getByTestId('rollup'),
  ).toBeEmpty()
  await busyRow.getByTestId('stream-toggle').click()
  await expect(busyRow.locator('[data-state=waiting-permission]')).toHaveText('permission')
  await expect(busyRow.getByTestId('rollup')).toHaveCount(0)
  // and a folded group says it for everything in it
  await alpha.getByTestId('group-toggle').click()
  await expect(alpha.getByTestId('tree-stream')).toHaveCount(0)
  await expect(alpha.getByTestId('rollup-waiting')).toHaveText('1')
  await page.reload()
  await expect(alpha.getByTestId('tree-stream')).toHaveCount(0) // remembered
  await alpha.getByTestId('group-toggle').click()

  // moved to another group from its own row
  const looseRow = ungrouped.locator('[data-test=tree-stream]', { hasText: 'loose-end' })
  await looseRow.hover()
  await looseRow.getByTestId('stream-group').click()
  await looseRow.getByTestId('group-input').fill('beta')
  await looseRow.getByTestId('group-save').click()
  await expect(
    page.locator('[data-test=tree-group][data-group=beta]').getByTestId('tree-stream'),
  ).toContainText('loose-end')

  // found by a stream's name, or by an agent's once its stream has been opened
  await page.getByTestId('tree-filter').fill('quiet')
  await expect(page.getByTestId('tree-stream')).toHaveCount(1)
  await page.getByTestId('tree-filter').fill('asker')
  await expect(page.getByTestId('tree-stream')).toHaveCount(1)
  await expect(page.getByTestId('agent-row')).toContainText('asker')
  await page.getByTestId('tree-filter').fill('nothing-like-this')
  await expect(page.getByTestId('work-tree')).toContainText('nothing by that name')
})

test.describe('on a phone', () => {
  // a phone's screen, touch and pixel ratio, in the browser every case here uses
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 13']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

  test('the tree is the page one comes back to, and an agent is a page of its own', async ({
    page,
  }) => {
    await login(page)
    const s = await stream(page, 'pocket')
    const id = await agent(page, s.id, 'thumb')
    await page.goto('./')
    // the tree alone, across the screen
    await expect(page.getByTestId('tree-pane')).toBeVisible()
    await expect(page.getByTestId('agent')).toHaveCount(0)
    const tree = (await page.getByTestId('tree-pane').boundingBox())!
    expect(tree.width).toBe(page.viewportSize()!.width)
    const row = page.locator('[data-test=tree-stream]', { hasText: 'pocket' })
    await row.getByTestId('stream-toggle').tap()
    const link = row.getByTestId('agent-row').locator('a')
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(40) // a thumb's worth
    await link.tap()
    // the agent alone: the chat in front, the flow a tab away, the tree a button away
    await expect(page).toHaveURL(new RegExp(`/next/a/${id}$`))
    await expect(page.getByTestId('tree-pane')).toBeHidden()
    await expect(page.getByTestId('chat-pane')).toBeVisible()
    await expect(page.getByTestId('flow-pane')).toBeHidden()
    await page.getByTestId('pane-tab-flow').tap()
    await expect(page.getByTestId('flow-pane')).toBeVisible()
    expect(await pageOverflow(page)).toBe(0)
    await page.getByTestId('tree-button').tap()
    await expect(page.getByTestId('tree-pane')).toBeVisible()
    await expect(page).toHaveURL(/\/next\/$/)
  })
})
