export const publicOperatorPathPrefixes = [
  "/access",
  "/account",
  "/api/access",
  "/sign-in",
  "/sign-up",
  "/setup",
  "/accept-invite",
  "/onboarding/",
  "/tenant-portal",
  "/tenant-portal/",
  "/owner-portal",
  "/owner-portal/",
  "/snapshots/",
  "/welcome",
  "/icon.svg",
  "/manifest.webmanifest",
];

export function isPublicOperatorPath(pathname: string) {
  return publicOperatorPathPrefixes.some((path) =>
    path.endsWith("/")
      ? pathname.startsWith(path)
      : pathname === path || pathname.startsWith(`${path}/`),
  );
}
