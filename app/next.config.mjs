/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // src/instrumentation.ts starts the agent runner when the server boots
  experimental: { instrumentationHook: true },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // node:sqlite is a Node built-in; keep it out of the bundle
      config.externals = [...(config.externals || []), { "node:sqlite": "commonjs node:sqlite" }];
    }
    return config;
  },
};
export default nextConfig;
