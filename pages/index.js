// pages/index.js
import { useUser, withPageAuthRequired } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import Dashboard from '../components/Dashboard';

function Home({ overview }) {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div>
      {/* User info bar */}
      <div className="bg-gray-800 text-white px-4 py-2">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-sm">
            Welcome, <span className="font-medium">{user?.name || user?.email}</span>
          </div>
          <Link href="/api/auth/logout" className="text-sm hover:text-gray-300 underline">
            Sign Out
          </Link>
        </div>
      </div>

      {/* Dashboard (SSR data includes .roomTypes) */}
      <Dashboard overview={overview} />
    </div>
  );
}

export default withPageAuthRequired(Home);

// --- SSR: fetch fresh data on every request (no cache) ---
export async function getServerSideProps(ctx) {
  try {
    // Prefer explicit base URL if provided, else infer from the incoming request.
    const baseEnv = process.env.NEXT_PUBLIC_BASE_URL?.trim();
    const proto =
      ctx.req.headers['x-forwarded-proto']?.toString() ||
      (ctx.req.headers.host?.startsWith('localhost') ? 'http' : 'https');
    const host =
      ctx.req.headers['x-forwarded-host']?.toString() ||
      ctx.req.headers.host?.toString();
    const base = baseEnv || `${proto}://${host}`;

    const res = await fetch(`${base}/api/overview`, {
      cache: 'no-store',
      headers: {
        // tiny cache-buster for any proxy layer that might still try to cache
        'x-no-cache': String(Date.now()),
        'accept': 'application/json',
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    // Prevent page caching by CDNs/proxies
    ctx.res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    return { props: { overview: data } };
  } catch (_err) {
    // Fail safe: render the shell; components handle missing data gracefully
    return { props: { overview: null } };
  }
}
