/**
 * Public static-site runtime flag. Production static deploys bake
 * VITE_PUBLIC_SITE=1; the storage override exists so a static host (and the
 * e2e static harness) can run the same unbranded bundle without a rebuild.
 */
export const PUBLIC_SITE_STORAGE_KEY = "di.public-site";

/** Compile-time half of the flag: safe for SSR-visible defaults. */
export const PUBLIC_SITE_BUILD = import.meta.env.VITE_PUBLIC_SITE === "1";

/** SSR-visible server default: public builds never assume a di server. */
export const SSR_SERVER_DRIVEN = !PUBLIC_SITE_BUILD;

/** True when this SPA is the public static client-only deployment. */
export function isPublicSite(): boolean {
  if (PUBLIC_SITE_BUILD) return true;
  try {
    return typeof window !== "undefined" && localStorage.getItem(PUBLIC_SITE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
