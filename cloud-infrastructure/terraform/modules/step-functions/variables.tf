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

variable "state_machine_definition_path" {
  type        = string
  description = "Path to etl-state-machine.asl.json"
}

variable "function_arns" {
  type        = map(string)
  description = "ASL placeholder name (e.g. ValidateFileFunctionArn) -> Lambda function ARN. Passed straight to templatefile() to fill in the ASL's $${XxxFunctionArn} placeholders."
}

variable "lambda_function_arns_list" {
  type        = list(string)
  description = "The same 12 ARNs as a list, for the state machine execution role's lambda:InvokeFunction Resource list"
}

variable "sqs_queue_arn" {
  type        = string
  description = "The ingestion jobs queue — an EventBridge Pipe starts one execution per message"
}
