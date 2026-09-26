import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthGate } from './auth'
import './styles.css'
import './dashboard-team.css'
import './staff-membership-baseline.css'
import './auth.css'

createRoot(document.getElementById('root')!).render(<StrictMode><AuthGate><App /></AuthGate></StrictMode>)
