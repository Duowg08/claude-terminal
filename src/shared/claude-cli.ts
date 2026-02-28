export function getClaudeCommand(flags: string[]): { command: string; args: string[] } {
  const isWindows = process.platform === 'win32';
  return isWindows
    ? { command: 'cmd.exe', args: ['/c', 'claude', ...flags] }
    : { command: 'claude', args: flags };
}
