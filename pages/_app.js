// pages/_app.js
import { UserProvider } from '@auth0/nextjs-auth0/client';
import '../styles/globals.css';
import Header from '../components/Header';

export default function App({ Component, pageProps }) {
  return (
    <UserProvider>
      <Header />
      {/* keep content below the sticky header */}
      <main className="pt-14">
        <Component {...pageProps} />
      </main>
    </UserProvider>
  );
}
