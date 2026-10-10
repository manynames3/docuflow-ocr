export type JobStatus =
  | "CREATED"
  | "UPLOADED"
  | "PROCESSING"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED"
  | "APPROVED"
  | "REJECTED"
  | "DELETING";

export type ExtractedField = {
  value: string;
  confidence: number;
  source_key?: string;
  page?: number;
  geometry?: { Left: number; Top: number; Width: number; Height: number };
};

export type ReviewJob = {
  job_id: string;
  filename: string;
  content_type: string;
  content_length: number;
  page_count?: number;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  parsed_fields: Record<string, ExtractedField>;
  confidence?: {
    score: number;
    average_confidence: number;
    review_reasons: string[];
    threshold: number;
  };
  corrected_fields?: Record<string, string>;
  failure?: { code: string };
};

export type UploadResponse = {
  job_id: string;
  status: JobStatus;
  upload_required: boolean;
  upload_url?: string | null;
  upload_fields?: Record<string, string> | null;
  expires_in_seconds?: number | null;
};

export type InvoiceHistoryEntry = {
  audit_id: string;
  event_type: string;
  created_at: string;
  details?: Record<string, unknown>;
};
