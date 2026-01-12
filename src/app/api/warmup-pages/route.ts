import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 增加超时时间，因为要访问多个页面

/**
 * 页面预热端点
 * 用于预热 Vercel Serverless Functions（页面路由）
 * 
 * 这个端点会访问应用中的关键页面，确保它们的 serverless functions 保持温暖
 */
export async function GET(request: Request) {
  try {
    // 验证请求来源（可选，用于安全性）
    const authHeader = request.headers.get('authorization');
    const token = process.env.CRON_SECRET;
    
    if (token && authHeader !== `Bearer ${token}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const results = {
      timestamp: new Date().toISOString(),
      warmedEndpoints: [] as any[],
      errors: [] as any[],
    };

    // 1. 预热 Supabase - 查询 projects 表
    try {
      const projectsResponse = await fetch(
        `${supabaseUrl}/rest/v1/projects?select=id,name&limit=3`,
        {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      );
      
      results.warmedEndpoints.push({
        name: 'Supabase - projects',
        status: projectsResponse.status,
        success: projectsResponse.ok,
      });

      // 如果有 projects，继续预热其他表
      if (projectsResponse.ok) {
        const projects = await projectsResponse.json();
        
        // 2. 预热 libraries 表
        const librariesResponse = await fetch(
          `${supabaseUrl}/rest/v1/libraries?select=id&limit=3`,
          {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );
        
        results.warmedEndpoints.push({
          name: 'Supabase - libraries',
          status: librariesResponse.status,
          success: librariesResponse.ok,
        });

        // 3. 预热 folders 表
        const foldersResponse = await fetch(
          `${supabaseUrl}/rest/v1/folders?select=id&limit=3`,
          {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );
        
        results.warmedEndpoints.push({
          name: 'Supabase - folders',
          status: foldersResponse.status,
          success: foldersResponse.ok,
        });

        // 4. 预热 assets 表
        const assetsResponse = await fetch(
          `${supabaseUrl}/rest/v1/assets?select=id&limit=3`,
          {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );
        
        results.warmedEndpoints.push({
          name: 'Supabase - assets',
          status: assetsResponse.status,
          success: assetsResponse.ok,
        });
      }
    } catch (error) {
      results.errors.push({
        endpoint: 'Supabase queries',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const successCount = results.warmedEndpoints.filter(e => e.success).length;
    const totalCount = results.warmedEndpoints.length;

    return NextResponse.json({
      status: 'warmed',
      message: `Successfully warmed ${successCount}/${totalCount} endpoints`,
      timestamp: results.timestamp,
      details: results,
    });
  } catch (error) {
    console.error('Warmup pages error:', error);
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

