# Code Review — two-axis review

Adapted from mattpocock/skills `code-review` for a single-pass review of the team's implementation artifacts (no sub-agents, no issue tracker).

Review along two axes, reported separately — never merge or rerank them:

- **Standards**: does the code follow good practice and the smell baseline below?
- **Spec**: does it faithfully implement the goal and the upstream artifacts — nothing missing, nothing unasked-for?

A change can pass one axis and fail the other; reporting both stops one from masking the other.

## Standards axis: the smell baseline

Each smell is a labelled heuristic (a judgement call), never a hard violation. Skip anything tooling already enforces. Each reads *what it is* → *how to fix*:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds → rename it; if no honest name comes, the design is murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file → extract the shared shape, call it from both.
- **Feature Envy** — a method reaching into another object's data more than its own → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params travelling together (a type wanting to be born) → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurring → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forcing scattered edits across many files → gather what changes together into one module.
- **Divergent Change** — one file or module edited for several unrelated reasons → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits → drop the inheritance, use composition.

## Spec axis

Check the implementation against the goal and the upstream artifacts:

- Requirements that are missing or only partial.
- Behaviour nobody asked for (scope creep).
- Requirements that look implemented but are implemented wrong.

## Output

Report findings under `## Standards` and `## Spec` headings, each finding citing the artifact/file and the rule or requirement it breaks. Close with exactly one verdict line:

- `APPROVED` — no blocking findings on either axis.
- `CHANGES_REQUIRED` — blocking findings exist; list them tersely.
