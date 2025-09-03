Illovo Dashboard



A secure revenue dashboard for Reserved Suites Illovo, built with Next.js, Prisma, Auth0, TailwindCSS, and Recharts.

Deployed on Vercel with PostgreSQL as the database.



🚀 Features



Secure login via Auth0



Daily, Room Type, and Yearly metrics with visualization



Multi-source data loading (/api/month, DB endpoints, or static JSON fallback in /public/data)



Monthly navigation \& historical trend analysis



Prisma ORM with PostgreSQL



TailwindCSS for styling



Vercel deployment ready



📂 Project Structure

illovo-dashboard/

├── components/          # Reusable React components

│   ├── Dashboard.js

│   ├── Header.js

│   └── PageTitle.js

├── lib/

│   └── prisma.js        # Prisma client wrapper

├── pages/

│   ├── \_app.js

│   ├── index.js

│   ├── login.js

│   └── api/

│       ├── auth/\[...auth0].js

│       ├── admin/import-report.js

│       ├── daily-metrics/

│       │   ├── index.js

│       │   └── \[id].js

│       ├── import-month.js

│       ├── month.js

│       ├── overview/index.js

│       ├── ping.js

│       └── rs/index.js

├── prisma/

│   ├── schema.prisma

│   ├── migrations/

│   │   ├── 20250823140607\_init/

│   │   ├── 20250823150504\_init/

│   │   ├── 20250825162120\_add\_room\_type\_metric/

│   │   ├── 2025-08-26\_add\_year\_metric/

│   │   └── migration\_lock.toml

├── public/

│   ├── rs-logo2.png

│   └── data/

│       ├── index.json

│       ├── 2025-08.json

│       └── 2025-09.json

├── styles/

│   └── globals.css

├── .env.local           # Local environment variables

├── .gitignore

├── next.config.js

├── package.json

├── postcss.config.js

├── tailwind.config.js

└── vercel.json



⚙️ Setup

1\. Clone repository

git clone https://github.com/your-org/illovo-dashboard.git

cd illovo-dashboard



2\. Install dependencies

npm install



3\. Environment variables



Create .env.local with:



DATABASE\_URL=postgresql://user:password@host:5432/dbname

DIRECT\_URL=postgresql://user:password@host:5432/dbname

AUTH0\_SECRET=your\_auth0\_secret

AUTH0\_BASE\_URL=https://yourdomain.vercel.app

AUTH0\_ISSUER\_BASE\_URL=https://your-tenant.auth0.com

AUTH0\_CLIENT\_ID=your\_auth0\_client\_id

AUTH0\_CLIENT\_SECRET=your\_auth0\_client\_secret

RS\_API=https://illovo-dashboard.vercel.app/exec



4\. Prisma setup

npx prisma generate

npx prisma migrate deploy



5\. Development

npm run dev





Visit: http://localhost:3000



6\. Deployment



Deployed on Vercel

.

Ensure the same env variables are set in Vercel Project Settings.



📊 Data Import



Upload reports via /api/admin/import-report



Daily metrics via /api/daily-metrics



Monthly merge via /api/month



Static fallback JSON in /public/data/{YYYY-MM}.json



🛠 Scripts



npm run dev – start local dev server



npm run build – build production app



npm run start – start production server



npm run vercel-build – Prisma migrate + build for Vercel



npm run postinstall – Prisma generate client after install



📖 Notes



Keep /public/data/index.json updated with min/max months for navigation.



Use ?debug=1 and ?inspect=1 query params in the dashboard for debugging.



Breakeven target is configurable in Dashboard.js.

