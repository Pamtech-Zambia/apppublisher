/** @type {import('next').NextConfig} */
const nextConfig = {
  // @h-t-m/app-inspect loads its Rust/WASM parsers from its installed package at runtime.
  // Next.js cannot infer those fs-loaded assets reliably, so explicitly trace them into
  // Node.js function bundles. Keep this narrow to the package's dist WASM files.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/@h-t-m/app-inspect/dist/*.wasm'],
  },
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
