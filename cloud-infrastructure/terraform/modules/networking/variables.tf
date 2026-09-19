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

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

# One NAT Gateway (single-AZ) rather than one per AZ — cheaper, acceptable
# for a first deployment. Both private subnets route through it, so an AZ
# outage on the NAT's AZ takes egress down for both; revisit if that's not
# an acceptable tradeoff.
variable "single_nat_gateway" {
  type        = bool
  description = "Use one shared NAT Gateway instead of one per AZ"
  default     = true
}
