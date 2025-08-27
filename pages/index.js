import { useUser, withPageAuthRequired } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import Dashboard from '../components/Dashboard';
import PageTitle from '../components/PageTitle'; // ⬅️ add this

function Home({ overview }) {
  const { user, isLoading } = useUser();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return (
    <div>
      {/* top welcome bar */}
      <div className="bg-gray-800 text-white px-4 py-2">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-sm">
            Welcome, <span className="font-medium">{user?.name || user?.email}</span>
          </div>
          <Link href="/api/auth/logout" className="text-sm hover:text-gray-300 underline">Sign Out</Link>
        </div>
      </div>

      {/* ⬇️ place the logo + title here */}
      <div className="max-w-7xl mx-auto px-4">
        <PageTitle title="Reserved Suites Illovo" subtitle="Revenue Dashboard" />
      </div>

      {/* main dashboard */}
      <Dashboard overview={overview} />
    </div>
  );
}
export default withPageAuthRequired(Home);

export async function getServerSideProps({ req, res }) {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const base  = `${proto}://${host}`;
    const r = await fetch(`${base}/api/overview`, { cache: 'no-store', headers: { 'x-no-cache': Date.now().toString() } });
    const data = await r.json();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return { props: { overview: data ?? null } };
  } catch {
    return { props: { overview: null } };
  }
}
