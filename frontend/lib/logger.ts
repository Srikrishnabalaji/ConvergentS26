// Single chokepoint for client-side logging. All output is gated on __DEV__
// so production builds never call into the underlying console. When PII
// scrubbing is added later, it lives here.

type LogArg = unknown;

function dev(method: 'log' | 'warn' | 'error', tag: string, args: LogArg[]) {
  if (!__DEV__) return;
  console[method](`[${tag}]`, ...args);
}

export const log = {
  debug: (tag: string, ...args: LogArg[]) => dev('log',   tag, args),
  warn:  (tag: string, ...args: LogArg[]) => dev('warn',  tag, args),
  error: (tag: string, ...args: LogArg[]) => dev('error', tag, args),
};
