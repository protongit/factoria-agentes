import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, fitDimensions } from "./ai.ts";
import { evaluateCondition } from "./condition.ts";

describe("fitDimensions", () => {
  it("rellena con ceros hasta la dimensión del índice", () => {
    const v = fitDimensions([1, 2, 3]);
    expect(v.length).toBe(EMBEDDING_DIMENSIONS);
    expect(v[0]).toBe(1);
    expect(v[3]).toBe(0);
  });
  it("recorta si excede", () => {
    const v = fitDimensions(new Array(EMBEDDING_DIMENSIONS + 10).fill(1));
    expect(v.length).toBe(EMBEDDING_DIMENSIONS);
  });
});

describe("evaluateCondition", () => {
  const ctx = { text: "El resultado contiene errores de tipos", outputs: { out: "todo bien" } };

  it("contains", () => {
    expect(evaluateCondition({ op: "contains", value: "errores" }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "contains", value: "éxito" }, ctx)).toBe(false);
  });
  it("not_contains", () => {
    expect(evaluateCondition({ op: "not_contains", value: "éxito" }, ctx)).toBe(true);
  });
  it("equals", () => {
    expect(evaluateCondition({ op: "equals", value: "todo bien", field: "out" }, ctx)).toBe(true);
  });
  it("regex", () => {
    expect(evaluateCondition({ op: "regex", value: "err" }, ctx)).toBe(true);
  });
  it("expresión inline", () => {
    expect(evaluateCondition({ expr: "contains:bien", field: "out" }, ctx)).toBe(true);
  });
  it("devuelve undefined cuando no hay operador", () => {
    expect(evaluateCondition({}, ctx)).toBeUndefined();
  });
});
