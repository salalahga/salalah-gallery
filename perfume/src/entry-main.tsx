import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthGate } from './components/Auth';
import { Shell } from './shells/Shell';

createRoot(document.getElementById('root')!).render(
  <AuthGate app="admin" title="Business management"><Shell appName="Owner & operations" /></AuthGate>,
);
