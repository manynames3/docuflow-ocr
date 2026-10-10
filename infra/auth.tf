resource "aws_cognito_user_pool" "customers" {
  name                     = "${local.name_prefix}-customers"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your DocuFlow verification code"
    email_message        = "Your DocuFlow verification code is {####}."
  }

  tags = local.tags
}

resource "aws_cognito_user_pool_client" "frontend" {
  name                                 = "${local.name_prefix}-frontend"
  user_pool_id                         = aws_cognito_user_pool.customers.id
  generate_secret                      = false
  enable_token_revocation              = true
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  callback_urls                        = ["${trimsuffix(var.frontend_url, "/")}/auth/callback"]
  logout_urls                          = [trimsuffix(var.frontend_url, "/")]
  supported_identity_providers         = ["COGNITO"]
  access_token_validity                = 1
  id_token_validity                    = 1
  refresh_token_validity               = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "managed_login" {
  domain       = local.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.customers.id
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "${local.name_prefix}-cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.frontend.id]
    issuer   = "https://${aws_cognito_user_pool.customers.endpoint}"
  }
}
