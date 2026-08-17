import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// __APP_VERSION__ / __GIT_HASH__ are injected by vite.config.js's `define`
// at build time. If this doesn't match what you expect after a deploy,
// you're looking at a cached/stale build - hard refresh or check that
// deploy:pages actually pushed.
console.log(
  `%c[build] enclave-frontend v${__APP_VERSION__} (${__GIT_HASH__})`,
  'font-weight: bold; color: #06c'
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
