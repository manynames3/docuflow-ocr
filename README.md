# DocuFlow OCR

DocuFlow OCR turns vendor invoices into reviewable accounting records. A customer creates an account, uploads a PDF or image, checks extracted invoice fields against the source document, saves corrections, approves or rejects the result, and downloads approved records as CSV.

## TL;DR

Private invoice intake, asynchronous OCR, field-level review, saved corrections, and CSV export. The workflow uses Cognito, API Gateway, Lambda, Step Functions, Textract, S3, and DynamoDB; Terraform defines the AWS deployment.

## What It Does

- Supports PDF, PNG, and JPEG invoices up to 10 MB and 5 pages.
- Limits each account to 5 invoice submissions per UTC day.
- Checks the uploaded file type and PDF page count before OCR.
- Extracts invoice fields asynchronously and shows confidence plus source-page references when available.
- Lets a customer correct values, inspect change history, approve or reject a document, and export saved results.
- Provides per-account document history and deletion. Stored documents and review data expire after 30 days.

The app does not include payment processing, accounting-system integrations, shared organizations, or line-item extraction. No subscription or purchase flow is represented as available.

## Architecture

See [architecture](docs/architecture.md) for the runtime flow, C4-style container diagram, deployment shape, and constraints. Architecture decisions are recorded in [docs/adrs](docs/adrs/README.md).

At a glance, Cognito issues customer tokens; API Gateway verifies them; Lambda enforces ownership from the verified Cognito subject; S3 holds private source documents and Textract output; DynamoDB stores job state and review history. Step Functions coordinates validation, asynchronous Textract polling, parsing, confidence routing, and failure handling.

## Technology

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Cloudflare Pages |
| Identity | Amazon Cognito managed login, OAuth authorization code with PKCE |
| API | API Gateway HTTP API with JWT authorizer |
| Compute | Python 3.12 AWS Lambda |
| OCR | Amazon Textract asynchronous document analysis |
| Orchestration | AWS Step Functions |
| Storage | Private S3 bucket with server-side encryption and lifecycle expiration |
| State | DynamoDB jobs, audit, and daily upload-quota tables |
| Operations | CloudWatch logs/alarms and an SQS dead-letter queue |
| Infrastructure | Terraform |
| Tests | Pytest, Ruff, and Playwright |

## Security And Retention

- Every customer API route requires a verified Cognito access token. The API derives the owner from the token subject; request bodies cannot select an owner.
- Job reads, document links, corrections, decisions, history, deletion, and exports are scoped to that owner.
- Source files remain private in S3. Upload forms are short-lived and size-bounded; document previews use five-minute signed URLs.
- API responses are not cacheable. Workflow logs and failure-queue messages omit document content and extracted values.
- Source documents, OCR output, job records, and review history have a 30-day retention policy. Customers can delete a document sooner.

These controls do not constitute a compliance certification. The current account model is one Cognito user per isolated workspace; team membership and role-based access are not implemented.

## Local Development

Prerequisites: Python 3.12 or newer, Node.js 22, Terraform 1.6+, and AWS CLI credentials for infrastructure work.

```bash
make install
make test
make lint
make package
make frontend-install
make frontend-build
npm --prefix frontend run test:e2e
make tf-fmt
make tf-validate
```

Create `frontend/.env.local` from `frontend/.env.example` to connect the browser to an already deployed API and Cognito app client. The app does not substitute sample invoices or fake OCR results when configuration is missing; it reports that account or processing configuration is unavailable.

Run the frontend locally with:

```bash
make frontend-dev
```

The Cognito callback and API CORS configuration must include the local origin when using a local browser session.

## AWS Deployment

Build Lambda packages before Terraform creates the functions:

```bash
make package
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
```

Terraform outputs include `api_base_url`, `cognito_auth_domain`, `cognito_client_id`, and `frontend_redirect_uri`. Configure the Cloudflare Pages build with:

```text
VITE_API_BASE_URL=<api_base_url>
VITE_COGNITO_AUTH_DOMAIN=<cognito_auth_domain>
VITE_COGNITO_CLIENT_ID=<cognito_client_id>
VITE_COGNITO_REDIRECT_URI=<frontend_redirect_uri>
```

The `VITE_` values are public client configuration, not secrets. The GitHub Actions workflow deploys Pages only when those product values and the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets are configured. No AWS or Cloudflare deployment is performed by the local test commands.

## Cost And Product Limits

There is no product subscription or checkout implementation. A deployed AWS stack can incur usage charges; Textract is billed per page, while storage, API requests, Lambda, Step Functions, and email delivery depend on usage and account quotas. Cognito uses email verification and password recovery. Review the AWS pricing and service quotas for the target account before accepting customer traffic.

The current scope is invoice header fields and CSV handoff. Extraction quality varies by document scan and layout; uncertain or missing values are intended for human review, not treated as verified automatically.

## Repository Layout

```text
infra/                 Terraform for AWS resources
frontend/              React customer interface and Cloudflare Pages config
src/lambdas/           API handlers, OCR workflow, and shared Python code
src/tests/             Unit tests and controlled Textract response fixture
scripts/               Lambda packaging helper
docs/                  Architecture, ADRs, API examples, and use cases
```
