import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './theme.css';
import { App } from './App';
import { StoreProvider } from './store';
import { configureSqlJs } from '../fluke/sqlite';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url';

configureSqlJs({ locateFile: () => sqlWasm });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
