# Sample invoice packs

The canonical runnable corpus is [`autoparts/`](autoparts/). It contains ten simulated inbox cases, fourteen automotive-parts PDFs, and expected outcomes in `manifest.json`. Editable text sources live separately under [`../fixtures/autoparts/`](../fixtures/autoparts/).

To test the harness, clone the repository, run the app, click **Import invoice files**, and select two or more PDFs from `samples/autoparts/pdf/`. Most reviewers can ignore `fixtures/`; it is only needed when changing or regenerating the synthetic corpus.
