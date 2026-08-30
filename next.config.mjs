/** @type {import('next').NextConfig} */
const nextConfig = {
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
