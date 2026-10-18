import './style.css'
import { Game } from './game.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
if (!canvas) throw new Error('Missing canvas')

try {
  const game = new Game(canvas)
  game.start()
} catch (err) {
  console.error(err)
  const message = document.createElement('p')
  message.style.cssText = 'color:#fff;padding:24px;font:16px/1.5 sans-serif'
  message.setAttribute('role', 'alert')
  message.textContent = 'Roadster Rampage could not start. Try reloading, or use a browser with WebGL 2 and hardware acceleration enabled.'
  document.body.replaceChildren(message)
}
