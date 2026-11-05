import { readScriptCharacterProfiles, scanScriptCharacterProfiles } from './scriptCharacterProfiles';

it('ends character metadata before an explicit scene annotation', () => {
  const lines = ['**Character - \u5c0f\u96e8**', '*\u9ec4\u8272\u96e8\u8863.*', '*\u5730\u70b9：\u516c\u4ea4\u7ad9。*', '\u5c0f\u96e8: \u7b49\u8f66。'];
  expect(scanScriptCharacterProfiles(lines).profiles).toEqual([{name: '\u5c0f\u96e8', description: '\u9ec4\u8272\u96e8\u8863.'}]);
  expect([...scanScriptCharacterProfiles(lines).metadataIndexes]).toEqual([0, 1]);
});

it('reads explicit profiles and stops at the next scene or dialogue', () => {
  const text = '**Character - \u5b88\u5854\u4eba**\n*\u5e74\u957f\u7537\u6027, \u7a7f\u65e7\u96e8\u8863.*\n*\u6027\u683c\u8c28\u614e, \u8bbf\u5ba2\u7684\u5bfc\u5e08.*\n\n**\u65e7\u706f\u5854**\n*\u6d77\u98ce\u5439\u52a8\u7a97\u5e18.*\n\u5b88\u5854\u4eba: \u8fdb\u6765\u5427.';
  expect(readScriptCharacterProfiles(text)).toEqual([{ name: '\u5b88\u5854\u4eba', description: '\u5e74\u957f\u7537\u6027, \u7a7f\u65e7\u96e8\u8863.\n\u6027\u683c\u8c28\u614e, \u8bbf\u5ba2\u7684\u5bfc\u5e08.' }]);
  expect([...scanScriptCharacterProfiles(text.split('\n')).metadataIndexes]).toEqual([0, 1, 2]);
});
