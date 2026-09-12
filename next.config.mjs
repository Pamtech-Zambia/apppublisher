/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        url: false,
        stream: false,
        buffer: false,
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/.well-known/openai-apps-challenge',
        destination: '/api/openai-apps-challenge',
      },
    ];
  },
};

export default nextConfig;
