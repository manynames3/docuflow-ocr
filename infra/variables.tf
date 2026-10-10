variable "project_name" {
  description = "Project name used in AWS resource names."
  type        = string
  default     = "docuflow-ocr"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "confidence_threshold" {
  description = "Minimum combined confidence score required to auto-complete a document."
  type        = number
  default     = 85
}

variable "required_fields" {
  description = "Normalized fields expected from the default invoice workflow."
  type        = list(string)
  default     = ["vendor_name", "document_date", "total_amount"]
}

variable "upload_ttl_seconds" {
  description = "Presigned S3 upload URL expiration in seconds."
  type        = number
  default     = 900
}

variable "max_upload_bytes" {
  description = "Maximum invoice size accepted by the upload API."
  type        = number
  default     = 10485760
}

variable "max_daily_uploads_per_account" {
  description = "Maximum invoice submissions per account per UTC day."
  type        = number
  default     = 5
}

variable "max_document_pages" {
  description = "Maximum number of invoice pages accepted before OCR."
  type        = number
  default     = 5
}

variable "document_retention_days" {
  description = "Days before stored invoices, OCR output, job data, and review history expire."
  type        = number
  default     = 30
}

variable "frontend_url" {
  description = "Public frontend URL used for Cognito callbacks and browser CORS."
  type        = string
  default     = "https://docuflow-ocr.pages.dev"
}

variable "frontend_origins" {
  description = "Exact browser origins allowed to call the API and upload to S3."
  type        = list(string)
  default     = ["https://docuflow-ocr.pages.dev"]
}

variable "api_throttle_rate_limit" {
  description = "API Gateway steady-state request limit shared across the service."
  type        = number
  default     = 10
}

variable "api_throttle_burst_limit" {
  description = "API Gateway burst request limit shared across the service."
  type        = number
  default     = 20
}

variable "log_retention_days" {
  description = "CloudWatch log retention period."
  type        = number
  default     = 14
}
