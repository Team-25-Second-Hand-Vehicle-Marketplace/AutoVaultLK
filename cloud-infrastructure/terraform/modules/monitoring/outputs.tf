output "sns_topic_arn" {
  description = "Subscribe additional endpoints (Slack via chatbot, PagerDuty, another email) to this topic"
  value       = aws_sns_topic.alerts.arn
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.this.dashboard_name
}
