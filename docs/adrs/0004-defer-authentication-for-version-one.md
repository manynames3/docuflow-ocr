# ADR 0004: Defer Authentication For Version 1

## Status

Accepted

## Context

The project is intended to demonstrate document automation, OCR orchestration, review routing, and Terraform-managed AWS infrastructure. Adding Cognito or a custom auth layer would increase scope without improving the core hiring signal.

## Decision

Do not include authentication in version 1. Document the limitation clearly and keep owner IDs as metadata only.

## Consequences

The project stays focused and easier to deploy for review. It is not production-ready as a public API until authentication and owner-scoped authorization are added.

