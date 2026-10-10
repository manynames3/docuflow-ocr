import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const controlledInvoice = await readFile(new URL("../../src/tests/fixtures/controlled_invoice.png", import.meta.url));
const reviewedJob = {
  job_id: "job-1",
  filename: "northstar-invoice.png",
  content_type: "image/png",
  content_length: controlledInvoice.length,
  page_count: 1,
  status: "NEEDS_REVIEW",
  created_at: "2026-10-10T12:00:00Z",
  updated_at: "2026-10-10T12:01:00Z",
  parsed_fields: {
    vendor_name: { value: "Northstar Supply", confidence: 99, page: 1 },
    invoice_number: { value: "NS-20418", confidence: 97, page: 1 },
    total_amount: { value: "$248.00", confidence: 72, page: 1 },
  },
};

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes("Cognito account flows") || testInfo.title.includes("sign-out")) return;
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "docuflow.auth.session",
      JSON.stringify({
        accessToken: "controlled-test-token",
        refreshToken: "controlled-test-refresh",
        expiresAt: Date.now() + 3_600_000,
        email: "reviewer@example.test",
      }),
    );
  });
});

test("reviewer corrects, approves, exports, reopens, and deletes an invoice", async ({ page }) => {
  let job: typeof reviewedJob | null = null;
  let history: Array<{ audit_id: string; event_type: string; created_at: string }> = [];
  let uploadAttempts = 0;
  const seenAuthHeaders: string[] = [];
  const savedBodies: Record<string, unknown>[] = [];

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const headers = request.headers();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/upload" && method === "POST") {
      uploadAttempts += 1;
      await route.fulfill({ status: uploadAttempts === 1 ? 503 : 204, body: "" });
      return;
    }
    if (url.pathname === "/test-invoice.png") {
      await route.fulfill({ status: 200, contentType: "image/png", body: controlledInvoice });
      return;
    }
    seenAuthHeaders.push(headers.authorization || "");
    if (method === "GET" && url.pathname === "/jobs") {
      await route.fulfill({ json: { jobs: job ? [job] : [], next_token: null } });
      return;
    }
    if (method === "POST" && url.pathname === "/uploads") {
      expect(request.postDataJSON()).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      job = { ...reviewedJob, status: "CREATED", parsed_fields: {} };
      await route.fulfill({
        status: 201,
        json: {
          job_id: "job-1",
          status: "CREATED",
          upload_required: true,
          upload_url: `${API}/upload`,
          upload_fields: { key: "controlled-private-upload", "Content-Type": "image/png" },
        },
      });
      return;
    }
    if (method === "POST" && url.pathname === "/jobs/job-1/upload-url") {
      const { sha256 } = request.postDataJSON() as { sha256: string };
      expect(sha256).toMatch(/^[a-f0-9]{64}$/);
      await route.fulfill({
        json: {
          job_id: "job-1",
          status: "CREATED",
          upload_required: true,
          upload_url: `${API}/upload`,
          upload_fields: { key: "controlled-private-upload", "Content-Type": "image/png", "x-amz-meta-sha256": sha256 },
        },
      });
      return;
    }
    if (method === "GET" && url.pathname === "/jobs/job-1") {
      if (!job) {
        await route.fulfill({ status: 404, json: { message: "Invoice not found." } });
        return;
      }
      await route.fulfill({ json: { job } });
      return;
    }
    if (method === "POST" && url.pathname === "/jobs/job-1/start") {
      job = { ...reviewedJob, status: "NEEDS_REVIEW" };
      await route.fulfill({ status: 202, json: { job_id: job.job_id, status: "PROCESSING" } });
      return;
    }
    if (method === "GET" && url.pathname === "/jobs/job-1/document") {
      await route.fulfill({ json: { url: `${API}/test-invoice.png`, expires_in_seconds: 300 } });
      return;
    }
    if (method === "GET" && url.pathname === "/jobs/job-1/history") {
      await route.fulfill({ json: { history } });
      return;
    }
    if (method === "PATCH" && url.pathname === "/jobs/job-1/review") {
      const body = request.postDataJSON() as Record<string, unknown>;
      savedBodies.push(body);
      job = { ...job!, corrected_fields: body.corrected_fields as Record<string, string> };
      history = [...history, { audit_id: `event-${history.length + 1}`, event_type: "FIELDS_CORRECTED", created_at: "2026-10-10T12:02:00Z" }];
      await route.fulfill({ json: { job_id: job.job_id, saved_at: "2026-10-10T12:02:00Z", corrected_fields: job.corrected_fields } });
      return;
    }
    if (method === "POST" && url.pathname === "/jobs/job-1/decision") {
      job = { ...job!, status: "APPROVED" };
      history = [...history, { audit_id: `event-${history.length + 1}`, event_type: "APPROVED", created_at: "2026-10-10T12:03:00Z" }];
      await route.fulfill({ json: { job_id: job.job_id, status: job.status } });
      return;
    }
    if (method === "GET" && url.pathname === "/exports/invoices.csv") {
      await route.fulfill({ status: 200, contentType: "text/csv", body: "vendor_name,total_amount\nNorthstar Supply,250.00\n" });
      return;
    }
    if (method === "DELETE" && url.pathname === "/jobs/job-1") {
      job = { ...job!, status: "DELETING" };
      await route.fulfill({ json: { job_id: job.job_id, deleted: true } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: `Unexpected request: ${method} ${url.pathname}` } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await expect(page.getByText("No invoices yet")).toBeVisible();
  await page.locator("#invoice-file").setInputFiles({
    name: "northstar-invoice.png",
    mimeType: "image/png",
    buffer: controlledInvoice,
  });
  await page.getByRole("button", { name: "Process invoice" }).click();
  await expect(page.getByRole("alert")).toContainText("The invoice upload did not complete");
  await page.getByRole("button", { name: "Resume upload" }).click();
  await expect(page.getByText("This invoice is ready for review.")).toBeVisible();
  expect(uploadAttempts).toBe(2);
  await expect(page.getByRole("heading", { name: "northstar-invoice.png" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extracted fields" })).toBeVisible();
  const original = page.getByRole("img", { name: "Uploaded invoice" });
  await expect(original).toBeVisible();
  await expect.poll(() => original.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200);

  await page.getByRole("textbox", { name: "Total due" }).fill("250.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your corrections are saved.")).toBeVisible();
  expect(savedBodies).toHaveLength(1);
  expect((savedBodies[0].corrected_fields as Record<string, string>).total_amount).toBe("250.00");

  await page.getByRole("button", { name: "Approve invoice" }).click();
  await expect(page.getByText("Invoice approved.")).toBeVisible();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Invoice approved", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export approved invoices/ }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("docuflow-invoices.csv");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Total due" })).toHaveValue("250.00");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete invoice" }).click();
  await expect(page.getByText("Invoice and its saved review data were deleted.")).toBeVisible();
  expect(seenAuthHeaders.length).toBeGreaterThan(5);
  expect(seenAuthHeaders.every((value) => value === "Bearer controlled-test-token")).toBe(true);
});

test("continues a saved upload after reopening the workspace without uploading it twice", async ({ page }) => {
  let job: typeof reviewedJob = { ...reviewedJob, status: "CREATED", parsed_fields: {} };
  let resumeRequests = 0;
  let fileUploads = 0;
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/jobs" && method === "GET") {
      await route.fulfill({ json: { jobs: [job], next_token: null } });
      return;
    }
    if (url.pathname === "/jobs/job-1" && method === "GET") {
      await route.fulfill({ json: { job } });
      return;
    }
    if (url.pathname === "/jobs/job-1/upload-url" && method === "POST") {
      resumeRequests += 1;
      expect(request.postDataJSON()).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      await route.fulfill({
        json: { job_id: "job-1", status: "CREATED", upload_required: false, upload_url: null, upload_fields: null },
      });
      return;
    }
    if (url.pathname === "/jobs/job-1/start" && method === "POST") {
      job = { ...reviewedJob, status: "NEEDS_REVIEW" };
      await route.fulfill({ status: 202, json: { job_id: job.job_id, status: "PROCESSING" } });
      return;
    }
    if (url.pathname === "/jobs/job-1/document" && method === "GET") {
      await route.fulfill({ json: { url: `${API}/test-invoice.png`, expires_in_seconds: 300 } });
      return;
    }
    if (url.pathname === "/test-invoice.png") {
      await route.fulfill({ status: 200, contentType: "image/png", body: controlledInvoice });
      return;
    }
    if (url.pathname === "/upload" && method === "POST") {
      fileUploads += 1;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({ json: { history: [] } });
  });

  await page.goto("/");
  await expect(page.getByText("northstar-invoice.png").first()).toBeVisible();
  await page.locator("#invoice-file").setInputFiles({
    name: "northstar-invoice.png",
    mimeType: "image/png",
    buffer: controlledInvoice,
  });
  await page.getByRole("button", { name: "Resume upload" }).click();
  await expect(page.getByText("This invoice is ready for review.")).toBeVisible();
  expect(resumeRequests).toBe(1);
  expect(fileUploads).toBe(0);
});

test("starts a new job for different invoice bytes with the same name and size", async ({ page }) => {
  const existingJob = { ...reviewedJob, status: "NEEDS_REVIEW" };
  let currentJob: typeof reviewedJob | null = null;
  let resumeRequests = 0;
  let createRequests = 0;
  let fileUploads = 0;
  const changedInvoice = Buffer.from(controlledInvoice);
  changedInvoice[100] ^= 1;

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/jobs" && method === "GET") {
      await route.fulfill({ json: { jobs: currentJob ? [currentJob, existingJob] : [existingJob], next_token: null } });
      return;
    }
    if (url.pathname === "/jobs/job-1" && method === "GET") {
      await route.fulfill({ json: { job: existingJob } });
      return;
    }
    if (url.pathname === "/jobs/job-2" && method === "GET") {
      await route.fulfill({ json: { job: currentJob } });
      return;
    }
    if (url.pathname === "/jobs/job-1/upload-url" && method === "POST") {
      resumeRequests += 1;
      await route.fulfill({
        status: 409,
        json: { code: "UPLOAD_CHECKSUM_MISMATCH", message: "The selected file does not match this invoice." },
      });
      return;
    }
    if (url.pathname === "/uploads" && method === "POST") {
      createRequests += 1;
      currentJob = { ...reviewedJob, job_id: "job-2", status: "CREATED", parsed_fields: {} };
      await route.fulfill({
        status: 201,
        json: {
          job_id: "job-2",
          status: "CREATED",
          upload_required: true,
          upload_url: `${API}/upload`,
          upload_fields: { key: "controlled-new-upload", "Content-Type": "image/png" },
        },
      });
      return;
    }
    if (url.pathname === "/upload" && method === "POST") {
      fileUploads += 1;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (url.pathname === "/jobs/job-2/start" && method === "POST") {
      currentJob = { ...reviewedJob, job_id: "job-2", status: "NEEDS_REVIEW" };
      await route.fulfill({ status: 202, json: { job_id: "job-2", status: "PROCESSING" } });
      return;
    }
    if (url.pathname === "/jobs/job-2/document" && method === "GET") {
      await route.fulfill({ json: { url: `${API}/test-invoice.png`, expires_in_seconds: 300 } });
      return;
    }
    if (url.pathname === "/test-invoice.png") {
      await route.fulfill({ status: 200, contentType: "image/png", body: controlledInvoice });
      return;
    }
    await route.fulfill({ json: { history: [] } });
  });

  await page.goto("/");
  await page.locator("#invoice-file").setInputFiles({
    name: "northstar-invoice.png",
    mimeType: "image/png",
    buffer: changedInvoice,
  });
  await page.getByRole("button", { name: "Open invoice" }).click();
  await expect(page.getByText("This invoice is ready for review.")).toBeVisible();
  expect(resumeRequests).toBe(1);
  expect(createRequests).toBe(1);
  expect(fileUploads).toBe(1);
});

test("sign-up, sign-in, and recovery open the Cognito account flows", async ({ page }) => {
  await page.route("https://login.example.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<main>Hosted account access</main>" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/login\.example\.test\/signup\?/);
  await expect(page).toHaveURL(/code_challenge_method=S256/);

  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/login\.example\.test\/login\?/);

  await page.goto("/");
  await page.getByRole("button", { name: "Forgot password\?" }).click();
  await expect(page).toHaveURL(/login\.example\.test\/forgotPassword\?/);
});

test("sign-out clears the local account session", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("docuflow.test.initialized")) return;
    sessionStorage.setItem("docuflow.test.initialized", "true");
    sessionStorage.setItem(
      "docuflow.auth.session",
      JSON.stringify({
        accessToken: "controlled-test-token",
        refreshToken: "controlled-test-refresh",
        expiresAt: Date.now() + 3_600_000,
        email: "reviewer@example.test",
      }),
    );
  });
  await page.route(`${API}/**`, (route) => route.fulfill({ json: { jobs: [], next_token: null } }));
  await page.route("https://login.example.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<main>Signed out</main>" }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login\.example\.test\/logout\?/);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Still typing invoice details by hand?" })).toBeVisible();
});

test("workspace remains within a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`${API}/**`, async (route) => {
    await route.fulfill({ json: { jobs: [], next_token: null } });
  });
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await expect(page.getByText("No invoices yet")).toBeVisible();
});

test("unsupported files and an unavailable service never appear processed", async ({ page }) => {
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/jobs") {
      await route.fulfill({ json: { jobs: [], next_token: null } });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/uploads") {
      await route.fulfill({ status: 503, json: { message: "Invoice processing is temporarily unavailable." } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Not found." } });
  });
  await page.goto("/");
  const input = page.locator("#invoice-file");
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an invoice") });
  await expect(page.getByRole("alert")).toHaveText("Choose a PDF, PNG, or JPEG invoice.");
  await expect(page.getByRole("button", { name: "Process invoice" })).toBeDisabled();

  await input.setInputFiles({
    name: "invoice.png",
    mimeType: "image/png",
    buffer: controlledInvoice,
  });
  await page.getByRole("button", { name: "Process invoice" }).click();
  await expect(page.getByRole("alert")).toContainText("Invoice processing is temporarily unavailable.");
  await expect(page.getByText("No invoices yet")).toBeVisible();
  await expect(page.getByText("Invoice received. Processing will appear here.")).toHaveCount(0);
});
