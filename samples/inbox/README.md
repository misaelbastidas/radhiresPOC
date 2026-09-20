# Simulated AP inbox

This folder represents the email intake layer of the agent. Each manifest entry is one synthetic message that the UI presents in the inbox on the left. The real product would replace this fixture with a Gmail, Outlook, or IMAP connector.

The ten threads cover the first evaluation set:

1. Exact resubmission.
2. Duplicate reference message.
3. Legitimate recurring invoice.
4. Corrected invoice.
5. Missing purchase order.
6. Credit memo.
7. Low-risk invoice.
8. Amount changed after an approved quantity change.
9. Monthly recurring maintenance.
10. Low-quality scan.

The application currently loads these as local fixtures so a reviewer can clone the repository and see an inbox immediately. The first three entries link to editable invoice fixtures in the parent `samples/` directory.
