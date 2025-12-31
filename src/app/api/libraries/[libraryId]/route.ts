import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyLibraryAccess } from '@/lib/services/authorizationService';

type Params = { params: Promise<{ libraryId: string }> };

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function GET(_req: Request, { params }: Params) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { libraryId } = await params;
  
  // verify library access
  if (isUuid(libraryId)) {
    try {
      await verifyLibraryAccess(supabase, libraryId);
    } catch (e: any) {
      if (e.name === 'AuthorizationError') {
        return NextResponse.json({ error: e.message }, { status: 403 });
      }
      return NextResponse.json({ error: e?.message || 'Library not found' }, { status: 404 });
    }
  }
  
  let query = supabase.from('libraries').select('*');
  if (isUuid(libraryId)) {
    query = query.eq('id', libraryId);
  } else {
    query = query.eq('name', libraryId);
  }

  const { data, error } = await query.single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

