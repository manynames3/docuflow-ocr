# API Examples

The customer API uses a Cognito access token. Sign in through the frontend and set the token obtained by its OAuth session. API ownership always comes from the verified token subject; do not send an `owner_id` in the request body.

```bash
export API_BASE="$(terraform -chdir=infra output -raw api_base_url)"
export ACCESS_TOKEN="<Cognito access token from a signed-in session>"
export INVOICE="./invoice.pdf"
```

## Create An Upload

Send a fresh idempotency key for each new invoice submission. Reuse the key only to retry the same submission.

```bash
FILE_SIZE="$(wc -c < "$INVOICE" | tr -d ' ')"
FILE_SHA256="$(shasum -a 256 "$INVOICE" | awk '{print $1}')"
BODY="$(jq -n --arg filename "$(basename "$INVOICE")" \
  --arg content_type application/pdf --argjson file_size "$FILE_SIZE" \
  --arg sha256 "$FILE_SHA256" \
  '{filename:$filename,content_type:$content_type,file_size:$file_size,sha256:$sha256}')"
UPLOAD_RESPONSE="$(curl -fsS -X POST "$API_BASE/uploads" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -H "idempotency-key: $(uuidgen)" \
  -d "$BODY")"
export JOB_ID="$(jq -r .job_id <<<"$UPLOAD_RESPONSE")"
```

The response includes a short-lived `upload_url` and `upload_fields`. Submit the returned fields and file as `multipart/form-data`:

```bash
UPLOAD_URL="$(jq -r .upload_url <<<"$UPLOAD_RESPONSE")"
declare -a FORM_ARGS=()
while IFS=$'\t' read -r key value; do
  FORM_ARGS+=(--form-string "$key=$value")
done < <(jq -r '.upload_fields | to_entries[] | [.key, .value] | @tsv' <<<"$UPLOAD_RESPONSE")
curl -fsS "$UPLOAD_URL" "${FORM_ARGS[@]}" --form "file=@$INVOICE"
```

The checksum is bound into the job and S3 upload policy. If the browser closes or the upload response is lost, reselect the same invoice; the workspace resumes the existing job. The API also supports this directly:

```bash
curl -fsS -X POST "$API_BASE/jobs/$JOB_ID/upload-url" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"sha256\":\"$FILE_SHA256\"}"
```

This returns `upload_required: false` if the exact file is already stored, or a new short-lived upload form if it is not. A different file checksum is rejected.

## Start And Check Processing

```bash
curl -fsS -X POST "$API_BASE/jobs/$JOB_ID/start" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" -d '{}'

curl -fsS "$API_BASE/jobs/$JOB_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

`POST /jobs/{job_id}/start` is safe to repeat: an already-running workflow returns its current status. Job states include `CREATED`, `PROCESSING`, `COMPLETED`, `NEEDS_REVIEW`, `FAILED`, `APPROVED`, and `REJECTED`.

## Review, Correct, And Approve

```bash
curl -fsS "$API_BASE/jobs" -H "authorization: Bearer $ACCESS_TOKEN"
curl -fsS "$API_BASE/jobs/$JOB_ID/document" -H "authorization: Bearer $ACCESS_TOKEN"
curl -fsS "$API_BASE/jobs/$JOB_ID/history" -H "authorization: Bearer $ACCESS_TOKEN"

curl -fsS -X PATCH "$API_BASE/jobs/$JOB_ID/review" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"corrected_fields":{"total_amount":"421.19"}}'

curl -fsS -X POST "$API_BASE/jobs/$JOB_ID/decision" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"decision":"APPROVE"}'
```

The document endpoint returns a five-minute signed preview URL. Extracted fields include confidence and, when available, source page and bounding-box coordinates.

## Export Or Delete

```bash
curl -fsS "$API_BASE/exports/invoices.csv" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -o docuflow-invoices.csv

curl -fsS -X DELETE "$API_BASE/jobs/$JOB_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

CSV contains approved invoices only, with saved corrections taking precedence. An empty export contains headers only. Deletion is rejected while processing is active; if storage cleanup is temporarily unavailable, retry the deletion request.
