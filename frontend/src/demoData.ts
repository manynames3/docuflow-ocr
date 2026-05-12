import type { ReviewJob, TimelineEvent } from "./types";

export const sampleJob: ReviewJob = {
  job_id: "demo-9f4b2c18",
  filename: "acme-invoice-0421.pdf",
  owner_id: "ap-operations",
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
    invoice_number: {
      value: "INV-0421",
      confidence: 94.5,
      source_key: "Invoice Number",
    },
    total_amount: {
      value: "$421.19",
      confidence: 78.5,
      source_key: "Amount Due",
    },
    email: {
      value: "billing@example.com",
      confidence: 93,
      source_key: "Email",
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
    filename: "vendor-batch-1842.pdf",
    status: "COMPLETED",
    owner_id: "ap-team",
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
    filename: "supplier-credit-77.png",
    status: "APPROVED",
    owner_id: "controller-review",
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
    detail: "Invoice job and upload URL created",
    status: "done",
  },
  {
    label: "Upload",
    detail: "Invoice received",
    status: "done",
  },
  {
    label: "Extract",
    detail: "Invoice details captured",
    status: "done",
  },
  {
    label: "Review",
    detail: "Invoice total awaiting approval",
    status: "active",
  },
];

export const pricingPlans = [
  {
    name: "Starter",
    price: "$49",
    summary: "For small teams processing invoices weekly.",
    features: ["500 pages/month", "Review queue", "CSV exports"],
  },
  {
    name: "Operations",
    price: "$149",
    summary: "For finance teams reviewing invoices daily.",
    features: ["3,000 pages/month", "Approval history", "Accounting-ready exports"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    summary: "For larger teams with rollout and security needs.",
    features: ["Custom volume", "Dedicated rollout", "Security review"],
  },
];
