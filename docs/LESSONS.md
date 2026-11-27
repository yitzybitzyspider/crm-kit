# Lessons from building the first hub

This kit comes out of one student team's hub. These are the lessons worth keeping, written so you can skip the mistakes.

## The big one: we built fast and got nowhere

In three days the first team merged 36 pull requests and wrote tens of thousands of lines of app code, scripts and tests. Their goal was "all four of us signed in, one real interview each". At the end of those three days, one person had signed in and there were zero interviews.

The code was not the problem. The process around it was.

### What went wrong

1. **Every change paid the price of the riskiest one.** A logo swap went through the same path as a database migration: ticket, worker, tests first, a deliberate break, up to seven CI workflows, three logs, a verifier. Branding took five pushes.
2. **"Never fix it in the conversation where you found it."** That rule turned a thirty second fix into a thirty to sixty minute pipeline. It was the single biggest slowdown.
3. **Rigor sized for production data about real people, on an empty database.** Hundreds of database assertions and concurrency tests, before one real row existed.
4. **Tests of the process itself.** Test files that checked the log rules, the CI triggers, the test runner and even the wording of documents. Each layer of process grew its own upkeep.
5. **A spiral into the process.** CI was slow, so the team ticketed faster CI, and those tickets needed CI to land. At one point 10 of the last 15 issues were about CI, tests or billing minutes.
6. **The fork brought its whole test suite.** Hundreds of upstream browser tests ran on every change, re-proving a product its makers already test. CI minutes ran out.
7. **The goal waited on a person.** Going live sat one merge away for hours.

### What was good, and stayed

- Honest logs that said what was checked and what was not.
- Sound security: Google sign-in with an allow list and no passwords, and Claude writes only through fixed database actions.
- Verbatim transcripts.
- Starting from an existing UI instead of designing screens.
- Running the heavy tests on a laptop instead of in billed CI.

### The fix

Three lanes by risk (see [PROTOCOL.md](PROTOCOL.md)), a freeze on system work until the goal was met, and cutting rather than tuning.

## Rules to keep

### About process

- **Measure outcomes, not output.** Merged pull requests are not progress. Your `FOCUS.md` "done when" is.
- **Size process to the blast radius.** Rigor belongs where a mistake hurts real data or real people, not on wording.
- **A rule about the process is a change with a cost.** Before adding a check, a log rule or a test of the process, ask whether it moves the goal.
- **When CI is slow, delete before you tune.**
- **Watch for the spiral.** When most open issues are about how you build, stop and ship.
- **Do not test document wording.** A test can only hold the shape of a claim, never whether it is true.
- **A finding that means a teammate loses work or sees wrong data is a blocker,** not a log entry. Fix it before the merge.

### About tests

- **A passing test proves little until you have seen it fail.** Break each rule once on purpose and read which cases fail. Many tests in the first hub passed with their rule removed, because the input happened not to need the rule.
- **When two layers enforce one rule, a break in one hides behind the other.** Break both.
- **Check the message, not just the exit code.** Different failures often share an exit code.
- **A test about a reply reads what the reply says,** not just that a reply exists.
- **Score what you could not run as not run,** never as a pass.

### About someone else's code

- **Read what you copy before putting real people in it.** The CRM the first hub forked sent a hash of each contact's email to an avatar service and reported its domain to its makers. Read the triggers and network calls first.
- **Do not trust upstream security.** Its default rule was "any signed in user may do anything, with no audit". Add your own rules on top.
- **Some upstream test suites wipe the database they point at.** Never point them at your real project.
- **"Supports X with configuration only" has to be checked in the code,** not assumed because the backend supports X.
- **Never give Claude a raw SQL tool.** Give it fixed actions that check each write.
- **Install third party code without running its install scripts** (`npm ci --ignore-scripts`) and read what a documented command runs before you put it in a workflow.

### About data and recordings

- **Transcripts can come in pages.** Keep reading until the tool says it is done, then compare the length to the total.
- **Speakers are often labeled by audio source, not name.** Keep the labels. Never guess names.
- **A free plan of a recording tool may give only AI notes, not the transcript.** Save the interview as transcript pending until the real one is pasted in.
- **Team check-ins look like interviews to a search.** Skip meetings with only teammates in them.
- **A shared, hand-edited table is the file a team fights over.** Generate views; never edit them by hand.
- **Free database tiers have a project limit.** Decide whose account owns the database before you deploy.
