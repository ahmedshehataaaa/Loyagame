import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { App } from './app.jsx';
import { clearAdminKey } from './lib/api.js';
import './index.css';

/* A 401 from ANY panel means the stored key is no longer good (rotated,
   mistyped, or a stale session). Handling it once at the cache level sends the
   operator back to the gate, rather than leaving five tabs erroring
   independently with no explanation. */
const queryCache = new QueryCache({
  onError: (error) => {
    if (error?.status === 401) {
      clearAdminKey();
      window.dispatchEvent(new CustomEvent('claimlabs:unauthorized'));
    }
  },
});

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      // The admin aggregates are cheap but not free; anything younger than one
      // poll interval is fresh enough to reuse across tab switches.
      staleTime: 5_000,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
