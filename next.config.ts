import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
    ];
  },
  // Friendly aliases for URLs visitors commonly try on company sites.
  async redirects() {
    return [
      { source: '/signin', destination: '/login', permanent: true },
      { source: '/sign-in', destination: '/login', permanent: true },
      { source: '/signup', destination: '/contact?intent=demo', permanent: false },
      { source: '/register', destination: '/contact?intent=demo', permanent: false },
      { source: '/resources', destination: '/blog', permanent: false },
      { source: '/insights', destination: '/blog', permanent: false },
      { source: '/solutions', destination: '/industries', permanent: false },
      { source: '/company', destination: '/about', permanent: false },
      { source: '/partners', destination: '/contact', permanent: false },
      { source: '/demo', destination: '/contact?intent=demo', permanent: false },
      { source: '/saas-projects', destination: '/products', permanent: true },
      { source: '/saas', destination: '/products', permanent: true },
      { source: '/lahore', destination: '/locations/lahore', permanent: true },
      { source: '/location', destination: '/locations', permanent: true },
    ];
  },
};

export default nextConfig;
