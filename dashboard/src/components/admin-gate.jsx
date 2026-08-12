import { useState } from 'react';
import { ShieldCheck, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { Card, CardContent } from './ui/card.jsx';
import { setAdminKey, verifyAdminKey } from '../lib/api.js';

/* The admin key is typed in, never bundled. It is verified against a real
   endpoint before it is stored, so a typo fails here instead of turning every
   panel into an error. Rendered as type="password" so the key is not sitting
   in plain text on a screen behind a counter. */
export function AdminGate({ onAuthed }) {
  const [key, setKey] = useState('');
  const [state, setState] = useState('idle'); // idle | checking | error

  async function submit(e) {
    e.preventDefault();
    if (!key.trim()) return;
    setState('checking');
    try {
      if (await verifyAdminKey(key.trim())) {
        setAdminKey(key.trim());
        onAuthed();
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <div className="mb-5 flex flex-col gap-1.5">
            <div className="text-brand-red flex items-center gap-2 text-sm font-bold">
              <ShieldCheck className="size-4" aria-hidden="true" />
              ClaimLabs Dashboard
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              McDonald&rsquo;s &mdash; Slice Rush
            </h1>
            <p className="text-muted-foreground text-xs">
              This dashboard shows customer phone numbers and live coupon codes. Enter the admin key
              to continue.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor="admin-key" className="sr-only">
              Admin key
            </label>
            <Input
              id="admin-key"
              type="password"
              autoComplete="current-password"
              placeholder="Admin key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (state === 'error') setState('idle');
              }}
              aria-invalid={state === 'error'}
              aria-describedby={state === 'error' ? 'admin-key-error' : undefined}
            />
            {state === 'error' ? (
              <p id="admin-key-error" className="text-status-critical text-xs" role="alert">
                That key was rejected. Check <code>ADMIN_KEY</code> in the deployment&rsquo;s
                environment variables.
              </p>
            ) : null}
            <Button type="submit" disabled={state === 'checking' || !key.trim()}>
              {state === 'checking' ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  Checking&hellip;
                </>
              ) : (
                'Unlock dashboard'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
