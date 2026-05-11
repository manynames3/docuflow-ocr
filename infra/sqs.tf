resource "aws_sqs_queue" "workflow_dlq" {
  name                      = "${local.name_prefix}-workflow-dlq"
  message_retention_seconds = 1209600

  tags = local.tags
}

