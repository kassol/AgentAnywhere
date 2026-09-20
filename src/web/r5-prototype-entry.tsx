/// <reference types="vite/client" />
// Throwaway R5 page experience. Served only by `bun run prototype:r5`.
import './craft-theme.css'
import './craft/styles.css'
import './r5-prototype.css'
import { createRoot } from 'react-dom/client'
import R5Prototype from './r5-prototype'

document.documentElement.dataset.font = 'inter'
document.title = 'AgentAnywhere · R5 页面原型'
if (import.meta.env.DEV && import.meta.env.MODE === 'r5-prototype') {
  createRoot(document.getElementById('root')!).render(<R5Prototype />)
}
