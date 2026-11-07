# Security policy

## Reporting a vulnerability

Please report security issues **privately** through GitHub's security advisories:
<https://github.com/soulsimulation/souls/security/advisories/new> (repository **Security** tab → **Report a
vulnerability**). Don't open a public issue, pull request or discussion for a vulnerability.

Include what you found, how to reproduce it (ideally against a local server, see below), and what an attacker could
do with it. We aim to acknowledge reports within a few days and will keep you updated until it is fixed. We are happy
to credit you in the advisory unless you prefer otherwise.

## Scope

In scope: this repository's code and the service it runs at `sim.eden.art`, in particular

- world isolation: reading or changing a world, Soul or god session you don't own;
- Soul pairing, Soul tokens and god (world creator) credentials;
- account sign-in and authorization;
- uploads and anything served from `assets.eden.art`;
- prompt or instruction injection that makes a Soul's or god's agent act outside what its owner asked;
- the model budget (spending beyond a world's limit);
- secrets or personal data exposed by the code, its logs or its history.

Out of scope: denial of service by volume, social engineering, and issues in third-party services or dependencies
that are already public upstream (please report those upstream).

## Testing safely

Test against a local server (`BRAIN_MODE=fake DEV_AUTH=1`, see [docs/development.md](docs/development.md)), not the
live site. Never test against real people's worlds, Souls or accounts, and never access, change or keep their data.
If you hit someone else's data by accident, stop and tell us in your report.
