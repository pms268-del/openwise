// Full success-criterion walkthrough across all four portals:
// SME registers → free market report → pays → reviews leads → outreach call extracted & approved →
// financial scenarios → inspection requested, performed, verified → final report approved → SME downloads PDF.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function login(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState("networkidle");
  return page;
}
const waitFor = async (page: Page, url: string, text: string | RegExp, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    await page.goto(url);
    if (await page.getByText(text).first().isVisible().catch(() => false)) return;
    await page.waitForTimeout(1500);
  }
  throw new Error(`Timed out waiting for "${text}" on ${url}`);
};

test("SME end-to-end location decision workflow", async ({ browser }) => {
  // 0. Register + onboarding
  const sme = await (await browser.newContext()).newPage();
  const email = `founder+${Date.now()}@example.com`;
  await sme.goto("/register");
  await sme.fill('input[name="name"]', "Test Founder");
  await sme.fill('input[name="orgName"]', "E2E Coffee LLC");
  await sme.fill('input[name="email"]', email);
  await sme.fill('input[name="password"]', "supersecret1");
  await sme.click('button:has-text("Create account")');
  await sme.waitForURL("**/app/new");
  const biz = `E2E Espresso ${Date.now()}`;
  await sme.fill('input[name="businessName"]', biz);
  await sme.fill('textarea[name="concept"]', "Specialty espresso bar with pastries and 20 seats");
  await sme.fill('input[name="targetArea"]', "Williamsburg, Brooklyn");
  await sme.fill('input[name="targetCustomers"]', "Young professionals and remote workers");
  await sme.fill('input[name="startupBudget"]', "400000");
  await sme.fill('input[name="maxMonthlyRent"]', "12000");
  await sme.fill('input[name="minSqft"]', "700");
  await sme.fill('input[name="maxSqft"]', "1500");
  await sme.click('button:has-text("Generate free market report")');
  await sme.waitForURL(/\/app\/e\/[0-9a-f-]{36}$/);
  const engUrl = new URL(sme.url()).pathname;

  // 1. Free market report
  await waitFor(sme, engUrl, "Suitability score");
  await expect(sme.getByText("Score breakdown")).toBeVisible();
  await expect(sme.getByText("Data sources", { exact: true })).toBeVisible();
  await expect(sme.getByText("Limitations", { exact: true })).toBeVisible();

  // 2. Payment activation (simulated checkout when Stripe is not configured)
  await sme.click('button:has-text("Activate paid research")');
  await sme.waitForURL(/checkout/);
  await sme.click('button:has-text("Simulate successful payment")');
  await sme.waitForURL(/properties/);

  // 3. Property leads
  await waitFor(sme, `${engUrl}/properties`, "210 Bedford Ave");
  await expect(sme.getByText("Discovery sources", { exact: true })).toBeVisible();
  const card = (addr: string) => sme.locator(".card", { hasText: addr }).filter({ has: sme.getByRole("button", { name: "Shortlist" }) });
  await card("210 Bedford Ave").getByRole("button", { name: "Shortlist" }).click();
  await sme.waitForLoadState("networkidle");
  await card("88 Grand St").getByRole("button", { name: "Shortlist" }).click();
  await sme.waitForLoadState("networkidle");

  // 4. Admin outreach: human call to the landlord of 88 Grand St → AI/rule extraction → human approval
  const admin = await login(browser, "admin@siteiq.dev");
  await admin.goto("/admin/properties?q=88%20Grand");
  await admin.click("text=88 Grand St");
  await admin.selectOption('select[name="channel"]', "phone_human");
  await admin.click('button:has-text("Prepare outreach")');
  await expect(admin.getByText("phone_human").first()).toBeVisible();
  await admin.fill('textarea[name="transcript"]', "Landlord said the asking rent is $10,200 per month. CAM charges are $350 per month. Security deposit would be $30,600. They want a 10-year lease. Electric runs about $900 per month. Utilities are about $300 per month. Available starting January 15, 2027. Café use is allowed. The rent is negotiable.");
  await admin.check('input[name="recordingConsent"]');
  await admin.click('button:has-text("Save & extract terms")');
  await waitFor(admin, "/admin/approvals", "88 Grand St");
  const approval = admin.locator(".card", { hasText: "88 Grand St" });
  await expect(approval.locator('input[name="edit_rent_monthly"]')).toHaveValue("10200");
  await approval.getByRole("button", { name: "Approve terms" }).click();
  await admin.waitForLoadState("networkidle");

  // 5. Financial scenarios for both shortlisted properties
  await waitFor(sme, `${engUrl}/financials`, "88 Grand St");
  await expect(sme.getByText("210 Bedford Ave").first()).toBeVisible();
  await expect(sme.getByText("Total cash required").first()).toBeVisible();
  await expect(sme.getByText("Ranking", { exact: true })).toBeVisible();

  // 6. SME requests an inspection; admin assigns it to a field agent
  await sme.goto(`${engUrl}/properties`);
  await sme.locator(".card", { hasText: "210 Bedford Ave" }).getByRole("button", { name: "Request on-site inspection" }).click();
  await sme.waitForLoadState("networkidle");
  await admin.goto("/admin/inspections");
  const row = admin.locator("tr", { hasText: biz }).filter({ hasText: "210 Bedford Ave" });
  const inspectionPath = await row.getByRole("link", { name: "Open" }).getAttribute("href");
  await row.locator('select[name="assignee"]').selectOption({ label: "Jordan Field (field_agent)" });
  await row.getByRole("button", { name: "Assign" }).click();
  await admin.waitForLoadState("networkidle");

  // 7. Field agent uploads evidence, completes checklist, confirms terms
  const agent = await login(browser, "agent@siteiq.dev");
  await agent.goto(inspectionPath!.replace("/admin/inspections/", "/field/i/"));
  await agent.setInputFiles('input[name="files"]', { name: "storefront.png", mimeType: "image/png", buffer: PNG });
  await agent.click('button:has-text("Upload")');
  await expect(agent.getByText("storefront.png")).toBeVisible();
  for (const sel of await agent.locator('select[name^="r_"]').all()) await sel.selectOption("yes");
  for (const inp of await agent.locator('input[type="number"][name^="r_"]').all()) await inp.fill("940");
  for (const ta of await agent.locator('textarea[name^="r_"]').all()) await ta.fill("No visible issues; clean condition.");
  await agent.fill('input[name="t_rent_monthly"]', "9600");
  await agent.fill('input[name="t_utilities_monthly"]', "350");
  await agent.click('button:has-text("Submit inspection for review")');
  await agent.waitForURL(/submitted=1/);

  // 8. Admin verifies the inspection
  await admin.goto(inspectionPath!);
  await admin.fill('input[name="note"]', "Photos and measurements consistent; rent confirmed at $9,600.");
  await admin.click('button:has-text("Verify")');
  await admin.waitForLoadState("networkidle");

  // 9. Decision report: generate, approve, deliver
  const engId = engUrl.split("/").pop();
  await admin.goto(`/admin/e/${engId}`);
  await admin.click('button:has-text("Generate decision report")');
  await waitFor(admin, `/admin/e/${engId}`, "Approve & deliver to client");
  await admin.click('button:has-text("Approve & deliver to client")');
  await admin.waitForLoadState("networkidle");

  // 10. SME receives the evidence-backed recommendation + PDF
  await waitFor(sme, `${engUrl}/report`, "Recommendation");
  await expect(sme.getByText("Property comparison & lease economics")).toBeVisible();
  await expect(sme.getByText("verified on site").first()).toBeVisible();
  // The on-site confirmed rent (not the earlier $9,800 asking rent) drives the delivered report.
  await expect(sme.locator("tr", { hasText: "210 Bedford Ave" }).getByText("$9,600")).toBeVisible();
  const res = await sme.request.get(await sme.getByRole("link", { name: "Download PDF" }).getAttribute("href") as string);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("org isolation: another SME cannot open a foreign engagement", async ({ browser }) => {
  const sme = await login(browser, "sme@siteiq.dev");
  const r = await sme.goto("/app/e/00000000-0000-0000-0000-000000000000");
  expect(r?.status()).toBe(404);
  const api = await sme.request.get("/api/reports/00000000-0000-0000-0000-000000000000/pdf");
  expect(api.status()).toBe(404);
  const admin = await sme.goto("/admin");
  expect(new URL(sme.url()).pathname).toBe("/app");
  void admin;
});
