import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Decide before importing or mounting CRM: isolated pages must never load its effects.
const route = window.location.hash;
const page = route === '#/phase3-synthetic'
  ? import('./Phase3SyntheticLab')
  : import('./App');
page.then(({ default: Page }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode><Page /></StrictMode>
  );
});

