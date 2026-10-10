# Manual to Automation Path

DocuFlow OCR models a practical transition from manual document extraction to automated review.

## Current Manual Pain

Operators receive PDFs or images, open each document, copy fields into a system of record, and escalate unclear values. This creates slow turnaround, inconsistent formatting, and limited visibility into failure patterns.

## Automated Intake

The API creates a document job and returns a presigned S3 URL. Operators or upstream systems upload documents without needing AWS credentials. Job status is stored immediately in DynamoDB.

## Automated Extraction

Step Functions starts Textract, waits for completion, stores raw OCR JSON in S3, parses normalized fields, and calculates a confidence score. High-confidence jobs move to `COMPLETED` with no manual extraction.

## Human Review Fallback

Low-confidence or incomplete jobs move to `NEEDS_REVIEW`. The customer workspace displays the original beside extracted fields, accepts saved corrections, and supports approve or reject decisions. Each change is recorded in the customer's review history.

## Continuous Improvement Loop

The `review_reasons`, saved corrections, and raw Textract output help identify fields and layouts that need better validation. Future work can add document-specific parsers, stronger business rules, and accounting-system integrations.
