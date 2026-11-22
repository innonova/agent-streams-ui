import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { E2E_ROOT } from './constants'
import { agent, login, pageOverflow, stream } from './helpers'

/**
 * Beside the flow: the chat usually, and the stream's features and notes
 * when asked for. They open with the agent still selected and its flow
 * still in sight, which is the point of having them here.
 */
test('a report is read, answered and closed beside the agent that wrote it', async ({ page }) => {
  await login(page)
  const s = await stream(page, 'reviewed')
  const id = await agent(page, s.id, 'author')
  await page.goto(`./a/${id}`)
  await expect(page.getByTestId('chat-pane')).toBeVisible()

  // the features of the agent's stream, in the pane the chat was in
  await page.getByTestId('beside-features').click()
  await expect(page.getByTestId('features-empty')).toContainText("the stream's own folder")
  // the agent is still selected, and its flow still in sight to the left
  await expect(page.getByTestId('agent-title')).toHaveText(/reviewed\s*›\s*author/)
  const flow = (await page.getByTestId('flow-pane').boundingBox())!
  const beside = (await page.getByTestId('beside-pane').boundingBox())!
  expect(flow.width).toBeGreaterThan(250)
  expect(flow.x + flow.width).toBeLessThanOrEqual(beside.x + 1)
  await expect(page.getByTestId('turn-input')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveCount(0) // the chat's input went with the chat

  await page.getByTestId('new-feature').click()
  await page.getByTestId('feature-title-input').fill('Sweep the floor')
  await page.getByTestId('feature-body-input').fill('Every corner, twice.')
  await page.getByTestId('form-submit').click()
  // made, and opened: the file is in the stream's folder
  await expect(page.getByTestId('feature-body')).toContainText('Every corner, twice.')
  await expect(page).toHaveURL(/feature=sweep-the-floor/)
  const file = path.join(
    E2E_ROOT,
    'streams',
    '.store',
    'reviewed',
    'features',
    'sweep-the-floor.md',
  )
  expect(fs.readFileSync(file, 'utf8')).toContain('title: Sweep the floor')

  // the agent reports, as it would: it edits the file
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('status: planned', 'status: review')
      .concat(
        '\n## Report (2026-11-22)\n\nSwept every corner twice, and found a coin under the bench that is now on the shelf.\n',
      ),
  )
  await expect(page.getByTestId('feature-status')).toHaveText('review')
  await expect(page.getByTestId('feature-body')).toContainText('found a coin')
  await expect(page.getByTestId('beside-features-count')).toHaveText('1')
  // back in the list it is on top, under what is for a person to read, saying where it stands
  await page.getByTestId('feature-back').click()
  const toRead = page.locator('[data-test=features-panel] section[data-status=review]')
  await expect(toRead).toContainText('for you to read')
  await expect(toRead.getByTestId('feature-latest')).toContainText(
    'report 2026-11-22 · Swept every corner',
  )

  // answered: a Response in the file, planned again; then closed
  await toRead.getByTestId('feature-row').click()
  await page.getByTestId('feature-response-input').fill('Good. The coin is mine.')
  await page.getByTestId('feature-respond').click()
  await expect(page.getByTestId('feature-status')).toHaveText('planned')
  await expect(page.getByTestId('feature-body')).toContainText('The coin is mine.')
  expect(fs.readFileSync(file, 'utf8')).toMatch(
    /## Response \(\d{4}-\d\d-\d\d, admin\)\n\nGood\. The coin is mine\./,
  )
  await expect(page.getByTestId('beside-features-count')).toHaveCount(0)
  // a reload comes back to the feature that was open, beside the same agent
  await page.reload()
  await expect(page.getByTestId('feature-body')).toContainText('The coin is mine.')
  await expect(page.getByTestId('agent-title')).toHaveText(/reviewed\s*›\s*author/)
  await page.getByTestId('feature-done').click()
  await expect(page.getByTestId('feature-status')).toHaveText('done')
  await page.getByTestId('feature-back').click()
  await expect(page.getByTestId('feature-row')).toHaveCount(0) // done is the past
  await page.getByTestId('features-done-toggle').click()
  await expect(page.getByTestId('feature-row')).toHaveCount(1)
  expect(await pageOverflow(page)).toBe(0)

  // and the chat is one click back, with its input
  await page.getByTestId('beside-chat').click()
  await expect(page.getByTestId('chat-pane')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page).not.toHaveURL(/feature=/)
})

test('notes are written beside the agent, without a word to it', async ({ page }) => {
  await login(page)
  const s = await stream(page, 'noted')
  const id = await agent(page, s.id, 'busy')
  await page.goto(`./a/${id}`)
  await page.getByTestId('beside-notes').click()
  await expect(page.getByTestId('notes-empty')).toBeVisible()
  await page.getByTestId('note-input').fill('The door squeaks\nOil the top hinge.')
  await page.getByTestId('note-input').press('Control+Enter')
  await page.getByTestId('note-input').fill('Label the shelves')
  await page.getByTestId('note-add').click()
  await expect(page.getByTestId('note')).toHaveCount(2)
  await expect(page.getByTestId('notes-open')).toContainText('Oil the top hinge.')
  await expect(page.getByTestId('beside-notes-count')).toHaveText('2')
  // nothing went to the agent: its flow has no message from this
  await expect(page.getByTestId('flow-pane')).not.toContainText('squeaks')
  // ticked, it leaves the list and is counted as done
  await page.getByTestId('note').first().getByTestId('note-tick').check()
  await expect(page.getByTestId('note')).toHaveCount(1)
  await expect(page.getByTestId('notes-done-toggle')).toContainText('1 done')
  await expect(page.getByTestId('beside-notes-count')).toHaveText('1')
  // the pane remembers what was in it, for the next agent looked at
  await page.reload()
  await expect(page.getByTestId('notes-panel')).toBeVisible()
  await page.getByTestId('beside-chat').click()
})

test('a stream says what it is for and what it has cloned, beside its agent', async ({ page }) => {
  await login(page)
  const made = await page.request.post('/api/streams', {
    data: { name: 'grounded', purpose: 'Keep both feet on the floor.', defaultProfile: 'fake' },
  })
  const s = ((await made.json()) as { project: { id: string; path: string } }).project
  const id = await agent(page, s.id, 'walker')
  // a repository in the registry, to bring in
  const source = path.join(E2E_ROOT, 'registry-source')
  fs.rmSync(source, { recursive: true, force: true })
  fs.mkdirSync(source, { recursive: true })
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: source,
    })
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(source, 'README.md'), '# a thing\n')
  git('add', '-A')
  git('commit', '-qm', 'a thing')
  await page.request.put('/api/repositories/thing', { data: { source } })

  await page.goto(`./a/${id}`)
  await page.getByTestId('beside-stream').click()
  const panel = page.getByTestId('stream-panel')
  await expect(panel).toContainText(s.path)
  await expect(page.getByTestId('stream-purpose')).toContainText('Keep both feet on the floor.')
  // its purpose is corrected here, in the file its agents read
  await page.getByTestId('stream-edit').click()
  await page
    .getByTestId('stream-text')
    .fill('# grounded\n\nKeep both feet on the floor, and look up now and then.\n')
  await page.getByTestId('stream-save').click()
  await expect(page.getByTestId('stream-purpose')).toContainText('look up now and then')
  expect(
    fs.readFileSync(path.join(E2E_ROOT, 'streams', '.store', 'grounded', 'AGENTS.md'), 'utf8'),
  ).toContain('look up now and then')
  // a repository is brought in from the registry, and shows the branch it is on
  await expect(page.getByTestId('clone')).toHaveCount(0)
  await page.getByTestId('clone-pick').selectOption('thing')
  await page.getByTestId('clone-use').click()
  await expect(
    page.locator('[data-test=clone][data-name=thing]').getByTestId('clone-branch'),
  ).toHaveText('main')
  expect(fs.existsSync(path.join(s.path, 'thing', 'README.md'))).toBe(true)
  await expect(page.getByTestId('clone-pick')).toHaveCount(0) // nothing left to bring in
  await page.getByTestId('beside-chat').click()
})
