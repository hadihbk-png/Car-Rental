import { afterEach, describe, expect, it, vi } from "vitest";
import { appDatabaseUrl, migrationDatabaseUrl } from "@/db/urls";
import { assertFakePaymentsAllowed, fakePaymentStore, fakeWebhookUrl } from "@/lib/payments";
import { NetlifyBlobsFakePaymentStore, emptyFakePaymentState } from "@/lib/payments/fake-store";
import { appBaseUrl, assertPersistentDiskAvailable, clientIpHeaders, deploymentOrigins, isDeployedProduction } from "./platform";
import releaseExpiredHolds, { config as cronConfig } from "../../netlify/functions/release-expired-holds.mjs";

const NETLIFY = { NETLIFY: "true", URL: "https://driveeasy.netlify.app" };

describe("database URLs", () => {
  it("app requests: DATABASE_URL, else NETLIFY_DATABASE_URL", () => {
    expect(appDatabaseUrl({ DATABASE_URL: "a", NETLIFY_DATABASE_URL: "n" })).toBe("a");
    expect(appDatabaseUrl({ NETLIFY_DATABASE_URL: "n" })).toBe("n");
    expect(appDatabaseUrl({})).toBeUndefined();
  });
  it("migrations prefer unpooled URLs, then pooled", () => {
    const all = { DATABASE_URL_UNPOOLED: "du", NETLIFY_DATABASE_URL_UNPOOLED: "nu", DATABASE_URL: "d", NETLIFY_DATABASE_URL: "n" };
    expect(migrationDatabaseUrl(all)).toBe("du");
    expect(migrationDatabaseUrl({ ...all, DATABASE_URL_UNPOOLED: "" })).toBe("nu");
    expect(migrationDatabaseUrl({ DATABASE_URL: "d", NETLIFY_DATABASE_URL: "n" })).toBe("d");
    expect(migrationDatabaseUrl({ NETLIFY_DATABASE_URL: "n" })).toBe("n");
  });
});

describe("platform URLs and auth", () => {
  it("base URL: explicit setting, else Netlify URL (deploy URL for previews), else Vercel", () => {
    expect(appBaseUrl({ ...NETLIFY, BETTER_AUTH_URL: "https://cars.example.com/" })).toBe("https://cars.example.com");
    expect(appBaseUrl({ ...NETLIFY, CONTEXT: "production" })).toBe("https://driveeasy.netlify.app");
    expect(appBaseUrl({ ...NETLIFY, CONTEXT: "deploy-preview", DEPLOY_PRIME_URL: "https://deploy-preview-4--driveeasy.netlify.app" })).toBe(
      "https://deploy-preview-4--driveeasy.netlify.app",
    );
    expect(appBaseUrl({ VERCEL: "1", VERCEL_URL: "driveeasy-abc.vercel.app" })).toBe("https://driveeasy-abc.vercel.app");
    expect(appBaseUrl({})).toBeUndefined();
  });

  it("trusted origins include deploy URLs and BETTER_AUTH_TRUSTED_ORIGINS", () => {
    const origins = deploymentOrigins({
      ...NETLIFY,
      DEPLOY_PRIME_URL: "https://deploy-preview-4--driveeasy.netlify.app",
      DEPLOY_URL: "https://6650abc--driveeasy.netlify.app",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://cars.example.com, https://www.cars.example.com",
    });
    expect(origins).toEqual(
      expect.arrayContaining([
        "https://driveeasy.netlify.app",
        "https://deploy-preview-4--driveeasy.netlify.app",
        "https://6650abc--driveeasy.netlify.app",
        "https://cars.example.com",
        "https://www.cars.example.com",
      ]),
    );
  });

  it("client IP headers: setting, else platform header, else x-forwarded-for", () => {
    expect(clientIpHeaders({ AUTH_IP_HEADER: "CF-Connecting-IP, x-real-ip" })).toEqual(["cf-connecting-ip", "x-real-ip"]);
    expect(clientIpHeaders(NETLIFY)).toEqual(["x-nf-client-connection-ip"]);
    expect(clientIpHeaders({ VERCEL: "1" })).toEqual(["x-real-ip", "x-vercel-forwarded-for"]);
    expect(clientIpHeaders({})).toEqual(["x-forwarded-for"]);
  });
});

describe("cloud safety rules", () => {
  it("refuses the fake payment provider in deployed production unless ALLOW_FAKE_PAYMENTS=true", () => {
    expect(isDeployedProduction({ ...NETLIFY, NODE_ENV: "production" })).toBe(true);
    expect(() => assertFakePaymentsAllowed({ ...NETLIFY, NODE_ENV: "production" })).toThrow(/ALLOW_FAKE_PAYMENTS=true/);
    expect(() => assertFakePaymentsAllowed({ VERCEL: "1", NODE_ENV: "production" })).toThrow(/PAYMENT_PROVIDER=fake/);
    expect(() => assertFakePaymentsAllowed({ ...NETLIFY, NODE_ENV: "production", ALLOW_FAKE_PAYMENTS: "true" })).not.toThrow();
    expect(() => assertFakePaymentsAllowed({ NODE_ENV: "production" })).not.toThrow(); // local `next start`
  });

  it("refuses local-disk storage on Netlify, naming the setting to change", () => {
    expect(() => assertPersistentDiskAvailable("STORAGE_DRIVER=local", "STORAGE_DRIVER=netlify-blobs", NETLIFY)).toThrow(
      /Set STORAGE_DRIVER=netlify-blobs/,
    );
    expect(() => fakePaymentStore({ ...NETLIFY, FAKE_PAYMENTS_STORE: "file" })).toThrow(/FAKE_PAYMENTS_STORE=netlify-blobs/);
    expect(() => assertPersistentDiskAvailable("STORAGE_DRIVER=local", "x", {})).not.toThrow();
    expect(fakePaymentStore({ ...NETLIFY, FAKE_PAYMENTS_STORE: "netlify-blobs" })).toBeInstanceOf(NetlifyBlobsFakePaymentStore);
  });

  it("fake webhook URL: explicit setting (empty disables), else ${URL}/api/webhooks/payments", () => {
    expect(fakeWebhookUrl({ FAKE_PAYMENTS_WEBHOOK_URL: "http://localhost:3000/api/webhooks/payments", URL: "https://x" })).toBe(
      "http://localhost:3000/api/webhooks/payments",
    );
    expect(fakeWebhookUrl({ FAKE_PAYMENTS_WEBHOOK_URL: "", URL: "https://x" })).toBeUndefined();
    expect(fakeWebhookUrl({ URL: "https://driveeasy.netlify.app/" })).toBe("https://driveeasy.netlify.app/api/webhooks/payments");
  });

  it("the Netlify Blobs fake-payment store round-trips state (mocked store)", async () => {
    const data = new Map<string, unknown>();
    const store = new NetlifyBlobsFakePaymentStore(() => ({
      get: async (k: string) => data.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => void data.set(k, JSON.parse(JSON.stringify(v))),
    }));
    expect(await store.load()).toEqual(emptyFakePaymentState());
    const state = emptyFakePaymentState();
    state.idempotency.k = "pay_1";
    await store.save(state);
    expect((await store.load()).idempotency).toEqual({ k: "pay_1" });
  });
});

describe("Netlify scheduled function", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const invoke = () => releaseExpiredHolds(new Request("http://localhost/.netlify/functions/x", { method: "POST", body: '{"next_run":"2026-10-23T18:05:00Z"}' }));

  it("runs every 5 minutes and calls the protected cron route with the bearer secret", async () => {
    expect(cronConfig.schedule).toBe("*/5 * * * *");
    vi.stubEnv("URL", "https://driveeasy.netlify.app");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const fetchMock = vi.fn(async () => Response.json({ expiredReservations: [], voided: [], failed: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await invoke();
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://driveeasy.netlify.app/api/cron/release-expired-holds",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer s3cret" }) }),
    );
  });

  it("throws on a non-2xx response or missing settings, so Netlify records a failure", async () => {
    vi.stubEnv("URL", "https://driveeasy.netlify.app");
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(invoke()).rejects.toThrow(/401/);
    vi.stubEnv("CRON_SECRET", "");
    await expect(invoke()).rejects.toThrow(/CRON_SECRET/);
  });
});
