import { describe, expect, it } from "vitest";
import { approveFor, hashDiff, memoryVerdictStore, modelFamily, selectReviewModel } from "./review.ts";
import { findAttribution, scanDiffAddedLines } from "./attribution.ts";
import { checkCommitMessage } from "./git-hooks.ts";
import { evaluatePolicy, parsePolicy } from "./policy.ts";
import { bashWriteViolation, commitGateViolation, discardViolation, evaluateToolCall } from "./sentinel.ts";
import { appendEntry, headHash, verifyChain } from "./governance.ts";
import { crossCheckClaims, evaluateClaims, extractClaims } from "./claims.ts";
import { isStale, stewardSweep } from "./steward.ts";
import { adrPath, nextAdrNumber, renderAdr } from "./adr.ts";
import { compileRuleSkeleton, extractRulesFromMarkdown, ruleCoverage } from "./rules-compile.ts";

describe("review", () => {
  it("extrae la familia del modelo", () => {
    expect(modelFamily("anthropic/claude-3-5")).toBe("claude");
    expect(modelFamily("openai/gpt-4o")).toBe("gpt");
  });

  it("elige un revisor de familia distinta", () => {
    expect(selectReviewModel("openai/gpt-4o", ["openai/gpt-4o-mini", "anthropic/claude-3"])).toBe("anthropic/claude-3");
  });

  it("no devuelve revisor si no hay familia distinta (fail-closed)", () => {
    expect(selectReviewModel("openai/gpt-4o", ["openai/gpt-4o-mini"])).toBeUndefined();
  });

  it("el hash ata el veredicto al diff exacto", async () => {
    const store = memoryVerdictStore();
    const diff = "diff --git a/x b/x\n+hola\n";
    const hash = hashDiff(diff);
    await store.save({ verdict: "approved", diffHash: hash, workspace: "root" });
    expect(approveFor(await store.get(hash), hash)).toBe(true);
    expect(approveFor(await store.get(hash), hashDiff(`${diff}+otra linea\n`))).toBe(false);
  });
});

describe("attribution", () => {
  it("detecta atribución IA", () => {
    expect(findAttribution("Co-Authored-By: Claude <noreply@anthropic.com>").length).toBeGreaterThan(0);
  });
  it("escanea solo líneas añadidas", () => {
    const diff = "-co-authored-by: claude\n+feat: algo\n";
    expect(scanDiffAddedLines(diff)).toHaveLength(0);
  });
});

describe("git-hooks commit policy", () => {
  it("acepta Conventional Commits", () => {
    expect(checkCommitMessage("feat(api): añade endpoint").ok).toBe(true);
  });
  it("rechaza tipo no permitido y atribución", () => {
    expect(checkCommitMessage("wip: cosas").ok).toBe(false);
    expect(checkCommitMessage("feat: x\n\nCo-Authored-By: Claude").ok).toBe(false);
  });
});

describe("policy", () => {
  it("parsea policy.yml y deniega por coincidencia", () => {
    const rules = parsePolicy(
      ["- id: no-force", "  text: \"No force push\"", "  kind: deterministic", "  class: security", "  tool: bash", "  contains: \"push --force\""].join("\n"),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.klass).toBe("security");
    const result = evaluatePolicy({ tool: "bash", command: "git push --force origin main" }, rules);
    expect(result.decision).toBe("deny");
    expect(result.match?.ruleId).toBe("no-force");
  });
});

describe("sentinel", () => {
  it("bloquea escrituras por bash", () => {
    expect(bashWriteViolation("echo hola > src/x.ts")).toBeDefined();
    expect(bashWriteViolation("echo hola > /tmp/x.ts")).toBeUndefined();
  });
  it("bloquea comandos destructivos y --no-verify", () => {
    expect(discardViolation("git reset --hard HEAD")).toBeDefined();
    expect(discardViolation("git checkout -- src/x.ts")).toBeDefined();
    expect(commitGateViolation("git commit --no-verify -m x")).toBeDefined();
    expect(commitGateViolation("git -c core.hooksPath=/dev/null commit")).toBeDefined();
  });
  it("aplica card-first sobre ficheros fuente", () => {
    const v = evaluateToolCall({ tool: "edit", path: "src/index.ts" }, { workspace: ".", hasCard: false, ragZones: [], ragQueried: false, sessionOwnedFiles: [] }, ["card-first"]);
    expect(v?.gate).toBe("card-first");
  });
  it("protege los ficheros de gobierno", () => {
    const v = evaluateToolCall({ tool: "write", path: ".factoria/policy.yml" }, { workspace: ".", hasCard: true, ragZones: ["."], ragQueried: true, sessionOwnedFiles: [] }, ["governance"]);
    expect(v?.gate).toBe("governance");
  });
});

describe("governance ledger", () => {
  it("encadena y detecta manipulación", () => {
    let entries: ReturnType<typeof appendEntry>[] = [];
    entries = [...entries, appendEntry(entries, { gate: "review", outcome: "allow", reason: "ok" })];
    entries = [...entries, appendEntry(entries, { gate: "review", outcome: "deny", reason: "no" })];
    expect(verifyChain(entries).ok).toBe(true);
    const tampered = structuredClone(entries);
    tampered[0]!.reason = "changed";
    expect(verifyChain(tampered).ok).toBe(false);
    expect(headHash(entries)).toBe(entries[1]?.hash);
  });

  it("el hash es estable ante el reordenamiento de claves de jsonb", () => {
    let entries: ReturnType<typeof appendEntry>[] = [];
    entries = [...entries, appendEntry(entries, { gate: "steward", outcome: "deny", reason: "caducada", payload: { from: "satisfied", to: "unknown" } })];
    const reordered = structuredClone(entries);
    reordered[0]!.payload = { to: "unknown", from: "satisfied" };
    expect(verifyChain(reordered).ok).toBe(true);
  });
});

describe("claims", () => {
  it("extrae y contrasta afirmaciones", () => {
    const claims = extractClaims("Los tests pasan. Todo verde.");
    expect(claims.length).toBeGreaterThan(0);
    const disproven = crossCheckClaims(["los tests pasan"], "FAIL src/x.test.ts\ntest failed");
    expect(disproven[0]?.status).toBe("disproven");
    expect(evaluateClaims("los tests pasan", "FAIL: 3 tests failed").passed).toBe(false);
    expect(evaluateClaims("los tests pasan", "all tests passed").passed).toBe(true);
  });
});

describe("steward", () => {
  it("caduca garantías y las pasa a unknown", () => {
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    expect(isStale({ status: "satisfied", lastVerifiedAt: old }, new Date(), 7 * 24 * 3600 * 1000)).toBe(true);
    const sweep = stewardSweep([{ id: "c1", title: "suite", status: "satisfied", lastVerifiedAt: old }]);
    expect(sweep.changes[0]?.to).toBe("unknown");
  });
});

describe("adr", () => {
  it("numera y renderiza", () => {
    expect(nextAdrNumber([{ number: 2 }])).toBe(3);
    expect(adrPath(1, "Usar Postgres")).toContain("0001-usar-postgres.md");
    expect(renderAdr({ number: 1, title: "T", status: "proposed", context: "", decision: "D", consequences: "" })).toContain("# 0001. T");
  });
});

describe("rules-compile", () => {
  it("extrae reglas y reporta cobertura", () => {
    const md = ["# Reglas", "- No usar git push --force", "- Siempre escribir tests"].join("\n");
    const rules = extractRulesFromMarkdown(md, "AGENTS.md");
    expect(rules).toHaveLength(2);
    const compiled = compileRuleSkeleton(rules);
    expect(compiled.every((r) => r.kind === "none")).toBe(true);
    const coverage = ruleCoverage({ "AGENTS.md": md }, compiled);
    expect(coverage.noGate).toHaveLength(2);
  });
});
