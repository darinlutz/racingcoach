import { memoryRoute } from '@/lib/memory/api';
import { OPENAPI } from '@/lib/memory/openapi';

export const GET = memoryRoute({ scope: 'memory:read', perMinute: 30 }, async () => OPENAPI);
