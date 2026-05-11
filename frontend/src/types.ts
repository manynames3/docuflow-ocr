export type JobStatus =
  | "CREATED"
  | "UPLOADED"
  | "PROCESSING"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED"
  | "APPROVED"
  | "REJECTED";

export type ExtractedField = {
  value: string;
  confidence: number;
  source_key: string;
};

export type ReviewJob = {
  job_id: string;
  filename: string;
  owner_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  parsed_fields: Record<string, ExtractedField>;
  confidence: {
    score: number;
    average_confidence: number;
    review_reasons: string[];
    threshold: number;
  };
  corrected_fields?: Record<string, string>;
};

export type UploadResponse = {
  job_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
};

export type IntakeMode = "demo" | "api";

export type TimelineEvent = {
  label: string;
  detail: string;
  status: "done" | "active" | "queued";
};

