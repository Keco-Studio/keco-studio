import { Cell } from '@mdxeditor/gurx';
import {
  addExportVisitor$,
  addImportVisitor$,
  createRootEditorSubscription$,
  realmPlugin,
  rootEditor$,
} from '@mdxeditor/editor';
import {
  documentHeadingExportVisitor,
  documentHeadingImportVisitor,
  documentListItemExportVisitor,
  documentParagraphExportVisitor,
  documentParagraphImportVisitor,
  normalizeDocumentBlockIds,
  registerDocumentBlockIdentity,
} from '@/lib/documents/documentBlockIdentity';

export type DocumentBlockIdentityPluginParams = {
  assignMissingIds: boolean;
};

const assignMissingDocumentBlockIds$ = Cell(false);

export const documentBlockIdentityPlugin =
  realmPlugin<DocumentBlockIdentityPluginParams>({
    init(realm, params) {
      realm.pub(
        assignMissingDocumentBlockIds$,
        params?.assignMissingIds ?? false
      );
      realm.pubIn({
        [addImportVisitor$]: [
          documentParagraphImportVisitor,
          documentHeadingImportVisitor,
        ],
        [addExportVisitor$]: [
          documentParagraphExportVisitor,
          documentHeadingExportVisitor,
          documentListItemExportVisitor,
        ],
      });
      realm.pub(createRootEditorSubscription$, (editor) =>
        registerDocumentBlockIdentity(editor, () =>
          realm.getValue(assignMissingDocumentBlockIds$)
        )
      );
    },
    update(realm, params) {
      const assignMissingIds = params?.assignMissingIds ?? false;
      const wasAssigning = realm.getValue(assignMissingDocumentBlockIds$);
      realm.pub(assignMissingDocumentBlockIds$, assignMissingIds);
      if (assignMissingIds && !wasAssigning) {
        realm
          .getValue(rootEditor$)
          ?.update(() => normalizeDocumentBlockIds(), { discrete: true });
      }
    },
  });
