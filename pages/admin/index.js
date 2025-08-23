// pages/admin.tsx  (or pages/admin/index.tsx)

export const getServerSideProps = async () => {
  // Important: nothing DB- or fetch-related here for now
  return { props: {} };
};

export default function AdminPage() {
  return <main style={{ padding: 24 }}>Admin is up ✅</main>;
}
