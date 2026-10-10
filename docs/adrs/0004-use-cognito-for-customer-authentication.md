# ADR 0004: Use Cognito For Customer Authentication

## Status

Accepted

## Context

The customer workflow contains private invoices, extracted fields, corrections, and exports. Client-supplied owner identifiers and unauthenticated API routes cannot protect those records. The existing AWS stack has no customer identity service.

## Decision

Use an Amazon Cognito user pool with managed sign-up, sign-in, email recovery, and OAuth authorization code with PKCE. API Gateway validates access-token JWTs; every customer Lambda derives the workspace owner from the verified Cognito `sub` claim and scopes reads and mutations to that subject.

## Consequences

The customer can create and manage an individual account without a separately hosted identity server. Cognito email quotas and account MAU pricing still apply. Team membership, organization administration, and role-based access are outside the current product scope.
