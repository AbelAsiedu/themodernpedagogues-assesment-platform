import type { NextConfig } from "next";

// The browser only ever talks to the web origin; /api/v1/* is proxied to the API.
// That keeps the session cookie same-origin and means no browser-side CORS in development.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  transpilePackages: ["@tmp/shared"],
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
  },
};
export default config;
