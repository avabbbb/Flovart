# Release Candidate Performance Evidence

## Reference environment

- OS: Windows 11 `10.0.26200`
- CPU: Intel i5-11400H, 12 logical processors
- Memory visible to the process: 15.65 GiB
- Browser: Chrome for Testing
- Chrome executable: `C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe`
- WebUI port: `3795` for the run below; dynamically allocated
- Console/page errors: `0`

The browser run used a fresh persistent profile, started the source WebUI with
`--web-port=0 --no-open --no-browser-agent`, and reloaded the real `/#/app`
page 30 times. It did not use Edge or the Windows default browser. The
launcher-owned WebUI process and the isolated browser profile were removed
afterward.

## Canvas load baseline

The separate visible-Chrome Canvas fixture run loaded deterministic local
Workflow graphs through the actual UI:

| Fixture | Nodes | Edges | Load to all nodes | JS heap after render |
| --- | ---: | ---: | ---: | ---: |
| Small | 100 | 99 | 1,258 ms | 63.5 MiB |
| Medium | 300 | 299 | 1,565 ms | 115.5 MiB |
| Large | 500 | 499 | 2,365 ms | 134.1 MiB |

The 500-node fixture reload baseline over 20 runs was median `2,091 ms`, p95
`3,059 ms`, worst `3,059 ms`, with zero console/page errors. These are local
comparison baselines, not universal product budgets.

## Refresh and memory probe

The 30-cycle Chrome run measured both the full Chrome process tree and the
active page heap after `window.gc()` when available:

| Metric | First sample | Peak | Final | Final delta |
| --- | ---: | ---: | ---: | ---: |
| Chrome working set | 530.1 MiB | 741.0 MiB | 723.6 MiB | +193.5 MiB |
| Chrome private bytes | 331.6 MiB | 568.5 MiB | 541.6 MiB | +210.0 MiB |
| Page JS heap after GC | 28.2 MiB | 47.2 MiB | 38.3 MiB | +10.2 MiB |

The page heap reached its steady range by the sixth cycle and stayed near
`40 MiB` through cycle 30; the isolated peak at cycle 5 fell back after the
next reload. There was no observed monotonic page-heap increase after warm-up,
and the page title remained `Flovart` throughout the run.

The Chrome process-tree values include Chromium browser, renderer, GPU and
utility processes and are therefore a workstation/browser baseline rather than
an application-retained-object measurement. This run closes the previously
missing local retained-heap observation but is not a substitute for a formal
Windows Performance Recorder/OS-level profile on a release machine.

## Interpretation

- Local 100/300/500-node Canvas load and interaction baselines are recorded.
- Thirty real page reloads completed without page or console errors.
- No application-level linear JS heap growth was observed after warm-up.
- Fifty Browser bind/unbind cycles completed with 50/50 client releases; the
  steady-state bind p95 was 1,408 ms after two explicitly recorded cold-start
  outliers.
- Fifty source WebUI launcher cycles completed with 50/50 real WebUI marker
  checks and 50 unique dynamic ports. Startup median was 2,685 ms, p95 was
  2,899 ms and worst was 3,120 ms; no browser was opened during this loop.
- Ten isolated NSIS install/uninstall repetitions completed with `10/10`
  roots removed. The elapsed median was 3,383 ms, p95 3,421 ms and worst
  3,637 ms; the installed application was not launched in this repetition.
- The staged NSIS application was launched 20 times in a separate isolated
  profile harness and reached a visible main window in `20/20` runs, with
  graceful close every time. Ten independent-profile cold starts measured
  median `117 ms`, p95 `123 ms`, worst `126 ms`; ten same-profile warm restarts
  measured median `113 ms`, p95 `121 ms`, worst `128 ms`. These timings measure
  main-window readiness, not Canvas readiness or first-paint Web Vitals.
- No absolute LCP/INP/CLS claim is made; this is a local desktop Canvas path,
  not a production Web Vitals collection run.
- Future performance changes must compare against these same browser/profile
  conditions and prove a bottleneck before changing architecture.

## Installed Desktop launch baseline

The staged unsigned NSIS package was installed into a temporary directory and
launched through a PowerShell `ProcessStartInfo` harness. The harness directed
`APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, Runtime/Agent discovery paths and
`WEBVIEW2_USER_DATA_FOLDER` to validated temporary profiles. It measured the
time from process start until the real Tauri main-window handle appeared, then
closed the app gracefully.

```text
launches: 20/20 ready
graceful closes: 20/20
cold: 10 independent profiles, median/p95/worst = 117/123/126 ms
warm: 10 same-profile restarts, median/p95/worst = 113/121/128 ms
```

This is a desktop window-readiness baseline, not a Canvas-ready or Web Vitals
measurement. The installed executable was the local unsigned RC package; no
Edge or other external browser was opened.
