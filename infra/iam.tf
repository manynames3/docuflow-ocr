data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${local.name_prefix}-lambda-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "lambda_exec" {
  statement {
    sid = "WriteCloudWatchLogs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid = "ReadWriteDocumentBucket"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.documents.arn,
      "${aws_s3_bucket.documents.arn}/*"
    ]
  }

  statement {
    sid = "ReadWriteDynamoTables"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:Scan"
    ]
    resources = [
      aws_dynamodb_table.jobs.arn,
      "${aws_dynamodb_table.jobs.arn}/index/*",
      aws_dynamodb_table.audit.arn,
      "${aws_dynamodb_table.audit.arn}/index/*"
    ]
  }

  statement {
    sid = "StartDocumentTextract"
    actions = [
      "textract:StartDocumentAnalysis",
      "textract:GetDocumentAnalysis"
    ]
    resources = ["*"]
  }

  statement {
    sid       = "StartWorkflow"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.document_workflow.arn]
  }

  statement {
    sid       = "WriteWorkflowDlq"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.workflow_dlq.arn]
  }
}

resource "aws_iam_role_policy" "lambda_exec" {
  name   = "${local.name_prefix}-lambda-policy"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_exec.json
}

data "aws_iam_policy_document" "sfn_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sfn_exec" {
  name               = "${local.name_prefix}-sfn-exec"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "sfn_exec" {
  statement {
    sid     = "InvokeWorkflowLambdas"
    actions = ["lambda:InvokeFunction"]
    resources = flatten([
      [for function in values(aws_lambda_function.workflow) : function.arn],
      [for function in values(aws_lambda_function.workflow) : "${function.arn}:*"]
    ])
  }

  statement {
    sid       = "WriteWorkflowDlq"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.workflow_dlq.arn]
  }

  statement {
    sid = "WriteStepFunctionLogs"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "sfn_exec" {
  name   = "${local.name_prefix}-sfn-policy"
  role   = aws_iam_role.sfn_exec.id
  policy = data.aws_iam_policy_document.sfn_exec.json
}

