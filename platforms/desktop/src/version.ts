import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Make a version safe for os bundle metadata. Exact release tags keep their
 * three-part semver. git-describe output between tags folds the commit count
 * into the patch field so local builds still monotonically derive from the
 * most recent tag instead of pinning the app at the package.json fallback.
 */
export const normalizeDesktopVersion = (raw: string | undefined, fallback = "0.1.0"): string => {
  if (!raw) return fallback;
  const cleaned = raw
    .trim()
    .replace(/^v/i, "")
    .replace(/-dirty$/, "");
  if (/^\d+\.\d+\.\d+$/.test(cleaned)) return cleaned;

  const describe = /^(\d+)\.(\d+)\.(\d+)-(\d+)-g[0-9a-f]+$/i.exec(cleaned);
  if (describe) {
    const [, major, minor, patch, distance] = describe;
    return `${major}.${minor}.${Number(patch) + Number(distance)}`;
  }

  return fallback;
};

const gitDescribe = (cwd: string): string | undefined => {
  try {
    return execFileSync("git", ["describe", "--tags", "--always", "--dirty"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

/** Resolve the packaging version: DI_VERSION first, then the nearest git tag. */
export const desktopVersion = (fallback = "0.1.0"): string => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  return normalizeDesktopVersion(process.env.DI_VERSION ?? gitDescribe(repoRoot), fallback);
};
