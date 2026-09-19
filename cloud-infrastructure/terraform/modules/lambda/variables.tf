variable "project_name" {
  type        = string
  description = "Resource name prefix"
  default     = "vehicle-marketplace"
}

variable "environment" {
  type        = string
  description = "Deployment stage (dev, staging, prod)"
  default     = "dev"
}

variable "service_name" {
  type        = string
  description = "e.g. auth, marketplace, admin, notification — becomes part of the ECR repo and function name"
}

variable "image_tag" {
  type        = string
  description = "Tag CI pushes to ECR and this function runs. First apply needs an image already pushed at this tag — see module README note."
  default     = "latest"
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type    = number
  default = 30
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
