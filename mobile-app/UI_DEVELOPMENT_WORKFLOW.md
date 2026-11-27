**WaveHouse Mobile UI development workflow — Stage 8**

Verified 17 November 2026 with Windows PowerShell, Expo SDK 57, React Native 0.86.3, React 19.2.3 and Expo Go 57.0.9. This guide establishes the workflow and proposes UI-01; it does not authorize implementation.

**Readiness and scope**

- VS Code already has `D:\DOAN\wavehouseManagement` open. The existing `WaveHouse_Pixel4a_API36` and Metro are running; reuse them.
- ADB serial is `emulator-5554`; Android 16/API 36 boot is complete. Metro listens on IPv4 loopback `127.0.0.1:8081`, with `tcp:8081` reversed through ADB.
- Expo Go visibly shows Fast Refresh enabled. Connected clients and normal non-CI Metro operation are present. Manual Reload returned to Catalog Home. An edit-to-screen Fast Refresh roundtrip remains pending the first approved source change.
- Observed branch: `test`. The preexisting `mobile-app/package-lock.json` repair has 37 insertions and no deletions; preserve it. Do not switch branches, stage, commit, push, merge, restore or reset files automatically.
- The laptop has about 8GB RAM. Use one AVD, 2 cores, effective 2560MB guest RAM, automatic graphics, WHPX, no snapshots and one Metro worker. Evaluate available RAM, commit headroom and actual responsiveness together. Pause or stop this development session if pressure becomes critical; never close other applications or change Windows settings automatically.
- Mobile app source changes require explicit task approval. Backend, Web, AI Service, Database and root project configuration remain outside the editing scope. No dependency changes are authorized.

**1. Open the project and inspect the existing session**

Use a normal PowerShell window or VS Code terminal. Run the editor command only when the project is not already open:
```powershell
code.cmd --reuse-window 'D:\DOAN\wavehouseManagement'
```

Read-only preflight:
```powershell
Set-Location 'D:\DOAN\wavehouseManagement'
git branch --show-current
git status --short --untracked-files=all
Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | ForEach-Object {
    [pscustomobject]@{
        AvailableRAMMiB = [math]::Round([double]$_.AvailableBytes / 1MB, 1)
        CommitHeadroomMiB = [math]::Round(([double]$_.CommitLimit - [double]$_.CommittedBytes) / 1MB, 1)
    }
}
& 'C:\Android\Sdk\platform-tools\adb.exe' devices -l
& 'C:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 get-state
& 'C:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 shell getprop sys.boot_completed
& 'C:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 emu avd name
Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
$wavehouseListenerOwners = @(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($wavehouseListenerPid in $wavehouseListenerOwners) {
    Get-CimInstance Win32_Process -Filter ("ProcessId=" + $wavehouseListenerPid) |
        Select-Object ProcessId, ExecutablePath, CommandLine
}
curl.exe --silent --show-error --max-time 3 http://127.0.0.1:8081/status
```

`device`, boot property `1`, exact AVD name `WaveHouse_Pixel4a_API36`, and `packager-status:running` are healthy results. An occupied port alone does not establish that the process belongs to WaveHouse. Inspect its command line before reusing or stopping it. If the correct emulator and Metro are already healthy, skip their startup blocks.

**2. Start the existing AVD only when stopped — terminal A**

This does not create or change an AVD. Run only after the resource check:
```powershell
$wavehouseEmulator = 'C:\Android\Sdk\emulator\emulator.exe'
$wavehouseAdb = 'C:\Android\Sdk\platform-tools\adb.exe'
$wavehouseEmulatorProcesses = @(Get-CimInstance Win32_Process |
    Where-Object { $_.Name -in @('emulator.exe', 'qemu-system-x86_64.exe') })
$wavehouseRunningAvd = @($wavehouseEmulatorProcesses |
    Where-Object { $_.CommandLine -match '\bWaveHouse_Pixel4a_API36\b' })
if ($wavehouseRunningAvd.Count -eq 0) {
    if ($wavehouseEmulatorProcesses.Count -gt 0) { throw 'Another emulator or emulator startup exists; inspect before launching.' }
    $wavehouseOccupiedPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in @(5554, 5555) })
    if ($wavehouseOccupiedPorts.Count -gt 0) { throw 'Emulator ports occupied; inspect before proceeding.' }
    Start-Process -FilePath $wavehouseEmulator -WindowStyle Normal -ArgumentList '-avd WaveHouse_Pixel4a_API36 -memory 2560 -cores 2 -gpu auto -accel on -no-snapshot -port 5554'
} else {
    Write-Output 'Reuse the running WaveHouse AVD.'
}
& $wavehouseAdb -s emulator-5554 get-state
& $wavehouseAdb -s emulator-5554 shell getprop sys.boot_completed
```

Wait until the last two checks return `device` and `1`. Re-run the checks while booting; allow up to three minutes, then inspect emulator/ADB state rather than launching a duplicate. Recheck RAM and commit headroom after boot. The saved AVD requests 2048MB, but this emulator enforces 2560MB at runtime; do not try to bypass that minimum.

**3. Start Metro only when stopped — terminal B**

Use the installed local CLI. The IPv4 preference fixes the verified IPv6-localhost/ADB-reverse download problem. The temporary TypeScript flag prevents automatic config/source generation. Clearing CI applies only to this shell while Metro runs, allowing watch mode:
```powershell
$wavehouseRoot = 'D:\DOAN\wavehouseManagement'
Set-Location (Join-Path $wavehouseRoot 'mobile-app')
if (@(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Port 8081 already has a listener. Verify and reuse the existing Metro instead.'
}
$wavehousePreviousCI = $env:CI
$wavehousePreviousTsSetup = $env:EXPO_NO_TYPESCRIPT_SETUP
$wavehousePreviousTelemetry = $env:EXPO_NO_TELEMETRY
try {
    $env:CI = $null
    $env:EXPO_NO_TYPESCRIPT_SETUP = '1'
    $env:EXPO_NO_TELEMETRY = '1'
    & 'C:\Program Files\nodejs\node.exe' --dns-result-order=ipv4first (Join-Path $wavehouseRoot 'mobile-app\node_modules\expo\bin\cli') start --go --localhost --port 8081 --max-workers 1
} finally {
    $env:CI = $wavehousePreviousCI
    $env:EXPO_NO_TYPESCRIPT_SETUP = $wavehousePreviousTsSetup
    $env:EXPO_NO_TELEMETRY = $wavehousePreviousTelemetry
}
```

Leave this terminal open. No persistent environment variables are changed. Expected output includes `Using src/app as the root directory for Expo Router` and `Waiting on http://localhost:8081`. The four existing Expo patch recommendations may appear; they do not authorize upgrades. Do not start another server on a different port to avoid diagnosing a conflict.

**4. Forward Metro and open WaveHouse — terminal A**
```powershell
$wavehouseAdb = 'C:\Android\Sdk\platform-tools\adb.exe'
& $wavehouseAdb -s emulator-5554 reverse tcp:8081 tcp:8081
if ($LASTEXITCODE -ne 0) { throw 'ADB reverse failed; do not open the app yet.' }
& $wavehouseAdb -s emulator-5554 reverse --list
$wavehouseMetroHealth = & curl.exe --silent --show-error --max-time 3 http://127.0.0.1:8081/status
if ($LASTEXITCODE -ne 0 -or $wavehouseMetroHealth -ne 'packager-status:running') {
    throw 'Metro is not ready; do not open the app yet.'
}
& $wavehouseAdb -s emulator-5554 shell am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8081' -p host.exp.exponent
if ($LASTEXITCODE -ne 0) { throw 'Expo Go open request failed; inspect ADB and the emulator.' }
```

Reapply reverse forwarding after an emulator or ADB restart. If Expo Go retains an old download-error screen, verify the IPv4 listener and forwarding, then use Reload. Dismiss a developer-menu tutorial if it appears. Catalog Home should render. The three list screens currently show an API configuration error because Backend integration is deferred; do not configure APIs or fabricate responses to remove it.

**5. Approved task → Fast Refresh → native review**

1. Agree on task ID, intended behavior, allowed files and acceptance criteria. Establish the current diff and capture the before state. An entry in a proposed roadmap is not permission to implement it.
2. Codex implements only the approved Mobile task. Preserve contracts, controllers and the lockfile unless separately authorized.
3. Save the changed component/style file. Fast Refresh should update the visible screen while Metro remains in watch mode. Some module changes legitimately trigger a full reload or reset local state.
4. If the update does not appear, inspect Metro errors, active project URL, connection and the Fast Refresh toggle. In a foreground Metro terminal press `r`, or use Expo Go Tools → Reload. Restart Metro only when needed; do not reinstall dependencies as a first response.
5. Check intended base/pressed/focus/disabled states, fully visible touch targets, text wrapping, scrolling, keyboard actions, native Back and return links. Document the actual viewport and distinguish Expo/Gboard overlays from app UI.
6. Capture matching after screenshots. Compare the same route, scroll position, input values and viewport to the before evidence.
7. Run relevant checks sequentially to limit RAM use; review the exact diff and provide the task report. Stop for user review before the next implementation task.

Fast Refresh being enabled is verified in Stage 8; source-edit propagation has deliberately not been tested yet. Test it during the first authorized UI implementation. Manual Reload success is a separate observation, not a substitute for the edit-driven check.

**6. Screenshot and touch-bound workflow**

Store screenshots outside the repository. Pull a PNG from Android instead of redirecting binary ADB output through Windows PowerShell:
```powershell
$wavehouseTaskId = 'UI-01'
$wavehouseEvidenceDir = Join-Path ([IO.Path]::GetTempPath()) ('wavehouse-ui-' + $wavehouseTaskId + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $wavehouseEvidenceDir | Out-Null
$wavehouseAdb = 'C:\Android\Sdk\platform-tools\adb.exe'
& $wavehouseAdb -s emulator-5554 shell screencap -p /sdcard/wavehouse-ui-review.png
& $wavehouseAdb -s emulator-5554 pull /sdcard/wavehouse-ui-review.png (Join-Path $wavehouseEvidenceDir 'before-catalog-home.png')
& $wavehouseAdb -s emulator-5554 shell wm size
& $wavehouseAdb -s emulator-5554 shell wm density
& $wavehouseAdb -s emulator-5554 shell settings get system font_scale
```

After the approved change, capture again using `after-catalog-home.png`; use descriptive names for every affected route. Keep the evidence directory path in the task report. Stage 8 screenshots use the same verified ADB capture/pull method.

For target measurement when needed:
```powershell
& $wavehouseAdb -s emulator-5554 shell uiautomator dump /sdcard/wavehouse-ui-review.xml
& $wavehouseAdb -s emulator-5554 pull /sdcard/wavehouse-ui-review.xml (Join-Path $wavehouseEvidenceDir 'after-catalog-home.xml')
```

Measure a fully visible control, not viewport-clipped bounds. At the verified 440dpi density, divide pixel dimensions by 2.75 to obtain dp. Return controls should be at least 48dp high; Home cards retain their defined 56dp minimum. XML accessibility bounds supplement screenshots and interaction checks; they do not establish complete TalkBack coverage.

**7. Review the diff and run relevant checks**
```powershell
Set-Location 'D:\DOAN\wavehouseManagement\mobile-app'
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
Set-Location 'D:\DOAN\wavehouseManagement'
git diff --check
git status --short --untracked-files=all
git diff --stat
git diff -- mobile-app
```

Run checks one at a time and record each exit code. TypeScript, lint and existing tests are appropriate for UI-01. Previous restoration checks passed 428 tests, TypeScript and lint; they were not rerun for this documentation-only stage. Existing Node tests exercise routes/controllers/models/API handling, not native pressed styles, refs or touch geometry. A native UI fix requires device evidence even when automated checks pass.

Preserve the preexisting lock repair and separate it from each task’s new diff. Report unexpected files instead of reverting them automatically. Do not install a new test framework or run version-fix/update commands without approval.

**8. Stop and restart safely**

For a foreground Metro started with step 3, press Ctrl+C in terminal B. Its temporary environment settings are restored by `finally`. Keep the emulator running if only Metro needs restarting.

The current Stage 8 Metro was started in the background. If stopping that server is needed, identify it by port and verify its exact WaveHouse CLI path; never terminate all Node processes:
```powershell
$wavehouseListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue)
$wavehouseOwnerIds = @($wavehouseListeners | Select-Object -ExpandProperty OwningProcess -Unique)
if ($wavehouseOwnerIds.Count -eq 0) {
    Write-Output 'Metro is already stopped.'
} elseif ($wavehouseOwnerIds.Count -ne 1) {
    throw 'Ambiguous listener ownership; inspect manually.'
} else {
    $wavehouseMetroPid = $wavehouseOwnerIds[0]
    $wavehouseMetroProcess = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $wavehouseMetroPid)
    $wavehouseExpectedCli = 'D:\DOAN\wavehouseManagement\mobile-app\node_modules\expo\bin\cli'
    if ($wavehouseMetroProcess.Name -ne 'node.exe' -or
        $wavehouseMetroProcess.CommandLine -notmatch [regex]::Escape($wavehouseExpectedCli) -or
        $wavehouseMetroProcess.CommandLine -notmatch '\sstart(\s|$)') {
        throw 'Port owner is not the expected WaveHouse Metro; leave it running.'
    }
    Stop-Process -Id $wavehouseMetroPid
    Start-Sleep -Seconds 2
}
Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
```

This terminates only the verified background dev server; it is a fallback, not a graceful Ctrl+C substitute. If the port remains occupied, inspect before starting another process. Do not use saved PIDs from a previous session because Windows can reuse them.

Gracefully stop the approved emulator when finished or if safety requires it:
```powershell
$wavehouseAdb = 'C:\Android\Sdk\platform-tools\adb.exe'
$wavehouseAvdIdentity = @(& $wavehouseAdb -s emulator-5554 emu avd name)
if ($LASTEXITCODE -ne 0 -or $wavehouseAvdIdentity -notcontains 'WaveHouse_Pixel4a_API36') {
    throw 'Expected emulator not identified; do not stop a different device.'
}
& $wavehouseAdb -s emulator-5554 emu kill
Start-Sleep -Seconds 3
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -in @('emulator.exe','qemu-system-x86_64.exe') -and $_.CommandLine -match 'WaveHouse_Pixel4a_API36' } |
    Select-Object ProcessId, Name
& $wavehouseAdb devices -l
```

Allow shutdown to complete; inspect lingering processes rather than launching a duplicate. Leave ADB itself and unrelated applications alone. Do not restart Windows or alter virtualization/security/memory settings.

**Metro restart:** stop Metro using the appropriate method, confirm port 8081 is free, repeat step 3, then reapply step 4. **Full development-session restart:** stop Metro, gracefully stop the approved AVD, recheck resources, repeat steps 2–4. These restart/stop commands were documented and syntax-checked; healthy running processes were not restarted merely to exercise them in Stage 8.

**9. UI-first priorities — proposed work, not authorization**

| Order | Task | Scope and verification |
|---|---|---|
| 1 | UI-01: restore navigation target styles | Shared accessible target; Home/return styles, pressed feedback and target sizing; no mocks needed |
| 2 | Explicit development-only scenarios | Opt-in client-factory context for populated/loading/empty/error/detail/reference scenarios; no global fetch patch or automatic real-network fallback |
| 3 | Complete visual verification of existing Catalog | Use approved scenarios for Ingredients, Products and Recipes data/detail/long-value layouts; retain current UUID/decimal/status/envelope contracts |
| 4 | Improve employee workflows and reusable UI | Compact hierarchy/filters, product selection for Recipes, contextual labels, shared fields/feedback/pagination; preserve existing query semantics |
| 5 | Accessibility and responsive matrix | Narrow widths, enlarged text, docked keyboard/gesture Back, TalkBack, focus, outlines and scrolling |
| Later | Additional Mobile screens | Confirm staff roles, screen requirements and ownership before scheduling receiving, transfers, stock adjustment, authentication or AI UI |

Scenario support is not implemented. Existing client/controller injection seams are suitable; list providers and detail hooks must select the same explicit development transport. Do not mix synthetic data into production API logic, hide actual failures, or present minStock as current on-hand inventory. Backend integration remains deferred.

For a later approved scenario task, keep fixtures and scenario transport in a dedicated development module, for example `src/dev/catalog-scenarios/`, selected at the composition boundary with `__DEV__` plus explicit opt-in and disabled by default. The production API client must not import fixtures or fall back to them. Cover normal/long success, loading, empty, recoverable error, detail not-found, pagination and partial reference failures with contract-shaped UUIDs, decimal strings and envelopes. Verify production mode cannot activate the development provider; do not assume a flag alone proves fixture code is excluded from a production bundle. No scenario code or data is added by Stage 8.

**10. Detailed UI-01 proposal — awaiting approval**

Problem: `Link asChild` around a Pressable style callback loses base/pressed container styles in the installed Router/Slot/Radix composition. Home destinations appear as plain text; measured return targets are 24–26dp high. Existing styles already define the intended appearance and 48/56dp minimum heights.

| Source file proposed for UI-01 | Change |
|---|---|
| `src/components/CatalogNavigationTarget.tsx` — new | One typed Router-compatible native target |
| `src/navigation/CatalogPlaceholder.tsx` | Replace the immediate slotted target in CatalogLink |
| `src/ingredients/IngredientScreens.tsx` | Replace NavigationLink and IngredientCard detail targets |
| `src/products/ProductScreens.tsx` | Replace NavigationLink and ProductCard detail targets |
| `src/recipes/RecipeScreens.tsx` | Replace NavigationLink and RecipeCard detail targets |

These five files cover seven current Link-asChild definitions. No route, controller, API, style-token, manifest or lockfile edits should be needed.

Design requirements:

- Derive native target props from React’s `ComponentPropsWithRef<typeof Pressable>`, excluding its callback-style signature. Use dedicated `baseStyle` and `pressedStyle` props of `StyleProp<ViewStyle>`. Account separately for the optional static style object injected by Slot; do not accept a public callback or array on the immediate child’s `style` prop.
- Build the Pressable style callback inside the wrapper. The immediate Slot child must not expose a callback or style array through its `style` prop. Custom style props can safely hold existing style objects/arrays.
- Compose any static Slot-injected style with the base style inside that callback, with pressed style applied last. Current links inject no meaningful parent style, but silently discarding an injected style would make the shared component fragile.
- React 19 supports a typed ref prop; forward it directly to native Pressable. Explicit forwardRef is also supported if needed. Preserve Router-injected handlers, ref, href/role/accessibility/focus props and event/preventDefault behavior. Remove custom style props before passing native props.
- Keep existing Link href/dismissTo, labels, roles, hit slop and text children unchanged. Do not replace Router navigation with manual router calls or patch node_modules.
- Reuse current style objects. Role normalization, copy polish, broad component extraction, scenario support and dependency upgrades are separate tasks.

Acceptance and validation:

1. Capture matching before evidence and fully visible native target bounds.
2. After explicit approval and implementation, observe save-driven Fast Refresh. Home surfaces/borders/padding/internal gaps reappear; pressed styling works.
3. Verify Home card minimum 56dp and feature return target minimum 48dp; preserve visible Tab focus/Enter, native Back and unavailable-route recovery.
4. Check affected visible lists and restore Home. Record populated detail-card actions as pending until approved scenario data is available.
5. Run existing tests, TypeScript and lint sequentially; inspect the five-source-file diff and unchanged manifest/lockfile. No test framework installation or implementation-mirroring/source-string tests are warranted.

Material risks: dropped ref/events, accidental navigation changes, incorrect style precedence, or restored padding increasing scrolling. Native evidence is essential; the old 428 passing Node tests do not validate those native behaviors.

**11. Required report for each approved UI task**

```text
Task ID and approved description:
Outcome and remaining work:
Files modified (include exact source links):
Screens and states affected:
Before/after evidence paths and viewport/density/font scale:
Fast Refresh: observed / not tested, with reason:
Functional checks: navigation, Back, inputs, filters, recovery:
Visual/accessibility checks: spacing, wrapping, target bounds, pressed/focus/disabled:
Automated checks: exact commands, exit codes and test counts:
Git diff: task changes separated from preexisting lock repair:
Known limitations: UI defect / API or Backend dependency / unverified scenario:
Host memory and emulator/Metro state:
Recommended next task (awaiting approval):
M01–M08 status only against supplied milestone definitions:
```

Do not claim populated/detail/empty/loading states passed from source inspection alone. Record unsupported scenarios explicitly. No new task starts automatically after a report.

**Milestone boundary:** no M01–M08 definitions were found in available records, so existing Catalog phases remain unmapped. Stage 8 implements no milestone. **M08 BLOCKED.** Use **M08 COMPLETED — READY FOR UI REVIEW** only after M08 is fully implemented and verified with required automated/native checks, screenshots, review instructions, launch commands and Backend limitations; then wait for UI review before M09/M10.

**Primary references and evidence**

- [React Native 0.86 Fast Refresh](https://reactnative.dev/docs/0.86/fast-refresh)
- [Expo SDK 57 Link/asChild](https://docs.expo.dev/versions/v57.0.0/sdk/router/link.md#aschild)
- [React 19 ref guidance](https://react.dev/reference/react/forwardRef)
- [Expo CLI](https://docs.expo.dev/more/expo-cli/)
- [VS Code CLI](https://code.visualstudio.com/docs/configure/command-line)
- Stage 7 evidence/report: `C:\Users\user\AppData\Local\Temp\wavehouse-stage7-ui-4b29af6b\STAGE7-UI-UX-ASSESSMENT.md`
- Stage 8 Fast Refresh and reload evidence: `C:\Users\user\AppData\Local\Temp\wavehouse-stage8-workflow-1898ecd2\`

Stage 8 changes this documentation only. UI-01 and all other source implementation remain unapproved.
