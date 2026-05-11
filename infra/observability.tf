resource "aws_cloudwatch_metric_alarm" "sfn_failed_executions" {
  alarm_name          = "${local.name_prefix}-sfn-failed-executions"
  alarm_description   = "Step Functions failed executions for DocuFlow OCR."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ExecutionsFailed"
  namespace           = "AWS/States"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.document_workflow.arn
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "${local.name_prefix}-dlq-depth"
  alarm_description   = "Workflow DLQ has failed document jobs waiting for inspection."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.workflow_dlq.name
  }

  tags = local.tags
}
