import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow blob: URLs created by URL.createObjectURL for image previews
    remotePatterns: [],
    dangerouslyAllowSVG: false,
    unoptimized: false,
  },
};

export default nextConfig;
