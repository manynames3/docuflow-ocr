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

output "cognito_user_pool_id" {
  description = "Cognito user pool used for customer accounts."
  value       = aws_cognito_user_pool.customers.id
}

output "cognito_client_id" {
  description = "Public Cognito app client ID for the frontend."
  value       = aws_cognito_user_pool_client.frontend.id
}

output "cognito_auth_domain" {
  description = "Cognito managed login domain."
  value       = "https://${aws_cognito_user_pool_domain.managed_login.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "frontend_redirect_uri" {
  description = "OAuth callback URL that must be configured in the frontend."
  value       = "${trimsuffix(var.frontend_url, "/")}/auth/callback"
}

output "frontend_api_base_url" {
  description = "API endpoint that must be configured as VITE_API_BASE_URL."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

