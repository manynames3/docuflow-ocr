# ADR 0003: Store Documents In S3 And State In DynamoDB

## Status

Accepted

## Context

Raw documents and Textract responses can be large and are not good fits for a DynamoDB item. Job status, normalized fields, review state, and audit metadata need fast keyed reads and review-queue queries.

## Decision

Store raw uploads and raw Textract JSON in S3. Store job state, parsed fields, confidence scores, corrections, and audit metadata in DynamoDB. Use an owner-and-created-time index for each customer's history, a job index for change history, and a separate on-demand table for daily upload counters.

## Consequences

Large document artifacts stay in object storage, while operational metadata remains queryable by its owner. The tradeoff is that the API coordinates DynamoDB metadata and S3 objects for preview and deletion.

