import { createLogger, format, transports } from "winston";
import { existsSync, mkdirSync } from "node:fs";

const logDir = "./logs";
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.printf(({ level, message, timestamp, stack }) => {
    return `[${timestamp}] ${level}: ${stack || message}`;
  }),
);

const fileFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }),
  format.json(),
);

export const logger = createLogger({
  level: "info",
  transports: [
    new transports.File({
      filename: `${logDir}/error.log`,
      level: "error",
      format: fileFormat,
    }),
    new transports.File({
      filename: `${logDir}/combined.log`,
      format: fileFormat,
    }),
    new transports.Console({
      format: consoleFormat,
    }),
  ],
});
