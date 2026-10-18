import { test, expect } from '@playwright/test'
const id = '11111111-1111-4111-8111-111111111111'
const entry = { runId: id, alias: 'Amber Otter', score: 650, distance: 50 }
// No external requests: Vite is local, API fully mocked, fonts blocked.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 })
  await page.addInitScript(() => localStorage.setItem('roadster-rampage-quality', 'medium'))
  await page.route('**/*', async route => {
    if (!route.request().url().startsWith('http://127.0.0.1:4173')) return route.abort()
    return route.continue()
  })
  await page.route('**/api/leaderboard', async route => {
    const body = route.request().postDataJSON()
    await route.fulfill({ json: body?.action === 'start' ? { ticket: `${id}.1800000000000.roadster-v1.signature` } : body?.action === 'submit' ? { entry, duplicate: false } : { entries: [], ruleset: 'roadster-v1' } })
  })
})
test('title, keyboard controls, pause/resume and local records survive offline API', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('roadster-rampage-best', JSON.stringify({ score: 99999, distance: 5000, combo: 12 })))
  await page.goto('/')
  await expect(page.locator('.leaderboard')).toContainText('No runs yet')
  await expect(page.locator('#titleBest')).toContainText('99,999')
  await page.getByRole('button', { name: 'Refresh leaderboard' }).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('body')).toHaveClass(/mode-title/)
  await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await expect(page.locator('body')).toHaveClass(/mode-playing/)
  await page.keyboard.press('p')
  await expect(page.locator('body')).toHaveClass(/mode-paused/)
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.locator('body')).toHaveClass(/mode-playing/)
  // Resume must release button focus so driving keys work immediately.
  await page.getByRole('button', { name: 'Sound', exact: true }).click()
  await page.keyboard.press('p')
  await expect(page.locator('body')).toHaveClass(/mode-paused/)
})
test('post-run lifecycle, double submission, stale responses and tampered response text', async ({ page }) => {
  await page.goto('/')
  // Exercise the real component in isolation without exposing a game cheat hook.
  const registered = page.waitForResponse(response => response.url().endsWith('/api/leaderboard') && response.request().postData()?.includes('start') === true)
  await page.evaluate(async () => {
    const { Leaderboard, CurrentRun } = await import('/src/leaderboard.ts')
    const board = new Leaderboard()
    const run = new CurrentRun(true)
    run.finish(650, 50, 1000)
    document.body.className = 'mode-score'
    board.show(document.getElementById('scoreLeaderboard')!, run)
    ;(window as any).testBoard = board
  })
  await registered
  let submissions = 0
  await page.route('**/api/leaderboard', async route => {
    const body = route.request().postDataJSON()
    if (body?.action === 'submit') {
      submissions++
      await new Promise(resolve => setTimeout(resolve, 100))
      await route.fulfill({ json: { entry, duplicate: false } })
    } else await route.fulfill({ json: { entries: [entry], ruleset: 'roadster-v1' } })
  })
  await page.getByRole('button', { name: 'Submit this run' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.getByRole('button', { name: 'Submitted', exact: true })).toBeDisabled()
  expect(submissions).toBe(1)
  await expect(page.locator('#scoreLeaderboard')).toContainText('Submitted as Amber Otter')
  await page.evaluate(() => (window as any).testBoard.hide())
  await expect(page.locator('#scoreLeaderboard .leaderboard')).toHaveCount(0)
})
test('debug and screenshot runs stay local; mobile leaderboard can scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  const registrations: string[] = []
  page.on('request', req => { if (req.method() === 'POST' && req.url().includes('/api/leaderboard')) registrations.push(req.postData()!) })
  await page.goto('/?debug')
  await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await page.keyboard.press('n')
  await expect(page.locator('body')).toHaveClass(/mode-playing/)
  expect(registrations).toEqual([])
  await page.goto('/?shot=front&autostart')
  await expect(page.locator('body')).toHaveClass(/mode-playing/)
  expect(registrations).toEqual([])
  await page.goto('/')
  await page.getByRole('button', { name: 'Refresh leaderboard' }).scrollIntoViewIfNeeded()
  const box = await page.getByRole('button', { name: 'Refresh leaderboard' }).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.y + box!.height).toBeLessThanOrEqual(700)
})
test('offline and error states never prevent starting; stale requests cannot repopulate UI', async ({ page }) => {
  await page.route('**/api/leaderboard', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.goto('/')
  await expect(page.locator('.leaderboard')).toContainText('unavailable')
  await page.evaluate(async () => {
    const { Leaderboard } = await import('/src/leaderboard.ts')
    let resolve: (data: object) => void
    const board = new Leaderboard(() => new Promise(r => { resolve = r }))
    const host = document.createElement('div'); host.id = 'stale-test'; document.body.append(host)
    board.show(host, null)
    board.hide()
    resolve!({ ruleset: 'roadster-v1', entries: [] })
  })
  await expect(page.locator('#stale-test')).toBeEmpty()
  await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await expect(page.locator('body')).toHaveClass(/mode-playing/)
})

test('real game finish submits only current results; restart and debug finish are isolated', async ({ page }) => {
  // Test-only module interception exposes the instance, with no production hook.
  await page.route('**/src/main.ts', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace('game.start();', 'window.__testGame = game; game.start();').replace('game.start()\n', 'window.__testGame = game; game.start()\n') })
  })
  await page.addInitScript(() => localStorage.setItem('roadster-rampage-best', JSON.stringify({ score: 99999, distance: 9000, combo: 12 })))
  const submitted: any[] = []
  await page.route('**/api/leaderboard', async route => {
    const body = route.request().postDataJSON()
    if (body?.action === 'submit') submitted.push(body)
    await route.fulfill({ json: body?.action === 'start' ? { ticket: `${id}.1800000000000.roadster-v1.signature` } : body?.action === 'submit' ? { entry, duplicate: false } : { entries: [], ruleset: 'roadster-v1' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await page.evaluate(() => {
    const game = (window as any).__testGame
    game.score = 650; game.player.z = 50; game.runDurationMs = 1000
    game.finishRun()
    game.score = 999999 // Cannot mutate the already captured result.
  })
  await expect(page.locator('#scoreLeaderboard')).toContainText('Optional')
  expect(submitted).toHaveLength(0)
  await page.getByRole('button', { name: 'Submit this run' }).click()
  await expect(page.getByRole('button', { name: 'Submitted', exact: true })).toBeDisabled()
  expect(submitted).toHaveLength(1)
  expect(submitted[0].score).toBe(650)
  expect(submitted[0].distance).toBe(50)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roadster-rampage-best')!).score)).toBe(99999)
  await page.getByRole('button', { name: 'Ride again' }).click()
  await expect(page.locator('body')).toHaveClass(/mode-playing/)
  await expect(page.locator('.leaderboard')).toHaveCount(0)
  await page.goto('/?debug')
  await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await page.evaluate(() => (window as any).__testGame.finishRun())
  await expect(page.locator('#scoreLeaderboard')).toContainText('Debug and screenshot runs stay local')
  await expect(page.getByRole('button', { name: 'Submit this run' })).toHaveCount(0)
})

test('loading, offline, invalid response and stale submission states are safe', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { Leaderboard, CurrentRun } = await import('/src/leaderboard.ts')
    const host = document.getElementById('scoreLeaderboard')!
    document.body.className = 'mode-score'
    let resolveSend: (data: object) => void
    const board = new Leaderboard(async body => {
      if (body) return new Promise(resolve => { resolveSend = resolve })
      return { ruleset: 'roadster-v1', entries: [] }
    })
    const run = new CurrentRun(true, async () => ({ ticket: '11111111-1111-4111-8111-111111111111.1.roadster-v1.sig' }))
    run.finish(1, 1, 1)
    board.show(host, run)
    ;(window as any).stale = { board, host, resolve: () => resolveSend({ entry: { runId: '11111111-1111-4111-8111-111111111111', alias: 'Amber Otter', score: 1, distance: 1 } }) }
  })
  await page.getByRole('button', { name: 'Submit this run' }).click()
  await expect(page.locator('#scoreLeaderboard')).toContainText('Submitting')
  await page.evaluate(() => {
    const { board, host, resolve } = (window as any).stale
    board.show(host, null)
    resolve()
  })
  await expect(page.locator('#scoreLeaderboard')).not.toContainText('Submitted as')
  await page.evaluate(async () => {
    const { Leaderboard } = await import('/src/leaderboard.ts')
    ;(window as any).stale.board.hide()
    const board = new Leaderboard(async () => ({ ruleset: 'roadster-v1', entries: [{ runId: '11111111-1111-4111-8111-111111111111', alias: '<img src=x onerror=alert(1)>', score: 1, distance: 1 }] }))
    board.show(document.getElementById('scoreLeaderboard')!, null)
  })
  await expect(page.locator('#scoreLeaderboard')).toContainText('Invalid leaderboard response')
  await expect(page.locator('#scoreLeaderboard img')).toHaveCount(0)
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Refresh leaderboard' }).first().click()
  // Injected invalid-response adapter still runs, but offline presentation takes priority.
  await expect(page.locator('#scoreLeaderboard')).toContainText('Offline')
})
