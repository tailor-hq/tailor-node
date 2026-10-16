/** Where the SDK reports problems. Any object with these methods works. */
export interface Logger {
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
}

export const consoleLogger: Logger = {
  warn: (message) => console.warn(message),
  error: (message) => console.error(message)
};
