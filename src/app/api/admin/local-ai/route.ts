import { NextResponse } from 'next/server';
import { isAiFeature } from '@/lib/aiModelList';
import { isLocalAiMode, isLocalModelId, LOCAL_AI_LIMITS, SERVER_ID_PATTERN } from '@/lib/localAi/config';
import { localAiAdmin } from '@/lib/localAi/adminAuth';
import { validGatewayUrl } from '@/lib/localAi/localModel';
import { readLocalAiStatus } from '@/lib/localAi/report';
import { reportLocalResult } from '@/lib/localAi/state';
import { deleteLocalAiServer, getLocalAiSettings, saveLocalAiServer, saveLocalAiSettings } from '@/lib/localAi/store';
import { BodyTooLargeError, JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { isLiveServer } from '@/lib/serverEnvironment';

// The Admin page's Local AI Server Mode section (docs/local-ai.md). GET: the settings, the registered servers with
// their live status (heartbeat, slots, circuit) and whether the secrets are configured (never their values).
// PUT { action, ... }: mode, featureModel, tuning, saveServer, deleteServer, resetCircuit. Admin role only (404).

export async function GET() {
  const { denied } = await localAiAdmin();
  if (denied) return denied;
  try {
    return NextResponse.json(await readLocalAiStatus());
  } catch (error) {
    console.error('Local AI status error:', error);
    return NextResponse.json({ error: 'Failed to read the local AI status' }, { status: 500 });
  }
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function PUT(request: Request) {
  const { user, denied } = await localAiAdmin();
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await readJsonLimited(request, JSON_BODY_LIMIT)) ?? {};
  } catch (error) {
    return bad(error instanceof BodyTooLargeError ? 'Too large' : 'Not JSON');
  }

  try {
    const settings = await getLocalAiSettings();
    switch (body.action) {
      case 'mode': {
        if (!isLocalAiMode(body.mode)) return bad('Unknown mode');
        await saveLocalAiSettings({ ...settings, mode: body.mode }, user.id);
        console.log(`Local AI Server Mode set to ${body.mode} by user ${user.id}`);
        break;
      }
      case 'featureModel': {
        if (!isAiFeature(body.feature)) return bad('Unknown feature');
        if (body.model !== null && !isLocalModelId(body.model)) return bad('Unknown local model');
        await saveLocalAiSettings({ ...settings, featureModels: { ...settings.featureModels, [body.feature]: body.model } }, user.id);
        console.log(`Local AI model for ${body.feature} set to ${body.model ?? 'cloud only'} by user ${user.id}`);
        break;
      }
      case 'tuning': {
        // Out-of-range values are clamped by parseLocalAiSettings
        await saveLocalAiSettings(
          {
            ...settings,
            localTimeoutMs: Number(body.localTimeoutMs ?? settings.localTimeoutMs),
            circuitFailures: Number(body.circuitFailures ?? settings.circuitFailures),
            circuitOpenMs: Number(body.circuitOpenMs ?? settings.circuitOpenMs),
            contextShare: Number(body.contextShare ?? settings.contextShare),
          },
          user.id
        );
        console.log(`Local AI tuning changed by user ${user.id}`);
        break;
      }
      case 'saveServer': {
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!SERVER_ID_PATTERN.test(id)) return bad('Server ID: lowercase letters, digits and dashes');
        const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
        if (!label) return bad('Name the server');
        const gatewayUrl = validGatewayUrl(body.gatewayUrl, isLiveServer());
        if (!gatewayUrl) return bad('Gateway URL: https://host with no path (http://127.0.0.1:port only in development)');
        const maxConcurrency = Number(body.maxConcurrency);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < LOCAL_AI_LIMITS.maxConcurrency.min || maxConcurrency > LOCAL_AI_LIMITS.maxConcurrency.max) {
          return bad('Concurrency: 1 to 16');
        }
        await saveLocalAiServer({ id, label, gatewayUrl, enabled: body.enabled !== false, maxConcurrency });
        console.log(`Local AI server ${id} saved by user ${user.id} (${gatewayUrl}, ${maxConcurrency} slots, ${body.enabled !== false ? 'enabled' : 'disabled'})`);
        break;
      }
      case 'deleteServer': {
        if (typeof body.id !== 'string' || !SERVER_ID_PATTERN.test(body.id)) return bad('Unknown server');
        await deleteLocalAiServer(body.id);
        console.log(`Local AI server ${body.id} removed by user ${user.id}`);
        break;
      }
      case 'resetCircuit': {
        if (typeof body.id !== 'string' || !SERVER_ID_PATTERN.test(body.id)) return bad('Unknown server');
        reportLocalResult(body.id, true);
        console.log(`Local AI server ${body.id}: circuit reset by user ${user.id}`);
        break;
      }
      default:
        return bad('Unknown action');
    }
    return NextResponse.json(await readLocalAiStatus());
  } catch (error) {
    console.error('Local AI setting error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
