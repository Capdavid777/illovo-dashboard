// Make the dashboard render with fresh data on every request
export async function getServerSideProps(ctx) {
  // Build a base URL that works on Vercel and locally
  const proto = ctx.req.headers['x-forwarded-proto'] ?? 'http';
  const host = ctx.req.headers.host ?? 'localhost:3000';
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ?? `${proto}://${host}`;

  // Call your existing API that computes the dashboard numbers
  const res = await fetch(`${base}/api/overview`, { cache: 'no-store' });
  const data = await res.json();

  return { props: { initialData: data } };
}

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