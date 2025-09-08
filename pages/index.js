// pages/index.js
import { withPageAuthRequired } from '@auth0/nextjs-auth0';
import Dashboard from '../components/Dashboard';

function Home({ overview = null }) {
  return <Dashboard initialOverview={overview} />;
}

export default withPageAuthRequired(Home, {
  getServerSideProps: async () => {
    // Let the client fetch; avoids SSR failures if data isn't ready
    return { props: { overview: null } };
  },
});
