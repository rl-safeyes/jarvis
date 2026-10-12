export function trustedPolicy(
  root?: URL,
): Promise<{ files: Record<string, string>; digest: string }>;
