# Test Documents

Never commit real customer invoices or private records.

There are no customer-facing sample records. The frontend does not substitute synthetic OCR results when the API is unavailable. Test evidence lives under `src/tests/fixtures/`; the synthetic OCR response is hand-authored, and the controlled invoice image is explicitly fictional. Neither is a customer invoice or a general OCR accuracy claim.

The controlled invoice image can be sent as a single page to Textract for a paid service check. Do not put real customer data in tests or logs. The result of that check, if run, must be recorded separately from the hand-authored response fixture.
