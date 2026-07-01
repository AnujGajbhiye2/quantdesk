import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ['@ixjb94/indicators'],
  // Keep native addons and pure-Node packages out of the Turbopack bundle
  serverExternalPackages: ['libsql', 'node-cron'],
  // Pin the workspace root so Turbopack does not infer a parent directory
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
