import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino uses runtime require.resolve to load its transport worker;
  // webpack bundling breaks that lookup. Keep these on the Node side.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
};

export default nextConfig;
