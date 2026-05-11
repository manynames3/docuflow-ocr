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
    "POST /uploads"                       = "create_upload"
    "POST /jobs/{job_id}/start"           = "start_processing"
    "GET /jobs/{job_id}"                  = "review_api"
    "GET /jobs/{job_id}/result"           = "review_api"
    "GET /review/jobs"                    = "review_api"
    "GET /review/jobs/{job_id}"           = "review_api"
    "POST /review/jobs/{job_id}/decision" = "review_api"
  }

  lambda_names = toset(concat(keys(local.api_lambdas), keys(local.workflow_lambdas)))

  common_lambda_environment = {
    DOCUMENTS_BUCKET     = aws_s3_bucket.documents.bucket
    JOBS_TABLE           = aws_dynamodb_table.jobs.name
    AUDIT_TABLE          = aws_dynamodb_table.audit.name
    DLQ_URL              = aws_sqs_queue.workflow_dlq.url
    CONFIDENCE_THRESHOLD = tostring(var.confidence_threshold)
    REQUIRED_FIELDS      = join(",", var.required_fields)
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

