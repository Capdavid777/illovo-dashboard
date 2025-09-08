// pages/login.js
import { useUser } from '@auth0/nextjs-auth0/client';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function Login() {
  const { user, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user) router.replace('/');
    else window.location.href = '/api/auth/login';
  }, [isLoading, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      Redirecting…
    </div>
  );
}
