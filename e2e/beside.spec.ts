import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { E2E_ROOT, PROJECT_DIR } from './constants'
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
  // a tick the manager refuses leaves the box unticked
  await page.route('**/api/projects/*/notes/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, body: '{}' })
      : route.continue(),
  )
  await page.getByTestId('note').first().getByTestId('note-tick').click()
  await expect(page.getByTestId('note').first().getByTestId('note-tick')).not.toBeChecked()
  await page.unroute('**/api/projects/*/notes/*')
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
  // and what of it is not landed, which a fresh clone has none of
  const landing = page.locator('[data-test=clone][data-name=thing]').getByTestId('clone-landing')
  await expect(landing).toHaveText('everything landed')
  fs.writeFileSync(path.join(s.path, 'thing', 'notes.txt'), 'x\n')
  await page.getByTestId('beside-notes').click()
  await page.getByTestId('beside-stream').click()
  await expect(landing).toHaveText('1 file not committed')
  await expect(page.getByTestId('clone-pick')).toHaveCount(0) // nothing left to bring in
  await page.getByTestId('beside-chat').click()
})

test('an agent is forked into another stream with its conversation', async ({ page }) => {
  await login(page)
  const from = await stream(page, 'trunk')
  const to = await stream(page, 'branch-off')
  const id = await agent(page, from.id, 'elder')
  await page.goto(`./a/${id}`)
  await page.getByTestId('turn-input').fill('the logo is teal')
  await page.getByTestId('turn-input').press('Control+Enter')
  await expect(page.getByTestId('flow-pane')).toContainText('You said: the logo is teal')

  // before the vendor has written the conversation down there is nothing to copy, and the form says so
  await page.getByTestId('agent-menu').click()
  await page.getByTestId('agent-fork').click()
  await page.getByTestId('fork-name').fill('younger')
  await page.getByTestId('fork-into').selectOption(to.id)
  await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('form-error')).toContainText('no conversation to copy yet')

  // the vendor's file, as the test plays it; then the fork is made and is where the screen goes
  const row = (await (await page.request.get(`/api/agents/${id}`)).json()) as {
    agent: { vendorConversationId: string }
  }
  const dir = path.join(E2E_ROOT, 'vendor', path.basename(from.path))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${row.agent.vendorConversationId}.jsonl`), 'so far\n')
  await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('agent-title')).toHaveText(/branch-off\s*›\s*younger/)
  await expect(page).not.toHaveURL(new RegExp(id))
  await expect(page.getByTestId('flow-pane')).toContainText('forked from trunk/elder')
  // both are in the tree, each in its own stream
  await expect(
    page.locator('[data-test=tree-stream]', { hasText: 'branch-off' }).getByTestId('agent-row'),
  ).toContainText('younger')
  await page.getByTestId('turn-input').fill('whence')
  await page.getByTestId('turn-input').press('Control+Enter')
  await expect(page.getByTestId('flow-pane')).toContainText(
    `Forked from ${row.agent.vendorConversationId}.`,
  )
})

test('the files of a stream are read beside the agent, and an upload is mentioned to it', async ({
  page,
}) => {
  await login(page)
  const made = await page.request.post('/api/streams', {
    data: { name: 'paperwork', purpose: 'Keep the papers in order.', defaultProfile: 'fake' },
  })
  const s = ((await made.json()) as { project: { id: string; path: string } }).project
  const id = await agent(page, s.id, 'clerk')
  fs.mkdirSync(path.join(s.path, 'stream', 'docs'))
  fs.writeFileSync(
    path.join(s.path, 'stream', 'docs', 'plan.md'),
    '# The plan\n\nFile everything **twice**.\n',
  )

  await page.goto(`./a/${id}`)
  await page.getByTestId('beside-files').click()
  const panel = page.getByTestId('files-panel')
  // the stream's own folder is there, and a Markdown file in it opens rendered
  const tree = page.getByTestId('file-tree')
  await tree.getByText('stream', { exact: true }).click()
  await tree.getByText('docs', { exact: true }).click()
  await tree.getByText('plan.md', { exact: true }).click()
  await expect(page.getByTestId('file-path')).toHaveText('stream/docs/plan.md')
  await expect(panel.locator('h1')).toHaveText('The plan')
  await expect(page).toHaveURL(/file=stream(%2F|\/)docs(%2F|\/)plan\.md/)
  // still beside the agent, whose flow and input are where they were
  await expect(page.getByTestId('agent-title')).toHaveText(/paperwork\s*›\s*clerk/)
  const flow = (await page.getByTestId('flow-pane').boundingBox())!
  const beside = (await page.getByTestId('beside-pane').boundingBox())!
  expect(flow.width).toBeGreaterThan(250)
  expect(flow.x + flow.width).toBeLessThanOrEqual(beside.x + 1)
  expect(await pageOverflow(page)).toBe(0)
  // a reload comes back to the same file
  await page.reload()
  await expect(page.getByTestId('file-path')).toHaveText('stream/docs/plan.md')

  // an upload lands in the selected folder and can be mentioned to the agent this is beside
  await page.getByTestId('files-upload-input').setInputFiles({
    name: 'receipt.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('paid\n'),
  })
  await page.getByText('mention to the agent').click()
  await expect(page.getByTestId('turn-input')).toHaveValue('See stream/docs/receipt.txt')
  expect(fs.readFileSync(path.join(s.path, 'stream', 'docs', 'receipt.txt'), 'utf8')).toBe('paid\n')

  // put away, the file leaves the address with it
  await page.getByTestId('beside-chat').click()
  await expect(page).not.toHaveURL(/file=/)
})

test('what changed is read beside the agent: its own commits first, everyone’s one click away', async ({
  page,
}) => {
  await login(page)
  // a project of the older kind on a repository with a commit and uncommitted work in it
  const all = (await (await page.request.get('/api/projects')).json()) as {
    project: { id: string; name: string }
  }[]
  const found = all.find((p) => p.project.name === 'with-history')
  const projectId =
    found?.project.id ??
    (
      (await (
        await page.request.post('/api/projects', {
          data: { name: 'with-history', repos: [{ path: PROJECT_DIR }], defaultProfile: 'fake' },
        })
      ).json()) as { project: { id: string } }
    ).project.id
  const id = await agent(page, projectId, `reader-${Date.now()}`)
  await page.goto(`./a/${id}`)
  await page.getByTestId('beside-changes').click()
  const panel = page.getByTestId('changes-panel')
  // it opens on what this agent committed, which is nothing
  await expect(page.getByTestId('changes-agent')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('commits-empty')).toContainText('No commits by this agent')
  // everyone's: the repository's commit, and the work not committed yet
  await page.getByTestId('changes-all').click()
  await expect(panel.getByTestId('commit-row')).toContainText('init')
  await expect(panel.getByTestId('working-row')).toContainText('working tree')
  await panel.getByTestId('commit-row').first().click()
  await expect(panel.getByTestId('commit-file').first()).toBeVisible()
  await panel.getByTestId('commit-file').first().click()
  await expect(panel.getByTestId('diff-path')).not.toHaveText('select a commit, then a file')
  // still beside the agent, and nothing spills off the screen
  await expect(page.getByTestId('agent-title')).toHaveText(/with-history\s*›\s*reader-/)
  await expect(page.getByTestId('turn-input')).toBeVisible()
  expect(await pageOverflow(page)).toBe(0)
  await page.getByTestId('changes-agent').click()
  await page.getByTestId('beside-chat').click()
})

test('a stream is put away once it has said what that does, and brought back from under the tree', async ({
  page,
}) => {
  await login(page)
  const s = await stream(page, 'seasonal')
  const id = await agent(page, s.id, 'keeper')
  // a clone of its own, with a file nobody committed
  const source = path.join(E2E_ROOT, 'seasonal-source')
  fs.rmSync(source, { recursive: true, force: true })
  fs.mkdirSync(source, { recursive: true })
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: source,
    })
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(source, 'README.md'), '# decorations\n')
  git('add', '-A')
  git('commit', '-qm', 'decorations')
  await page.request.put('/api/repositories/decorations', { data: { source } })
  await page.request.post(`/api/projects/${s.id}/clones`, { data: { repository: 'decorations' } })
  const clone = path.join(s.path, 'decorations')
  await expect.poll(() => fs.existsSync(path.join(clone, 'README.md'))).toBe(true)
  fs.writeFileSync(path.join(clone, 'scratch.txt'), 'x\n')

  await page.goto(`./a/${id}`)
  const row = page.locator('[data-test=tree-stream]', { hasText: 'seasonal' })
  await row.getByTestId('stream-group').click()
  await row.getByTestId('stream-put-away').click()
  // what it will do, before it is done: the file that would be lost stands in the way until let go
  const dialog = page.getByTestId('archive-dialog')
  await expect(dialog.getByTestId('archive-uncommitted')).toContainText('decorations')
  await expect(dialog.getByTestId('archive-uncommitted')).toContainText('scratch.txt')
  await expect(dialog.getByTestId('archive-agents')).toContainText('keeper')
  await expect(dialog.getByTestId('form-submit')).toBeDisabled()
  expect(await pageOverflow(page)).toBe(0)
  await dialog.getByTestId('archive-discard').check()
  await dialog.getByTestId('form-submit').click()
  // away: out of the tree, the agent's page left for the tree, the clone off the disk
  await expect(page.locator('[data-test=tree-stream]', { hasText: 'seasonal' })).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/next\/$/)
  expect(fs.existsSync(clone)).toBe(false)
  expect(fs.existsSync(path.join(s.path, 'AGENTS.md'))).toBe(true)

  // and found where one looks for a stream that is not there
  await page.getByTestId('away-toggle').click()
  const away = page.locator('[data-test=away-row]', { hasText: 'seasonal' })
  await away.getByTestId('away-bring-back').click()
  await expect(page.locator('[data-test=tree-stream]', { hasText: 'seasonal' })).toHaveCount(1)
  await expect(page.locator('[data-test=away-row]', { hasText: 'seasonal' })).toHaveCount(0)
  await expect.poll(() => fs.existsSync(path.join(clone, 'README.md'))).toBe(true)
  expect(fs.existsSync(path.join(clone, 'scratch.txt'))).toBe(false)
  // its agent is there again, and is spoken to as before
  await expect(page.locator('[data-test=stream-moving]')).toHaveCount(0)
  await page.locator('[data-test=tree-stream]', { hasText: 'seasonal' }).getByText('keeper').click()
  await expect(page.getByTestId('agent-header')).toContainText('keeper')
})

test('a stream’s changes are its own commits; the repository’s history is asked for', async ({
  page,
}) => {
  await login(page)
  const s = await stream(page, 'own-work')
  const id = await agent(page, s.id, 'maker')
  // a repository with a history of its own, and a clone of it in the stream
  const source = path.join(E2E_ROOT, 'own-work-source')
  fs.rmSync(source, { recursive: true, force: true })
  fs.mkdirSync(source, { recursive: true })
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd,
    })
  git(source, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(source, 'README.md'), '# shared\n')
  git(source, 'add', '-A')
  git(source, 'commit', '-qm', 'long before this stream')
  await page.request.put('/api/repositories/shared', { data: { source } })
  await page.request.post(`/api/projects/${s.id}/clones`, { data: { repository: 'shared' } })
  const clone = path.join(s.path, 'shared')
  await expect.poll(() => fs.existsSync(path.join(clone, 'README.md'))).toBe(true)
  git(clone, 'checkout', '-q', '-b', 'own-work/first')
  fs.writeFileSync(path.join(clone, 'new.txt'), 'x\n')
  git(clone, 'add', '-A')
  git(clone, 'commit', '-qm', 'what this stream did', '-m', 'Feature: own-work/first')

  await page.goto(`./a/${id}`)
  await page.getByTestId('beside-changes').click()
  const panel = page.getByTestId('changes-panel')
  // the stream's: its commit, with the feature it names, and not the repository's past
  await page.getByTestId('changes-all').click()
  await expect(page.getByTestId('changes-all')).toHaveText("the stream's")
  await expect(panel.getByTestId('commit-row')).toHaveCount(1)
  await expect(panel.getByTestId('commit-row')).toContainText('what this stream did')
  await expect(panel.getByTestId('commit-row')).toContainText('first')
  // the repository's: everything the clone holds
  await page.getByTestId('changes-repository').click()
  await expect(panel.getByTestId('commit-row')).toHaveCount(2)
  await expect(panel.getByTestId('commit-row').nth(1)).toContainText('long before this stream')
  expect(await pageOverflow(page)).toBe(0)
  await page.getByTestId('changes-agent').click()
  await page.getByTestId('beside-chat').click()
})
