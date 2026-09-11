# Testing

Keep this suite small. Retain a test when a plausible mistake could lose user
work, repeat a side effect, cross an authentication or document boundary, or
break recovery, and the behavior is difficult to verify by reading the code.

The retained guardrails cover:

- Document writes, rollback, script revisions, and crash-safe persistence.
- RPC compatibility, lost replies, duplicate execution, and transaction ownership.
- Concurrent tasks, cancellation, host startup, and recovery after reconnects.
- Authentication, credential revocation, file access, and rendered untrusted text.
- Browser submission and reconnect behavior, plus native package validation.

Do not add tests just to check constants, schemas already covered by the RPC
contract, forwarding wrappers, formatting, UI layout, or implementation text.
Use typechecking and code review for those. Temporary feature and regression
tests can be deleted after verification unless they protect one of these risks.
Prefer extending an existing behavioral test over adding another mock-heavy suite.

Run the automated guardrails:

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.web.json
dotnet test dotnet/Hopper.Core.Tests/Hopper.Core.Tests.csproj
pnpm test:rpc-cross-language
```

The tests in `grasshopper-plugin.Tests` need Rhino/Grasshopper for native
execution. Build that project, then use `scripts/run-native-tests.mjs --help`
to run selected methods in an explicitly selected Rhino instance. Plain
`dotnet test` cannot run the graph rollback and solution tests without the
Grasshopper runtime. Keep the native document and script checks for changes
to those operations.
