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

variable "service_name" {
  type        = string
  description = "e.g. validate-file, split-chunks — becomes part of the function name"
}

variable "s3_bucket" {
  type        = string
  description = "Bucket holding the built zip artifact (modules.lambda's ECR-image equivalent)"
}

variable "s3_key" {
  type        = string
  description = "Fixed key CI overwrites on each deploy, e.g. lambda-artifacts/validate-file.zip. Unlike modules.lambda's image_uri, this is a static value Terraform never computes, so there is nothing for a later apply to fight — no lifecycle.ignore_changes needed."
}

variable "handler" {
  type    = string
  default = "index.handler"
}

variable "runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type    = number
  default = 60
}

variable "execution_role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}
