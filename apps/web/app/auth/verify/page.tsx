'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState('Verifying your sign-in link…');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    void (async () => {
      const res = await clientFetch('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        router.replace('/');
      } else {
        setState('error');
        setMessage(res.error?.message ?? 'This link is invalid or has expired.');
      }
    })();
  }, [params, router]);

  return (
    <main style={{ maxWidth: 400, margin: '18vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>TRACE</h1>
      <p className={state === 'error' ? '' : 'muted'} style={{ color: state === 'error' ? 'var(--critical)' : undefined }}>
        {message}
      </p>
      {state === 'error' && (
        <a className="btn" href="/login">
          Back to sign in
        </a>
      )}
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }} className="muted">Loading…</main>}>
      <VerifyInner />
    </Suspense>
  );
}
