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

# CloudFront cost tier — PriceClass_100 (US/Canada/Europe edges only) is the
# cheapest; widen if buyers outside those regions need lower latency.
variable "price_class" {
  type    = string
  default = "PriceClass_100"
}
