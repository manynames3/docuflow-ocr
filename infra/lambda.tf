resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambda_names
  name              = "/aws/lambda/${local.name_prefix}-${each.key}"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

resource "aws_lambda_function" "workflow" {
  for_each = local.workflow_lambdas

  function_name    = "${local.name_prefix}-${each.key}"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  filename         = "${local.lambda_zip_dir}/${each.key}.zip"
  source_code_hash = try(filebase64sha256("${local.lambda_zip_dir}/${each.key}.zip"), null)
  timeout          = each.value.timeout
  memory_size      = each.value.memory_size

  environment {
    variables = local.common_lambda_environment
  }

  tags = local.tags

  depends_on = [aws_cloudwatch_log_group.lambda]
}

resource "aws_lambda_function" "api" {
  for_each = local.api_lambdas

  function_name    = "${local.name_prefix}-${each.key}"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  filename         = "${local.lambda_zip_dir}/${each.key}.zip"
  source_code_hash = try(filebase64sha256("${local.lambda_zip_dir}/${each.key}.zip"), null)
  timeout          = each.value.timeout
  memory_size      = each.value.memory_size

  environment {
    variables = merge(
      local.common_lambda_environment,
      each.key == "create_upload" ? { UPLOAD_TTL_SECONDS = tostring(var.upload_ttl_seconds) } : {},
      each.key == "start_processing" ? { STATE_MACHINE_ARN = aws_sfn_state_machine.document_workflow.arn } : {}
    )
  }

  tags = local.tags

  depends_on = [aws_cloudwatch_log_group.lambda]
}

