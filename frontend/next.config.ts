import type { NextConfig } from 'next';

import { version } from './package.json';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * The version of the bundle actually running in the browser.
   *
   * Read from package.json here rather than written into an env file, because
   * the point of it is to be impossible to forget to update — a version you
   * have to remember to bump in two places is a version that eventually lies.
   *
   * It exists because `NEXT_PUBLIC_*` values are compiled in at build time, so
   * "I changed the setting and it still doesn't work" is usually "you are still
   * being served the old bundle". Showing the frontend's version next to the
   * backend's turns that guess into something you can read off the page.
   */
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },

  typescript: {
    // Never ship a build that doesn't typecheck.
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The call widget needs the microphone; nothing else does.
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
