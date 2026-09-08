import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@trace/shared'],
  // Monorepo: the workspace root is two levels up, not the home directory.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Linting is enforced by the repo-wide flat config via `pnpm lint` / CI.
  // `next build` would otherwise require eslint-config-next specifically.
  eslint: { ignoreDuringBuilds: true },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
  },
};

export default nextConfig;
