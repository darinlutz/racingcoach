import { NextResponse } from 'next/server';
import { listCarSetups, listImports, listLibraryCars } from '@/lib/carSetupLibrary';
import { cleanCarFolder } from '@/lib/carSetupLibraryRules';
import { adminSession } from '@/lib/carSetupRoutes';

// The Setups page's iRacing Setups tab (docs/setups.md's iRacing setup collection): the cars with imported setups,
// the picked car's setups (?car=<its setups folder>) and the latest imports with their failures. Admins only, 404
// for anyone else.
export async function GET(request: Request) {
  const admin = await adminSession();
  if (admin.response) return admin.response;
  try {
    const car = cleanCarFolder(new URL(request.url).searchParams.get('car'));
    const [cars, setups, imports] = await Promise.all([listLibraryCars(), car ? listCarSetups(car) : Promise.resolve([]), listImports(10)]);
    return NextResponse.json({ cars, setups, imports });
  } catch (error) {
    console.error('Car setup library error:', error);
    return NextResponse.json({ error: 'Failed to load the setups' }, { status: 500 });
  }
}
