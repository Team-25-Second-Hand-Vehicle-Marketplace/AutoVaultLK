terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  project_name = "vehicle-marketplace"
  environment  = var.environment
  aws_region   = var.aws_region
}

output "public_api_endpoint" {
  value = module.api_gateway.public_api_endpoint
}

output "internal_api_endpoint" {
  value = module.api_gateway.internal_api_endpoint
}
