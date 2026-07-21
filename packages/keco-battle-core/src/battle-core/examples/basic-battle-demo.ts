import {
  BattleEntity,
  BattleTickEngine,
  BattleCommand,
  createBattleSession,
  enqueueBattleCommand
} from '..'

function buildEntity(input: {
  id: string
  name: string
  x: number
  y: number
  atk: number
  def: number
}): BattleEntity {
  return {
    id: input.id,
    name: input.name,
    team: input.id === 'left-1' ? 'left' : 'right',
    position: { x: input.x, y: input.y },
    resources: {
      hp: 30,
      maxHp: 30,
      mp: 20,
      maxMp: 20,
      stamina: 20,
      maxStamina: 20,
      rage: 0,
      maxRage: 100,
      shield: 0,
      maxShield: 24
    },
    atk: input.atk,
    def: input.def,
    spd: 10,
    skillSlots: [
      { skillId: 'arcane_bolt', cooldownTick: 0 },
      { skillId: 'frost_lock', cooldownTick: 0 }
    ],
    defending: false,
    alive: true,
    effects: []
  }
}

function runDemo(): void {
  const left = buildEntity({
    id: 'left-1',
    name: 'Knight',
    x: 1,
    y: 1,
    atk: 8,
    def: 3
  })
  const right = buildEntity({
    id: 'right-1',
    name: 'Mage',
    x: 2,
    y: 1,
    atk: 7,
    def: 2
  })

  let session = createBattleSession({ left, right })
  const engine = new BattleTickEngine()

  const commands: BattleCommand[] = [
    {
      commandId: 'cmd-1',
      sessionId: session.id,
      actorId: left.id,
      targetId: right.id,
      tick: 1,
      action: 'basic_attack'
    },
    {
      commandId: 'cmd-2',
      sessionId: session.id,
      actorId: right.id,
      tick: 1,
      action: 'cast_skill',
      skillId: 'frost_lock',
      targetId: left.id
    },
    {
      commandId: 'cmd-3',
      sessionId: session.id,
      actorId: left.id,
      targetId: right.id,
      tick: 2,
      action: 'basic_attack'
    },
    {
      commandId: 'cmd-4',
      sessionId: session.id,
      actorId: right.id,
      targetId: left.id,
      tick: 3,
      action: 'cast_skill',
      skillId: 'arcane_bolt'
    },
    {
      commandId: 'cmd-5',
      sessionId: session.id,
      actorId: left.id,
      targetId: right.id,
      tick: 3,
      action: 'basic_attack'
    }
  ]

  commands.forEach((command) => {
    session = enqueueBattleCommand(session, command)
  })

  for (let index = 0; index < 7 && session.result === 'ongoing'; index += 1) {
    const result = engine.tick(session)
    session = result.session
    console.log(`tick=${session.tick} applied=${result.appliedCommandCount} result=${session.result}`)
    console.log(
      `leftHP=${session.left.resources.hp} rightHP=${session.right.resources.hp} leftEffects=${session.left.effects
        .map((effect) => `${effect.effectType}:${effect.remainingTick}`)
        .join(',') || '-'}`
    )
  }

  console.log('---- events ----')
  session.events.forEach((event) => {
    console.log(`[${event.tick}] ${event.type} ${JSON.stringify(event.payload)}`)
  })
}

runDemo()

