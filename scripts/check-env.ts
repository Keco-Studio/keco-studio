/**
 * 检查环境变量配置
 * 用于验证清理脚本所需的环境变量是否已正确设置
 * 
 * Usage:
 *   tsx scripts/check-env.ts
 */

import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env and .env.local
// .env.local will override .env (same as Next.js and Playwright config)
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ 
  path: path.resolve(__dirname, '../.env.local'), 
  override: true // Allow .env.local variables to override .env
});

const requiredVars = {
  'NEXT_PUBLIC_SUPABASE_URL': 'Supabase 项目 URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'Supabase Anon Key',
  'SUPABASE_SERVICE_ROLE_KEY': 'Supabase Service Role Key（用于清理数据）',
};

console.log('🔍 检查环境变量配置...\n');

let allSet = true;

for (const [varName, description] of Object.entries(requiredVars)) {
  const value = process.env[varName];
  const isSet = !!value;
  
  if (isSet) {
    // 只显示前10个字符和后4个字符，中间用 ... 代替
    const masked = value.length > 14 
      ? `${value.substring(0, 10)}...${value.substring(value.length - 4)}`
      : '***';
    console.log(`✅ ${varName}`);
    console.log(`   描述: ${description}`);
    console.log(`   值: ${masked}\n`);
  } else {
    console.log(`❌ ${varName}`);
    console.log(`   描述: ${description}`);
    console.log(`   状态: 未设置\n`);
    allSet = false;
  }
}

if (allSet) {
  console.log('✨ 所有必需的环境变量都已设置！');
  console.log('   现在可以运行: tsx scripts/clean-remote-test-data.ts\n');
} else {
  console.log('⚠️  缺少必需的环境变量！');
  console.log('   请在 .env.local 文件中添加缺失的变量。');
  console.log('   参考: tests/e2e/SECURITY_TEST_GUIDE.md\n');
  process.exit(1);
}

