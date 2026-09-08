// JSON Schema subset validator shared by the Node bridge and the Figma plugin.
// The previous custom validator silently skipped allOf/if/then; this one really
// executes: type, properties, additionalProperties, required, enum, const,
// numeric bounds, string length/pattern, array items/length, anyOf, allOf and
// if/then/else. Pure JS, no external dependencies.

const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export class SchemaError extends Error {
  constructor(message, path = 'arguments') {
    super(message);
    this.name = 'SchemaError';
    this.code = 'INVALID_PARAM';
    this.path = path;
  }
}

function fail(label, detail) {
  throw new SchemaError(`${label} ${detail}`, label);
}

export function validateSchema(value, schema, label = 'arguments') {
  validateValue(value, schema, label);
  return value;
}

function validateValue(value, schema, label) {
  if (!schema || typeof schema !== 'object') return;

  if (Array.isArray(schema.anyOf)) {
    const errors = [];
    for (const candidate of schema.anyOf) {
      try { validateValue(value, candidate, label); return; }
      catch (e) { errors.push(e.message); }
    }
    fail(label, `不匹配 anyOf 的任何分支: ${errors[0] || '未知原因'}`);
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validateValue(value, sub, label);
  }

  if (schema.if !== undefined) {
    let applies = true;
    try { validateValue(value, schema.if, label); }
    catch { applies = false; }
    if (applies) {
      if (schema.then !== undefined) validateValue(value, schema.then, label);
    } else if (schema.else !== undefined) {
      validateValue(value, schema.else, label);
    }
  }

  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    fail(label, `必须等于 ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum !== undefined && !schema.enum.some(candidate => deepEqual(value, candidate))) {
    fail(label, '不在允许值中');
  }

  if (schema.type !== undefined) {
    const ok = schema.type === 'object' ? isPlainObject(value) :
      schema.type === 'array' ? Array.isArray(value) :
        schema.type === 'null' ? value === null :
          schema.type === 'integer' ? Number.isSafeInteger(value) :
            schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value) :
              schema.type === 'boolean' ? typeof value === 'boolean' :
                typeof value === schema.type;
    if (!ok) fail(label, `必须是 ${schema.type}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(label, '长度不合法');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(label, '长度不合法');
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(label, '格式不合法');
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(label, '超出范围');
    if (schema.maximum !== undefined && value > schema.maximum) fail(label, '超出范围');
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(label, '数量不合法');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(label, '数量不合法');
    if (schema.items !== undefined) value.forEach((item, i) => validateValue(item, schema.items, `${label}[${i}]`));
  }

  if (isPlainObject(value) && isPlainObject(schema.properties)) {
    for (const key of schema.required || []) if (!own(value, key)) fail(label, `缺少 ${key}`);
    for (const key of Object.keys(value)) {
      if (!own(schema.properties, key)) {
        if (schema.additionalProperties !== false) continue;
        fail(label, `含未知字段: ${key}`);
      }
      validateValue(value[key], schema.properties[key], `${label}.${key}`);
    }
  }
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) if (!deepEqual(a[key], b[key])) return false;
  return true;
}
