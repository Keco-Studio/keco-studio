import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10; // Vercel 函数最大执行时间

export async function GET(request: Request) {
  try {
    // 验证请求来源（可选，用于安全性）
    const authHeader = request.headers.get('authorization');
    const token = process.env.CRON_SECRET;
    
    // 如果设置了 CRON_SECRET，则验证
    if (token && authHeader !== `Bearer ${token}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // 增强的预热策略：预热多个关键表，模拟实际用户操作
    const warmupResults = [];

    // 1. 预热 projects 表（最常访问）
    const projectsResponse = await fetch(
      `${supabaseUrl}/rest/v1/projects?select=id,name,created_at&limit=5`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );
    warmupResults.push({ table: 'projects', status: projectsResponse.status });

    // 2. 预热 libraries 表
    const librariesResponse = await fetch(
      `${supabaseUrl}/rest/v1/libraries?select=id,name&limit=5`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );
    warmupResults.push({ table: 'libraries', status: librariesResponse.status });

    // 3. 预热 folders 表
    const foldersResponse = await fetch(
      `${supabaseUrl}/rest/v1/folders?select=id&limit=5`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );
    warmupResults.push({ table: 'folders', status: foldersResponse.status });

    // 4. 预热 assets 表
    const assetsResponse = await fetch(
      `${supabaseUrl}/rest/v1/assets?select=id&limit=5`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );
    warmupResults.push({ table: 'assets', status: assetsResponse.status });

    const successCount = warmupResults.filter(r => r.status === 200 || r.status === 404).length;

    return NextResponse.json({ 
      status: 'warmed',
      timestamp: new Date().toISOString(),
      message: `Supabase warmed: ${successCount}/${warmupResults.length} tables queried`,
      debug: {
        tables: warmupResults,
        allSuccess: successCount === warmupResults.length
      }
    });
  } catch (error) {
    // 只有在完全无法连接时才返回错误
    console.error('Warmup error:', error);
    return NextResponse.json({ 
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

