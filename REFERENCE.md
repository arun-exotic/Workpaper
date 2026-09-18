For the *OBLIQ.in FE-2 Evaluation*, you can use the following publicly available *synthetic datasets* as sample/test data.

These are not mandatory — you can also create your own mock data. Please *do not use real client, bank or financial information*.

 1. Indian Synthetic Bank Statements

🔗 https://huggingface.co/datasets/AgamiAI/Indian-Bank-Statements

*What it contains:*
Synthetic Indian business bank statements in PDF/structured formats, including transactions such as UPI, NEFT, IMPS and RTGS.

*Why use it:*
Useful for testing how your system handles financial documents and bank statements.

*How it can help in the task:*
You can use a statement as a client document and implement:
`Upload → Review → Correction → Approval → Audit History`

---

 1. Synthetic Indian Finance Data

🔗 https://github.com/AnujSureshkumar/synthetic-finance-data

*What it contains:*
Synthetic Indian invoices, GST-related data, GSTR-2B, purchase registers, TDS and other financial records.

*Why use it:*
It provides realistic-looking but synthetic Indian business documents.

*How it can help in the task:*
You can use invoices/purchase registers/GST documents to create different document states such as:
`Pending → Uploaded → Under Review → Correction Required → Approved`

You can also use the mismatched records to demonstrate how your system handles a document requiring correction.

---

 3. Invoice Sandbox Benchmark

🔗 https://github.com/ciru-ai/invoice-sandbox-benchmark

*What it contains:*
Synthetic invoice PDFs along with related business/operational data and deliberately created edge cases.

*Why use it:*
Useful if you want additional invoice/document variety for testing.

*How it can help in the task:*
You can test document upload, metadata, review, correction and audit-log workflows with different invoice cases.

---

 4. LedgerBridge — Synthetic Business Data

🔗 https://github.com/PearlThoughts/LedgerBridge

*What it contains:*
Synthetic Indian business financial data including bank exports and other bookkeeping-related files.

*Why use it:*
Useful for experimenting with structured financial data alongside uploaded documents.

*How it can help in the task:*
You can use CSV/XLS/XLSX data as supporting records for a client and demonstrate how your system handles document/data workflows.

---

 What should you actually use?

You *do not need to download or process the entire datasets*.

For this evaluation, keep the scope small.

A good setup would be:

*1–2 clients*
↓
*5–10 documents*
↓
*Upload*
↓
*Review*
↓
*Approve / Request Correction*
↓
*Re-upload*
↓
*Audit Trail*

The goal is *not to build an OCR system or analyse thousands of financial records*.

The goal is to demonstrate that you can build a reliable workflow around documents, review, correction, approval and traceability.
You are free to choose your own dataset, generate mock data, or use a combination of these resources.

*Please remember:* These datasets are only test data. Do not upload or use any real person's/client's financial information in your project.

Good luck with the evaluation! 🚀

