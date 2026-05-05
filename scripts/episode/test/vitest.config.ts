import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "scripts-episode",
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
