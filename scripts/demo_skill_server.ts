import http from 'node:http';
import crypto from 'node:crypto';

type DemoServerOptions = {
  port?: number;
  protocolVersion?: string;
  secret?: string;
  timestampSkewSeconds?: number;
  nonceTtlSeconds?: number;
};

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeysDeep(obj[key]);
    return out;
  }
  return value;
}

function sign(payload: Record<string, unknown>, secret: string): string {
  const canonical = JSON.stringify(sortKeysDeep(payload));
  return crypto.createHmac('sha256', secret).update(Buffer.from(canonical, 'utf8')).digest('hex');
}

export function startDemoSkillServer(options: DemoServerOptions = {}): Promise<http.Server> {
  const port = options.port ?? 4050;
  const protocolVersion = options.protocolVersion ?? '1.0';
  const secret = options.secret ?? process.env.DEMO_SKILL_HMAC_SECRET ?? 'demo-secret';
  const skewSeconds = options.timestampSkewSeconds ?? 120;
  const nonceTtlSeconds = options.nonceTtlSeconds ?? 300;

  const nonceStore = new Map<string, number>();
  const cleanupNonce = () => {
    const now = Date.now();
    for (const [nonce, exp] of nonceStore.entries()) {
      if (exp <= now) nonceStore.delete(nonce);
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/manifest') {
        const manifest = {
          gateway_protocol_version: protocolVersion,
          id: 'demo.echo',
          version: '1.0.0',
          capabilities: [
            {
              capability: 'demo.echo',
              description: 'Echo demo worker',
              input_schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  mode: { type: 'string' },
                },
                required: ['message'],
                additionalProperties: false,
              },
              output_schema: {
                type: 'object',
                properties: {
                  result: { type: 'string' },
                },
                required: ['result'],
                additionalProperties: false,
              },
            },
          ],
          requires: { auth: 'hmac-sha256' },
          safety: { data_handling: 'no_secrets' },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(manifest));
        return;
      }

      if (req.method === 'POST' && req.url === '/run') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;

        const timestamp = Number(body.timestamp || 0);
        const nonce = String(body.nonce || '');
        const signature = String(body.signature || '');
        const now = Date.now();

        if (Math.abs(now - timestamp) > skewSeconds * 1000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error_code: 'NONCE_REPLAY', message: 'timestamp out of skew window' }));
          return;
        }

        cleanupNonce();
        if (nonceStore.has(nonce)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error_code: 'NONCE_REPLAY', message: 'nonce already used' }));
          return;
        }

        const unsigned = {
          gateway_protocol_version: body.gateway_protocol_version,
          skill_id: body.skill_id,
          capability: body.capability,
          input: body.input,
          timestamp: body.timestamp,
          nonce: body.nonce,
        };
        const expected = sign(unsigned, secret);
        if (expected !== signature) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error_code: 'SKILL_AUTH_FAILED', message: 'bad signature' }));
          return;
        }

        nonceStore.set(nonce, now + nonceTtlSeconds * 1000);

        const input = (body.input || {}) as Record<string, unknown>;
        const mode = String(input.mode || '');
        if (mode === 'timeout') {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (mode === 'invalid_output') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, output: { unexpected: true } }));
          return;
        }

        const message = String(input.message || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, output: { result: `echo:${message}` }, meta: { worker: 'demo.echo' } }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error_code: 'NOT_FOUND', message: 'route not found' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error_code: 'INTERNAL', message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDemoSkillServer()
    .then(() => {
      console.log('Demo skill server is running at http://127.0.0.1:4050');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
