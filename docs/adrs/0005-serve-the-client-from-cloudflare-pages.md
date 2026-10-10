# ADR 0005: Serve The Client From Cloudflare Pages

## Status

Accepted

## Context

The customer interface is a static React application. It needs a public HTTPS origin for Cognito redirects and browser access to API Gateway and signed S3 uploads, without maintaining a server-rendering tier.

## Decision

Build the React/Vite frontend to static assets and serve them from Cloudflare Pages. Provide the API URL and Cognito public client configuration at build time. If those values are missing, show an explicit unavailable state; do not generate sample jobs or simulated OCR results.

## Consequences

Static hosting has no application server to maintain. Each production build must use values matching the deployed Cognito callbacks, API CORS origins, and S3 CORS origins. Account access and processing remain unavailable until those services are deployed and configured.
