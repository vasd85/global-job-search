const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const isDebug = LOG_LEVEL === "debug";

export function debug(
  tag: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isDebug) return;
  const parts = [`[${tag}] ${message}`];
  if (data) parts.push(JSON.stringify(data, null, 2));
  console.debug(parts.join("\n  "));
}
