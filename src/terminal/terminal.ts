export interface TerminalOptions {
  cwd: string;
  command: string;
  args: string[];
  title?: string;
  closeAfterExit?: boolean;
}
export interface TerminalProcess {
  processId?: number;
  command: string;
}
export interface TerminalLauncher {
  open(options: TerminalOptions): Promise<TerminalProcess>;
}
