# Manual to Automation Path

DocuFlow OCR models a practical transition from manual document extraction to automated review.

## Current Manual Pain

Operators receive PDFs or images, open each document, copy fields into a system of record, and escalate unclear values. This creates slow turnaround, inconsistent formatting, and limited visibility into failure patterns.

## Automated Intake

The API creates a document job and returns a presigned S3 URL. Operators or upstream systems upload documents without needing AWS credentials. Job status is stored immediately in DynamoDB.

## Automated Extraction

Step Functions starts Textract, waits for completion, stores raw OCR JSON in S3, parses normalized fields, and calculates a confidence score. High-confidence jobs move to `COMPLETED` with no manual extraction.

## Human Review Fallback

Low-confidence or incomplete jobs move to `NEEDS_REVIEW`. Review endpoints list the queue, fetch extracted fields, submit corrected values, and approve or reject the job. Each decision writes an audit record.

## Continuous Improvement Loop

The `review_reasons`, corrected fields, and raw Textract output show which document types fail most often. Future work can add document-specific parsers, stronger validation rules, better sample coverage, and eventually a UI for faster review.
