import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones on the same Wi-Fi or hotspot reach the dev server by LAN address.
  // (The production server used for field tests has no such restriction.)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  // Photos are posted to route handlers; nothing is sent to third parties.
  poweredByHeader: false,
};

export default nextConfig;
