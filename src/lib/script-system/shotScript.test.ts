import { checkBoard, example, fromScript, sceneHtml } from './shotScript';
describe('shot script generation', () => {
  it('retains actual sparse choice targets and scene names from Script', () => {
    const board=fromScript([
      {id:'a',values:{Content:'\u5f00\u95e8？',Option12:'\u5f00\u95e8',Option12_Next:'Jump B',Option20:'\u7b49\u5f85',Option20_Next:'Jump A',Label:'A'}},
      {id:'b',values:{Label:'B',Content:'\u4f60\u597d',Name:'\u6765\u5ba2',Commands:'End'}},
    ],'\u95e8\u5385',new Map([['b','\u8d70\u5eca']]));
    expect(board.shots[0].exits).toEqual([{label:'\u5f00\u95e8',target:'b'},{label:'\u7b49\u5f85',target:'a'}]);
    expect(board.shots[1]).toMatchObject({scene:'\u8d70\u5eca',speaker:'\u6765\u5ba2',exits:[]});
  });
  it('rejects dangling targets and treats script-like dialogue as text in the export',()=>{
    const board=structuredClone(example);
    board.shots[0].line='</script><script>alert(1)</script>';
    expect(sceneHtml(board)).not.toContain(board.shots[0].line);
    board.shots[0].exits[0].target='missing';
    expect(()=>checkBoard(board)).toThrow('branch targets');
  });
});
