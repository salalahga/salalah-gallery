import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthGate } from './components/Auth';
import { StaffApp } from './shells/StaffApp';

createRoot(document.getElementById('root')!).render(
  <AuthGate app="staff" title="Staff"><StaffApp /></AuthGate>,
);
