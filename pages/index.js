import { useUser, withPageAuthRequired } from '@auth0/nextjs-auth0/client';
import Dashboard from '../components/Dashboard';
import Link from 'next/link';

function Home() {
  const { user, isLoading } = useUser();

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div>
      {/* User info bar */}
      <div className="bg-gray-800 text-white px-4 py-2">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-sm">
            Welcome, <span className="font-medium">{user?.name || user?.email}</span>
          </div>
          <Link
            href="/api/auth/logout"
            className="text-sm hover:text-gray-300 underline"
          >
            Sign Out
          </Link>
        </div>
      </div>
      
      {/* Dashboard */}
      <Dashboard />
    </div>
  );
}

export default withPageAuthRequired(Home);

// pages/index.js  (append or replace your data loader)

// This runs on *every request* on the server.
export async function getServerSideProps(ctx) {
  try {
    // Use your own domain in production so cookies/env are correct.
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      'https://illovo-dashboard.vercel.app';

    const res = await fetch(`${base}/api/overview`, {
      // IMPORTANT: prevent Next from caching this fetch
      cache: 'no-store',
      // (optional extra belt-and-braces)
      headers: { 'x-no-cache': Date.now().toString() },
    });

    const data = await res.json();

    // Also tell any proxy/CDN not to cache this page
    ctx.res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    // If your component expects a different prop shape, map it here:
    return { props: { overview: data } };
  } catch (e) {
    // Never hard-crash the page
    return { props: { overview: null, error: 'fetch-failed' } };
  }
}
