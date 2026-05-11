# ADR 0005: Use Cloudflare Pages For The Product Frontend

## Status

Accepted

## Context

The backend demonstrates the AWS workflow, but hiring managers also need to see the project as a credible end-user product. The frontend should be fast to deploy, inexpensive to host, and able to run either as a polished demo or against the real API.

## Decision

Build the frontend as a React/Vite app in `frontend/` and deploy the static build output to Cloudflare Pages. Use `VITE_API_BASE_URL` to connect to the deployed API Gateway backend, and fall back to demo mode when no API URL is configured.

## Consequences

The project has a sales-ready product surface without adding server-side frontend infrastructure. The tradeoff is that authentication, billing, and account management still need to be added before offering the product publicly.

