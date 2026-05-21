# Synthetic plan with chunk missing the Files. section

Fixture for parse-plan.sh test: chunk has Goal and Acceptance
criteria but no Files section — should trip structural validation.

## 5. Chunks

### Chunk no-files — A chunk missing its Files section

```yaml
id: no-files
depends_on: []
labels:
  - type:chore
  - feature:missing-section-fixture
```

**Goal.** Trip the missing-section guard by omitting `**Files.**`.

**Acceptance criteria.**
- [ ] parse-plan.sh exits non-zero
- [ ] stderr names the offending chunk and the missing section
