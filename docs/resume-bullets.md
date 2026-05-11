# Resume Bullets

- Built a serverless document-intake pipeline using S3 presigned uploads, API Gateway, Step Functions, Textract, Python Lambda, DynamoDB, and Terraform to extract, validate, and expose structured fields from uploaded PDFs and images.
- Designed a human-in-the-loop review workflow that routes low-confidence Textract results to a DynamoDB-backed review queue, stores corrected fields, and writes audit records for approved or rejected documents.
- Implemented operational controls including Step Functions retries and catches, SQS dead-letter handling, CloudWatch logs and alarms, resource-scoped IAM, unit-tested parsing logic, and documented deployment, teardown, and troubleshooting runbooks.

