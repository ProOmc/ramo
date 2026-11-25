import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import './bootstrap';
import './design/tokens.css';
import { App } from './layout/App';

const host = document.getElementById('root');
if (!host) throw new Error('Ramo shell host (#root) is missing from index.html.');
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
