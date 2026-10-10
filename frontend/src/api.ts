import { accessToken, endSession } from "./auth";
import type { InvoiceHistoryEntry, ReviewJob, UploadResponse } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const ACCEPTED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function hasApiBackend(): boolean {
  return API_BASE_URL.length > 0;
}

function requireApi(): string {
  if (!API_BASE_URL) throw new Error("Invoice processing is not connected on this site yet.");
  return API_BASE_URL;
}

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const response = await fetch(`${requireApi()}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    endSession();
    throw new Error("Your session expired. Sign in again.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { message?: string; code?: string };
      if (body.message) message = body.message;
      code = body.code;
    } catch {
      // Keep the status-based message when the service has no JSON error body.
    }
    throw new ApiError(message, code);
  }
  return response;
}

export function validateInvoiceFile(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const expectedType = ACCEPTED_TYPES[extension];
  if (!expectedType) return "Choose a PDF, PNG, or JPEG invoice.";
  if (file.type && file.type !== expectedType) return "The file name and file type do not match.";
  if (file.size < 1 || file.size > 10 * 1024 * 1024) return "Invoices must be between 1 byte and 10 MB.";
  return null;
}

export async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createUpload(file: File, key: string, sha256: string): Promise<UploadResponse> {
  const contentType = file.type || ACCEPTED_TYPES[file.name.split(".").pop()?.toLowerCase() || ""];
  const response = await request("/uploads", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({ filename: file.name, content_type: contentType, file_size: file.size, sha256 }),
  });
  return (await response.json()) as UploadResponse;
}

export async function resumeUpload(jobId: string, sha256: string): Promise<UploadResponse> {
  const response = await request(`/jobs/${encodeURIComponent(jobId)}/upload-url`, {
    method: "POST",
    body: JSON.stringify({ sha256 }),
  });
  return (await response.json()) as UploadResponse;
}

export async function uploadToS3(file: File, upload: UploadResponse): Promise<void> {
  if (!upload.upload_url || !upload.upload_fields) throw new Error("The upload could not be prepared. Try again.");
  const formData = new FormData();
  Object.entries(upload.upload_fields).forEach(([key, value]) => formData.append(key, value));
  formData.append("file", file);
  const response = await fetch(upload.upload_url, { method: "POST", body: formData });
  if (!response.ok) throw new Error("The invoice upload did not complete. Check your connection and try again.");
}

export async function startProcessing(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST", body: "{}" });
}

export async function getJobs(): Promise<ReviewJob[]> {
  const jobs: ReviewJob[] = [];
  let nextToken = "";
  do {
    const query = nextToken ? `?next_token=${encodeURIComponent(nextToken)}` : "";
    const response = await request(`/jobs${query}`);
    const body = (await response.json()) as { jobs: ReviewJob[]; next_token: string | null };
    jobs.push(...body.jobs);
    nextToken = body.next_token || "";
  } while (nextToken);
  return jobs;
}

export async function getJob(jobId: string): Promise<ReviewJob> {
  const response = await request(`/jobs/${encodeURIComponent(jobId)}`);
  const body = (await response.json()) as { job: ReviewJob };
  return body.job;
}

export async function getDocumentUrl(jobId: string): Promise<string> {
  const response = await request(`/jobs/${encodeURIComponent(jobId)}/document`);
  const body = (await response.json()) as { url: string };
  return body.url;
}

export async function getHistory(jobId: string): Promise<InvoiceHistoryEntry[]> {
  const response = await request(`/jobs/${encodeURIComponent(jobId)}/history`);
  const body = (await response.json()) as { history: InvoiceHistoryEntry[] };
  return body.history;
}

export async function saveCorrections(jobId: string, correctedFields: Record<string, string>): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ corrected_fields: correctedFields }),
  });
}

export async function submitReviewDecision(jobId: string, decision: "APPROVE" | "REJECT"): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function deleteJob(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

export async function downloadExport(): Promise<void> {
  const response = await request("/exports/invoices.csv");
  const file = await response.blob();
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "docuflow-invoices.csv";
  link.click();
  URL.revokeObjectURL(url);
}
