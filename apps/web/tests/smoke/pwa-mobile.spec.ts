import { expect, test } from "@playwright/test";

import { isPublicOperatorPath } from "../../src/lib/operator-routes";
import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("pwa assets stay outside the temporary access gate", () => {
  for (const path of [
    "/manifest.webmanifest",
    "/icon.svg",
    "/icons/relby-icon-192.png",
    "/icons/relby-icon-512.png",
    "/icons/relby-maskable-512.png",
    "/apple-touch-icon.png",
  ]) {
    expect(isPublicOperatorPath(path)).toBe(true);
  }
});

test("root exposes installable app metadata without offline caching", async ({
  page,
}) => {
  await page.goto("/");

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute(
    "href",
    /\/manifest\.webmanifest$/,
  );

  const manifestHref = await manifestLink.getAttribute("href");
  expect(manifestHref).toBeTruthy();
  const manifestUrl = new URL(manifestHref ?? "", page.url()).toString();
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain(
    "application/manifest+json",
  );

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "Relby",
    short_name: "Relby",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#edf0f6",
    theme_color: "#245bff",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      }),
      expect.objectContaining({
        src: "/icons/relby-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      }),
      expect.objectContaining({
        src: "/icons/relby-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      }),
      expect.objectContaining({
        src: "/icons/relby-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      }),
    ]),
  );
  for (const icon of manifest.icons.filter(
    (entry: { type?: string }) => entry.type === "image/png",
  )) {
    const iconResponse = await page.request.get(
      new URL(icon.src, page.url()).toString(),
    );
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
    const bytes = await iconResponse.body();
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }

  const serviceWorkers = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return [];
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.map((registration) => ({
      scope: registration.scope,
      scriptURL:
        registration.active?.scriptURL ??
        registration.installing?.scriptURL ??
        registration.waiting?.scriptURL ??
        "",
    }));
  });
  expect(serviceWorkers).toEqual([]);

  const cacheNames = await page.evaluate(async () => {
    if (!("caches" in window)) return [];
    return caches.keys();
  });
  expect(cacheNames).toEqual([]);
});

test("mobile shell carries standalone metadata and avoids horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('meta[name="apple-mobile-web-app-title"]'),
  ).toHaveAttribute("content", "Relby");
  await expect(
    page.locator('meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]');
  await expect(appleTouchIcon).toHaveAttribute(
    "href",
    /\/apple-touch-icon\.png$/,
  );
  await expect(appleTouchIcon).toHaveAttribute("sizes", "180x180");
  const appleTouchIconHref = await appleTouchIcon.getAttribute("href");
  expect(appleTouchIconHref).toBeTruthy();
  const appleTouchIconResponse = await page.request.get(
    new URL(appleTouchIconHref ?? "", page.url()).toString(),
  );
  expect(appleTouchIconResponse.ok()).toBe(true);
  expect(appleTouchIconResponse.headers()["content-type"]).toContain(
    "image/png",
  );
  await expect(
    page.locator(
      'meta[name="theme-color"][media="(prefers-color-scheme: light)"]',
    ),
  ).toHaveAttribute("content", "#edf0f6");
  await expect(
    page.locator(
      'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]',
    ),
  ).toHaveAttribute("content", "#0d1424");

  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileNav = page.getByRole("navigation", { name: /^Primary$/ });
  await expect(
    mobileNav.getByRole("link", { name: /^Dashboard/ }),
  ).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: /^Money/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeVisible();
});
