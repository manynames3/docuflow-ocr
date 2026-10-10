import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  ApiError,
  createUpload,
  deleteJob,
  downloadExport,
  fileSha256,
  getDocumentUrl,
  getHistory,
  getJob,
  getJobs,
  hasApiBackend,
  resumeUpload,
  saveCorrections,
  startProcessing,
  submitReviewDecision,
  uploadToS3,
  validateInvoiceFile,
} from "./api";
import {
  accessToken,
  beginAuth,
  completeAuthRedirect,
  currentUser,
  endSession,
  hasAuthConfiguration,
} from "./auth";
import type { InvoiceHistoryEntry, JobStatus, ReviewJob, UploadResponse } from "./types";

const FIELD_LABELS: Record<string, string> = {
  vendor_name: "Vendor",
  invoice_number: "Invoice number",
  document_date: "Invoice date",
  due_date: "Due date",
  total_amount: "Total due",
  currency: "Currency",
  purchase_order: "Purchase order",
  tax_amount: "Tax",
  billing_address: "Billing address",
};
const FIELD_ORDER = Object.keys(FIELD_LABELS);

function statusText(status: JobStatus) {
  return {
    CREATED: "Upload ready",
    UPLOADED: "Queued",
    PROCESSING: "Processing",
    COMPLETED: "Ready to export",
    NEEDS_REVIEW: "Review needed",
    FAILED: "Needs attention",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    DELETING: "Deleting",
  }[status];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeFilename(filename: string) {
  return filename.replace(/\\/g, "/").split("/").pop()?.trim().replace(/[^A-Za-z0-9._ -]/gu, "_").slice(0, 120) || "";
}

function initialCorrections(job: ReviewJob) {
  return Object.fromEntries(
    FIELD_ORDER.map((name) => [
      name,
      job.corrected_fields?.[name] ?? job.parsed_fields?.[name]?.value ?? "",
    ]),
  );
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [jobs, setJobs] = useState<ReviewJob[]>([]);
  const [activeJob, setActiveJob] = useState<ReviewJob | null>(null);
  const [activeId, setActiveId] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<InvoiceHistoryEntry[]>([]);
  const [documentUrl, setDocumentUrl] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [documentPage, setDocumentPage] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error" | "success">("info");
  const [action, setAction] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const matchesActiveInvoice = Boolean(
    file && activeJob && activeJob.status !== "DELETING" &&
    activeJob.filename === safeFilename(file.name) && activeJob.content_length === file.size,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await completeAuthRedirect();
      if (cancelled) return;
      if (result.handled && result.error) setAuthError(result.error);
      if (hasAuthConfiguration() && currentUser()) {
        try {
          await accessToken();
          if (!cancelled) setUser(currentUser());
        } catch {
          if (!cancelled) setUser(null);
        }
      }
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshJobs = useCallback(async () => {
    const latest = await getJobs();
    setJobs(latest);
    if (!activeId && latest[0]) setActiveId(latest[0].job_id);
  }, [activeId]);

  useEffect(() => {
    if (!user || !hasApiBackend()) return;
    let cancelled = false;
    void getJobs()
      .then((latest) => {
        if (cancelled) return;
        setJobs(latest);
        setActiveId((current) => current || latest[0]?.job_id || "");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Invoices could not be loaded.");
          setNoticeKind("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !activeId) {
      setActiveJob(null);
      setDocumentUrl("");
      setHistory([]);
      return;
    }
    let cancelled = false;
    setDocumentError("");
    setDocumentPage(null);
    void getJob(activeId)
      .then((job) => {
        if (cancelled) return;
        setActiveJob(job);
        setFields(initialCorrections(job));
        setJobs((current) => [job, ...current.filter((item) => item.job_id !== job.job_id)]);
        if (job.status === "CREATED") {
          setDocumentError("The upload has not finished yet.");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Invoice details could not be loaded.");
          setNoticeKind("error");
        }
      });
    void getHistory(activeId)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, user]);

  useEffect(() => {
    if (!user || !activeId || !activeJob || activeJob.status === "CREATED") {
      setDocumentUrl("");
      return;
    }
    let cancelled = false;
    setDocumentError("");
    void getDocumentUrl(activeId)
      .then((url) => {
        if (!cancelled) setDocumentUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDocumentError("The original invoice is temporarily unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, activeJob?.status, user]);

  useEffect(() => {
    if (!user || activeJob?.status !== "PROCESSING") return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const latest = await getJob(activeJob.job_id);
        if (cancelled) return;
        setActiveJob(latest);
        setJobs((current) => [latest, ...current.filter((item) => item.job_id !== latest.job_id)]);
        if (latest.status !== "PROCESSING") {
          setFields(initialCorrections(latest));
          setNotice(latest.status === "FAILED" ? (latest.failure?.code === "DOCUMENT_INVALID" ? "This file could not be read. Check the supported format, 10 MB size limit, and 5-page limit." : "We could not process this invoice. It is still available in your history.") : "Invoice processing is complete.");
          setNoticeKind(latest.status === "FAILED" ? "error" : "success");
          void getHistory(latest.job_id).then(setHistory).catch(() => undefined);
          void getDocumentUrl(latest.job_id).then(setDocumentUrl).catch(() => undefined);
          return;
        }
      } catch {
        if (!cancelled) {
          setNotice("Connection interrupted. We will keep checking this invoice.");
          setNoticeKind("info");
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 2500);
    };
    timer = window.setTimeout(poll, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeJob?.job_id, activeJob?.status, user]);

  const exportableCount = useMemo(
    () => jobs.filter((job) => job.status === "APPROVED").length,
    [jobs],
  );
  const changedFields = useMemo(() => {
    if (!activeJob) return false;
    return FIELD_ORDER.some((name) => {
      const oldValue = activeJob.corrected_fields?.[name] ?? activeJob.parsed_fields?.[name]?.value ?? "";
      return (fields[name] || "") !== oldValue;
    });
  }, [activeJob, fields]);

  function chooseFile(nextFile?: File) {
    setFileError("");
    setFile(nextFile || null);
    idempotencyKey.current = crypto.randomUUID();
    if (nextFile) {
      const validation = validateInvoiceFile(nextFile);
      if (validation) setFileError(validation);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function handleUpload() {
    if (!file) {
      setFileError("Choose an invoice to continue.");
      fileInput.current?.focus();
      return;
    }
    const validation = validateInvoiceFile(file);
    if (validation) {
      setFileError(validation);
      return;
    }
    setAction("upload");
    setNotice("Preparing a private upload...");
    setNoticeKind("info");
    let submittedJobId = "";
    try {
      const sha256 = await fileSha256(file);
      let upload: UploadResponse;
      if (matchesActiveInvoice && activeJob) {
        try {
          upload = await resumeUpload(activeJob.job_id, sha256);
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== "UPLOAD_CHECKSUM_MISMATCH") throw error;
          upload = await createUpload(file, idempotencyKey.current, sha256);
        }
      } else {
        upload = await createUpload(file, idempotencyKey.current, sha256);
      }
      submittedJobId = upload.job_id;
      setActiveId(upload.job_id);
      if (upload.upload_required) {
        setNotice("Uploading invoice securely...");
        await uploadToS3(file, upload);
      }
      if (upload.status === "CREATED" || upload.status === "FAILED") {
        setNotice("Starting invoice processing...");
        await startProcessing(upload.job_id);
      }
      const job = await getJob(upload.job_id);
      setActiveJob(job);
      setActiveId(job.job_id);
      setJobs((current) => [job, ...current.filter((item) => item.job_id !== job.job_id)]);
      setNotice(job.status === "FAILED"
        ? (job.failure?.code === "DOCUMENT_INVALID" ? "This file could not be read. Check the supported format, 10 MB size limit, and 5-page limit." : "We could not process this invoice. You can retry or remove it.")
        : job.status === "PROCESSING" || job.status === "UPLOADED" ? "This invoice is already processing."
          : job.status === "NEEDS_REVIEW" || job.status === "COMPLETED" ? "This invoice is ready for review."
            : job.status === "APPROVED" ? "This invoice is already approved."
              : job.status === "REJECTED" ? "This invoice is already rejected."
                : "Invoice received. Processing will appear here.");
      setNoticeKind(job.status === "FAILED" ? "error" : "success");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "The invoice could not be uploaded.";
      setNotice(message);
      setNoticeKind("error");
      if (submittedJobId) {
        try {
          const job = await getJob(submittedJobId);
          setActiveId(job.job_id);
          setActiveJob(job);
          setJobs((current) => [job, ...current.filter((item) => item.job_id !== job.job_id)]);
        } catch {
          // Keep the request error visible if the service is unreachable.
        }
      }
    } finally {
      setAction("");
    }
  }

  async function retryProcessing() {
    if (!activeJob) return;
    setAction("retry");
    setNotice("Retrying invoice processing...");
    setNoticeKind("info");
    try {
      await startProcessing(activeJob.job_id);
      const job = await getJob(activeJob.job_id);
      setActiveJob(job);
      setNotice("Invoice processing restarted.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Processing could not be restarted.");
      setNoticeKind("error");
    } finally {
      setAction("");
    }
  }

  async function saveReview() {
    if (!activeJob) return;
    setAction("save");
    try {
      await saveCorrections(activeJob.job_id, fields);
      const job = await getJob(activeJob.job_id);
      setActiveJob(job);
      setJobs((current) => [job, ...current.filter((item) => item.job_id !== job.job_id)]);
      setHistory(await getHistory(job.job_id));
      setNotice("Your corrections are saved.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Corrections could not be saved.");
      setNoticeKind("error");
    } finally {
      setAction("");
    }
  }

  async function decide(decision: "APPROVE" | "REJECT") {
    if (!activeJob) return;
    setAction(decision.toLowerCase());
    try {
      if (changedFields) await saveCorrections(activeJob.job_id, fields);
      await submitReviewDecision(activeJob.job_id, decision);
      const job = await getJob(activeJob.job_id);
      setActiveJob(job);
      setJobs((current) => [job, ...current.filter((item) => item.job_id !== job.job_id)]);
      setHistory(await getHistory(job.job_id));
      setNotice(decision === "APPROVE" ? "Invoice approved." : "Invoice rejected.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The review decision could not be saved.");
      setNoticeKind("error");
    } finally {
      setAction("");
    }
  }

  async function removeInvoice() {
    if (!activeJob || !window.confirm(`Delete ${activeJob.filename} and its saved review data?`)) return;
    setAction("delete");
    try {
      await deleteJob(activeJob.job_id);
      const remaining = jobs.filter((job) => job.job_id !== activeJob.job_id);
      setJobs(remaining);
      setActiveId(remaining[0]?.job_id || "");
      setActiveJob(null);
      setNotice("Invoice and its saved review data were deleted.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The invoice could not be deleted.");
      setNoticeKind("error");
    } finally {
      setAction("");
    }
  }

  async function exportInvoices() {
    setAction("export");
    try {
      await downloadExport();
      setNotice(exportableCount ? "Your invoice export has downloaded." : "The export is ready. It contains the column headers; no approved invoices are available yet.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The invoice export could not be created.");
      setNoticeKind("error");
    } finally {
      setAction("");
    }
  }

  if (!authReady) {
    return <main className="loading-screen"><LoaderCircle aria-hidden="true" className="spin" /><span>Loading your workspace...</span></main>;
  }

  if (!user) {
    const configured = hasAuthConfiguration() && hasApiBackend();
    return (
      <main className="landing">
        <header className="landing-nav">
          <a className="brand" href="/" aria-label="DocuFlow home"><span className="brand-mark"><FileText size={18} /></span><span>DocuFlow</span></a>
          <div className="nav-actions">
            <button className="button button-quiet" onClick={() => void beginAuth("login")} disabled={!configured}>Sign in</button>
            <button className="button button-primary" onClick={() => void beginAuth("signup")} disabled={!configured}>Create account <ArrowUpRight size={16} /></button>
          </div>
        </header>
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="eyebrow">INVOICE PROCESSING</p>
            <h1>Still typing invoice details by hand?</h1>
            <p className="hero-description">DocuFlow reads vendor invoices, pulls out the key details, and gives your team a place to check and correct them before export.</p>
            <div className="hero-actions">
              <button className="button button-primary button-large" onClick={() => void beginAuth("signup")} disabled={!configured}>Create your account <ArrowUpRight size={17} /></button>
              <span className="hero-login">Already have an account? <button onClick={() => void beginAuth("login")} disabled={!configured}>Sign in</button></span>
            </div>
            <div className="supported-line"><span>PDF, PNG, JPEG</span><span>Up to 10 MB</span><span>Up to 5 pages</span><span>5 uploads per account/day</span></div>
          </div>
          <div className="product-preview" aria-label="Invoice review workspace preview">
            <div className="preview-top"><span className="preview-dot" /><span>WORKSPACE PREVIEW</span><span className="preview-state">ILLUSTRATIVE</span></div>
            <div className="preview-body">
              <div className="preview-document">
                <div className="paper-brand">NORTHSTAR SUPPLY</div>
                <div className="paper-rule" />
                <div className="paper-title">INVOICE</div>
                <div className="paper-grid"><span>Invoice no.</span><b>NS-20418</b><span>Date</span><b>May 12, 2026</b></div>
                <div className="paper-line long" /><div className="paper-line" /><div className="paper-line short" />
                <div className="paper-total"><span>AMOUNT DUE</span><b>$2,480.00</b></div>
              </div>
              <div className="preview-fields">
                <div className="preview-fields-heading"><span>EXTRACTED FIELDS</span><span>3 of 5 verified</span></div>
                {[["Vendor", "Northstar Supply", "verified"], ["Invoice number", "NS-20418", "verified"], ["Invoice date", "May 12, 2026", "verified"], ["Due date", "May 27, 2026", "review"], ["Total due", "$2,480.00", "verified"]].map(([label, value, status]) => (
                  <div className="preview-field" key={label}><span>{label}</span><b>{value}</b><span className={`mini-check ${status}`}>{status === "verified" ? <Check size={12} /> : "Check"}</span></div>
                ))}
              </div>
            </div>
            <div className="preview-foot"><span><ShieldCheck size={14} /> Private invoice storage</span><span>CSV export</span></div>
          </div>
        </section>
        <section className="landing-proof" aria-label="Service details">
          <div><strong>Less retyping</strong><span>Invoice details become editable fields.</span></div>
          <div><strong>Human review</strong><span>Check extracted values before they leave your team.</span></div>
          <div><strong>Clear retention</strong><span>Documents expire after 30 days or can be deleted sooner.</span></div>
        </section>
        {!configured && <p className="config-note" role="status">Account access and invoice processing are not configured for this site yet.</p>}
        {authError && <p className="config-note error-note" role="alert">{authError}</p>}
        <footer className="landing-footer"><span>©2026 SUPREME AI VENTURES LLC</span><button onClick={() => void beginAuth("forgotPassword")} disabled={!configured}>Forgot password?</button></footer>
      </main>
    );
  }

  const previewIsPdf = activeJob?.content_type === "application/pdf";
  const reviewReady = Boolean(activeJob && ["NEEDS_REVIEW", "COMPLETED", "APPROVED", "REJECTED"].includes(activeJob.status));
  const finalStatus = activeJob?.status === "APPROVED" || activeJob?.status === "REJECTED";

  return (
    <main className="app-shell">
      <header className="workspace-nav">
        <a className="brand" href="/" aria-label="DocuFlow home"><span className="brand-mark"><FileText size={18} /></span><span>DocuFlow</span></a>
        <div className="workspace-title"><span>Accounts Payable</span><small>Invoice workspace</small></div>
        <div className="account-actions">
          <span className="account-email">{user}</span>
          <button className="icon-button" onClick={exportInvoices} disabled={action === "export"} aria-label="Export approved invoices" title="Export approved invoices"><ArrowDownToLine size={18} /></button>
          <button className="icon-button" onClick={endSession} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </header>

      {notice && <div className={`notice notice-${noticeKind}`} role={noticeKind === "error" ? "alert" : "status"}><span>{noticeKind === "error" ? <AlertCircle size={17} /> : noticeKind === "success" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</span><p>{notice}</p><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

      <section className="workspace-layout">
        <aside className="inbox-panel">
          <div className="section-heading"><div><p className="eyebrow">YOUR DOCUMENTS</p><h1>Invoices</h1></div><button className="icon-button" onClick={() => void refreshJobs().catch(() => undefined)} aria-label="Refresh invoices" title="Refresh"><RefreshCw size={16} /></button></div>

          <div className={`upload-box ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <input ref={fileInput} id="invoice-file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={onFileChange} />
            <button className="upload-select" onClick={() => fileInput.current?.click()} disabled={action === "upload"}>
              <UploadCloud size={20} />
              <span>{file ? file.name : "Choose an invoice"}</span>
              <small>{file ? formatSize(file.size) : "or drop a file here"}</small>
            </button>
            <button className="button button-primary upload-button" disabled={!file || Boolean(fileError) || action === "upload"} onClick={() => void handleUpload()}>
              {action === "upload" ? <LoaderCircle size={16} className="spin" /> : <UploadCloud size={16} />}
              {action === "upload" ? "Uploading" : matchesActiveInvoice ? activeJob?.status === "CREATED" ? "Resume upload" : "Open invoice" : "Process invoice"}
            </button>
            <p className="upload-limit">PDF, PNG, or JPEG · 10 MB · 5 pages · 5 uploads per account/day</p>
            {fileError && <p className="field-error" role="alert">{fileError}</p>}
          </div>

          <div className="document-list-heading"><span>RECENT INVOICES</span><span>{jobs.length}</span></div>
          {jobs.length ? <ul className="document-list">
            {jobs.map((job) => <li key={job.job_id}>
              <button className={`document-row ${job.job_id === activeId ? "selected" : ""}`} onClick={() => setActiveId(job.job_id)}>
                <span className="document-icon"><FileText size={17} /></span>
                <span className="document-meta"><strong title={job.filename}>{job.filename}</strong><small>{formatDate(job.created_at)}</small></span>
                <span className={`status-pill status-${job.status.toLowerCase()}`}>{statusText(job.status)}</span>
              </button>
            </li>)}
          </ul> : <div className="empty-inbox"><FileText size={22} /><strong>No invoices yet</strong><span>Upload an invoice to get started.</span></div>}
          <div className="retention-note"><ShieldCheck size={16} /><span>Private storage. Documents are deleted after 30 days.</span></div>
        </aside>

        <section className="review-panel" aria-label="Invoice details">
          {!activeJob ? <div className="review-empty"><FileText size={32} /><h2>Your review workspace</h2><p>Upload an invoice to see the original document, extracted details, and review status together.</p><button className="button button-quiet" onClick={() => fileInput.current?.click()}><UploadCloud size={16} /> Choose an invoice</button></div> : <>
            <div className="review-header">
              <div className="review-title"><p className="eyebrow">INVOICE DETAILS</p><h2 title={activeJob.filename}>{activeJob.filename}</h2><div className="file-facts"><span>{formatSize(activeJob.content_length || 0)}</span>{activeJob.page_count && <span>{activeJob.page_count} pages</span>}<span>{formatDate(activeJob.created_at)}</span></div></div>
              <div className={`large-status status-${activeJob.status.toLowerCase()}`}><span className={activeJob.status === "PROCESSING" ? "status-spinner" : "status-dot"}>{activeJob.status === "PROCESSING" ? <LoaderCircle size={15} /> : null}</span>{statusText(activeJob.status)}</div>
            </div>

            {activeJob.status === "PROCESSING" && <div className="processing-banner"><LoaderCircle className="spin" size={18} /><div><strong>Reading your invoice</strong><span>This can take a minute. You can leave this page; processing will continue.</span></div></div>}
            {activeJob.status === "FAILED" && <div className="processing-banner error-banner"><AlertCircle size={18} /><div><strong>{activeJob.failure?.code === "DOCUMENT_INVALID" ? "This invoice could not be read" : "We couldn't finish processing"}</strong><span>{activeJob.failure?.code === "DOCUMENT_INVALID" ? "Check the file type and page limits, then upload the corrected document." : "Your invoice remains private and can be retried or deleted."}</span></div>{activeJob.failure?.code !== "DOCUMENT_INVALID" && <button className="button button-quiet" onClick={() => void retryProcessing()} disabled={Boolean(action)}><RefreshCw size={15} /> Retry</button>}</div>}

            <div className="review-content">
              <section className="document-view" aria-label="Original invoice">
                <div className="subsection-header"><h3>Original invoice</h3>{documentPage && previewIsPdf && <span>Page {documentPage}</span>}</div>
                <div className="document-canvas">
                  {documentUrl ? (previewIsPdf ? <iframe title={`Original invoice, page ${documentPage || 1}`} src={`${documentUrl}${documentPage ? `#page=${documentPage}` : "#page=1"}`} /> : <img src={documentUrl} alt="Uploaded invoice" />) : <div className="document-placeholder">{documentError || (activeJob.status === "PROCESSING" ? "The original is being prepared..." : "The original document is unavailable.")}</div>}
                </div>
                {documentUrl && <a className="document-open" href={documentUrl} target="_blank" rel="noreferrer">Open original in a new tab <ArrowUpRight size={14} /></a>}
              </section>

              <section className="fields-panel" aria-label="Extracted invoice fields">
                <div className="subsection-header"><div><h3>Extracted fields</h3><p>{reviewReady ? "Check the values before approving." : "Fields will appear when processing finishes."}</p></div></div>
                {reviewReady ? <>
                  <div className="field-list">
                    {FIELD_ORDER.map((name) => {
                      const extracted = activeJob.parsed_fields?.[name];
                      const confidence = extracted?.confidence;
                      return <label className="field-row" key={name}>
                        <span className="field-label">{FIELD_LABELS[name]}{typeof confidence === "number" && <span className={`confidence ${confidence < 85 ? "confidence-low" : ""}`}>{Math.round(confidence)}%</span>}</span>
                        <input value={fields[name] || ""} onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))} placeholder="Not found" aria-label={FIELD_LABELS[name]} disabled={Boolean(action) || finalStatus} />
                        {extracted?.page && <button className="source-link" type="button" onClick={() => setDocumentPage(extracted.page || null)}>View page {extracted.page}<ChevronRight size={13} /></button>}
                      </label>;
                    })}
                  </div>
                  {!finalStatus && <div className="review-actions">
                    <button className="button button-quiet" onClick={() => void saveReview()} disabled={Boolean(action) || !changedFields}>{action === "save" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Save changes</button>
                    <button className="button button-reject" onClick={() => void decide("REJECT")} disabled={Boolean(action)}>{action === "reject" ? <LoaderCircle className="spin" size={15} /> : null}Reject</button>
                    <button className="button button-primary" onClick={() => void decide("APPROVE")} disabled={Boolean(action)}>{action === "approve" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Approve invoice</button>
                  </div>}
                </> : <div className="fields-pending"><Clock3 size={21} /><span>We’ll show the extracted values here as soon as they are ready.</span></div>}
              </section>
            </div>

            <section className="history-panel">
              <div className="subsection-header"><div><h3>Activity</h3><p>Saved corrections and approval decisions</p></div><button className="button button-danger-quiet" onClick={() => void removeInvoice()} disabled={Boolean(action) || activeJob.status === "PROCESSING"}><Trash2 size={15} />Delete invoice</button></div>
              {history.length ? <ol className="activity-list">{history.map((entry) => <li key={entry.audit_id}><span className="activity-mark"><Check size={12} /></span><div><strong>{entry.event_type === "FIELDS_CORRECTED" ? "Corrections saved" : entry.event_type === "APPROVED" ? "Invoice approved" : entry.event_type === "REJECTED" ? "Invoice rejected" : entry.event_type.replace(/_/g, " ").toLowerCase()}</strong><small>{formatDate(entry.created_at)}</small></div></li>)}</ol> : <p className="activity-empty">No review activity yet.</p>}
            </section>
          </>}
        </section>
      </section>
      <footer className="workspace-footer"><span>©2026 SUPREME AI VENTURES LLC</span><span>Invoices are retained for 30 days unless deleted sooner.</span><button onClick={exportInvoices} disabled={action === "export"}><ArrowDownToLine size={14} />Export approved invoices ({exportableCount})</button></footer>
    </main>
  );
}
