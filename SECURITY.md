# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅        |
| < 1.1   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on the repository.

Include as much detail as you can:
- Affected version (see the version in the admin header or `GET /api/config`)
- Steps to reproduce / proof of concept
- Impact and any suggested remediation

You can expect an acknowledgement within a few days. Please allow reasonable
time for a fix before any public disclosure.

## Security Notes for Operators

ADS-Bit is intended for trusted LANs, not direct exposure to the public
internet. If you must expose it:

- Set a strong admin password (changed from the setup default).
- Put it behind HTTPS via a reverse proxy or tunnel (e.g. Caddy, nginx,
  Tailscale). The built-in server speaks plain HTTP.
- Never commit your `config.json` — it contains the admin password hash and
  session secret. It is git-ignored by default; fresh installs start from
  `config.json.example`.
