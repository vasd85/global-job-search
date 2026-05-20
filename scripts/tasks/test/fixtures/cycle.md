# Synthetic plan with a depends_on cycle (a → b → a)

Fixture for parse-plan.sh test: every section is well-formed in
isolation, but chunk `b` depends on chunk `a` which depends on `b`.

## 5. Chunks

### Chunk a — First chunk in the cycle

```yaml
id: a
depends_on: [b]
labels:
  - type:chore
  - feature:cycle-fixture
```

**Goal.** Trip the DAG cycle detector together with chunk `b`.

**Files.**
- nope/never.md

**Acceptance criteria.**
- [ ] parse-plan.sh exits non-zero
- [ ] stderr names the cycle edge

---

### Chunk b — Second chunk in the cycle

```yaml
id: b
depends_on: [a]
labels:
  - type:chore
  - feature:cycle-fixture
```

**Goal.** Close the loop opened by chunk `a`.

**Files.**
- nope/never.md

**Acceptance criteria.**
- [ ] parse-plan.sh exits non-zero
- [ ] stderr names the cycle edge
