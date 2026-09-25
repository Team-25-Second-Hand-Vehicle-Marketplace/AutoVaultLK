terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# The full ingestion ETL design (SAD §6.6): a Standard state machine fanning
# out to one Lambda per stage, started by an EventBridge Pipe reading the
# ingestion jobs SQS queue — replacing the earlier MVP's single etl-worker
# Lambda consuming that same queue directly via an event source mapping.
#
# STANDARD, not EXPRESS: EXPRESS workflows cap an execution at 5 minutes,
# which is close to what motivated moving off the MVP's 15-minute Lambda
# ceiling in the first place. STANDARD also keeps execution history, useful
# for debugging a failed dealer upload after the fact.
#
# The pipe uses FIRE_AND_FORGET: it starts an execution per message and does
# not wait on it, matching JobQueue.publish()'s existing contract (resolves
# once the message is accepted, not once the pipeline finishes — POST
# /ingest/upload answers 202 immediately).
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

data "aws_iam_policy_document" "state_machine_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "state_machine" {
  name               = "${var.project_name}-etl-state-machine-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.state_machine_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "state_machine_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = var.lambda_function_arns_list
  }
}

resource "aws_iam_role_policy" "state_machine_invoke" {
  name   = "invoke-stage-lambdas"
  role   = aws_iam_role.state_machine.id
  policy = data.aws_iam_policy_document.state_machine_invoke.json
}

resource "aws_sfn_state_machine" "this" {
  name     = "${var.project_name}-etl-${var.environment}"
  type     = "STANDARD"
  role_arn = aws_iam_role.state_machine.arn

  definition = templatefile(var.state_machine_definition_path, var.function_arns)

  tags = local.tags
}

# -----------------------------------------------------------------------------
# EventBridge Pipe: SQS -> Step Functions, no Lambda glue code needed. Takes
# the place of the MVP's aws_lambda_event_source_mapping.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "pipe_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["pipes.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pipe" {
  name               = "${var.project_name}-etl-pipe-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.pipe_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "pipe_permissions" {
  statement {
    sid    = "ReadUploadJobs"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [var.sqs_queue_arn]
  }

  statement {
    sid       = "StartEtlExecution"
    effect    = "Allow"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.this.arn]
  }
}

resource "aws_iam_role_policy" "pipe_permissions" {
  name   = "pipe-permissions"
  role   = aws_iam_role.pipe.id
  policy = data.aws_iam_policy_document.pipe_permissions.json
}

resource "aws_pipes_pipe" "ingestion_jobs" {
  name     = "${var.project_name}-ingestion-jobs-${var.environment}"
  role_arn = aws_iam_role.pipe.arn
  source   = var.sqs_queue_arn
  target   = aws_sfn_state_machine.this.arn

  source_parameters {
    sqs_queue_parameters {
      batch_size = 1
    }
  }

  target_parameters {
    step_function_state_machine_parameters {
      invocation_type = "FIRE_AND_FORGET"
    }
  }

  tags = local.tags
}

output "state_machine_arn" {
  value = aws_sfn_state_machine.this.arn
}
