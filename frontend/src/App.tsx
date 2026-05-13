import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  FileText,
  Play,
  RefreshCw,
  SearchCheck,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  createUpload,
  getJob,
  hasApiBackend,
  startProcessing,
  submitReviewDecision,
  uploadToS3,
} from "./api";
import { baseTimeline, completedJobs, pricingPlans, sampleJob } from "./demoData";
import type { IntakeMode, JobStatus, ReviewJob, TimelineEvent } from "./types";

const pipelineSteps = ["CREATED", "UPLOADED", "PROCESSING", "NEEDS_REVIEW"] as const;

const workflowSteps = [
  {
    title: "Receive",
    text: "Upload vendor invoices.",
  },
  {
    title: "Capture",
    text: "Pull out vendor, date, number, and total.",
  },
  {
    title: "Review",
    text: "Check only uncertain fields.",
  },
  {
    title: "Approve",
    text: "Send clean records downstream.",
  },
];

const proofPoints = [
  {
    title: "More than text extraction",
    text: "OCR captures the invoice text; DocuFlow turns uncertain values into review tasks.",
  },
  {
    title: "Built for the approval step",
    text: "Teams can verify vendor, date, invoice number, and total before records move downstream.",
  },
  {
    title: "Cleaner accounting handoff",
    text: "Approved records can be exported as CSV or sent through the API to an accounting workflow.",
  },
];

const useCases = [
  "Vendor invoices",
  "Monthly invoice batches",
  "Exception review",
  "Accounting handoff prep",
];

const trustPoints = [
  "Private document storage",
  "Temporary upload links",
  "Human approval for uncertain fields",
  "Automatic document expiration",
];

function statusLabel(status: JobStatus) {
  return status.replace("_", " ");
}

function confidenceTone(confidence: number) {
  if (confidence >= 92) return "good";
  if (confidence >= 85) return "warn";
  return "risk";
}

function nextDemoJob(fileName?: string): ReviewJob {
  return {
    ...sampleJob,
    job_id: `demo-${Math.random().toString(16).slice(2, 10)}`,
    filename: fileName || sampleJob.filename,
    status: "CREATED",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function normalizeJob(job: Partial<ReviewJob>, fallbackFilename: string): ReviewJob {
  return {
    ...sampleJob,
    ...job,
    filename: job.filename || fallbackFilename,
    parsed_fields: job.parsed_fields || {},
    confidence: job.confidence || {
      score: 0,
      average_confidence: 0,
      threshold: 85,
      review_reasons: ["processing"],
    },
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function scrollToReviewOutput(delay = 0) {
  window.setTimeout(() => {
    document.getElementById("review-output")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, delay);
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeJob, setActiveJob] = useState<ReviewJob>(sampleJob);
  const [jobs, setJobs] = useState<ReviewJob[]>([sampleJob, ...completedJobs]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>(baseTimeline);
  const [processing, setProcessing] = useState(false);
  const [mode, setMode] = useState<IntakeMode>(hasApiBackend() ? "api" : "demo");
  const [notice, setNotice] = useState("Accounts Payable review queue ready");
  const [correctedFields, setCorrectedFields] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(sampleJob.parsed_fields).map(([field, details]) => [field, details.value]),
    ),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fields = useMemo(() => Object.entries(activeJob.parsed_fields), [activeJob.parsed_fields]);
  const reviewCount = jobs.filter((job) => job.status === "NEEDS_REVIEW").length;
  const approvedCount = jobs.filter((job) => ["APPROVED", "COMPLETED"].includes(job.status)).length;

  function updateTimeline(activeIndex: number) {
    const details = [
      "Invoice record created",
      "Invoice received",
      "Invoice details being captured",
      "Accounts Payable review queue updated",
    ];
    const labels = ["Intake", "Upload", "Extract", "Review"];

    setTimeline(
      pipelineSteps.map((step, index) => ({
        label: labels[index] || step,
        detail: details[index],
        status: index < activeIndex ? "done" : index === activeIndex ? "active" : "queued",
      })),
    );
  }

  function mergeJob(job: ReviewJob) {
    setJobs((current) => {
      const withoutJob = current.filter((item) => item.job_id !== job.job_id);
      return [job, ...withoutJob].slice(0, 6);
    });
  }

  async function runDemo(fileName?: string) {
    const demoJob = nextDemoJob(fileName);
    setProcessing(true);
    setMode(hasApiBackend() && selectedFile ? "api" : "demo");
    setActiveJob(demoJob);
    mergeJob(demoJob);
    setCorrectedFields(
      Object.fromEntries(
        Object.entries(demoJob.parsed_fields).map(([field, details]) => [field, details.value]),
      ),
    );

    const transitions: Array<{ status: JobStatus; notice: string }> = [
      { status: "CREATED", notice: "Invoice upload URL issued" },
      { status: "UPLOADED", notice: "Invoice received" },
      { status: "PROCESSING", notice: "Capturing invoice details" },
      { status: "NEEDS_REVIEW", notice: "Accounts Payable review queue updated" },
    ];

    transitions.forEach((transition, index) => {
      window.setTimeout(() => {
        updateTimeline(index);
        setNotice(transition.notice);
        setActiveJob((current) => {
          const updated = {
            ...current,
            status: transition.status,
            updated_at: new Date().toISOString(),
          };
          mergeJob(updated);
          return updated;
        });
        if (index === transitions.length - 1) {
          setProcessing(false);
        }
      }, index * 650);
    });
  }

  async function runApi(file: File) {
    setProcessing(true);
    setMode("api");
    setNotice("Creating upload");
    updateTimeline(0);

    try {
      const upload = await createUpload(file);
      setNotice("Uploading document");
      updateTimeline(1);
      await uploadToS3(file, upload);
      setNotice("Preparing invoice review");
      updateTimeline(2);
      await startProcessing(upload.job_id);
      let job = normalizeJob(await getJob(upload.job_id), file.name);
      for (let attempt = 0; attempt < 8 && job.status === "PROCESSING"; attempt += 1) {
        setNotice("Waiting for invoice details");
        await wait(4000);
        job = normalizeJob(await getJob(upload.job_id), file.name);
      }
      setActiveJob(job);
      mergeJob(job);
      setCorrectedFields(
        Object.fromEntries(
          Object.entries(job.parsed_fields || {}).map(([field, details]) => [field, details.value]),
        ),
      );
      setNotice("Invoice submitted");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "API request failed");
    } finally {
      setProcessing(false);
    }
  }

  async function handleStart() {
    if (hasApiBackend() && selectedFile) {
      await runApi(selectedFile);
      scrollToReviewOutput(100);
      return;
    }

    await runDemo(selectedFile?.name);
    scrollToReviewOutput(900);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    if (file) {
      setNotice(`${file.name} selected`);
    }
  }

  async function approveJob() {
    if (mode === "api" && hasApiBackend()) {
      try {
        await submitReviewDecision(activeJob.job_id, correctedFields);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Review submission failed");
        return;
      }
    }

    const approvedJob: ReviewJob = {
      ...activeJob,
      status: "APPROVED",
      corrected_fields: correctedFields,
      updated_at: new Date().toISOString(),
    };
    setActiveJob(approvedJob);
    mergeJob(approvedJob);
    setNotice("Invoice approved");
    setTimeline((current) =>
      current.map((item) => ({
        ...item,
        status: "done",
      })),
    );
  }

  return (
    <main className="product-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="DocuFlow OCR home">
          <BrandMark />
          <span className="brand-copy">
            <strong>DocuFlow</strong>
            <small>Invoice review automation</small>
          </span>
        </a>
        <span className="topbar-pill">Accounts Payable</span>
        <div className="topbar-actions">
          <a className="demo-link" href="#review-output">How it works</a>
          <a className="topbar-cta" href="#workspace">Start trial</a>
        </div>
      </header>

      <nav className="pill-nav" aria-label="Product sections">
        <a href="#product">Product</a>
        <a href="#review-output">Workflow</a>
        <a href="#use-cases">Use cases</a>
        <a href="#trust">Trust</a>
        <a href="#pricing">Plans</a>
      </nav>

      <section className="hero-band" id="product">
        <div className="hero-copy animate-in">
          <span className="eyebrow">Accounts Payable automation</span>
          <h1>Invoice review without the <span>copy-paste</span>.</h1>
          <p>
            Built for teams that receive vendor invoices and still review totals, dates, and vendor details by hand.
          </p>
          <div className="hero-tags" aria-label="Common invoice review tasks">
            {useCases.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={handleStart} disabled={processing}>
              {processing ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
              Try sample invoice
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={18} />
              Upload invoice
            </button>
          </div>
        </div>

        <section className="command-surface animate-in delay-1" id="workspace" aria-label="Invoice review demo">
          <div className="window-chrome">
            <span />
            <span />
            <span />
            <small>Invoice review</small>
          </div>
          <div className="surface-header">
            <div>
              <span className="surface-kicker">Live workspace</span>
              <h2>Accounts Payable Intake</h2>
            </div>
            <span className={`status-badge status-${activeJob.status.toLowerCase()}`}>
              {statusLabel(activeJob.status)}
            </span>
          </div>

          <div className="dropzone">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
              onChange={handleFileChange}
            />
            <div className="drop-icon">
              <FileText size={24} />
            </div>
            <div>
              <strong>{selectedFile ? selectedFile.name : activeJob.filename}</strong>
              <span>{notice}</span>
            </div>
            <button className="compact-button" type="button" onClick={handleStart} disabled={processing}>
              {processing ? "Running" : "Process"}
              <ChevronRight size={16} />
            </button>
          </div>

          <dl className="snapshot-grid" aria-label="Invoice review snapshot">
            <div>
              <dt>Confidence</dt>
              <dd>{activeJob.confidence.score}%</dd>
            </div>
            <div>
              <dt>Needs review</dt>
              <dd>{reviewCount}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{approvedCount}</dd>
            </div>
          </dl>

          <div className="timeline">
            {timeline.map((item) => (
              <div className={`timeline-item ${item.status}`} key={item.label}>
                <span className="timeline-dot" />
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
          <a className="surface-link" href="#review-output">
            View extracted fields
            <ArrowRight size={16} />
          </a>
        </section>
      </section>

      <section className="editorial-section" id="review-output">
        <div className="section-copy">
          <span className="eyebrow">Sample output</span>
          <h2>From invoice PDF to reviewed fields.</h2>
          <p>
            Run the sample and DocuFlow updates the field verification panel and recent invoice queue in the same workspace.
          </p>
          <ol className="workflow-list">
            {workflowSteps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="workspace-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Accounts Payable review</span>
                <h2>Invoice field verification</h2>
              </div>
              <button className="secondary-button small" type="button" onClick={approveJob}>
                <CheckCircle2 size={17} />
                Approve
              </button>
            </div>

            <div className="field-list">
              {fields.length > 0 ? (
                fields.map(([field, details]) => (
                  <label className="field-row" key={field}>
                    <span>
                      <strong>{field.replace(/_/g, " ")}</strong>
                      <small>{details.source_key}</small>
                    </span>
                    <input
                      value={correctedFields[field] || ""}
                      onChange={(event) =>
                        setCorrectedFields((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))
                      }
                    />
                    <em className={`confidence ${confidenceTone(details.confidence)}`}>
                      {details.confidence.toFixed(1)}%
                    </em>
                  </label>
                ))
              ) : (
                <div className="empty-state">
                  <SearchCheck size={22} />
                  <strong>Invoice details pending</strong>
                  <span>The review fields will appear when extraction finishes.</span>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Invoice queue</span>
                <h2>Recent invoices</h2>
              </div>
              <button className="icon-button dark" type="button" aria-label="Download report">
                <Download size={17} />
              </button>
            </div>

            <div className="job-list">
              {jobs.map((job) => (
                <button className="job-row" key={job.job_id} type="button" onClick={() => setActiveJob(job)}>
                  <span className="job-file">
                    <FileCheck2 size={18} />
                    <span>
                      <strong>{job.filename}</strong>
                      <small>{job.owner_id}</small>
                    </span>
                  </span>
                  <span className={`status-badge status-${job.status.toLowerCase()}`}>
                    {statusLabel(job.status)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="split-section" id="use-cases">
        <div>
          <span className="eyebrow">Why not just OCR?</span>
          <h2>Extraction is only the first step.</h2>
        </div>
        <div className="proof-list">
          {proofPoints.map((item) => (
            <article key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split-section trust-section" id="trust">
        <div>
          <span className="eyebrow">Trust</span>
          <h2>Review control, not black-box automation.</h2>
        </div>
        <div>
          <p>
            DocuFlow avoids pretending OCR is perfect. Uncertain fields stay visible until someone approves the invoice record.
          </p>
          <ul className="trust-list">
            {trustPoints.map((item) => (
              <li key={item}>
                <Check size={16} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        <div>
          <span className="eyebrow">Plans</span>
          <h2>Start with the invoice volume you need.</h2>
          <p>Pick the invoice volume that matches your team. Upgrade when review work becomes daily.</p>
        </div>
        <div className="pricing-options">
          {pricingPlans.map((plan) => (
            <article className={`price-option ${plan.featured ? "featured" : ""}`} key={plan.name}>
              <div className="price-option-head">
                <span>{plan.name}</span>
                {plan.featured ? <em>Daily teams</em> : null}
              </div>
              <strong>{plan.price}</strong>
              <p>{plan.summary}</p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <a className={plan.featured ? "primary-button" : "secondary-button"} href="#workspace">
                {plan.name === "Enterprise" ? "Talk to sales" : `Start ${plan.name}`}
                <ArrowRight size={17} />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="closing-section" aria-label="Try DocuFlow">
        <div>
          <span className="eyebrow">Ready to test it?</span>
          <h2>Try the invoice workflow.</h2>
          <p>See the intake, extracted fields, review queue, and approval flow in one pass.</p>
        </div>
        <div className="closing-actions">
          <button className="primary-button" type="button" onClick={handleStart} disabled={processing}>
            {processing ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
            Try sample invoice
          </button>
          <a className="secondary-button" href="#pricing">
            View plans
            <ArrowRight size={17} />
          </a>
        </div>
      </section>

      <footer className="site-footer">
        <a className="footer-brand" href="#workspace" aria-label="DocuFlow OCR home">
          <BrandMark />
          <span className="brand-copy">
            <strong>DocuFlow</strong>
            <small>Invoice Control</small>
          </span>
        </a>
        <nav className="footer-links" aria-label="Footer">
          <a href="#product">Product</a>
          <a href="#review-output">Workflow</a>
          <a href="#use-cases">Use cases</a>
          <a href="#trust">Trust</a>
          <a href="#pricing">Plans</a>
        </nav>
        <span className="footer-meta">©2026 SUPREME AI VENTURES LLC</span>
      </footer>
    </main>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <path
          className="brand-mark-paper"
          d="M13 7.5h16.5L39 17v23.5H13z"
        />
        <path className="brand-mark-fold" d="M29.5 7.5V17H39" />
        <path className="brand-mark-line primary" d="M18 19.5h13" />
        <path className="brand-mark-line" d="M18 25.5h18" />
        <path className="brand-mark-line" d="M18 31.5h9" />
        <path className="brand-mark-check" d="M29.5 33.5l3 3 6-7" />
        <path className="brand-mark-flow" d="M7.5 13.5h7.5M7.5 24h7.5M7.5 34.5h7.5" />
      </svg>
    </span>
  );
}
