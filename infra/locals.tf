locals {
  name_prefix    = "${var.project_name}-${var.environment}"
  lambda_zip_dir = "${path.module}/../build/lambda"

  api_lambdas = {
    create_upload = {
      timeout     = 10
      memory_size = 128
    }
    start_processing = {
      timeout     = 10
      memory_size = 128
    }
    review_api = {
      timeout     = 10
      memory_size = 128
    }
  }

  workflow_lambdas = {
    validate_input = {
      timeout     = 10
      memory_size = 128
    }
    textract_start = {
      timeout     = 10
      memory_size = 128
    }
    textract_get_results = {
      timeout     = 30
      memory_size = 256
    }
    parse_and_score = {
      timeout     = 30
      memory_size = 256
    }
    failure_handler = {
      timeout     = 10
      memory_size = 128
    }
  }

  api_routes = {
    "GET /health"                    = "review_api"
    "POST /uploads"                  = "create_upload"
    "POST /jobs/{job_id}/upload-url" = "create_upload"
    "POST /jobs/{job_id}/start"      = "start_processing"
    "GET /jobs"                      = "review_api"
    "GET /jobs/{job_id}"             = "review_api"
    "GET /jobs/{job_id}/document"    = "review_api"
    "GET /jobs/{job_id}/history"     = "review_api"
    "PATCH /jobs/{job_id}/review"    = "review_api"
    "POST /jobs/{job_id}/decision"   = "review_api"
    "DELETE /jobs/{job_id}"          = "review_api"
    "GET /exports/invoices.csv"      = "review_api"
  }

  lambda_names = toset(concat(keys(local.api_lambdas), keys(local.workflow_lambdas)))

  common_lambda_environment = {
    DOCUMENTS_BUCKET        = aws_s3_bucket.documents.bucket
    JOBS_TABLE              = aws_dynamodb_table.jobs.name
    AUDIT_TABLE             = aws_dynamodb_table.audit.name
    QUOTAS_TABLE            = aws_dynamodb_table.quotas.name
    DLQ_URL                 = aws_sqs_queue.workflow_dlq.url
    CONFIDENCE_THRESHOLD    = tostring(var.confidence_threshold)
    REQUIRED_FIELDS         = join(",", var.required_fields)
    MAX_UPLOAD_BYTES        = tostring(var.max_upload_bytes)
    MAX_DOCUMENT_PAGES      = tostring(var.max_document_pages)
    DOCUMENT_RETENTION_DAYS = tostring(var.document_retention_days)
    MAX_DAILY_UPLOADS       = tostring(var.max_daily_uploads_per_account)
  }

  cognito_domain_prefix = substr(
    replace(lower("${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"), "/[^a-z0-9-]/", "-"),
    0,
    63
  )

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

