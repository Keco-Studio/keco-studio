import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * 智能预热端点
 * 
 * 解决两个冷启动问题：
 * 1. Supabase 数据库冷启动
 * 2. Vercel Serverless Functions (页面路由) 冷启动
 * 
 * 策略：
 * - 查询 Supabase 多个表，保持数据库连接活跃
 * - 获取最近更新的项目 ID
 * - 向这些项目的页面发送 HEAD 请求，唤醒 serverless functions
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = process.env.CRON_SECRET;
    
    if (token && authHeader !== `Bearer ${token}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.headers.get('host') 
      ? `https://${request.headers.get('host')}`
      : 'https://keco-studio.vercel.app';

    const results = {
      timestamp: new Date().toISOString(),
      supabase: [] as any[],
      pageWarmups: [] as any[],
      errors: [] as any[],
    };

    // 1. 预热 Supabase - 获取最近更新的项目
    try {
      const projectsResponse = await fetch(
        `${supabaseUrl}/rest/v1/projects?select=id,updated_at&order=updated_at.desc&limit=3`,
        {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      );

      results.supabase.push({
        table: 'projects',
        status: projectsResponse.status,
        success: projectsResponse.ok,
      });

      // 2. 如果成功获取项目，预热对应的页面路由
      if (projectsResponse.ok) {
        try {
          const projects = await projectsResponse.json();
          
          // 预热每个项目的页面（发送 HEAD 请求）
          const pageWarmupPromises = projects.slice(0, 2).map(async (project: any) => {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);

              const pageResponse = await fetch(
                `${baseUrl}/${project.id}`,
                {
                  method: 'HEAD',
                  headers: {
                    'User-Agent': 'Keco-Warmup-Bot/1.0',
                  },
                  signal: controller.signal,
                }
              );

              clearTimeout(timeoutId);

              return {
                url: `/${project.id}`,
                status: pageResponse.status,
                success: pageResponse.ok || pageResponse.status === 404 || pageResponse.status === 307,
              };
            } catch (error) {
              return {
                url: `/${project.id}`,
                status: 0,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown',
              };
            }
          });

          results.pageWarmups = await Promise.all(pageWarmupPromises);
        } catch (jsonError) {
          results.errors.push({
            stage: 'parsing projects',
            error: 'Failed to parse projects JSON',
          });
        }
      }
    } catch (error) {
      results.errors.push({
        stage: 'projects query',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 3. 预热其他关键表
    const tables = ['libraries', 'folders', 'assets'];
    const tablePromises = tables.map(async (table) => {
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/${table}?select=id&limit=3`,
          {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );

        return {
          table,
          status: response.status,
          success: response.ok || response.status === 404,
        };
      } catch (error) {
        return {
          table,
          status: 0,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown',
        };
      }
    });

    const tableResults = await Promise.all(tablePromises);
    results.supabase.push(...tableResults);

    const supabaseSuccess = results.supabase.filter(r => r.success).length;
    const pagesSuccess = results.pageWarmups.filter(r => r.success).length;
    const totalPages = results.pageWarmups.length;

    return NextResponse.json({
      status: 'warmed',
      message: `Warmed ${supabaseSuccess}/${results.supabase.length} DB tables, ${pagesSuccess}/${totalPages} page functions`,
      timestamp: results.timestamp,
      debug: {
        supabase: results.supabase,
        pages: results.pageWarmups,
        errors: results.errors.length > 0 ? results.errors : undefined,
      },
    });
  } catch (error) {
    console.error('Smart warmup error:', error);
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

