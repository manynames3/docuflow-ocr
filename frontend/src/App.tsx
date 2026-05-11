import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Cloud,
  Download,
  FileCheck2,
  FileSearch,
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
  const [notice, setNotice] = useState("Review queue ready");
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
      "Job record and upload URL created",
      "Document stored in S3",
      "Textract workflow in progress",
      "Review queue updated",
    ];

    setTimeline(
      pipelineSteps.map((step, index) => ({
        label: step === "NEEDS_REVIEW" ? "REVIEW" : step,
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
      { status: "CREATED", notice: "Upload URL issued" },
      { status: "UPLOADED", notice: "Document received" },
      { status: "PROCESSING", notice: "Textract workflow running" },
      { status: "NEEDS_REVIEW", notice: "Review queue updated" },
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
      setNotice("Starting workflow");
      updateTimeline(2);
      await startProcessing(upload.job_id);
      let job = normalizeJob(await getJob(upload.job_id), file.name);
      for (let attempt = 0; attempt < 8 && job.status === "PROCESSING"; attempt += 1) {
        setNotice("Waiting for OCR results");
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
      setNotice("Job submitted");
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
    setNotice("Document approved");
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
          <span className="brand-mark">
            <FileSearch size={18} />
          </span>
          <span>DocuFlow OCR</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#workspace">Workspace</a>
          <a href="#review">Review</a>
          <a href="#pricing">Pricing</a>
          <a href="#deployment">Deploy</a>
        </nav>
        <div className="topbar-actions">
          <span className="mode-pill">
            <Cloud size={14} />
            {hasApiBackend() ? "Live API" : "Demo mode"}
          </span>
          <button className="icon-button" type="button" aria-label="Refresh workspace">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <section className="hero-band" id="workspace">
        <div className="hero-copy">
          <span className="eyebrow">Document operations platform</span>
          <h1>OCR intake, review, and audit for teams that still process documents by hand.</h1>
          <p>
            Turn PDFs and images into structured records with AWS Textract, Step Functions, and a
            review queue built for production operators.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={handleStart} disabled={processing}>
              {processing ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
              Run intake
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={18} />
              Select document
            </button>
          </div>
        </div>

        <section className="command-surface" aria-label="Document intake command center">
          <div className="surface-header">
            <div>
              <span className="surface-kicker">Live workspace</span>
              <h2>Intake Command Center</h2>
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
            <Metric icon={<Gauge size={18} />} label="Auto-score" value={`${activeJob.confidence.score}%`} />
            <Metric icon={<ClipboardCheck size={18} />} label="Review queue" value={`${reviewCount}`} />
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

      <section className="workspace-grid">
        <section className="panel" id="review">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Human review</span>
              <h2>Field verification</h2>
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
                <strong>OCR results pending</strong>
                <span>The review fields will appear when Textract parsing finishes.</span>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Pipeline health</span>
              <h2>Recent jobs</h2>
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
        <Capability icon={<Layers3 size={20} />} title="Serverless workflow" text="API Gateway, Lambda, Step Functions" />
        <Capability icon={<SearchCheck size={20} />} title="OCR extraction" text="Textract forms and tables" />
        <Capability icon={<ShieldCheck size={20} />} title="Audit path" text="Review decisions in DynamoDB" />
        <Capability icon={<Activity size={20} />} title="Ops visibility" text="CloudWatch alarms and SQS DLQ" />
      </section>

      <section className="pricing-section" id="pricing">
        <div className="section-heading">
          <span className="eyebrow">Commercial packaging</span>
          <h2>Plans that make the product feel ready for customers.</h2>
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

      <section className="deployment-band" id="deployment">
        <div>
          <span className="eyebrow">Cloudflare Pages frontend</span>
          <h2>Static app, AWS backend, sales-ready surface.</h2>
          <p>
            The frontend deploys from `frontend/dist` and can run as a polished demo or connect to
            the deployed API with `VITE_API_BASE_URL`.
          </p>
        </div>
        <div className="deployment-stack">
          <span>
            <Lock size={16} />
            No credentials in browser code
          </span>
          <span>
            <Sparkles size={16} />
            Demo mode for hiring reviews
          </span>
          <span>
            <Clock3 size={16} />
            Direct Cloudflare Pages deploy
          </span>
        </div>
      </section>
    </main>
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
