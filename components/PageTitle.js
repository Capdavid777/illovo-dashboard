// components/PageTitle.js
import Image from 'next/image';

export default function PageTitle({ title, subtitle }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <Image
        src="/rs-logo2.png"   // file already in /public
        alt="Reserved Suites"
        width={40}
        height={40}
        priority
      />
      <div className="leading-tight">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-500">{subtitle}</p>}
      </div>
    </div>
  );
}
