import pino, { type Logger } from "pino";

// LOG_LEVEL: defaults to "info". Set LOG_LEVEL=debug for tracing.
// LOG_PRETTY=1: opt in to pretty-printed [tag] lines via pino-pretty
// transport. Off by default so prod hosts that forget to set
// NODE_ENV can't silently emit non-parseable output.
const level = process.env.LOG_LEVEL ?? "info";
const usePretty = process.env.LOG_PRETTY === "1";

const base = pino({
  level,
  ...(usePretty && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
        messageFormat: "[{tag}] {msg}",
      },
    },
  }),
});

export function createLogger(tag: string): Logger {
  return base.child({ tag });
}

export type { Logger };
