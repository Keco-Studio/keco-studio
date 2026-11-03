import { checkBoard, example, fromScript, sceneHtml } from './shotScript';
describe('shot script generation', () => {
  it('retains actual sparse choice targets and scene names from Script', () => {
    const board=fromScript([
      {id:'a',values:{Content:'开门？',Option12:'开门',Option12_Next:'Jump B',Option20:'等待',Option20_Next:'Jump A',Label:'A'}},
      {id:'b',values:{Label:'B',Content:'你好',Name:'来客',Commands:'End'}},
    ],'门厅',new Map([['b','走廊']]));
    expect(board.shots[0].exits).toEqual([{label:'开门',target:'b'},{label:'等待',target:'a'}]);
    expect(board.shots[1]).toMatchObject({scene:'走廊',speaker:'来客',exits:[]});
  });
  it('rejects dangling targets and treats script-like dialogue as text in the export',()=>{
    const board=structuredClone(example);
    board.shots[0].line='</script><script>alert(1)</script>';
    expect(sceneHtml(board)).not.toContain(board.shots[0].line);
    board.shots[0].exits[0].target='missing';
    expect(()=>checkBoard(board)).toThrow('分支目标');
  });
});
