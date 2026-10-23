// One-time Netlify setup for DriveEasy. Run it yourself after `netlify login` and after
// adding Netlify DB to the site in the Netlify dashboard:
//
//   node scripts/netlify-setup.mjs [site-name]
//
// It links this folder to the site, sets any missing environment variables (generating
// fresh secrets, never printed), triggers a deploy (which runs the migrations), seeds the
// sample data into the Netlify database and Netlify Blobs, and checks the live site.
// Seed account passwords are written to .local/netlify-logins.txt (git-ignored).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SITE_NAME = process.argv[2] || "thunderous-malasada-c364f9";
const secret = () => randomBytes(32).toString("base64url");

function netlify(args, { json = false, quiet = false } = {}) {
  const res = spawnSync("netlify", args, { shell: true, encoding: "utf8", env: { ...process.env, CI: "1" } });
  if (res.status !== 0) {
    if (!quiet) console.error(res.stderr || res.stdout);
    throw new Error(`netlify ${args[0]} failed`);
  }
  return json ? JSON.parse(res.stdout) : res.stdout;
}

function step(msg) {
  console.log(`\n== ${msg}`);
}

function fail(msg) {
  console.error(`\nSTOPPED: ${msg}`);
  process.exit(1);
}

// 1. Logged in?
step("Checking Netlify login");
let token;
try {
  const configPath = path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "netlify", "Config", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  token = process.env.NETLIFY_AUTH_TOKEN || config.users?.[config.userId]?.auth?.token;
} catch {
  token = process.env.NETLIFY_AUTH_TOKEN;
}
if (!token) fail("Not logged in. Run `netlify login` first.");
console.log("Logged in.");

// 2. Link the site.
step(`Linking this folder to ${SITE_NAME}`);
const statePath = path.join(".netlify", "state.json");
if (!existsSync(statePath)) netlify(["link", "--name", SITE_NAME]);
const siteId = JSON.parse(readFileSync(statePath, "utf8")).siteId;
if (!siteId) fail("Could not read the site id after linking.");
const site = netlify(["api", "getSite", "--data", `"{\\"site_id\\":\\"${siteId}\\"}"`], { json: true });
const siteUrl = site.ssl_url || site.url;
console.log(`Linked: ${siteUrl}`);

// 3. Database present?
step("Checking the database");
const env = netlify(["env:list", "--context", "production", "--json"], { json: true });
// DRIVEEASY_DB_URL lets you pass the direct connection string yourself if Netlify hides it.
const dbUrl =
  process.env.DRIVEEASY_DB_URL ||
  env.NETLIFY_DATABASE_URL_UNPOOLED ||
  env.DATABASE_URL_UNPOOLED ||
  env.NETLIFY_DATABASE_URL ||
  env.DATABASE_URL;
if (!dbUrl) {
  fail("No database found. In Netlify open the site > Extensions > add Netlify DB, then run this script again.");
}
if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
  fail(
    "Netlify hides the database link from the CLI. Copy the direct (unpooled) connection string from the " +
      "Netlify DB page and run:  $env:DRIVEEASY_DB_URL='<connection string>'; node scripts/netlify-setup.mjs",
  );
}
console.log("Database settings found.");

// 4. Environment variables (only missing ones; existing values are kept).
step("Setting environment variables");
const wanted = {
  BETTER_AUTH_SECRET: secret,
  QR_SIGNING_SECRET: secret,
  CRON_SECRET: secret,
  PAYMENT_WEBHOOK_SECRET: secret,
  STORAGE_DRIVER: () => "netlify-blobs",
  PAYMENT_PROVIDER: () => "fake",
  ALLOW_FAKE_PAYMENTS: () => "true",
  FAKE_PAYMENTS_STORE: () => "netlify-blobs",
};
for (const [key, make] of Object.entries(wanted)) {
  if (env[key]) {
    console.log(`  ${key}: already set, kept`);
    continue;
  }
  const value = make();
  netlify(["env:set", key, value], { quiet: true });
  env[key] = value;
  console.log(`  ${key}: set`);
}

// 5. Deploy (the build runs the migrations).
step("Deploying (build runs the migrations; this takes a few minutes)");
const build = netlify(["api", "createSiteBuild", "--data", `"{\\"site_id\\":\\"${siteId}\\"}"`], { json: true });
const deployId = build.deploy_id;
let deploy;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  deploy = netlify(["api", "getDeploy", "--data", `"{\\"deploy_id\\":\\"${deployId}\\"}"`], { json: true });
  process.stdout.write(`  state: ${deploy.state}\r`);
  if (["ready", "error"].includes(deploy.state)) break;
}
console.log("");
if (deploy?.state !== "ready") fail(`Deploy did not finish: ${deploy?.state} ${deploy?.error_message ?? ""}`);
console.log("Deploy is live.");

// 6. Seed sample data into the Netlify database and Blobs.
step("Loading sample data");
const logins = {
  SEED_ADMIN_PASSWORD: secret().slice(0, 20),
  SEED_CUSTOMER_PASSWORD: secret().slice(0, 20),
};
const seed = spawnSync(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", "scripts/seed.mts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_URL_UNPOOLED: dbUrl,
      STORAGE_DRIVER: "netlify-blobs",
      NETLIFY_BLOBS_SITE_ID: siteId,
      NETLIFY_BLOBS_TOKEN: token,
      PAYMENT_PROVIDER: "fake",
      FAKE_PAYMENTS_STORE: "netlify-blobs",
      FAKE_PAYMENTS_WEBHOOK_URL: "",
      PAYMENT_WEBHOOK_SECRET: env.PAYMENT_WEBHOOK_SECRET,
      QR_SIGNING_SECRET: env.QR_SIGNING_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: siteUrl,
      ...logins,
    },
  },
);
if (seed.status !== 0) fail("Seeding failed (see the output above).");
mkdirSync(".local", { recursive: true });
writeFileSync(
  path.join(".local", "netlify-logins.txt"),
  `DriveEasy on ${siteUrl}\nadmin@driveeasy.test     ${logins.SEED_ADMIN_PASSWORD}\ncustomer@driveeasy.test  ${logins.SEED_CUSTOMER_PASSWORD}\n`,
);
console.log("Sample data loaded. Logins saved to .local/netlify-logins.txt");

// 7. Check the live site.
step("Checking the live site");
const home = await fetch(siteUrl);
const html = await home.text();
const checks = [
  ["Home page loads", home.ok],
  ["Branches appear", /Dubai|Abu Dhabi|Sharjah/.test(html)],
  ["No error page", !html.includes("Something went wrong")],
  ["Cleanup route refuses without the secret", (await fetch(`${siteUrl}/api/cron/release-expired-holds`)).status === 401],
  [
    "Cleanup route works with the secret",
    (await fetch(`${siteUrl}/api/cron/release-expired-holds`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })).ok,
  ],
];
for (const [name, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
if (checks.some(([, ok]) => !ok)) fail("Some live checks failed.");
console.log(`\nDone. Open ${siteUrl}`);
