output "api_base_url" {
  description = "HTTP API base URL."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "documents_bucket" {
  description = "S3 bucket used for raw uploads and Textract JSON output."
  value       = aws_s3_bucket.documents.bucket
}

output "jobs_table" {
  description = "DynamoDB jobs table name."
  value       = aws_dynamodb_table.jobs.name
}

output "audit_table" {
  description = "DynamoDB audit table name."
  value       = aws_dynamodb_table.audit.name
}

output "state_machine_arn" {
  description = "Step Functions workflow ARN."
  value       = aws_sfn_state_machine.document_workflow.arn
}

output "workflow_dlq_url" {
  description = "SQS DLQ URL for failed workflow jobs."
  value       = aws_sqs_queue.workflow_dlq.url
}

