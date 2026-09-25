variable "project_name" {
  type        = string
  description = "Resource name prefix"
  default     = "vehicle-marketplace"
}

variable "environment" {
  type        = string
  description = "Deployment stage (dev, staging, production)"
  default     = "dev"
}

variable "lambda_function_names" {
  type        = map(string)
  description = "Service name -> deployed Lambda function name. One Errors + one Throttles alarm is created per entry."
}

variable "sqs_queue_name" {
  type        = string
  description = "The ingestion jobs queue name (for a backlog-depth alarm)"
}

variable "sqs_dlq_name" {
  type        = string
  description = "The ingestion jobs DLQ name — any message here means a job needs manual attention"
}

variable "db_instance_identifier" {
  type        = string
  description = "From modules.database.instance_identifier"
}

variable "db_proxy_name" {
  type        = string
  description = "From modules.database.proxy_name (not currently alarmed on directly — RDS Proxy exposes fewer standalone CloudWatch metrics than the instance — but kept for the dashboard and future use)"
}

variable "alarm_email" {
  type        = string
  description = "Email to subscribe to the alerts SNS topic. Optional — the topic is always created either way, so it can be subscribed to later from the console without a terraform apply."
  default     = null
}

variable "db_cpu_threshold_percent" {
  type    = number
  default = 80
}

variable "db_free_storage_threshold_bytes" {
  type        = number
  description = "Default: 2 GiB, sized against the database module's default 20 GB allocated_storage"
  default     = 2147483648
}

variable "db_connections_threshold" {
  type        = number
  description = "Client connections to the RDS Proxy target, not raw Postgres backends — sized well under db.t4g.micro's max_connections"
  default     = 60
}
