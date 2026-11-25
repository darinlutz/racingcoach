// The Memory API's OpenAPI 3.1 description (docs/AI_MEMORY_API.md has the prose), served at /api/memory/v1/openapi

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const ok = (schema: unknown, description = 'OK') => ({ description, ...json(schema) });
const errors = { '400': ref('ErrorResponse'), '401': ref('ErrorResponse'), '403': ref('ErrorResponse'), '404': ref('ErrorResponse'), '429': ref('ErrorResponse') };
const errorResponses = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, ok(v, 'Error')]));
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

export const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Clarivex Memory API', version: '1.0.0', description: 'Centralized AI memory: PostgreSQL is authoritative; Mem0 is a replaceable intelligence provider.' },
  servers: [{ url: '/api/memory/v1' }],
  security: [{ bearer: [] }, { session: [] }],
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', description: 'An API client key (cmk_...). Send X-Memory-Subject when the client has subjects.' },
      session: { type: 'apiKey', in: 'cookie', name: 'session', description: 'An Admin signed in to the site (the Memory Manager).' },
    },
    schemas: {
      ErrorResponse: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, currentVersion: { type: 'integer' } }, required: ['code', 'requestId'] } } },
      Memory: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          content: { type: 'string' },
          summary: { type: ['string', 'null'] },
          namespacePath: { type: 'string' },
          categoryKey: { type: 'string' },
          importance: { type: 'integer', minimum: 1, maximum: 10 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          status: { enum: ['Pending', 'Approved', 'Active', 'Archived', 'Superseded', 'Expired', 'Rejected', 'Deleted'] },
          isPinned: { type: 'boolean' },
          isLocked: { type: 'boolean' },
          isActive: { type: 'boolean' },
          isSensitive: { type: 'boolean' },
          version: { type: 'integer' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      NewMemory: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string', maxLength: 4000 }, title: { type: 'string', maxLength: 200 }, namespace: { type: 'string', description: 'Path or ID' }, category: { type: 'string', description: 'Key or ID' }, importance: { type: 'integer' }, confidence: { type: 'number' }, expiresAt: { type: 'string', format: 'date-time' }, isPinned: { type: 'boolean' }, metadata: { type: 'object' } },
      },
      RetrieveRequest: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string', maxLength: 2000 }, namespaces: { type: 'array', items: { type: 'string' } }, includeChildren: { type: 'boolean', default: true }, mode: { enum: ['hybrid', 'semantic', 'keyword'] }, profileId: { type: 'string', format: 'uuid' }, model: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } } },
      },
      RetrieveResponse: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'A <memory_context> block of reference data, to add as a separate message; never system instructions' },
          memories: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, category: { type: 'string' }, namespace: { type: 'string' }, score: { type: 'number' }, rank: { type: 'integer' } } } },
          tokens: { type: 'integer' },
          mode: { type: 'string' },
          degraded: { type: ['string', 'null'], description: 'Why retrieval ran degraded, e.g. embeddingUnavailable:circuitOpen (keyword only)' },
          accessLogId: { type: ['integer', 'null'] },
          requestId: { type: 'string' },
        },
      },
      ExtractRequest: {
        type: 'object',
        required: ['messages'],
        properties: { messages: { type: 'array', maxItems: 40, items: { type: 'object', required: ['role', 'content'], properties: { role: { enum: ['user', 'assistant', 'system'] }, content: { type: 'string', maxLength: 8000 }, id: { type: 'string' } } } }, namespace: { type: 'string' }, conversationId: { type: 'string' }, messageId: { type: 'string' }, model: { type: 'string' }, trigger: { type: 'string' } },
      },
    },
  },
  paths: {
    '/health': { get: { summary: 'Service health', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/memories': {
      get: { summary: 'List memories (filters, sort, pages)', parameters: ['q', 'namespace', 'category', 'status', 'pinned', 'locked', 'sensitive', 'expiring', 'sort', 'direction', 'limit', 'offset'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })), responses: { '200': ok({ type: 'object', properties: { items: { type: 'array', items: ref('Memory') }, total: { type: 'integer' } } }), ...errorResponses } },
      post: { summary: 'Create a memory (scope memory:write)', requestBody: json(ref('NewMemory')), responses: { '201': ok({ type: 'object', properties: { memory: ref('Memory'), duplicate: { type: 'boolean' } } }), '422': ok(ref('ErrorResponse'), 'Contains a secret'), ...errorResponses } },
    },
    '/memories/{id}': {
      get: { summary: 'One memory, its relationships and retrievals', parameters: [idParam], responses: { '200': ok({ type: 'object' }), ...errorResponses } },
      patch: { summary: 'Change a memory (expectedVersion required)', parameters: [idParam], requestBody: json({ type: 'object', required: ['expectedVersion'] }), responses: { '200': ok({ type: 'object', properties: { memory: ref('Memory') } }), '409': ok(ref('ErrorResponse'), 'Version conflict or invalid transition'), '423': ok(ref('ErrorResponse'), 'Locked'), ...errorResponses } },
      delete: { summary: 'Delete (?permanent=true for a privacy deletion: history, embeddings and Mem0 copies too)', parameters: [idParam, { name: 'permanent', in: 'query', schema: { type: 'boolean' } }], responses: { '200': ok({ type: 'object' }), ...errorResponses } },
    },
    '/memories/{id}/history': { get: { summary: 'Version history', parameters: [idParam], responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/memories/{id}/restore': { post: { summary: 'Restore a version (Admin)', parameters: [idParam], responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/memories/{id}/embed': { post: { summary: 'Recalculate the embedding (Admin)', parameters: [idParam], responses: { '200': ok({ type: 'object' }), '503': ok(ref('ErrorResponse'), 'Embedding model offline'), ...errorResponses } } },
    '/memories/bulk': { post: { summary: 'Bulk operation (Admin)', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/retrieve': { post: { summary: 'Memory context for an LLM request', requestBody: json(ref('RetrieveRequest')), responses: { '200': ok(ref('RetrieveResponse')), ...errorResponses } } },
    '/search': { post: { summary: 'Search memories (keyword, semantic, hybrid)', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/extract': { post: { summary: 'Queue extraction (scope memory:extract); 202 with the job. Idempotency-Key header honoured.', requestBody: json(ref('ExtractRequest')), responses: { '202': ok({ type: 'object', properties: { jobId: { type: 'string' }, duplicate: { type: 'boolean' } } }), ...errorResponses } } },
    '/feedback': { post: { summary: 'Retrieval feedback (scope memory:feedback)', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/candidates': { get: { summary: 'Approval Queue (Admin)', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/candidates/{id}/{action}': { post: { summary: 'approve | approveLocked | separate | reject | merge | replace (Admin)', parameters: [idParam, { name: 'action', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': ok({ type: 'object' }), '423': ok(ref('ErrorResponse'), 'Target locked'), ...errorResponses } } },
    '/candidates/bulk': { post: { summary: 'Bulk approve eligible / reject (Admin)', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/conflicts': { get: { summary: 'Conflicts (Admin)', responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/conflicts/{id}/resolve': { post: { summary: 'Resolve a conflict (Admin)', parameters: [idParam], responses: { '200': ok({ type: 'object' }), ...errorResponses } } },
    '/categories': { get: { summary: 'Categories', responses: { '200': ok({ type: 'object' }) } }, post: { summary: 'New category (Admin)', responses: { '200': ok({ type: 'object' }) } } },
    '/namespaces': { get: { summary: 'Namespaces this caller may read', responses: { '200': ok({ type: 'object' }) } }, post: { summary: 'New namespace (Admin)', responses: { '200': ok({ type: 'object' }) } } },
    '/settings': { get: { summary: 'Settings (Admin)', responses: { '200': ok({ type: 'object' }) } }, put: { summary: 'Change settings (Admin)', responses: { '200': ok({ type: 'object' }) } } },
    '/analytics': { get: { summary: 'Analytics (Admin); ?format=csv', responses: { '200': ok({ type: 'object' }) } } },
  },
};
