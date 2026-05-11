# ADR 0003: Store Documents In S3 And State In DynamoDB

## Status

Accepted

## Context

Raw documents and Textract responses can be large and are not good fits for a DynamoDB item. Job status, normalized fields, review state, and audit metadata need fast keyed reads and review-queue queries.

## Decision

Store raw uploads and raw Textract JSON in S3. Store job state, parsed fields, confidence scores, review corrections, and audit metadata in DynamoDB. Use a `status-created_at-index` GSI to list jobs in `NEEDS_REVIEW`.

## Consequences

Large document artifacts stay in object storage, while operational metadata remains easy to query. The tradeoff is that callers may need both DynamoDB metadata and S3 objects for deep debugging.

