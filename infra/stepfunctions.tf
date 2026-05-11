resource "aws_cloudwatch_log_group" "sfn" {
  name              = "/aws/vendedlogs/states/${local.name_prefix}-document-workflow"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

resource "aws_sfn_state_machine" "document_workflow" {
  name     = "${local.name_prefix}-document-workflow"
  role_arn = aws_iam_role.sfn_exec.arn

  logging_configuration {
    include_execution_data = true
    level                  = "ERROR"
    log_destination        = "${aws_cloudwatch_log_group.sfn.arn}:*"
  }

  definition = jsonencode({
    Comment = "DocuFlow OCR document OCR and confidence-routing workflow"
    StartAt = "ValidateInput"
    States = {
      ValidateInput = {
        Type     = "Task"
        Resource = aws_lambda_function.workflow["validate_input"].arn
        Retry    = local.lambda_retry
        Catch    = local.workflow_catch
        Next     = "StartTextract"
      }
      StartTextract = {
        Type     = "Task"
        Resource = aws_lambda_function.workflow["textract_start"].arn
        Retry    = local.lambda_retry
        Catch    = local.workflow_catch
        Next     = "WaitForTextract"
      }
      WaitForTextract = {
        Type    = "Wait"
        Seconds = 15
        Next    = "GetTextractResults"
      }
      GetTextractResults = {
        Type     = "Task"
        Resource = aws_lambda_function.workflow["textract_get_results"].arn
        Retry    = local.lambda_retry
        Catch    = local.workflow_catch
        Next     = "TextractFinished"
      }
      TextractFinished = {
        Type = "Choice"
        Choices = [
          {
            Variable     = "$.textract_status"
            StringEquals = "SUCCEEDED"
            Next         = "ParseAndScore"
          },
          {
            Variable     = "$.textract_status"
            StringEquals = "PARTIAL_SUCCESS"
            Next         = "ParseAndScore"
          },
          {
            Variable     = "$.textract_status"
            StringEquals = "IN_PROGRESS"
            Next         = "WaitForTextract"
          },
          {
            Variable     = "$.textract_status"
            StringEquals = "FAILED"
            Next         = "FailureHandler"
          }
        ]
        Default = "FailureHandler"
      }
      ParseAndScore = {
        Type     = "Task"
        Resource = aws_lambda_function.workflow["parse_and_score"].arn
        Retry    = local.lambda_retry
        Catch    = local.workflow_catch
        Next     = "RouteByConfidence"
      }
      RouteByConfidence = {
        Type = "Choice"
        Choices = [
          {
            Variable     = "$.status"
            StringEquals = "COMPLETED"
            Next         = "Completed"
          },
          {
            Variable     = "$.status"
            StringEquals = "NEEDS_REVIEW"
            Next         = "NeedsReview"
          }
        ]
        Default = "FailureHandler"
      }
      FailureHandler = {
        Type     = "Task"
        Resource = aws_lambda_function.workflow["failure_handler"].arn
        Retry    = local.lambda_retry
        Next     = "Failed"
      }
      Completed = {
        Type = "Succeed"
      }
      NeedsReview = {
        Type = "Succeed"
      }
      Failed = {
        Type  = "Fail"
        Cause = "DocuFlow OCR workflow failed"
      }
    }
  })

  tags = local.tags

  depends_on = [aws_iam_role_policy.sfn_exec]
}

locals {
  lambda_retry = [
    {
      ErrorEquals = [
        "Lambda.ServiceException",
        "Lambda.AWSLambdaException",
        "Lambda.SdkClientException",
        "Lambda.TooManyRequestsException"
      ]
      IntervalSeconds = 2
      MaxAttempts     = 3
      BackoffRate     = 2
    }
  ]

  workflow_catch = [
    {
      ErrorEquals = ["States.ALL"]
      ResultPath  = "$.error"
      Next        = "FailureHandler"
    }
  ]
}
