export const publicOperatorPathPrefixes = [
  "/access",
  "/api/access",
  "/sign-in",
  "/sign-up",
  "/setup",
  "/accept-invite",
  "/onboarding/",
  "/tenant-portal/",
  "/snapshots/",
  "/icon.svg",
];

export function isPublicOperatorPath(pathname: string) {
  return publicOperatorPathPrefixes.some((path) =>
    path.endsWith("/")
      ? pathname.startsWith(path)
      : pathname === path || pathname.startsWith(`${path}/`),
  );
}
