# Catalog fixtures

Public catalog fields only, reduced from the owner-observed 2026-10-22
Sony STR-DG720 download and anonymous model-check/discovery responses.
No account response, cookies, credentials, timestamps or personal device list
are recorded. OAuth and Harmony signin replies are synthetic in the tests.

The response wrappers exercise the helper's supported wire shapes. Discovery
omits GetGlobalLanguageCommands to test its GetCommands-sibling fallback.
SmartKey / RC6 Mode 0 is deliberately synthetic, to exercise skipped codes;
it is not a claim about the Sony receiver's command set.
