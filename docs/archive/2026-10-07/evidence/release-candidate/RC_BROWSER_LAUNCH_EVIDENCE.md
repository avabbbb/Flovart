# Browser Launcher and Port Isolation Evidence

## Current acceptance method

Automated browser acceptance does not call the Windows system URL handler and
does not open Edge. It launches the installed Chrome for Testing executable
with an isolated profile, while the Flovart launcher runs with:

```text
--no-open --web-port=0 --agent-port=0
```

The WebUI and Browser Agent therefore receive fresh loopback ports for each
run. `37522` and `17373` remain preferences used by compatibility probes, not
fixed test addresses.

## Current working-tree recheck

The Playwright smoke was run through the Playwright skill after its dev-server
detection returned no pre-existing server. It started the source launcher,
opened the page directly in Chrome for Testing, then navigated to a separate
one-time bootstrap URL built from the discovered Agent connection.

```text
browser: Chrome for Testing
executable: C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe
WebUI: http://127.0.0.1:10588
Agent: http://127.0.0.1:10613
plain origin: clients=0, hasWorkflow=false
bootstrap origin: clients=1, hasWorkflow=true
title: Flovart
connected indicator: present
console/page errors: 0
```

The test created its own temporary Agent configuration and browser-launch
state, then closed the browser and terminated only its launcher-owned process
trees. No listener remained on `37522`, `17373`, `10588` or `10613`. No Edge
process was created by this run.

## Product boundary

Normal user-facing `--open` may still follow the operating system's default
browser. This is intentional product behavior. Automated validation must use
the isolated Chrome path above so a user's Edge windows and stale URL-handler
tabs cannot affect the result.

The plain WebUI origin is intentionally not a Browser binding. A valid
bootstrap handoff is required to establish the current Workflow Writer; this
prevents an old or unrelated local page from being mistaken for a connected
Canvas.

## Fifty-cycle bind/unbind soak

Using the same Chrome for Testing executable and dynamic-port launcher, a
second smoke created 50 isolated browser contexts. Each context opened a
one-time bootstrap URL, waited for `clients > 0` and `hasWorkflow=true`, then
closed and waited for the Agent client count to return to zero.

```text
WebUI: http://127.0.0.1:10031
Agent: http://127.0.0.1:4287
bindings: 50/50
released after close: 50/50
bind median: 1,122 ms
bind p95: 1,408 ms
bind worst: 23,287 ms
page title failures: 0
console error cycles: 0
final clients: 0
```

The only bind values above 3 seconds were cycle 1 (`23,287 ms`) and cycle 2
(`15,317 ms`), both cold-start/browser warm-up cycles; cycles 3–50 stayed
within the reported steady-state p95. The outliers remain recorded rather
than hidden. No Edge process was used and no listener remained on the dynamic
ports or on the preferred `37522`/`17373` ports after cleanup.

## Reusable repository smoke

The repository now exposes `npm run test:browser:chrome` so automated runs do
not need to invoke `start --open` or the Windows default browser. The command
owns a temporary Agent config, WebUI discovery file, browser-launch marker and
Chrome profile; it starts with `--no-open --web-port=0 --agent-port=0`, then
opens the one-time bootstrap URL through Playwright Chrome for Testing.

Latest run:

```text
browser: Chrome for Testing (chromium-1223)
WebUI: http://127.0.0.1:10482
Agent: http://127.0.0.1:3842
browserConnected: true
clients: 1
hasWorkflow: true
final URL: http://127.0.0.1:10482/#/app
console/page errors: 0
fixed listeners after cleanup: 37522=0, 17373=0, 1635=0
```

The Docker path was corrected separately: Compose publishes the Web service at
`1635` by default, not `37522`, and `start --docker --open` now resolves and
opens the actual dynamically selected host port. The Compose config passed with
default and overridden ports.

## Latest Chrome-only recheck after RC environment alignment

The current working tree reran `npm run test:browser:chrome` after the Docker
runtime image was aligned with the repository Node requirement. The harness
again used Chrome for Testing, skipped the Windows default browser, and started
with `--no-open --web-port=0 --agent-port=0`.

```text
browser: Chrome for Testing (chromium-1223)
WebUI: http://127.0.0.1:3594
Agent: http://127.0.0.1:4099
browserConnected: true
clients: 1
hasWorkflow: true
final URL: http://127.0.0.1:3594/#/app
console/page errors: 0
fixed listeners after cleanup: none on 37522/17373/1635
```

The test-owned launcher and browser profile were cleaned after the run; no
Edge process was created.

## Latest current-worktree recheck

The same Chrome-only smoke was rerun after the final port-plan and test
regressions. It used a fresh isolated profile and dynamic ports:

```text
browser: Chrome for Testing (chromium-1223)
WebUI: http://127.0.0.1:11290
Agent: http://127.0.0.1:11291
browserConnected: true
clients: 1
hasWorkflow: true
final URL: http://127.0.0.1:11290/#/app
console/page errors: 0
fixed listeners after cleanup: none on 37522/17373/1635/11290/11291
```

The runner did not invoke the Windows URL handler or open Edge.

## Clean candidate smoke

The same harness was run from clean candidate
`7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306` after fresh root and DSH installs.
The isolated rerun passed:

```text
browser: Chrome for Testing (chromium-1223)
WebUI: http://127.0.0.1:5226
Agent: http://127.0.0.1:7380
browserConnected: true
clients: 1
hasWorkflow: true
final URL: http://127.0.0.1:5226/#/app
console/page errors: 0
fixed listeners after cleanup: none
```

One run started concurrently with the full clean test/build load reached the
Vite-ready state but exceeded the 30-second navigation timeout. The isolated
rerun completed in 8.5 seconds; the failure is retained as a resource
contention observation, not suppressed by retry logic.
