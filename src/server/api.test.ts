import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { handleAIRequest } from './api.js';
import { channelRegistry } from '../channels/registry.js';

// Define a type for our mock response
interface MockResponse {
  statusCode: number;
  jsonData: any;
  status(code: number): MockResponse;
  json(data: any): void;
  headersSent: boolean;
}

describe('handleAIRequest', () => {
  let originalHandleMessage: any;

  beforeEach(() => {
    originalHandleMessage = channelRegistry.handleMessage;
  });

  afterEach(() => {
    channelRegistry.handleMessage = originalHandleMessage;
  });

  it('should send success response when handleMessage returns result', async () => {
    // Mock handleMessage
    channelRegistry.handleMessage = async () => ({
      text: 'Hello world',
      model: 'gpt-4',
      provider: 'openai',
      tokensUsed: 10,
      contextUsed: 2,
      contextEnabled: true,
      contextTotal: 5
    });

    const res: any = {
      statusCode: 200,
      jsonData: null,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonData = data;
        this.headersSent = true;
      }
    };

    const incoming: any = { text: 'test' };

    await handleAIRequest(res, incoming);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.jsonData, {
      success: true,
      response: 'Hello world',
      model: 'gpt-4',
      provider: 'openai',
      tokensUsed: 10,
      contextUsed: 2,
      contextEnabled: true,
      contextTotal: 5
    });
  });

  it('should send 500 error when handleMessage returns null', async () => {
    channelRegistry.handleMessage = async () => null;

    const res: any = {
      statusCode: 200,
      jsonData: null,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonData = data;
        this.headersSent = true;
      }
    };

    const incoming: any = { text: 'test' };

    await handleAIRequest(res, incoming);

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.jsonData, { error: 'Ошибка обработки' });
  });

  it('should propagate error when handleMessage throws', async () => {
    channelRegistry.handleMessage = async () => {
      throw new Error('Simulated error');
    };

    const res: any = {
      statusCode: 200,
      jsonData: null,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonData = data;
        this.headersSent = true;
      }
    };

    const incoming: any = { text: 'test' };

    await assert.rejects(
      async () => await handleAIRequest(res, incoming),
      { message: 'Simulated error' }
    );

    assert.strictEqual(res.headersSent, false);
  });
});
