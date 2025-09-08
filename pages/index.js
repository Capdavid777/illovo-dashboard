// pages/index.js
import { withPageAuthRequired } from '@auth0/nextjs-auth0';
import Dashboard from '../components/Dashboard';

function Home({ overview = null }) {
  return <Dashboard initialOverview={overview} />;
}

export default withPageAuthRequired(Home, {
  getServerSideProps: async () => {
    // Let client-side fetch load the data; keeps SSR simple/robust
    return { props: { overview: null } };
  },
});
