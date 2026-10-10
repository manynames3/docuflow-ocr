# Architecture Decisions

## Step Functions For Asynchronous OCR

Textract analysis is asynchronous. Step Functions makes waiting, bounded polling, retries, failure states, and job transitions explicit without holding a Lambda open for the full OCR duration. See [ADR 0001](adrs/0001-use-step-functions-for-textract-orchestration.md).

## Explicit Processing Start

After the customer uploads a document, the browser calls `POST /jobs/{job_id}/start`. The API verifies ownership and object presence before starting the workflow. This makes retries and the upload-to-processing transition explicit. See [ADR 0002](adrs/0002-use-explicit-start-processing-endpoint.md).

## Private Object Storage And Durable State

S3 stores source documents and raw Textract output; DynamoDB stores customer-scoped jobs, parsed fields, corrections, and audit history. See [ADR 0003](adrs/0003-store-documents-in-s3-and-state-in-dynamodb.md).

## Cognito Identity

Cognito manages customer accounts, API Gateway verifies access tokens, and Lambda derives the owner from the verified subject. See [ADR 0004](adrs/0004-use-cognito-for-customer-authentication.md).

## Static Customer Interface

Cloudflare Pages serves the React/Vite app. Missing API or identity configuration produces an unavailable state; the app does not manufacture invoices or pretend OCR succeeded. See [ADR 0005](adrs/0005-serve-the-client-from-cloudflare-pages.md).
