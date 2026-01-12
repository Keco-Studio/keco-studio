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

    // 策略1: 直接 HTTP 请求到 Supabase REST API（最可靠）
    // 这个请求会唤醒数据库连接，无论表是否有数据
    const response = await fetch(
      `${supabaseUrl}/rest/v1/projects?select=id&limit=1`,
      {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    // 只要收到响应（即使是错误），就说明 Supabase 已被唤醒
    const responseData = await response.text();
    const isSuccess = response.ok || response.status === 404 || response.status === 400;

    if (!isSuccess) {
      console.warn('Warmup response status:', response.status, responseData);
    }

    return NextResponse.json({ 
      status: 'warmed',
      timestamp: new Date().toISOString(),
      message: 'Supabase connection warmed up successfully',
      debug: {
        httpStatus: response.status,
        responseReceived: true
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

