# Controlled Textract Test Evidence

**Result:** Passed
**Run time:** 2026-10-10 18:04 UTC
**Region:** `us-east-1`
**Request ID:** `842a0bef-a949-4db3-b379-02222a65883c`
**Input:** [`controlled_invoice.png`](../../src/tests/fixtures/controlled_invoice.png), a fictional one-page invoice marked as test evidence and not payable
**Operation:** Direct Textract `AnalyzeDocument` request with `FORMS` and `TABLES`; one page submitted

Textract returned one page of text. The response included the expected fictional vendor (`Northstar Test Supplies`), invoice number (`NST-20418`), invoice and due dates, purchase order (`TEST-PO-481`), and total (`$248.00`). Reported line confidence was between 95.66% and 100% for the returned lines.

This verifies one direct Textract OCR request using the controlled fixture. It does not verify the deployed DocuFlow API, S3 upload flow, Step Functions execution, persistence, Cognito sign-in, field normalization, or production accuracy. The hand-authored fixture at `src/tests/fixtures/invoice_textract.json` is separate and is not the response from this run.
