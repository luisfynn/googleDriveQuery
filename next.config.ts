import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // xlsx 패키지가 Node.js 내장 모듈에 의존하므로 외부화
  serverExternalPackages: ["xlsx", "googleapis"],
};

export default nextConfig;
