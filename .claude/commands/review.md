# Code Review

Run a comprehensive code review using multiple specialized sub-agents in parallel, then synthesize the findings.

## Instructions

1. First, understand the scope of the review (PR diff, specific files, or current branch changes).
2. Launch the following reviewer agents **in parallel**:
   - security-reviewer
   - performance-reviewer
   - architecture-reviewer
   - code-quality-reviewer
   - test-reviewer

3. After all agents respond, synthesize their findings into one clear report with this structure:

**🔴 Critical Issues** (Must fix)
**🟡 Important Suggestions**
**✅ Good Practices**
**📋 Summary & Recommendations**

For every issue, include:

- File + line reference
- Clear explanation
- Suggested fix (with code when helpful)
- Which reviewer found it

Be constructive and educational. Prioritize real problems over style nitpicks.
