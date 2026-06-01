import { expect, test } from "@playwright/test";

import { isPublicOperatorPath } from "../../src/lib/operator-routes";
import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("pwa assets stay outside the temporary access gate", () => {
  for (const path of ["/manifest.webmanifest", "/icon.svg"]) {
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
    name: "Leasium",
    short_name: "Leasium",
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
    ]),
  );

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
  ).toHaveAttribute("content", "Leasium");
  await expect(
    page.locator('meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
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
  const mobileNav = page.getByRole("navigation", { name: "Primary" });
  await expect(
    mobileNav.getByRole("link", { name: /^Dashboard/ }),
  ).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: /^Money/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeVisible();
});
