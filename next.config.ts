import type { NextConfig } from "next";
// Pin the workspace root. Without it, a lockfile in any parent directory makes
// Turbopack infer that directory as the root and emit the standalone output at
// .next/standalone/<pkg-name>/server.js — but the Dockerfile copies the tree flat
// and runs `node server.js`, so the container would start and immediately die.
const nextConfig: NextConfig = { output: "standalone", turbopack: { root: import.meta.dirname } };
export default nextConfig;
