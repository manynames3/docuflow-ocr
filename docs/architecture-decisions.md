# Architecture Decisions

## Step Functions Instead of One Large Lambda

Step Functions makes the document workflow visible and resilient. Textract async jobs require waiting and polling, which is a poor fit for one long-running Lambda. The state machine separates validation, OCR start, polling, parsing, confidence routing, and failure handling. Each state has retries and catches, and a failed execution can be inspected without digging through a single log stream.

## Explicit Start Endpoint Instead of S3 Event Trigger

The first version uses `POST /jobs/{job_id}/start` after the presigned upload. This keeps the demo deterministic: the caller can create a job, upload the document, and then start processing when the upload is complete. S3 event triggers are useful in production, but they add more moving parts for a portfolio walkthrough.

## DynamoDB for Job State

DynamoDB is a good fit for status lookups and review queues. The jobs table uses `job_id` as the partition key and a `status-created_at-index` GSI to list `NEEDS_REVIEW` work. Raw documents and raw Textract JSON stay in S3 so DynamoDB stores only operational metadata and normalized extraction output.

## Dedicated Audit Table

Review decisions are stored in a separate audit table. A single-table design could also work, but a dedicated table is clearer for a portfolio project and avoids overloading the job item with append-only history.

## Shared Lambda Execution Role

The project uses one resource-scoped Lambda role for simplicity. Permissions are limited to the generated S3 bucket, DynamoDB tables, DLQ, state machine, and Textract actions. A production version could split this into per-function roles to reduce blast radius further.

## No Authentication in Version 1

The API does not include Cognito or custom authorization. That keeps the project focused on document automation. A production extension should add authentication, owner scoping, and authorization checks before exposing review endpoints.

## Optional Frontend Deferred

The backend exposes the full review workflow through API endpoints. A TypeScript review UI would be useful, but the first version prioritizes deployable AWS infrastructure, tests, and runbook clarity.

