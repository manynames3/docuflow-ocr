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
  description = "Normalized fields expected for the default invoice-style demo."
  type        = list(string)
  default     = ["vendor_name", "document_date", "total_amount"]
}

variable "upload_ttl_seconds" {
  description = "Presigned S3 upload URL expiration in seconds."
  type        = number
  default     = 900
}

variable "log_retention_days" {
  description = "CloudWatch log retention period."
  type        = number
  default     = 14
}
