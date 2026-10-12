export class Docker {
  constructor(socket?: string);
  call(method: string, route: string, body?: unknown): Promise<any>;
  inspect(name: string): Promise<any>;
}
export function command(
  cmd: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string | Buffer; timeout?: number },
): Promise<string>;
export class AppDeployer {
  constructor(docker: Docker, project: string, guard?: () => Promise<void>);
  capture(): Promise<any>;
  assertTarget(job: any): Promise<void>;
  promote(job: any): Promise<void>;
  healthy(job: any): Promise<void>;
  rollback(job: any): Promise<void>;
}
