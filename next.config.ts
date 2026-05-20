import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Enables Cloudflare context (env, KV, R2…) during `next dev`
import("@opennextjs/cloudflare").then((m) =>
  m.initOpenNextCloudflareForDev()
);
