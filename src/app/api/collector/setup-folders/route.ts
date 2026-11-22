import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { cleanSetupFolders } from '@/lib/setupFolderRules';
import { recordSetupFolders } from '@/lib/setupFolders';

// POST { folders: string[] }: the names of the folders in the PC's Documents\iRacing\setups, which the telemetry
// collector sends once at launch (SetupFolderReport.cs), for the Admin page's 3D Car Models to offer as car paths.
// Upload key auth. Names that can't be car paths are left out; answers { recorded }.
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => null);
    if (!body || !Array.isArray(body.folders)) {
      return NextResponse.json({ error: 'Expected { folders: string[] }' }, { status: 400 });
    }
    const recorded = await recordSetupFolders(cleanSetupFolders(body.folders));
    return NextResponse.json({ recorded });
  } catch (error) {
    console.error('Collector setup folders error:', error);
    return NextResponse.json({ error: 'Failed to save the setup folders' }, { status: 500 });
  }
}
