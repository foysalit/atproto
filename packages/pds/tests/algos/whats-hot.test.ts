import AtpAgent, { AtUri } from '@atproto/api'
import { runTestServer, TestServerInfo } from '../_util'
import { SeedClient } from '../seeds/client'
import basicSeed from '../seeds/basic'
import { makeAlgos } from '../../src'
import { HOUR } from '@atproto/common'

describe('algo whats-hot', () => {
  let server: TestServerInfo
  let agent: AtpAgent
  let sc: SeedClient

  // account dids, for convenience
  let alice: string
  let bob: string

  const feedPublisherDid = 'did:example:feed-publisher'
  const feedUri = AtUri.make(
    feedPublisherDid,
    'app.bsky.feed.generator',
    'whats-hot',
  ).toString()

  beforeAll(async () => {
    server = await runTestServer(
      {
        dbPostgresSchema: 'algo_whats_hot',
      },
      {
        algos: makeAlgos(feedPublisherDid),
      },
    )
    agent = new AtpAgent({ service: server.url })
    sc = new SeedClient(agent)
    await basicSeed(sc)

    alice = sc.dids.alice
    bob = sc.dids.bob
    await server.ctx.backgroundQueue.processAll()
  })

  afterAll(async () => {
    await server.close()
  })

  it('returns well liked posts', async () => {
    const img = await sc.uploadFile(
      alice,
      'tests/image/fixtures/key-landscape-small.jpg',
      'image/jpeg',
    )
    const one = await sc.post(alice, 'first post', undefined, [img])
    const two = await sc.post(bob, 'bobby boi')
    const three = await sc.post(bob, 'another one')

    for (let i = 0; i < 12; i++) {
      const name = `user${i}`
      await sc.createAccount(name, {
        handle: `user${i}.test`,
        email: `user${i}@test.com`,
        password: 'password',
      })
      if (i > 3) {
        await sc.like(sc.dids[name], one.ref)
      }
      if (i > 5) {
        await sc.like(sc.dids[name], two.ref)
      }
      await sc.like(sc.dids[name], three.ref)
    }
    await server.ctx.backgroundQueue.processAll()

    // move the 3rd post 5 hours into the past to check gravity
    await server.ctx.db.db
      .updateTable('post')
      .where('uri', '=', three.ref.uriStr)
      .set({ indexedAt: new Date(Date.now() - 5 * HOUR).toISOString() })
      .execute()
    const res = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri },
      { headers: sc.getHeaders(alice) },
    )
    expect(res.data.feed[0].post.uri).toBe(one.ref.uriStr)
    expect(res.data.feed[1].post.uri).toBe(two.ref.uriStr)
    const indexOfThird = res.data.feed.findIndex(
      (item) => item.post.uri === three.ref.uriStr,
    )
    // doesn't quite matter where this cam in but it should be down-regulated pretty severely from gravity
    expect(indexOfThird).toBeGreaterThan(3)
  })

  it('paginates', async () => {
    const res = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri },
      { headers: sc.getHeaders(alice) },
    )
    const first = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri, limit: 3 },
      { headers: sc.getHeaders(alice) },
    )
    const second = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri, cursor: first.data.cursor },
      { headers: sc.getHeaders(alice) },
    )

    expect([...first.data.feed, ...second.data.feed]).toEqual(res.data.feed)
  })
})
