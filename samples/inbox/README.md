# Simulated AP inbox

This folder represents the email intake layer of the agent. Each manifest entry is one synthetic message that the UI presents in the inbox on the left. The real product would replace this fixture with a Gmail, Outlook, or IMAP connector.

The ten threads cover the evaluation set described in [`../autoparts/README.md`](../autoparts/README.md): duplicate resubmissions, recurring parts, corrected invoices, missing POs, credit memos, revised quantities, and low-confidence scans.

The attachments and reference documents are explicitly linked to `samples/autoparts/` in `manifest.json`. The editable email bodies live in `fixtures/inbox/`; this folder contains only the manifest and the explanation of the intake contract.

The application currently loads these as local fixtures so a reviewer can clone the repository and see an inbox immediately. The manifest is the source of truth for the expected outcome of each case.
