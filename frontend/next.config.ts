import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:2095",
    NEXT_PUBLIC_SUB_URL: process.env.NEXT_PUBLIC_SUB_URL ?? "http://localhost:2096",
  },
};

export default withNextIntl(nextConfig);
