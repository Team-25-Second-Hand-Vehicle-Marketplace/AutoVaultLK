terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# CloudWatch alarms + one dashboard for every deployed Lambda (the 4
# always-on services plus however many ingestion functions are wired in —
# lambda_function_names is caller-supplied), the RDS instance, and the
# ingestion SQS queue/DLQ. The SNS topic is always created (cheap, no ongoing
# cost) even with no subscriber yet, so alarms have somewhere to fire from
# day one — subscribe to it later from the console if alarm_email isn't set
# at apply time.
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts-${var.environment}"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alarm_email != null ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# -----------------------------------------------------------------------------
# Lambda: one Errors + one Throttles alarm per function.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = var.lambda_function_names

  alarm_name          = "${var.project_name}-${each.key}-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = var.lambda_function_names

  alarm_name          = "${var.project_name}-${each.key}-throttles-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

# -----------------------------------------------------------------------------
# Ingestion SQS: any DLQ message means a job needs manual attention (see
# production/main.tf's redrive_policy — 3 failed deliveries land here).
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ingestion_dlq_depth" {
  alarm_name          = "${var.project_name}-ingestion-dlq-depth-${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.sqs_dlq_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

# -----------------------------------------------------------------------------
# RDS: CPU, free storage, and proxy client connections.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.project_name}-db-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.db_cpu_threshold_percent
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.db_instance_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

resource "aws_cloudwatch_metric_alarm" "db_free_storage" {
  alarm_name          = "${var.project_name}-db-free-storage-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.db_free_storage_threshold_bytes
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.db_instance_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name          = "${var.project_name}-db-connections-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.db_connections_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.db_instance_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

# -----------------------------------------------------------------------------
# Dashboard: one glance at every Lambda, the database, and the ingestion
# queue/DLQ depth.
# -----------------------------------------------------------------------------

locals {
  lambda_widgets = [
    for service, function_name in var.lambda_function_names : {
      type   = "metric"
      width  = 12
      height = 6
      properties = {
        title  = "Lambda: ${service}"
        view   = "timeSeries"
        stat   = "Sum"
        period = 300
        metrics = [
          ["AWS/Lambda", "Invocations", "FunctionName", function_name],
          ["AWS/Lambda", "Errors", "FunctionName", function_name],
          ["AWS/Lambda", "Throttles", "FunctionName", function_name],
          ["AWS/Lambda", "Duration", "FunctionName", function_name, { stat = "Average", yAxis = "right" }],
        ]
      }
    }
  ]

  fixed_widgets = [
    {
      type   = "metric"
      width  = 12
      height = 6
      properties = {
        title  = "RDS"
        view   = "timeSeries"
        period = 300
        metrics = [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifier],
          ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.db_instance_identifier, { yAxis = "right" }],
          ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.db_instance_identifier, { yAxis = "right" }],
        ]
      }
    },
    {
      type   = "metric"
      width  = 12
      height = 6
      properties = {
        title  = "RDS Proxy client connections"
        view   = "timeSeries"
        period = 300
        metrics = [
          ["AWS/RDS", "DatabaseConnectionsCurrentlyInTransaction", "ProxyName", var.db_proxy_name],
        ]
      }
    },
    {
      type   = "metric"
      width  = 12
      height = 6
      properties = {
        title  = "Ingestion queue"
        view   = "timeSeries"
        period = 300
        metrics = [
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.sqs_queue_name],
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.sqs_dlq_name, { label = "DLQ" }],
        ]
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.project_name}-${var.environment}"
  dashboard_body = jsonencode({
    widgets = concat(local.lambda_widgets, local.fixed_widgets)
  })
}
