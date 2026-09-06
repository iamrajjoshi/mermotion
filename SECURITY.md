# Security policy

Mermotion renders user-authored Mermaid and motion source inside a network-disabled browser realm.
The website keeps drafts in the browser, and exports stay on the device. It has no account system,
application server, or hosted project store.

## Report a vulnerability

Use [GitHub's private vulnerability report](https://github.com/iamrajjoshi/mermotion/security/advisories/new)
for bugs that could expose local data, bypass renderer isolation, execute active content in an
export, or make an unexpected network request. Include a minimal input file, the affected command or
browser, and the impact you observed. Please don't open a public issue until a fix is available.

For ordinary crashes, malformed output, or feature requests without a security impact, use the
[public issue tracker](https://github.com/iamrajjoshi/mermotion/issues).

## Supported versions

Security fixes target the latest release and the current `main` branch. Older prereleases aren't
maintained separately.
