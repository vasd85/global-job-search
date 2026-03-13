# Testing Conventions

These principles apply to all test code in this monorepo.
The `test-writer` agent (`.claude/agents/test-writer.md`) embeds these
principles directly. When updating rules here, also update the agent file.

## Core Principles

1. **Test contracts, not implementation.** Verify observable effects, not
   internal mechanisms. Tests must survive refactoring that changes HOW but
   not WHAT. Never assert which internal helper was called — assert what
   the caller observes.

2. **Adversarial negative testing.** For string matching, URL parsing, or
   domain validation: always include a near-miss that must NOT match.
   If code checks `host.includes("greenhouse.io")`, test that
   `notgreenhouse.io` does not match.

3. **Respect module boundaries.** Test only the layer under test. Do not
   re-test behavior that belongs to a dependency. If another module's
   test suite covers it, mock or accept the dependency's output.

4. **Every test name earned by assertions.** If the test name says "shows
   loading indicator", the assertions must query the loading element. A
   name that doesn't match its assertions creates false confidence.

5. **Deterministic data.** Never use midnight UTC (`T00:00:00Z`) for dates
   formatted with locale functions — use `T12:00:00Z`. Always mock
   `Date.now()` with `vi.setSystemTime()` or pass explicit timestamps.

6. **Always test async failure paths.** For any `fetch`, DB, or external
   service call: test rejection, non-OK status, and invalid response body.
   If the code lacks error handling, write the test and add `// TODO:`.

7. **Table-driven tests.** Use `test.each` when 3+ cases share the same
   assertion shape. One block covers all cases, not N copy-pasted tests.

8. **Flag bugs, don't enshrine.** If behavior looks wrong, write the test
   but add `// TODO:` explaining the issue. Don't silently assert buggy
   values as the correct contract.

9. **UI tests: assert what users see.** Test loading/error/empty states
   and user interactions → visible results. Do not test `useEffect` call
   counts, debounce timer internals, or `useCallback` references.

10. **Mock real semantics.** DB mocks must distinguish insert vs conflict.
    Assert `.set()` / `.values()` arguments, not just call counts.
    `expect(mock).toHaveBeenCalled()` only proves "something ran" — prove
    the correct data was written.
