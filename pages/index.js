// pages/index.js
import Link from 'next/link';
import Dashboard from '../components/Dashboard';

// Client-side hooks (for the top bar loading state)
import { useUser, withPageAuthRequired as withPageAuthRequiredClient } from '@auth0/nextjs-auth0/client';
// Server-side wrapper (so SSR is also protected)
import { withPageAuthRequired as withPageAuthRequiredSSR } from '@auth0/nextjs-auth0';

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

      {/* Dashboard gets the fresh server-side data here */}
      <Dashboard overview={overview} />
    </div>
  );
}

// Protect the page component
export default withPageAuthRequiredClient(Home);

// Protect SSR too and fetch fresh data for every request
export const getServerSideProps = withPageAuthRequiredSSR({
  async getServerSideProps(ctx) {
    try {
      const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://illovo-dashboard.vercel.app';

      const res = await fetch(`${base}/api/overview`, {
        cache: 'no-store',
        headers: { 'x-no-cache': Date.now().toString() },
      });

      const overview = await res.json();

      // Ensure the page itself isn’t cached
      ctx.res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );

      return { props: { overview } };
    } catch (e) {
      // Never crash the page if the API fails
      return { props: { overview: null, error: 'fetch-failed' } };
    }
  },
});
