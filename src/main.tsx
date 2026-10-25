import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Register PWA service worker with auto-update
registerSW({
  immediate: true,
  onRegistered(r) {
    if (r) {
      console.log('Canada Recall Alert PWA Service Worker successfully registered');
    }
  },
  onRegisterError(error) {
    console.warn('PWA Service Worker registration error:', error);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
