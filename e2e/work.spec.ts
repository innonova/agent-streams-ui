import fs from 'node:fs'
import path from 'node:path'
import { devices, expect, test } from '@playwright/test'
import { E2E_ROOT } from './constants'
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
  await page.getByTestId('agent-name').fill('sorter')
  await page.getByTestId('agent-profile').selectOption('fake')
  await page.getByTestId('agent-permissions').selectOption('ask')
  await page.getByTestId('agent-nudge').check()
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

  // what is done to the agent rather than said to it is behind one button
  await page.getByTestId('agent-menu').click()
  await page.getByTestId('agent-edit').click()
  await expect(page.getByTestId('agent-permissions')).toHaveValue('ask') // as it was made
  await expect(page.getByTestId('agent-nudge')).toBeChecked()
  await page.getByTestId('agent-name').fill('sorter-two')
  await page.getByTestId('agent-model').fill('fake-large')
  await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('agent-title')).toHaveText(/spring-clean\s*›\s*sorter-two/)
  await expect(group.getByTestId('agent-row')).toContainText('sorter-two')
  await page.getByTestId('agent-menu').click()
  await page.getByTestId('agent-stats').click()
  await expect(page.getByTestId('stats-dialog')).toContainText('sorter-two')
  await expect(page.getByTestId('stats')).toContainText('Runtime') // the figures, once fetched
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('stats-dialog')).toHaveCount(0)

  // a reload comes back to the agent that was open
  await page.goto('./')
  await expect(page.getByTestId('agent-title')).toHaveText(/spring-clean\s*›\s*sorter-two/)

  // deleted for good: off the tree, and the screen back to nobody
  page.once('dialog', (d) => void d.accept())
  await page.getByTestId('agent-menu').click()
  await page.getByTestId('agent-delete').click()
  // back at the tree with nobody selected, in the address too: not left on a pane that no longer exists
  await expect(page.getByTestId('empty')).toContainText('Pick an agent')
  await expect(page).toHaveURL(/\/next\/$/)
  await expect(group.getByTestId('agent-row')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('empty')).toContainText('Pick an agent')
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

  // found by a stream's name, or by an agent's, whether or not its stream was ever opened
  await page.getByTestId('tree-filter').fill('quiet')
  await expect(page.getByTestId('tree-stream')).toHaveCount(1)
  await expect(page.getByTestId('agent-row')).toContainText('idler') // a stream the search opens shows its agents
  await page.getByTestId('tree-filter').fill('findable')
  await expect(page.getByTestId('tree-stream')).toHaveCount(1)
  await expect(page.getByTestId('tree-stream')).toContainText('loose-end')
  await page.getByTestId('tree-filter').fill('asker')
  await expect(page.getByTestId('tree-stream')).toHaveCount(1)
  await expect(page.getByTestId('agent-row')).toContainText('asker')
  await page.getByTestId('tree-filter').fill('nothing-like-this')
  await expect(page.getByTestId('work-tree')).toContainText('nothing by that name')
})

test('a newer build of this UI is offered for a reload; a deploy of the other UI is not', async ({
  page,
}) => {
  await login(page)
  await expect(page.getByTestId('user')).toHaveText('admin')
  await expect(page.getByTestId('update-available')).toHaveCount(0)
  // the UI at / is deployed: none of this page's business
  fs.writeFileSync(
    path.join(E2E_ROOT, 'ui', 'build.json'),
    JSON.stringify({ id: `other-${Date.now()}` }),
  )
  // eslint-disable-next-line playwright/no-wait-for-timeout -- waiting for something not to happen
  await page.waitForTimeout(1500) // three of the manager's ticks
  await expect(page.getByTestId('update-available')).toHaveCount(0)
  // this one is
  fs.writeFileSync(
    path.join(E2E_ROOT, 'ui-next', 'build.json'),
    JSON.stringify({ id: `next-${Date.now()}` }),
  )
  await expect(page.getByTestId('update-available')).toBeVisible()
  // the settings are under the tree: text size, theme, notifications
  await page.getByTestId('settings').click()
  const size = await page.getByTestId('font-size').textContent()
  await page.getByTestId('font-larger').click()
  await expect(page.getByTestId('font-size')).not.toHaveText(size!)
  await page.getByTestId('font-smaller').click()
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  // the menu opens upwards and stays on the screen
  const menu = (await page.getByTestId('settings-menu').boundingBox())!
  expect(menu.y).toBeGreaterThanOrEqual(0)
  expect(menu.y + menu.height).toBeLessThanOrEqual(page.viewportSize()!.height)
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
    // the tabs are one line, however many there are: they scroll sideways and never stack
    const tabs = (await page.getByTestId('pane-tabs').boundingBox())!
    expect(tabs.height).toBeLessThan(52)
    await page.getByTestId('pane-tab-stream').scrollIntoViewIfNeeded()
    await page.getByTestId('pane-tab-stream').tap()
    await expect(page.getByTestId('stream-panel')).toBeVisible()
    await page.getByTestId('pane-tab-flow').scrollIntoViewIfNeeded()
    await page.getByTestId('pane-tab-flow').tap()
    await expect(page.getByTestId('flow-pane')).toBeVisible()
    expect(await pageOverflow(page)).toBe(0)
    await page.getByTestId('tree-button').tap()
    await expect(page.getByTestId('tree-pane')).toBeVisible()
    await expect(page).toHaveURL(/\/next\/$/)
    // archived by someone else while it is on screen: the screen comes back to the tree by itself
    await row.getByTestId('agent-row').locator('a').tap()
    await expect(page.getByTestId('agent')).toBeVisible()
    await page.request.post(`/api/agents/${id}/archive`)
    await expect(page.getByTestId('tree-pane')).toBeVisible()
    await expect(page).toHaveURL(/\/next\/$/)
    await expect(row.getByTestId('agent-row')).toHaveCount(0)
  })
})
