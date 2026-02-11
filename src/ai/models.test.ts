import { test } from 'node:test';
import assert from 'node:assert';
import { buildMultimodalUserContent, ImageAttachment } from './models.js';

test('buildMultimodalUserContent returns string when no images', () => {
  const result = buildMultimodalUserContent('hello', undefined, (img) => img);
  assert.strictEqual(result, 'hello');
});

test('buildMultimodalUserContent returns string when empty images array', () => {
  const result = buildMultimodalUserContent('hello', [], (img) => img);
  assert.strictEqual(result, 'hello');
});

test('buildMultimodalUserContent returns array with text and images', () => {
  const images: ImageAttachment[] = [{ data: 'abc', mediaType: 'image/png' }];
  const mapper = (img: ImageAttachment) => ({ type: 'image_url' as const, url: img.data });

  const result = buildMultimodalUserContent('hello', images, mapper);

  assert.deepStrictEqual(result, [
    { type: 'text', text: 'hello' },
    { type: 'image_url', url: 'abc' }
  ]);
});

test('buildMultimodalUserContent skips empty text', () => {
    const images: ImageAttachment[] = [{ data: 'abc', mediaType: 'image/png' }];
    const mapper = (img: ImageAttachment) => ({ type: 'image_url' as const, url: img.data });

    const result = buildMultimodalUserContent('   ', images, mapper);

    assert.deepStrictEqual(result, [
        { type: 'image_url', url: 'abc' }
    ]);
});

test('buildMultimodalUserContent handles multiple images', () => {
    const images: ImageAttachment[] = [
        { data: 'abc', mediaType: 'image/png' },
        { data: 'def', mediaType: 'image/jpeg' }
    ];
    const mapper = (img: ImageAttachment) => ({ type: 'image_url' as const, url: img.data, mime: img.mediaType });

    const result = buildMultimodalUserContent('hello', images, mapper);

    assert.deepStrictEqual(result, [
        { type: 'text', text: 'hello' },
        { type: 'image_url', url: 'abc', mime: 'image/png' },
        { type: 'image_url', url: 'def', mime: 'image/jpeg' }
    ]);
});
