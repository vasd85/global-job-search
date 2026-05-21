import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "scripts-tasks",
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
