import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Gauge,
  Layers3,
  Lock,
  Play,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
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

const buyerOutcomes = [
  {
    icon: <Gauge size={20} />,
    title: "Fewer keying mistakes",
    text: "Capture vendor, invoice number, date, and total before anyone types them by hand.",
  },
  {
    icon: <ClipboardCheck size={20} />,
    title: "Exceptions first",
    text: "Send uncertain totals and vendor fields to review instead of making the team check every page.",
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Cleaner approvals",
    text: "Keep corrected values and approval decisions attached to each invoice record.",
  },
  {
    icon: <Activity size={20} />,
    title: "Finance-ready output",
    text: "Prepare reviewed invoice data for export into the systems your team already uses.",
  },
];

const workflowSteps = [
  {
    icon: <Upload size={20} />,
    title: "Receive",
    text: "Upload invoice PDFs or images from vendors, shared inboxes, or monthly batches.",
  },
  {
    icon: <FileText size={20} />,
    title: "Capture",
    text: "Extract the fields Accounts Payable needs: vendor, invoice number, invoice date, and total.",
  },
  {
    icon: <SearchCheck size={20} />,
    title: "Review",
    text: "Route only low-confidence values to a focused review queue for quick correction.",
  },
  {
    icon: <CheckCircle2 size={20} />,
    title: "Approve",
    text: "Approve the clean record and keep a history of what changed and who approved it.",
  },
  {
    icon: <Download size={20} />,
    title: "Export",
    text: "Move reviewed invoice data downstream without rebuilding the invoice by hand.",
  },
];

const faqItems = [
  {
    question: "Who uses DocuFlow day to day?",
    answer:
      "Accounts Payable specialists, finance operations analysts, and controllers who need a faster way to process vendor invoices without losing review control.",
  },
  {
    question: "Does it approve every invoice automatically?",
    answer:
      "No. The product is designed around human review for uncertain fields, so finance teams can approve clean records and correct exceptions before export.",
  },
  {
    question: "How would a team buy this?",
    answer:
      "Small teams can start with a self-serve plan. Larger finance teams would usually book a demo, test a sample invoice set, review security needs, and choose a volume-based plan.",
  },
  {
    question: "What files does the workflow support?",
    answer:
      "The demo is built around invoice PDFs and common image formats such as PNG, JPG, TIFF, and scanned invoice files.",
  },
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
      return;
    }

    await runDemo(selectedFile?.name);
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
            <small>Invoice Control</small>
          </span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#review">Review</a>
          <a href="#pricing">Plans</a>
        </nav>
        <div className="topbar-actions">
          <a className="demo-link" href="#workspace">View demo</a>
          <a className="topbar-cta" href="#pricing">Start trial</a>
          <button className="icon-button" type="button" aria-label="Refresh workspace">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <section className="hero-band" id="product">
        <div className="hero-copy">
          <span className="eyebrow">Accounts Payable invoice automation</span>
          <h1>Turn vendor invoices into approved accounting records.</h1>
          <p>
            DocuFlow captures invoice numbers, dates, vendor details, and totals, then sends only
            uncertain fields to review before your finance team exports the clean record.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={handleStart} disabled={processing}>
              {processing ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
              Try sample invoice
            </button>
            <a className="secondary-button" href="#pricing">
              See plans
              <ArrowRight size={18} />
            </a>
          </div>
          <div className="buyer-note" aria-label="Buyer fit">
            <span>For Accounts Payable teams</span>
            <span>Self-serve trial or sales demo</span>
            <span>Volume-based plans</span>
          </div>
        </div>

        <section className="command-surface" id="workspace" aria-label="Invoice intake command center">
          <div className="surface-header">
            <div>
              <span className="surface-kicker">Live product workspace</span>
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

          <div className="metric-grid" aria-label="Operational metrics">
            <Metric icon={<Gauge size={18} />} label="Confidence score" value={`${activeJob.confidence.score}%`} />
            <Metric icon={<ClipboardCheck size={18} />} label="Needs review" value={`${reviewCount}`} />
            <Metric icon={<BadgeCheck size={18} />} label="Approved" value={`${approvedCount}`} />
          </div>

          <div className="timeline">
            {timeline.map((item) => (
              <div className={`timeline-item ${item.status}`} key={item.label}>
                <span className="timeline-dot" />
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="buyer-strip" aria-label="Finance team outcomes">
        {buyerOutcomes.map((outcome) => (
          <Outcome key={outcome.title} {...outcome} />
        ))}
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <span className="eyebrow">How teams use it</span>
          <h2>From vendor invoice to approved record.</h2>
          <p>
            The product is built for the everyday Accounts Payable path: receive invoices, capture
            the fields, review exceptions, approve the record, and move it downstream.
          </p>
        </div>
        <div className="workflow-grid">
          {workflowSteps.map((step, index) => (
            <WorkflowStep key={step.title} step={`${index + 1}`} {...step} />
          ))}
        </div>
      </section>

      <section className="workspace-grid">
        <section className="panel" id="review">
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
      </section>

      <section className="trust-strip" aria-label="Platform capabilities">
        <Capability
          icon={<Layers3 size={20} />}
          title="Less manual entry"
          text="Capture invoice fields before review"
        />
        <Capability icon={<SearchCheck size={20} />} title="Review the exceptions" text="Focus on uncertain totals and vendors" />
        <Capability icon={<ShieldCheck size={20} />} title="Approval history" text="Keep a record of every decision" />
        <Capability icon={<Activity size={20} />} title="Ready for accounting" text="Prepare clean invoice records" />
      </section>

      <section className="pricing-section" id="pricing">
        <div className="section-heading">
          <span className="eyebrow">How teams buy</span>
          <h2>Start with a sample invoice. Scale by monthly volume.</h2>
          <p>
            Smaller teams can start self-serve. Finance teams with higher invoice volume can book a
            rollout review and validate DocuFlow on their own invoice samples.
          </p>
        </div>
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <article className={`price-card ${plan.featured ? "featured" : ""}`} key={plan.name}>
              <div>
                <span className="plan-name">{plan.name}</span>
                <h3>{plan.price}</h3>
                <p>{plan.summary}</p>
              </div>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={16} />
                    {feature}
                  </li>
                ))}
              </ul>
              <button className={plan.featured ? "primary-button full" : "secondary-button full"} type="button">
                Choose {plan.name}
                <ArrowRight size={17} />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="faq-section" aria-label="Buyer questions">
        <div className="section-heading">
          <span className="eyebrow">Buyer questions</span>
          <h2>What a finance buyer needs to know.</h2>
        </div>
        <div className="faq-grid">
          {faqItems.map((item) => (
            <FaqItem key={item.question} {...item} />
          ))}
        </div>
      </section>

      <section className="deployment-band" id="platform">
        <div>
          <span className="eyebrow">Built for finance teams</span>
          <h2>One workspace for invoice intake, review, and approval.</h2>
          <p>
            Give Accounts Payable analysts a single place to upload vendor invoices, verify
            extracted fields, and approve clean records before they move downstream.
          </p>
        </div>
        <div className="deployment-stack">
          <span>
            <Lock size={16} />
            Direct invoice uploads
          </span>
          <span>
            <Sparkles size={16} />
            Review uncertain totals first
          </span>
          <span>
            <Clock3 size={16} />
            Approval history for finance teams
          </span>
        </div>
      </section>
    </main>
  );
}

function Outcome({ icon, text, title }: { icon: ReactNode; text: string; title: string }) {
  return (
    <article className="outcome-card">
      {icon}
      <strong>{title}</strong>
      <span>{text}</span>
    </article>
  );
}

function WorkflowStep({
  icon,
  step,
  text,
  title,
}: {
  icon: ReactNode;
  step: string;
  text: string;
  title: string;
}) {
  return (
    <article className="workflow-card">
      <div className="workflow-card-top">
        <span>{step}</span>
        {icon}
      </div>
      <strong>{title}</strong>
      <p>{text}</p>
    </article>
  );
}

function FaqItem({ answer, question }: { answer: string; question: string }) {
  return (
    <article className="faq-item">
      <strong>{question}</strong>
      <p>{answer}</p>
    </article>
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

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Capability({
  icon,
  text,
  title,
}: {
  icon: ReactNode;
  text: string;
  title: string;
}) {
  return (
    <article className="capability">
      {icon}
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </article>
  );
}
