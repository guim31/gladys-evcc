# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the address of evcc and, when set, its admin password, stored by Gladys in
  the integration configuration (never written under `/data`, never logged);
- under `/data`, only `evcc-structure.json`: the meters, loadpoints and
  vehicle names of the evcc installation, so the devices stay listed while
  evcc is off;
- network: plain HTTP and websocket to the configured evcc address on the
  local network, nothing else. `/api/state` of evcc also returns settings the
  integration never reads nor logs (MQTT, InfluxDB and messaging credentials, EEBUS
  certificate): they are dropped as soon as the state is read.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and evcc, the chargers and vehicles it controls.
