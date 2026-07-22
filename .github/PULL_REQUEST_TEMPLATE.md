## What changed

Normative specification sections and roadmap phase:

## Evidence

- [ ] Read and followed [`docs/PRODUCT_SPECIFICATION.md`](../docs/PRODUCT_SPECIFICATION.md)
- [ ] `pnpm check`
- [ ] `pnpm audit --audit-level high`
- [ ] `pnpm smoke` (or reason it is not applicable)
- [ ] `pnpm pack` and package-import check
- [ ] Broken fixture and correct control added/updated
- [ ] Relevant real-world project/case study rerun when behavior discovery or execution changed
- [ ] Product status/roadmap/changelog updated when their facts changed
- [ ] No credentials, auth state, or sensitive reports committed
- [ ] Third-party notice updated when a dependency/source was added

## Detector/contract compatibility

Describe any change to detector codes, verdicts, evidence schema, behavior contracts, or CLI output.

## Release-gate impact

List the applicable gates from specification §29, including environment validity, cleanup, schema compatibility, artifact secret safety, browser/OS coverage, and external case-study evidence. Any gate not yet implemented must leave the capability marked `PARTIAL`.
