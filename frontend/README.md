# DocuFlow Customer Interface

React/Vite Accounts Payable workspace served from Cloudflare Pages. It uses Cognito for account access and the authenticated API for uploads, processing status, review, document history, and CSV export. It has no synthetic record mode.

## Local Setup

Copy `.env.example` to `.env.local` and set the API URL plus Cognito auth domain and public app client ID from Terraform outputs. The Cognito callback and API/S3 CORS origins must include the browser origin.

```bash
npm install
npm run dev
npm run build
```

If account or processing configuration is missing, the app shows that the service is unavailable and disables the corresponding account actions.

## Cloudflare Pages

- Build command: `npm run build`
- Build output: `dist`
- Configure `VITE_API_BASE_URL`, `VITE_COGNITO_AUTH_DOMAIN`, and `VITE_COGNITO_CLIENT_ID` as build environment variables. `VITE_COGNITO_REDIRECT_URI` is optional and defaults to the current site origin plus `/auth/callback`.
- The GitHub workflow deploys only when product configuration and Cloudflare credentials are present.
