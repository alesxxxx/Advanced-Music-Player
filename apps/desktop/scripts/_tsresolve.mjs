import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Minimal ESM resolve hook for the test harnesses: lets Node import the app's extensionless
 * relative TypeScript specifiers (e.g. `import "../genreNormalize"`) the same way Vite does.
 * Node 23.6+ strips the types itself; this only fills the missing extension.
 */
export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
    for (const ext of [".ts", ".tsx", ".js"]) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return next(specifier + ext, context);
      }
    }
  }
  return next(specifier, context);
}
