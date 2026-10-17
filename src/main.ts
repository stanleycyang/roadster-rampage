import './style.css'
import { Game } from './game.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
if (!canvas) throw new Error('Missing canvas')

try {
  const game = new Game(canvas)
  game.start()
} catch (err) {
  console.error(err)
  const message = err instanceof Error ? err.message : String(err)
  document.body.innerHTML = `<pre style="color:#fff;padding:24px;font:14px/1.4 monospace">${message}</pre>`
}
