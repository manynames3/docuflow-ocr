# ADR 0002: Use An Explicit Start-Processing Endpoint

## Status

Accepted

## Context

S3 event notifications could start processing after upload, but they add asynchronous event wiring and make demos harder to control. The portfolio goal is to show the workflow clearly and reliably.

## Decision

Use `POST /jobs/{job_id}/start` after the client uploads the document to the presigned S3 URL.

## Consequences

The caller controls when processing begins, demos are deterministic, and status transitions are easier to explain. The tradeoff is that clients must make one extra API call after upload.

