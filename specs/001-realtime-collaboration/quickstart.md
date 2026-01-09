# Quickstart Guide: Real-time Project Collaboration

**Feature**: Real-time Project Collaboration  
**Date**: 2026-01-08  
**Purpose**: Setup instructions and development workflow guide

## Prerequisites

- Node.js 18+ installed
- Supabase CLI installed (`npm install -g supabase`)
- Supabase project with Realtime enabled
- Resend account for email sending (free tier sufficient for dev)
- Git repository cloned

---

## Environment Setup

### 1. Environment Variables

Create/update `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Email Service (Resend)
RESEND_API_KEY=re_your_resend_api_key

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Invitation Security
INVITATION_SECRET=your-32-character-random-secret-key-here

# Optional: Rate Limiting (if using Vercel Edge Config)
EDGE_CONFIG=your-edge-config-connection-string
```

**Generate invitation secret**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Install Dependencies

```bash
npm install
```

**New dependencies** (if not already present):
```bash
npm install jose  # For JWT token signing/verification
npm install resend @react-email/components  # For email sending
```

### 3. Database Migrations

Run migrations to create collaboration tables:

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push

# Or manually apply:
psql $DATABASE_URL -f supabase/migrations/20260108000000_create_project_collaborators.sql
psql $DATABASE_URL -f supabase/migrations/20260108000001_create_collaboration_invitations.sql
psql $DATABASE_URL -f supabase/migrations/20260108000002_add_avatar_color_to_profiles.sql
psql $DATABASE_URL -f supabase/migrations/20260108000003_update_rls_for_collaboration.sql
psql $DATABASE_URL -f supabase/migrations/20260108000004_enable_realtime_for_collaboration.sql
psql $DATABASE_URL -f supabase/migrations/20260108000005_backfill_project_owners_as_admins.sql
```

### 4. Enable Supabase Realtime

In Supabase Dashboard:
1. Go to **Database** → **Replication**
2. Enable replication for:
   - `project_collaborators`
   - `library_assets`
   - `library_asset_values`
3. Save changes

Or via SQL:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_collaborators;
ALTER PUBLICATION supabase_realtime ADD TABLE public.library_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.library_asset_values;
```

### 5. Configure Resend

1. Sign up at [resend.com](https://resend.com)
2. Verify your sending domain (or use Resend test domain for dev)
3. Generate API key from dashboard
4. Add to `.env.local` as `RESEND_API_KEY`

**Test email sending**:
```bash
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "onboarding@resend.dev",
    "to": "your-email@example.com",
    "subject": "Test Email",
    "html": "<p>It works!</p>"
  }'
```

---

## Development Workflow

### Start Development Server

```bash
npm run dev
```

Access at `http://localhost:3000`

### Test Collaboration with Multiple Users

#### Option 1: Multiple Browser Profiles

1. Open Chrome regular window → Sign in as User A
2. Open Chrome incognito window → Sign in as User B
3. Navigate both to same project library page
4. Edit cells and observe real-time updates

#### Option 2: Multiple Browsers

1. Chrome → Sign in as User A
2. Firefox → Sign in as User B
3. Navigate to same library
4. Test presence indicators and editing

#### Option 3: Multiple Devices

1. Desktop → User A
2. Laptop/Phone → User B
3. Same library
4. Test cross-device synchronization

### Testing Checklist

**Invitation Flow**:
- [ ] Admin can invite with admin/editor/viewer roles
- [ ] Editor can invite with editor/viewer roles only
- [ ] Viewer can invite with viewer role only
- [ ] Email received with correct accept link
- [ ] Invitation link works (redirects to project)
- [ ] Expired invitation shows error
- [ ] Already-accepted invitation shows error

**Collaborator Management**:
- [ ] Admin can view all collaborators
- [ ] Editor can view but not modify collaborators
- [ ] Admin can change collaborator roles
- [ ] Admin can remove collaborators
- [ ] Removed collaborator loses access immediately

**Real-time Editing**:
- [ ] Cell edits appear in <500ms for other users
- [ ] Multiple users editing different cells (no conflicts)
- [ ] Multiple users editing same cell (last-write-wins)
- [ ] Asset creation broadcasts to all users
- [ ] Asset deletion broadcasts to all users

**Presence Indicators**:
- [ ] Active users shown in header with avatars
- [ ] User avatars appear on focused cells
- [ ] Avatar colors consistent across sessions
- [ ] Stacked avatars when multiple users in same cell
- [ ] Presence disappears within 10s of user leaving

---

## Debugging

### Enable Realtime Logging

```typescript
// Add to library page component
useEffect(() => {
  supabase.realtime.setAuth(session?.access_token);
  
  // Enable debug logging
  supabase.realtime.onDebugMessage((message) => {
    console.log('[Realtime Debug]:', message);
  });
}, [session]);
```

### Check Realtime Connection

```typescript
const channel = supabase.channel('test-connection');

channel.on('system', {}, (payload) => {
  console.log('Channel status:', payload.status);
});

await channel.subscribe((status) => {
  console.log('Subscription status:', status);
});
```

### Verify RLS Policies

```sql
-- Check if user can see collaborators
SELECT * FROM public.project_collaborators
WHERE project_id = 'your-project-id';

-- Check user's role
SELECT role FROM public.project_collaborators
WHERE user_id = auth.uid() AND project_id = 'your-project-id';

-- Test policy directly
SELECT *
FROM public.library_assets
WHERE library_id = 'your-library-id';
```

### Inspect Presence State

```typescript
const presenceChannel = supabase.channel(`library:${libraryId}:presence`);

presenceChannel.on('presence', { event: 'sync' }, () => {
  const state = presenceChannel.presenceState();
  console.log('Active users:', Object.values(state).flat());
});
```

### Check Email Delivery

In development, Resend test mode shows emails in dashboard:
1. Go to [resend.com/emails](https://resend.com/emails)
2. View sent emails (not actually delivered in test mode)
3. Check invitation token and link format

---

## Common Issues

### Issue: Realtime not working

**Symptoms**: Cell edits don't appear for other users

**Solutions**:
1. Verify Realtime enabled in Supabase dashboard
2. Check tables added to `supabase_realtime` publication
3. Verify `access_token` passed to Realtime auth
4. Check browser console for WebSocket errors
5. Test with simple channel subscription first

```typescript
// Minimal test
const testChannel = supabase.channel('test');
testChannel.on('broadcast', { event: 'test' }, (payload) => {
  console.log('Received:', payload);
});
await testChannel.subscribe();
await testChannel.send({ type: 'broadcast', event: 'test', payload: { hello: 'world' } });
```

### Issue: RLS policies blocking access

**Symptoms**: 403 errors or empty data

**Solutions**:
1. Check user authenticated: `const { data: { user } } = await supabase.auth.getUser()`
2. Verify user is collaborator: Query `project_collaborators` table
3. Test policy with `auth.uid()`:
   ```sql
   SELECT auth.uid(); -- Should return user UUID
   ```
4. Temporarily disable RLS for debugging (re-enable after):
   ```sql
   ALTER TABLE public.project_collaborators DISABLE ROW LEVEL SECURITY;
   ```

### Issue: Invitation emails not sending

**Symptoms**: No email received

**Solutions**:
1. Check Resend API key valid
2. Verify `RESEND_API_KEY` in `.env.local`
3. Check sending domain verified (or use `onboarding@resend.dev` for testing)
4. Look for errors in server logs
5. Test API key with curl command (see setup section)

### Issue: Avatar colors not showing

**Symptoms**: Borders/avatars have no color

**Solutions**:
1. Check `avatar_color` column exists in `profiles` table
2. Run backfill migration to generate colors for existing users
3. Verify trigger fires for new users:
   ```sql
   SELECT avatar_color FROM public.profiles WHERE id = 'user-id';
   ```
4. Check color generation function works:
   ```sql
   SELECT public.generate_avatar_color('123e4567-e89b-12d3-a456-426614174000');
   ```

### Issue: Presence indicators not disappearing

**Symptoms**: User avatars remain after leaving

**Solutions**:
1. Verify `untrack()` called in useEffect cleanup
2. Check heartbeat interval not too frequent (should be 30s)
3. Test presence sync event listener:
   ```typescript
   presenceChannel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
     console.log('User left:', leftPresences);
   });
   ```

### Issue: Conflicts not resolving correctly

**Symptoms**: Cell values overwriting each other unexpectedly

**Solutions**:
1. Verify timestamp comparison logic (newer timestamp wins)
2. Check optimistic updates map cleared after broadcast
3. Add debug logging to conflict handler:
   ```typescript
   if (optimistic && optimistic.timestamp < timestamp) {
     console.log('Conflict detected:', { optimistic, remote: timestamp });
   }
   ```

---

## Testing with Playwright

### E2E Test Setup

```typescript
// tests/e2e/specs/collaboration.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Collaboration', () => {
  test('two users can edit simultaneously', async ({ browser }) => {
    // Create two contexts (separate users)
    const userA = await browser.newContext();
    const userB = await browser.newContext();
    
    const pageA = await userA.newPage();
    const pageB = await userB.newPage();
    
    // Sign in as different users
    await pageA.goto('/auth/signin');
    await pageA.fill('[name="email"]', 'user-a@test.com');
    await pageA.fill('[name="password"]', 'password');
    await pageA.click('button[type="submit"]');
    
    await pageB.goto('/auth/signin');
    await pageB.fill('[name="email"]', 'user-b@test.com');
    await pageB.fill('[name="password"]', 'password');
    await pageB.click('button[type="submit"]');
    
    // Navigate to same library
    await pageA.goto('/project-id/library-id');
    await pageB.goto('/project-id/library-id');
    
    // User A edits cell
    await pageA.click('[data-cell-id="asset-1-field-1"]');
    await pageA.fill('[data-cell-id="asset-1-field-1"] input', 'New value from A');
    await pageA.keyboard.press('Enter');
    
    // Wait for real-time update
    await pageB.waitForTimeout(1000);
    
    // User B sees update
    await expect(pageB.locator('[data-cell-id="asset-1-field-1"]')).toContainText('New value from A');
    
    // Cleanup
    await userA.close();
    await userB.close();
  });
});
```

### Run Tests

```bash
# Run all collaboration tests
npm run test:e2e -- tests/e2e/specs/collaboration.spec.ts

# Run with UI
npm run test:e2e -- tests/e2e/specs/collaboration.spec.ts --headed

# Debug mode
npm run test:e2e -- tests/e2e/specs/collaboration.spec.ts --debug
```

---

## Performance Monitoring

### Track Realtime Latency

```typescript
let latencies: number[] = [];

editChannel.on('broadcast', { event: 'cell:update' }, (payload) => {
  const event = payload.payload;
  const latency = Date.now() - event.timestamp;
  latencies.push(latency);
  
  // Log every 10 updates
  if (latencies.length === 10) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log('Average latency:', avg, 'ms');
    latencies = [];
  }
});
```

### Monitor Presence Updates

```typescript
let presenceUpdates = 0;

presenceChannel.on('presence', { event: 'sync' }, () => {
  presenceUpdates++;
  console.log('Presence updates:', presenceUpdates);
});
```

### Track Message Volume

```typescript
let messageCount = 0;

setInterval(() => {
  console.log('Messages per minute:', messageCount);
  messageCount = 0;
}, 60000);

editChannel.on('broadcast', { event: '*' }, () => {
  messageCount++;
});
```

---

## Production Checklist

Before deploying to production:

**Security**:
- [ ] Generate new `INVITATION_SECRET` (different from dev)
- [ ] Verify Resend domain authenticated
- [ ] Test RLS policies with production data
- [ ] Enable rate limiting for invitations
- [ ] Add audit logging for role changes

**Performance**:
- [ ] Test with 10 concurrent users
- [ ] Measure real-time latency (<500ms)
- [ ] Verify presence cleanup works (stale sessions removed)
- [ ] Monitor Supabase Realtime connection limits
- [ ] Enable CDN for static assets

**Monitoring**:
- [ ] Setup error tracking (Sentry, etc.)
- [ ] Monitor email delivery rates
- [ ] Track invitation acceptance rates
- [ ] Log failed permission checks
- [ ] Alert on high realtime latency

**Documentation**:
- [ ] Update user guide with collaboration features
- [ ] Create admin guide for managing collaborators
- [ ] Document troubleshooting steps
- [ ] Write release notes

---

## Next Steps

After completing this quickstart:

1. **Implement Core Features**:
   - Start with invitation system (P1)
   - Add collaborator management UI (P1)
   - Implement real-time editing (P2)
   - Add presence indicators (P2)
   - Handle conflict resolution (P3)

2. **Run Tests**:
   - Unit tests for services
   - Integration tests for API
   - E2E tests for full workflows

3. **Polish UI**:
   - Extract Figma designs with F2C MCP
   - Implement pixel-perfect components
   - Add loading states and error handling
   - Responsive design testing

4. **Deploy**:
   - Deploy to staging environment
   - User acceptance testing
   - Performance testing with concurrent users
   - Deploy to production

---

## Resources

- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime)
- [Resend Documentation](https://resend.com/docs)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [RLS Policy Examples](https://supabase.com/docs/guides/auth/row-level-security)
- [Playwright Testing](https://playwright.dev/)

---

## Support

For issues or questions:
- Check GitHub issues for similar problems
- Review error logs in browser console and server
- Test with minimal reproduction case
- Document steps to reproduce before reporting

