# Security Policy

## Branch Protection

`main` branch is protected:

| Setting | Value |
|---|---|
| Require pull request before merging | ✅ Enabled |
| Required approving reviews | 1 |
| Dismiss stale reviews | ✅ |
| Enforce for admins | ✅ |
| Allow force pushes | ❌ Blocked |
| Allow branch deletion | ❌ Blocked |

## Secret Scanning

Secret scanning is **enabled** on this repository. If a secret (e.g. API key, token, credentials) is committed to any branch, GitHub will:

1. Alert repository administrators via email
2. Block pushes containing known secret patterns (if push protection is enabled)

If you accidentally committed a secret:
1. Remove it from the commit history — see [GitHub's guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-commit)
2. Rotate the exposed secret immediately

## Dependencies

[Dependabot security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates) is **enabled**. Dependabot will automatically open pull requests to update vulnerable dependencies when security advisories are published.

## Reporting a Vulnerability

Please do not report security vulnerabilities in the public issue tracker.
Instead, contact the repository maintainer directly if you discover a security issue in the weather/calendar integration code or its dependency chain.
