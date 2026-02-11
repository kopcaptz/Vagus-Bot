import Ajv, { type ValidateFunction } from 'ajv';
import type { JsonSchemaObject } from './types.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const validatorCache = new WeakMap<object, ValidateFunction>();

function getValidator(schema: JsonSchemaObject): ValidateFunction {
  const existing = validatorCache.get(schema as unknown as object);
  if (existing) return existing;
  const compiled = ajv.compile(schema as unknown as object);
  validatorCache.set(schema as unknown as object, compiled);
  return compiled;
}

function normalizeSchema(schema: JsonSchemaObject): JsonSchemaObject {
  if (schema.additionalProperties === undefined) {
    return {
      ...schema,
      additionalProperties: false,
    };
  }
  return schema;
}

export function validateBySchema(schema: JsonSchemaObject, data: unknown, context: 'input' | 'output'): void {
  const effectiveSchema = normalizeSchema(schema);
  const validator = getValidator(effectiveSchema);
  const valid = validator(data);
  if (!valid) {
    const details = (validator.errors || [])
      .map(e => `${e.instancePath || '/'}: ${e.message || 'validation error'}`)
      .join('; ');
    throw new Error(`SCHEMA_VALIDATION_FAILED (${context}): ${details}`);
  }
}
