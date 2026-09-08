// @ts-check
import tseslint from "typescript-eslint";

/**
 * TRACE lint configuration.
 *
 * The `no-restricted-imports` blocks encode the module-dependency rule from
 * docs/architecture.md and ADR-002. A violation fails CI.
 *
 *   web        -> shared, ui
 *   api/worker -> domain, db, ai, compliance, shared
 *   domain     -> (nothing)
 *   db/ai/compliance -> shared
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.config.*",
      "**/generated/**",
      "**/next-env.d.ts",
      "**/.next/**",
      "packages/db/src/prisma-client/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // NestJS relies on runtime type reflection (emitDecoratorMetadata) for
  // dependency injection, so constructor-injected classes must be *value*
  // imports. `consistent-type-imports` cannot tell the difference and would
  // rewrite them to type-only imports, breaking DI. Disable it for the API.
  {
    files: ["apps/api/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  // packages/domain must stay pure: no infrastructure, no other TRACE packages
  // except @trace/shared.
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@trace/db",
                "@trace/db/*",
                "@trace/api",
                "@trace/ui",
                "@trace/ai",
                "@trace/compliance",
                "@nestjs/*",
                "next",
                "next/*",
                "react",
                "@prisma/*",
                "ioredis",
                "bullmq",
              ],
              message:
                "packages/domain must be pure. It may only import @trace/shared and standard libraries.",
            },
          ],
        },
      ],
    },
  },

  // Infrastructure packages (db, and later ai/compliance) may only depend on
  // @trace/shared among TRACE packages, and never on the API/UI/web framework.
  {
    files: ["packages/db/**/*.ts", "packages/ai/**/*.ts", "packages/compliance/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@trace/api", "@trace/ui", "next", "next/*", "react"],
              message:
                "Infrastructure packages may not import the API, UI, or web framework.",
            },
          ],
        },
      ],
    },
  },

  // apps/web may not reach into backend packages.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@trace/db",
                "@trace/db/*",
                "@trace/domain",
                "@trace/domain/*",
                "@trace/ai",
                "@trace/compliance",
                "@nestjs/*",
                "@prisma/*",
              ],
              message:
                "apps/web talks to the backend only through the HTTP API client (@trace/shared types are allowed).",
            },
          ],
        },
      ],
    },
  },
);
