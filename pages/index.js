import { useUser, withPageAuthRequired } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import Dashboard from '../components/Dashboard';

function Home({ overview }) {
  const { user, isLoading } = useUser();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return (
    <div>
      <div className="bg-gray-800 text-white px-4 py-2">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-sm">
            Welcome, <span className="font-medium">{user?.name || user?.email}</span>
          </div>
          <Link href="/api/auth/logout" className="text-sm hover:text-gray-300 underline">Sign Out</Link>
        </div>
      </div>

      <Dashboard overview={overview} />
    </div>
  );
}
export default withPageAuthRequired(Home);
