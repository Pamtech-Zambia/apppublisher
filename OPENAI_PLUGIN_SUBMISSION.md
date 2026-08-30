# OpenAI Plugin Submission Checklist

This repository is intended to back a public MCP plugin submission.

## Before submission

- Deploy this repository to a public HTTPS production domain.
- Use the production MCP URL ending in `/api/mcp`.
- Keep Google Play write/publish operations disabled in the public service unless a future architecture and policy review explicitly supports them.
- Prepare a public website, support URL, privacy policy URL, and terms URL.
- Prepare a production logo and listing descriptions.
- Verify the publisher identity in the OpenAI Platform organization that will submit the plugin.
- Ensure the submitter has Apps Management **Write** permission.
- Prepare at least five positive and three negative reviewer test cases.
- Confirm each MCP tool's annotations accurately describe real behavior.

## MCP review

Use the OpenAI plugin submission portal and choose **With MCP**. For this project, use a **Universal** MCP URL unless OpenAI explicitly approves a template URL.

When the portal requests domain verification, serve the exact challenge token at:

`https://YOUR-DOMAIN/.well-known/openai-apps-challenge`

Then use **Scan Tools**, fix every validation issue, deploy the correction, and scan again.

## Truthfulness requirement

The plugin must never fabricate Android app behavior, privacy/data-safety declarations, affiliations, permissions justifications, screenshots, or Google Play listing claims. Inferred functionality is not publishable until corroborated.

## Final submission

Complete listing information, starter prompts, tests, country availability, release notes, and policy attestations. Submit for review. Approval does not automatically publish the plugin; after approval, publish the approved version from the OpenAI Platform portal.

Always re-check current OpenAI documentation immediately before submitting because submission requirements can change.
