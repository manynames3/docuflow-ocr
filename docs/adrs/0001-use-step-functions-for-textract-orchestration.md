# ADR 0001: Use Step Functions For Textract Orchestration

## Status

Accepted

## Context

Textract document analysis is asynchronous for PDFs and can require waiting and polling before results are available. A single long-running Lambda would hide workflow state, risk timeout pressure, and make failure recovery harder to inspect.

## Decision

Use AWS Step Functions to orchestrate validation, Textract start, wait/poll behavior, result fetch, parsing, confidence routing, retries, catches, and failure handling.

## Consequences

Workflow state is visible in AWS, each Lambda stays small, and retries/catches are explicit. The tradeoff is more infrastructure than a single Lambda and a small amount of Step Functions execution cost.

