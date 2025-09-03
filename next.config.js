/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,             // catch React issues early
  swcMinify: true,                   // use SWC for faster minification
  productionBrowserSourceMaps: false // safer: don’t expose source maps publicly
};

module.exports = nextConfig;
