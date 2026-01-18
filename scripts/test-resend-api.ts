/**
 * Test Resend API Configuration
 * 
 * This script tests if the Resend API key is valid and working.
 * Run: npx tsx scripts/test-resend-api.ts
 */

import { Resend } from 'resend';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testResendAPI() {
  console.log('🔍 Testing Resend API Configuration...\n');

  // Check if API key exists
  const apiKey = process.env.RESEND_API_KEY;
  console.log('1. API Key Check:');
  if (!apiKey) {
    console.error('   ❌ RESEND_API_KEY not found in .env.local');
    console.log('\n💡 Solution:');
    console.log('   1. Go to https://resend.com/api-keys');
    console.log('   2. Create a new API key');
    console.log('   3. Add to .env.local: RESEND_API_KEY=re_your_key_here');
    process.exit(1);
  }
  console.log(`   ✅ API Key exists (${apiKey.substring(0, 10)}...)`);

  // Check API key format
  console.log('\n2. API Key Format:');
  if (!apiKey.startsWith('re_')) {
    console.error('   ❌ API Key should start with "re_"');
    console.log('   Current format:', apiKey.substring(0, 20) + '...');
    process.exit(1);
  }
  console.log('   ✅ Format looks correct');

  // Test API connection
  console.log('\n3. Testing API Connection:');
  const resend = new Resend(apiKey);
  
  try {
    // Try to send a test email
    const testEmail = process.env.TEST_EMAIL || '111@qq.com';
    console.log(`   Sending test email to: ${testEmail}`);
    
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Keco Studio <invites@resend.dev>',
      to: testEmail,
      subject: 'Resend API Test',
      html: '<p>This is a test email from Keco Studio. If you receive this, Resend is working correctly!</p>',
    });

    if (result.error) {
      console.error('   ❌ API Error:', result.error);
      console.log('\n🔧 Common issues:');
      console.log('   - API key might be invalid or revoked');
      console.log('   - API key might not have sending permissions');
      console.log('   - Network/firewall issues');
      console.log('\n💡 Try:');
      console.log('   1. Generate a new API key at https://resend.com/api-keys');
      console.log('   2. Make sure to select "Full Access" or "Sending Access"');
      console.log('   3. Update RESEND_API_KEY in .env.local');
      process.exit(1);
    }

    console.log('   ✅ Test email sent successfully!');
    console.log('   Email ID:', result.data?.id);
    console.log('\n📧 Check your inbox:', testEmail);
    console.log('📊 View logs: https://resend.com/logs');
    
  } catch (error) {
    console.error('   ❌ Connection failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
    }
    console.log('\n🔧 Possible causes:');
    console.log('   - Network connectivity issues');
    console.log('   - Firewall blocking requests to api.resend.com');
    console.log('   - Invalid API key');
    process.exit(1);
  }

  console.log('\n✨ All tests passed! Resend is configured correctly.');
}

testResendAPI();

