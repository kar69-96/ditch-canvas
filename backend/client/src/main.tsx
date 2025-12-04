import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Enable mock layer when backend is unavailable (development only)
import { enableMockFetch } from './mocks/mock'

if (import.meta.env.VITE_ENABLE_MOCKS === 'true') {
  enableMockFetch()
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
