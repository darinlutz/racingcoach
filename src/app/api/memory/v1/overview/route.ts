import { memoryRoute } from '@/lib/memory/api';
import { overview } from '@/lib/memory/analytics';

export const GET = memoryRoute({ scope: 'memory:admin' }, async () => overview());
