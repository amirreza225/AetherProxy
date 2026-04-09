import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:2095",
    NEXT_PUBLIC_SUB_URL: process.env.NEXT_PUBLIC_SUB_URL ?? "http://localhost:2096",
  },
};

export default nextConfig;
