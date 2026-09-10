# Model evaluation projection

This contract applies only to the separate model evaluation. Real use returns the entire native finding unchanged, including all details and diagnostics. A model projection neither executes native SQL nor replaces that finding.

Each input case supplies case_id, check_id, inputs and requested_paths. Treat inputs as one explicit independent invocation; arrays named source, report, membership, reference, observed, columns, policy, observations or ads project their corresponding native input tables as described in the quick reference. Cases never share populations or evidence.

Return exactly:

~~~json
{"cases":[{"case_id":"string","check_id":"string","status":"string","reasons":["string"],"values":[{"path":"string","value":null}]}]}
~~~

This illustrates types only, not a case answer. The cases array must have exactly the input case count, in input order, preserving case_id and check_id. Each status and reasons array are the native finding's **overall** status and reasons, not a detail's or comparison's status. Reasons are distinct and lexicographically sorted; empty reasons are []. Return no explanations, wrappers or additional properties.

Each values array has exactly one entry per requested path, in the same request order. Copy the requested JSON pointer string as path. Resolve it against the native finding JSON: object fields use their exact names, array indices are zero-based, and pointer escapes ~1 and ~0 mean slash and tilde. Follow the native array ordering described in the quick reference. Do not reorder values to match native field order.

Value is only a string, Boolean, or NULL. Native money, counts, rates, tolerances and differences remain decimal strings. Preserve Boolean false and SQL unknown NULL; neither becomes zero. Date fields remain ISO date strings or NULL. A missing pointer is a manifest/input problem, never permission to fabricate NULL. Selected projections are validated to reference existing native scalar fields.

Output schemas specify types and required properties only; they do not embed expected labels or answers. Independent scoring checks case/check identities, overall statuses, every reason and its cardinality, and every requested path/value and its cardinality. Repeated, omitted or reordered cases/values are errors even when other values look plausible. Evaluation fixtures carry neutral case labels; they do not prescribe an outcome.
