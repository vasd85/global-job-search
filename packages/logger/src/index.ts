import pino, { type Logger } from "pino";

const isDev = process.env.NODE_ENV !== "production";
const level = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info");

const base = pino({
  level,
  ...(isDev && {
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
