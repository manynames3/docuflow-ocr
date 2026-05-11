# Samples

Do not commit real customer documents or private records.

For a demo, create a small synthetic PDF or image with fields such as:

```text
Vendor Name: Acme Services
Invoice Date: 2026-05-01
Total Amount: $421.19
Email: billing@example.com
Case Number: CASE-1001
```

Save it as `samples/sample-invoice.pdf` before running the README demo commands. The unit tests use a mock Textract JSON fixture instead of calling AWS.

