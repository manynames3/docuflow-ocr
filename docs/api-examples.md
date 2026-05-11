# API Examples

Set the API URL after deployment:

```bash
export API_BASE="$(terraform -chdir=infra output -raw api_base_url)"
```

## Create Upload

Request:

```bash
curl -s -X POST "$API_BASE/uploads" \
  -H "content-type: application/json" \
  -d '{
    "filename": "sample-invoice.pdf",
    "content_type": "application/pdf",
    "owner_id": "demo"
  }'
```

Response:

```json
{
  "job_id": "00000000-0000-0000-0000-000000000000",
  "document_id": "00000000-0000-0000-0000-000000000000",
  "upload_url": "https://...",
  "upload_method": "PUT",
  "upload_headers": {
    "content-type": "application/pdf"
  },
  "raw_s3_key": "raw/demo/00000000-0000-0000-0000-000000000000/sample-invoice.pdf",
  "expires_in_seconds": 900
}
```

Upload:

```bash
curl -X PUT "$UPLOAD_URL" \
  -H "content-type: application/pdf" \
  --upload-file samples/sample-invoice.pdf
```

## Start Processing

```bash
curl -s -X POST "$API_BASE/jobs/$JOB_ID/start"
```

```json
{
  "job_id": "00000000-0000-0000-0000-000000000000",
  "status": "PROCESSING",
  "execution_arn": "arn:aws:states:..."
}
```

## Get Job Status

```bash
curl -s "$API_BASE/jobs/$JOB_ID"
```

## Get Extracted Result

```bash
curl -s "$API_BASE/jobs/$JOB_ID/result"
```

Successful extraction includes normalized fields similar to:

```json
{
  "job": {
    "job_id": "00000000-0000-0000-0000-000000000000",
    "status": "COMPLETED",
    "parsed_fields": {
      "vendor_name": {
        "value": "Acme Services",
        "confidence": 98,
        "source_key": "Vendor Name"
      }
    },
    "confidence": {
      "status": "COMPLETED",
      "score": 96.4,
      "review_reasons": []
    }
  }
}
```

## List Review Queue

```bash
curl -s "$API_BASE/review/jobs"
```

## Submit Review Decision

Approve with corrected fields:

```bash
curl -s -X POST "$API_BASE/review/jobs/$JOB_ID/decision" \
  -H "content-type: application/json" \
  -d '{
    "decision": "APPROVE",
    "reviewer": "aiden",
    "corrected_fields": {
      "total_amount": "421.19"
    },
    "comment": "Corrected currency formatting."
  }'
```

Reject:

```bash
curl -s -X POST "$API_BASE/review/jobs/$JOB_ID/decision" \
  -H "content-type: application/json" \
  -d '{"decision":"REJECT","reviewer":"aiden","comment":"Wrong document type."}'
```

