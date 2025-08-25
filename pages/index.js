// pages/index.js
import { useUser, withPageAuthRequired } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import Dashboard from '../components/Dashboard';

function Home({ overview }) {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
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

      {/* Dashboard (SSR data includes .roomTypes now) */}
      <Dashboard overview={overview} />
    </div>
  );
}

export default withPageAuthRequired(Home);

// This runs on every request (no cache) and now returns roomTypes too
export async function getServerSideProps(ctx) {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      'https://illovo-dashboard.vercel.app';

    const res = await fetch(`${base}/api/overview`, {
      cache: 'no-store',
      headers: { 'x-no-cache': Date.now().toString() },
    });

    const data = await res.json();

    // prevent CDN/proxy caching of the page
    ctx.res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    return { props: { overview: data ?? null } };
  } catch (e) {
    return { props: { overview: null, error: 'fetch-failed' } };
  }
}
