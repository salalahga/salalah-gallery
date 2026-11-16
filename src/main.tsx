import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initPwa } from './plugins/pwa';
import { lazy, Suspense } from 'react';

// Customer selection links (/pick/<token>) open a public page without login.
const pick = /^\/pick\/([a-f0-9]{24,64})\/?$/.exec(window.location.pathname);
const PublicPick = lazy(() => import('./modules/PublicPick'));
if (!pick) initPwa();

createRoot(document.getElementById('root')!).render(<StrictMode>{pick ? <Suspense fallback={null}><PublicPick token={pick[1]} /></Suspense> : <App />}</StrictMode>);
