# AGENTS.md

## Project Purpose
This repository is a portfolio-ready AWS serverless document automation project for an AWS Engineer / Cloud Engineer role. Optimize for clarity, deployability, clean docs, and resume value.

## Stack Preferences
- Infrastructure: Terraform
- Backend: Python AWS Lambda
- API: Amazon API Gateway HTTP API
- Orchestration: AWS Step Functions
- OCR/extraction: AWS Textract
- Storage: S3 for raw documents and raw Textract JSON; DynamoDB for job state, audit records, and normalized fields
- Queue/error handling: SQS DLQ
- Observability: CloudWatch logs and alarms
- Optional frontend: TypeScript/React only if it remains simple

## Engineering Rules
- Keep the design low-cost and easy to tear down.
- Never commit secrets, credentials, real customer data, or private documents.
- Prefer least-privilege IAM and explain any broad permissions.
- Add or update tests when changing parsing, scoring, state transitions, or API schemas.
- Keep `README.md` current with setup, deploy, demo, test, cost, and teardown instructions.
- Keep `docs/resume-bullets.md` aligned with the target AWS Engineer role.

## Quality Gates
Before considering work complete, try to run:
- `make test`
- `make lint`
- `make fmt`
- `make tf-fmt`
- `make tf-validate`

If a command cannot run locally, document why and provide the next command the user should run.

