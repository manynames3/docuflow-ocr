import type { ReviewJob, TimelineEvent } from "./types";

export const sampleJob: ReviewJob = {
  job_id: "demo-9f4b2c18",
  filename: "vendor-invoice-0421.pdf",
  owner_id: "acme-ops",
  status: "NEEDS_REVIEW",
  created_at: "2026-05-11T20:14:00Z",
  updated_at: "2026-05-11T20:15:26Z",
  parsed_fields: {
    vendor_name: {
      value: "Acme Services",
      confidence: 98.5,
      source_key: "Vendor Name",
    },
    document_date: {
      value: "2026-05-01",
      confidence: 96,
      source_key: "Invoice Date",
    },
    total_amount: {
      value: "$421.19",
      confidence: 78.5,
      source_key: "Total Amount",
    },
    email: {
      value: "billing@example.com",
      confidence: 93,
      source_key: "Email",
    },
    case_number: {
      value: "CASE-1001",
      confidence: 91,
      source_key: "Case Number",
    },
  },
  confidence: {
    score: 82.4,
    average_confidence: 91.4,
    threshold: 85,
    review_reasons: ["total_amount_below_threshold"],
  },
};

export const completedJobs: ReviewJob[] = [
  {
    ...sampleJob,
    job_id: "demo-4f6d2a90",
    filename: "parcel-notice-1842.pdf",
    status: "COMPLETED",
    owner_id: "county-review",
    confidence: {
      score: 96.1,
      average_confidence: 97.2,
      threshold: 85,
      review_reasons: [],
    },
  },
  {
    ...sampleJob,
    job_id: "demo-a120f3bd",
    filename: "claim-form-77.png",
    status: "APPROVED",
    owner_id: "claims-team",
    confidence: {
      score: 84.8,
      average_confidence: 90.4,
      threshold: 85,
      review_reasons: ["manual_review_completed"],
    },
  },
];

export const baseTimeline: TimelineEvent[] = [
  {
    label: "Intake",
    detail: "Job record and upload URL created",
    status: "done",
  },
  {
    label: "Upload",
    detail: "Document stored in S3",
    status: "done",
  },
  {
    label: "OCR",
    detail: "Textract analysis completed",
    status: "done",
  },
  {
    label: "Review",
    detail: "Low-confidence field awaiting approval",
    status: "active",
  },
];

export const pricingPlans = [
  {
    name: "Starter",
    price: "$49",
    summary: "For small teams replacing spreadsheet-based document intake.",
    features: ["500 pages/month", "Review queue", "CSV exports", "Email support"],
  },
  {
    name: "Operations",
    price: "$149",
    summary: "For departments with daily document processing work.",
    features: ["3,000 pages/month", "Audit history", "Priority OCR", "Workflow support"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    summary: "For regulated teams with custom retention and approval flows.",
    features: ["Custom volume", "Private AWS deployment", "SLA options", "Security review"],
  },
];

