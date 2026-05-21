# Synthetic plan with no type:* label

Fixture for parse-plan.sh test: chunk has the `feature:*` label but
no `type:*` label — should trip label validation.

## 5. Chunks

### Chunk lone — A chunk missing its type label

```yaml
id: lone
depends_on: []
labels:
  - feature:missing-label-fixture
```

**Goal.** Trip label validation by omitting the type:* label.

**Files.**
- nope/never.md

**Acceptance criteria.**
- [ ] parse-plan.sh exits non-zero
- [ ] stderr names the offending chunk + missing label
