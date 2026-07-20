import { describe, expect, it } from '@jest/globals';
import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture } from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('document-derived library database invariants', () => {
  it('follows a document move, rejects independent movement, and cascades deletion', async () => {
    const fx = await buildProjectFixture();
    try {
      const { data: doc } = await fx.svc.from('documents').insert({
        project_id: fx.projectId,
        name: `source-${fx.suffix}`,
        content: '',
        created_by: fx.owner.id,
      }).select('id').single();
      const { data: child } = await fx.svc.from('libraries').insert({
        project_id: fx.projectId,
        folder_id: null,
        name: `child-${fx.suffix}`,
        source_document_id: doc!.id,
        document_export_type: 'table',
      }).select('id').single();

      const folder = await fx.svc.from('folders').insert({
        project_id: fx.projectId,
        name: `target-${fx.suffix}`,
      }).select('id').single();
      expect((await fx.svc.from('documents').update({ folder_id: folder.data!.id }).eq('id', doc!.id)).error).toBeNull();
      expect((await fx.svc.from('libraries').select('folder_id').eq('id', child!.id).single()).data?.folder_id)
        .toBe(folder.data!.id);

      expect((await fx.svc.from('libraries').update({ folder_id: null }).eq('id', child!.id)).error).not.toBeNull();
      expect((await fx.svc.from('documents').delete().eq('id', doc!.id)).error).toBeNull();
      expect((await fx.svc.from('libraries').select('id').eq('id', child!.id)).data).toEqual([]);
    } finally {
      await teardownProjectFixture(fx);
    }
  });
});
