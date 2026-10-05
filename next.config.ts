import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // самодостаточная сборка для Docker (node server.js без node_modules)
  output: 'standalone',
  // круглая кнопка «N» в левом нижнем углу в режиме разработки
  devIndicators: false,
};

export default nextConfig;
