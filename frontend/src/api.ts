import type { ReviewJob, UploadResponse } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export function hasApiBackend() {
  return API_BASE_URL.length > 0;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function createUpload(file: File): Promise<UploadResponse> {
  return requestJson<UploadResponse>("/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      owner_id: "cloudflare-pages-demo",
    }),
  });
}

export async function uploadToS3(file: File, upload: UploadResponse): Promise<void> {
  const response = await fetch(upload.upload_url, {
    method: "PUT",
    headers: upload.upload_headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}`);
  }
}

export async function startProcessing(jobId: string): Promise<void> {
  await requestJson(`/jobs/${jobId}/start`, { method: "POST" });
}

export async function getJob(jobId: string): Promise<ReviewJob> {
  const response = await requestJson<{ job: ReviewJob }>(`/jobs/${jobId}`);
  return response.job;
}

export async function submitReviewDecision(
  jobId: string,
  correctedFields: Record<string, string>,
): Promise<void> {
  await requestJson(`/review/jobs/${jobId}/decision`, {
    method: "POST",
    body: JSON.stringify({
      decision: "APPROVE",
      reviewer: "cloudflare-pages-demo",
      corrected_fields: correctedFields,
      comment: "Approved from DocuFlow OCR frontend.",
    }),
  });
}

