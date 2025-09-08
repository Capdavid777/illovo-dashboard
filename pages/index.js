// pages/index.js
import Dashboard from '../components/Dashboard';
import { withPageAuthRequired } from '@auth0/nextjs-auth0';

export default function Home({ overview = null }) {
  return <Dashboard initialOverview={overview} />;
}

// Make the page SSR and protected by Auth0.
// You can fetch initial data here if you want; returning null keeps build simple.
export const getServerSideProps = withPageAuthRequired({
  // Optional: customize returnTo or fetch initial props
  // returnTo: '/',
  getServerSideProps: async (_ctx) => {
    return { props: { overview: null } };
  },
});
