import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthGate } from './components/Auth';
import { Shell } from './shells/Shell';
import { MANAGER_MODULES } from './modules/registry';

// Separate application for the business manager: own login, owner-controlled permissions, audited.
createRoot(document.getElementById('root')!).render(
  <AuthGate app="manager" title="Business Manager"><Shell appName="Business Manager" modules={MANAGER_MODULES} /></AuthGate>,
);
