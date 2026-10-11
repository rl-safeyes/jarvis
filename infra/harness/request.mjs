let body = '';
for await (const chunk of process.stdin) body += chunk;
const response = await fetch('http://127.0.0.1:7090/request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
  signal: AbortSignal.timeout(45000),
});
// A valid HTTP error is a bridge result, not a Docker transport failure.
process.stdout.write(JSON.stringify({ ok: response.ok, result: await response.json() }));
