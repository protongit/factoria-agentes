import { describe, expect, it } from "vitest";
import { permissionAllows, resolvePermissions, toOpenCodePermissions } from "./harness.ts";

describe("permisos del harness", () => {
  it("deniega por defecto el acceso a rutas externas y los bucles peligrosos", () => {
    const perms = toOpenCodePermissions(resolvePermissions());
    expect(perms.external_directory).toBe("deny");
    expect(perms.doom_loop).toBe("deny");
  });

  it("respeta los permisos explícitos del subagente y del harness", () => {
    const perms = resolvePermissions({ external_directory: "allow" }, { bash: "allow" });
    expect(perms.external_directory).toBe("allow");
    expect(perms.bash).toBe("allow");
  });
});

describe("permissionAllows", () => {
  it("acepta patrones explícitos y rechaza lo no permitido", () => {
    expect(permissionAllows("allow")).toBe(true);
    expect(permissionAllows("deny")).toBe(false);
    expect(permissionAllows({ "*": "allow" })).toBe(true);
    expect(permissionAllows({ "git *": "allow" }, "git status")).toBe(true);
    expect(permissionAllows({ "git *": "allow" }, "rm -rf /")).toBe(false);
  });
});
