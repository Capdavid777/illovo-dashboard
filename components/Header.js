import Image from 'next/image';
import Link from 'next/link';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#CBA135]/40 bg-neutral-900 text-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3">
          {/* file lives in /public so path starts with / */}
          <Image src="/rs-logo2.png" alt="Reserved Suites" width={140} height={28} priority />
        </Link>
        {/* optional right-side */}
        <nav className="text-xs opacity-80">
          <a href="/api/auth/signout" className="underline">Sign Out</a>
        </nav>
      </div>
    </header>
  );
}
