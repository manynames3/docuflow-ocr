# DocuFlow OCR Frontend

Cloudflare Pages frontend for DocuFlow OCR. It is a React/Vite product surface for accounts payable invoice intake, OCR status, Accounts Payable field review, recent invoices, and customer-facing plans.

## Modes

- Demo mode: used when `VITE_API_BASE_URL` is empty. This is useful for hiring-manager walkthroughs without deploying AWS.
- Live API mode: used when `VITE_API_BASE_URL` points at the deployed API Gateway URL.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Cloudflare Pages

Build command:

```bash
npm run build
```

Build output directory:

```text
dist
```

Optional environment variable:

```text
VITE_API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com
```
